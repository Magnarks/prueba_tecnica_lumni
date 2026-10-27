import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type OpenAI from 'openai'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import {
  assistantExtractionSchema,
  emptyAssistantContext,
  mergeAssistantEvidence,
  type AssistantContext,
} from './assistant-extraction'
import {
  BookingConflictError,
  BookingUnavailableError,
  createBookingDraft,
  getBookingByAccessToken,
  type BookingCustomerInput,
  type BookingServicesInput,
} from './booking-service'
import { createAIClient, getAIConfiguration } from './ai-config'
import {
  createQuote,
  type QuoteRepository,
  type QuoteResult,
  type QuoteRoom,
} from './quote-service'

const MAX_CHAT_MESSAGE_LENGTH = 1_000
const MAX_CHAT_MESSAGES = 41

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2_000),
  createdAt: z.string(),
}).strict()

const chatMessagesSchema = z.array(chatMessageSchema).max(MAX_CHAT_MESSAGES)
const assistantContextSchema = z.object({
  roomId: z.number().int().positive().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  suggestedStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  durationHours: z.number().finite().nullable(),
  fullName: z.string().max(120).nullable(),
  email: z.string().email().max(254).nullable(),
  attendeeCount: z.number().int().min(1).max(100).nullable(),
  projector: z.boolean(),
  coffeePeople: z.number().int().min(0).max(30).nullable(),
}).strict()

export type AssistantChatMessage = z.infer<typeof chatMessageSchema>

export interface AssistantChatView {
  chatId: string
  messages: AssistantChatMessage[]
  draftBookingId: string | null
  quote: QuoteResult | null
}

export interface AssistantTurnResult extends AssistantChatView {
  message: string
  suggestedStartTime: string | null
}

export class AssistantChatNotFoundError extends Error {
  constructor() {
    super('No se encontró esta conversación o el acceso expiró.')
    this.name = 'AssistantChatNotFoundError'
  }
}

export class AssistantModelError extends Error {
  constructor() {
    super('No fue posible consultar el modelo local. Revisa AI_BASE_URL y AI_MODEL.')
    this.name = 'AssistantModelError'
  }
}

export class AssistantDraftAlreadyCreatedError extends Error {
  constructor(readonly bookingId: string) {
    super('Esta conversación ya tiene un borrador de reserva.')
    this.name = 'AssistantDraftAlreadyCreatedError'
  }
}

interface AssistantChatRow {
  chatId: string
  tokenHash: string
  context: unknown
  messages: unknown
  draftBookingId: string | null
}

function hashAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex')
}

function parseContext(value: unknown): AssistantContext {
  const parsed = assistantContextSchema.safeParse(value)
  return parsed.success ? parsed.data : emptyAssistantContext
}

function parseMessages(value: unknown): AssistantChatMessage[] {
  const parsed = chatMessagesSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

function newMessage(role: 'user' | 'assistant', content: string): AssistantChatMessage {
  return { role, content, createdAt: new Date().toISOString() }
}

async function findChat(
  pool: Pool,
  chatId: string,
  tokenHash: string,
): Promise<AssistantChatRow> {
  const result = await pool.query<AssistantChatRow>(
    `SELECT id::text AS "chatId",
            token_hash AS "tokenHash",
            context,
            messages,
            booking_id::text AS "draftBookingId"
     FROM reservation_chat_sessions
     WHERE id = $1 AND token_hash = $2 AND expires_at > now()`,
    [chatId, tokenHash],
  )

  const chat = result.rows[0]
  if (!chat) {
    throw new AssistantChatNotFoundError()
  }

  return chat
}

export async function createAssistantChat(pool: Pool): Promise<{
  chatId: string
  accessToken: string
  messages: AssistantChatMessage[]
  quote: null
}> {
  const accessToken = randomBytes(32).toString('base64url')
  const messages = [newMessage(
    'assistant',
    'Hola. Te ayudo a cotizar una sala. ¿Qué tamaño prefieres, para qué fecha y a qué hora?',
  )]
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reservation_chat_sessions (token_hash, context, messages)
     VALUES ($1, $2::jsonb, $3::jsonb)
     RETURNING id::text AS id`,
    [
      hashAccessToken(accessToken),
      JSON.stringify(emptyAssistantContext),
      JSON.stringify(messages),
    ],
  )

  return { chatId: result.rows[0].id, accessToken, messages, quote: null }
}

export async function getAssistantChat(
  pool: Pool,
  chatId: string,
  accessToken: string,
): Promise<AssistantChatView> {
  const chat = await findChat(pool, chatId, hashAccessToken(accessToken))
  const quote = chat.draftBookingId
    ? await getBookingByAccessToken(pool, chat.draftBookingId, accessToken).then((booking) => ({
      room: booking.room,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      durationHours: booking.durationHours,
      base: booking.base,
      discount: booking.discount,
      surcharge: booking.surcharge,
      total: booking.base - booking.discount + booking.surcharge,
      available: true,
      reason: null,
      suggestedStartTime: null,
    }))
    : null

  return {
    chatId: chat.chatId,
    messages: parseMessages(chat.messages),
    draftBookingId: chat.draftBookingId,
    quote,
  }
}

async function loadPromptAndRooms(pool: Pool): Promise<{ prompt: string; rooms: QuoteRoom[] }> {
  const [prompt, rooms] = await Promise.all([
    readFile(resolve(process.cwd(), 'server/prompts/reservation-assistant.md'), 'utf8'),
    pool.query<QuoteRoom>(
      `SELECT id, name, size, hourly_rate::float8 AS "hourlyRate"
       FROM rooms ORDER BY id`,
    ),
  ])

  return { prompt, rooms: rooms.rows }
}

async function extractAssistantFields(
  client: OpenAI,
  model: string,
  prompt: string,
  rooms: QuoteRoom[],
  userMessage: string,
  coffeeCountPending: boolean,
): Promise<ReturnType<typeof assistantExtractionSchema.parse>> {
  const catalogue = rooms.map((room) => `${room.name} (${room.size})`).join(', ')
  const pendingFieldInstruction = coffeeCountPending
    ? 'El servidor ya preguntó cuántas personas desean café. Si el mensaje actual es solo una cantidad, copia esa cantidad literalmente en coffeeEvidence. No la uses como attendeeCount.'
    : ''

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 1_024,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `${prompt}\n\nCatálogo disponible (solo nombre y tamaño; no hay capacidades): ${catalogue}\n${pendingFieldInstruction}`,
      },
      { role: 'user', content: userMessage },
    ],
  }).catch((error: unknown) => {
    console.error(
      'Falló la solicitud al modelo local.',
      error instanceof Error ? `${error.name}: ${error.message}` : 'Error desconocido',
    )
    throw new AssistantModelError()
  })
  const choice = completion.choices[0]
  const content = choice?.message.content

  if (!content) {
    console.error('El modelo local devolvió una respuesta vacía.', choice?.finish_reason ?? 'sin finish_reason')
    throw new AssistantModelError()
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(content)
  } catch {
    console.error('El modelo local no devolvió JSON válido.')
    throw new AssistantModelError()
  }

  const parsed = assistantExtractionSchema.safeParse(decoded)

  if (!parsed.success) {
    console.error(
      'La respuesta del modelo no cumple el schema de extracción.',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    )
    throw new AssistantModelError()
  }

  return parsed.data
}

function getBogotaReferenceDate(): Date {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  return new Date(`${date}T12:00:00-05:00`)
}

export function explicitlyAcceptsSuggestedTime(message: string): boolean {
  const normalized = message.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
      .replace(/[,.!¡¿?]/g, '')
    .trim()

  return /^(si|de acuerdo|me sirve|usa esa hora|acepto|esa hora|esa hora esta bien|perfecto)( por favor)?$/u.test(normalized)
}

export function getNextAssistantQuestion(context: AssistantContext): string | null {
  if (!context.roomId) {
    if (context.attendeeCount) {
      return `No tengo capacidad registrada por sala para ${context.attendeeCount} personas. ¿Qué tamaño prefieres: pequeña, mediana o grande?`
    }

    return '¿Qué tamaño de sala prefieres: pequeña, mediana o grande?'
  }

  if (!context.date) {
    return '¿Para qué fecha necesitas la sala? Puedes decir una fecha o un día, por ejemplo, “el sábado”.'
  }

  if (!context.startTime) {
    return '¿A qué hora exacta quieres empezar? “En la mañana” no alcanza para verificar disponibilidad.'
  }

  if (!context.durationHours) {
    return '¿Cuánto tiempo necesitas la sala? La duración puede ser de 1 a 10 horas, en bloques de 30 minutos.'
  }

  return null
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatQuoteReply(quote: Awaited<ReturnType<typeof createQuote>>): string {
  if (!quote.available) {
    const suggestion = quote.suggestedStartTime
      ? ` Puedo cotizarte a las ${quote.suggestedStartTime}; dime si quieres usar esa hora.`
      : ''

    return `${quote.reason ?? 'La sala no está disponible.'}${suggestion}`
  }

  return `${quote.room.name} está disponible el ${quote.date}, de ${quote.startTime} a ${quote.endTime}. Total: ${formatCurrency(quote.total)} COP.`
}

async function saveChatTurn(
  pool: Pool,
  chatId: string,
  tokenHash: string,
  context: AssistantContext,
  messages: AssistantChatMessage[],
): Promise<AssistantChatMessage[]> {
  const result = await pool.query<{ messages: unknown }>(
    `UPDATE reservation_chat_sessions
     SET context = $3::jsonb,
         messages = messages || $4::jsonb,
         updated_at = now()
     WHERE id = $1
       AND token_hash = $2
       AND expires_at > now()
       AND booking_id IS NULL
     RETURNING messages`,
    [chatId, tokenHash, JSON.stringify(context), JSON.stringify(messages)],
  )

  if (!result.rowCount) {
    throw new AssistantChatNotFoundError()
  }

  return parseMessages(result.rows[0].messages)
}

export async function sendAssistantMessage(
  pool: Pool,
  quoteRepository: QuoteRepository,
  chatId: string,
  accessToken: string,
  userMessage: string,
): Promise<AssistantTurnResult> {
  const trimmedMessage = userMessage.trim()

  if (!trimmedMessage || trimmedMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new RangeError('El mensaje debe tener entre 1 y 1.000 caracteres.')
  }

  const tokenHash = hashAccessToken(accessToken)
  const chat = await findChat(pool, chatId, tokenHash)
  const priorMessages = parseMessages(chat.messages)

  if (chat.draftBookingId) {
    return {
      chatId,
      messages: priorMessages,
      draftBookingId: chat.draftBookingId,
      quote: await getAssistantChat(pool, chatId, accessToken).then((resumed) => resumed.quote),
      message: 'Ya hay un borrador listo. Ábrelo en la aplicación para revisarlo y confirmarlo.',
      suggestedStartTime: null,
    }
  }

  if (priorMessages.filter((message) => message.role === 'user').length >= 20) {
    throw new RangeError('Esta conversación alcanzó el límite de mensajes. Crea una nueva conversación.')
  }

  const { prompt, rooms } = await loadPromptAndRooms(pool)
  const configuration = getAIConfiguration()
  const currentContext = parseContext(chat.context)
  const extraction = await extractAssistantFields(
    createAIClient(configuration),
    configuration.model,
    prompt,
    rooms,
    trimmedMessage,
    currentContext.coffeePeople === null,
  )
  let context = mergeAssistantEvidence(
    trimmedMessage,
    currentContext,
    extraction,
    rooms,
    getBogotaReferenceDate(),
  )
  const userTurn = newMessage('user', trimmedMessage)

  if (chatContextSuggestedTime(chat.context)) {
    const suggestedStartTime = chatContextSuggestedTime(chat.context) as string
    const previousContext = parseContext(chat.context)
    const hasProvidedNewTime = context.startTime !== previousContext.startTime

    if (explicitlyAcceptsSuggestedTime(trimmedMessage)) {
      context = { ...context, startTime: suggestedStartTime, suggestedStartTime: null }
    } else if (hasProvidedNewTime) {
      context = { ...context, suggestedStartTime: null }
    } else {
      const reply = `¿Quieres que use la hora sugerida de las ${suggestedStartTime}, o prefieres indicar otra hora?`
      const messages = await saveChatTurn(
        pool,
        chatId,
        tokenHash,
        context,
        [userTurn, newMessage('assistant', reply)],
      )

      return {
        chatId,
        messages,
        draftBookingId: null,
        message: reply,
        quote: null,
        suggestedStartTime,
      }
    }
  }

  let quote: Awaited<ReturnType<typeof createQuote>> | null = null
  let assistantMessage = getNextAssistantQuestion(context)

  if (!assistantMessage) {
    quote = await createQuote({
      roomId: context.roomId as number,
      date: context.date as string,
      startTime: context.startTime as string,
      durationHours: context.durationHours as number,
    }, quoteRepository)
    assistantMessage = formatQuoteReply(quote)
  }

  const assistantMessageWithDetails = assistantMessage ?? '¿Qué otro dato me puedes compartir?'

  if (!quote?.available) {
    let reply = assistantMessageWithDetails

    if (quote?.suggestedStartTime) {
      context = { ...context, suggestedStartTime: quote.suggestedStartTime }
      reply = `${reply} Confírmame si quieres usar ese horario.`
    }

    const messages = await saveChatTurn(
      pool,
      chatId,
      tokenHash,
      context,
      [userTurn, newMessage('assistant', reply)],
    )
    return {
      chatId,
      messages,
      draftBookingId: null,
      message: reply,
      quote,
      suggestedStartTime: quote?.suggestedStartTime ?? null,
    }
  }

  if (!context.fullName) {
    assistantMessage = `${assistantMessageWithDetails} ¿A nombre de quién dejamos el borrador?`
  } else if (!context.email) {
    assistantMessage = `${assistantMessageWithDetails} ¿Cuál es el correo del cliente?`
  } else if (context.coffeePeople === null) {
    assistantMessage = `${assistantMessageWithDetails} ¿Cuántas personas desean café?`
  }

  if (assistantMessage !== assistantMessageWithDetails) {
    const messages = await saveChatTurn(
      pool,
      chatId,
      tokenHash,
      context,
      [userTurn, newMessage('assistant', assistantMessage)],
    )

    return {
      chatId,
      messages,
      draftBookingId: null,
      message: assistantMessage,
      quote,
      suggestedStartTime: null,
    }
  }

  const bookingReadyMessage = `${assistantMessageWithDetails} Dejé los datos en un borrador. Ábrelo en la aplicación para revisarlo y confirmar con el botón.`
  const draftOptions = {
    accessToken,
    attendeeCount: context.attendeeCount,
    currentStep: 3,
    customer: {
      fullName: context.fullName as string,
      email: context.email as string,
      company: null,
    } satisfies BookingCustomerInput,
    services: {
      projector: context.projector,
      coffeePeople: context.coffeePeople ?? 0,
    } satisfies BookingServicesInput,
    beforeCreate: async (client: PoolClient) => {
      const lockedChat = await client.query<{ bookingId: string | null }>(
        `SELECT booking_id::text AS "bookingId"
         FROM reservation_chat_sessions
         WHERE id = $1 AND token_hash = $2 AND expires_at > now()
         FOR UPDATE`,
        [chatId, tokenHash],
      )
      const row = lockedChat.rows[0]

      if (!row) {
        throw new AssistantChatNotFoundError()
      }

      if (row.bookingId) {
        throw new AssistantDraftAlreadyCreatedError(row.bookingId)
      }
    },
    afterCreate: async (client: PoolClient, bookingId: string) => {
      const update = await client.query(
        `UPDATE reservation_chat_sessions
         SET context = $3::jsonb,
             messages = messages || $4::jsonb,
             booking_id = $5,
             updated_at = now()
         WHERE id = $1 AND token_hash = $2 AND booking_id IS NULL`,
        [
          chatId,
          tokenHash,
          JSON.stringify(context),
          JSON.stringify([userTurn, newMessage('assistant', bookingReadyMessage)]),
          bookingId,
        ],
      )

      if (!update.rowCount) {
        throw new AssistantChatNotFoundError()
      }
    },
  }

  try {
    const draft = await createBookingDraft(pool, quoteRepository, {
      roomId: context.roomId as number,
      date: context.date as string,
      startTime: context.startTime as string,
      durationHours: context.durationHours as number,
    }, draftOptions)
    const messages = await getAssistantChat(pool, chatId, accessToken)

    return {
      chatId,
      messages: messages.messages,
      draftBookingId: draft.booking.id,
      message: bookingReadyMessage,
      quote,
      suggestedStartTime: null,
    }
  } catch (error) {
    if (error instanceof AssistantDraftAlreadyCreatedError) {
      const resumed = await getAssistantChat(pool, chatId, accessToken)
      return {
        chatId,
        messages: resumed.messages,
        draftBookingId: error.bookingId,
          quote: await getAssistantChat(pool, chatId, accessToken).then((resumed) => resumed.quote),
        message: 'Ya hay un borrador listo. Ábrelo en la aplicación para revisarlo y confirmarlo.',
        suggestedStartTime: null,
      }
    }

    if (error instanceof BookingUnavailableError || error instanceof BookingConflictError) {
      const currentQuote = await createQuote({
        roomId: context.roomId as number,
        date: context.date as string,
        startTime: context.startTime as string,
        durationHours: context.durationHours as number,
      }, quoteRepository)
      context = {
        ...context,
        suggestedStartTime: currentQuote.suggestedStartTime,
      }
      const reply = currentQuote.suggestedStartTime
        ? `${formatQuoteReply(currentQuote)} Confírmame si quieres usar ese horario.`
        : formatQuoteReply(currentQuote)
      const messages = await saveChatTurn(
        pool,
        chatId,
        tokenHash,
        context,
        [userTurn, newMessage('assistant', reply)],
      )

      return {
        chatId,
        messages,
        draftBookingId: null,
        message: reply,
        quote: currentQuote,
        suggestedStartTime: currentQuote.suggestedStartTime,
      }
    }

    throw error
  }
}

export { assistantContextSchema }

function chatContextSuggestedTime(context: unknown): string | null {
  const parsed = assistantContextSchema.safeParse(context)
  return parsed.success ? parsed.data.suggestedStartTime : null
}