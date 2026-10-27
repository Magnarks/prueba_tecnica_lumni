import { createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  InvalidBookingTransitionError,
  transitionBooking,
  type BookingStatus,
} from './booking-state'
import { createQuote, type QuoteRepository, type QuoteRequest, type QuoteRoom } from './quote-service'

export const PROJECTOR_PRICE = 50_000
export const COFFEE_PER_PERSON_PRICE = 8_000

export interface BookingCustomerInput {
  fullName: string
  email: string
  company?: string | null
}

export interface BookingServicesInput {
  projector: boolean
  coffeePeople: number
}

export interface BookingDraftInput extends QuoteRequest, BookingCustomerInput {}

export interface BookingView {
  id: string
  status: BookingStatus
  currentStep: number
  customer: {
    fullName: string | null
    email: string | null
    company: string | null
  }
  room: QuoteRoom
  date: string
  startTime: string
  endTime: string
  durationHours: number
  base: number
  discount: number
  surcharge: number
  total: number
  services: BookingServicesInput
}

export interface CreatedBookingDraft {
  booking: BookingView
  accessToken: string
}

export class BookingNotFoundError extends Error {
  constructor() {
    super('No se encontró la reserva o el token de acceso no es válido.')
    this.name = 'BookingNotFoundError'
  }
}

export class BookingNotEditableError extends Error {
  constructor() {
    super('Solo se pueden editar reservas en borrador.')
    this.name = 'BookingNotEditableError'
  }
}

export class BookingProgressError extends Error {
  constructor(message = 'Completa y guarda los pasos anteriores antes de continuar.') {
    super(message)
    this.name = 'BookingProgressError'
  }
}

export function assertBookingProgress(
  currentStep: number,
  nextStep: number,
  hasSavedCustomer: boolean,
): void {
  if (
    nextStep < 1 ||
    nextStep > 2 ||
    Math.abs(nextStep - currentStep) > 1 ||
    (nextStep === 2 && !hasSavedCustomer)
  ) {
    throw new BookingProgressError()
  }
}

export class BookingUnavailableError extends Error {
  constructor(readonly quote: Awaited<ReturnType<typeof createQuote>>) {
    super(quote.reason ?? 'La sala no está disponible en ese horario.')
    this.name = 'BookingUnavailableError'
  }
}

export class BookingConflictError extends Error {
  constructor() {
    super('Otra persona confirmó la sala en ese horario. Cotiza una nueva hora.')
    this.name = 'BookingConflictError'
  }
}

interface BookingRow {
  id: string
  status: BookingStatus
  currentStep: number
  total: number
  projector: boolean
  coffeePeople: number
  fullName: string | null
  email: string | null
  company: string | null
  roomId: number
  roomName: string
  roomSize: QuoteRoom['size']
  hourlyRate: number
  date: string
  startTime: string
  endTime: string
  durationHours: number
}

interface PriceLine {
  concept: string
  amount: number
}

export function calculateBookingTotal(
  priceLines: PriceLine[],
  services: BookingServicesInput,
): number {
  const quotedTotal = priceLines
    .filter((line) => !line.concept.startsWith('service_'))
    .reduce((sum, line) => sum + line.amount, 0)

  return quotedTotal
    + (services.projector ? PROJECTOR_PRICE : 0)
    + services.coffeePeople * COFFEE_PER_PERSON_PRICE
}

function hashAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex')
}

function toColombiaTimestamp(date: string, time: string): string {
  return new Date(`${date}T${time}:00-05:00`).toISOString()
}

function isOverlapConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23P01'
}

async function findBookingRow(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  bookingId: string,
  tokenHash: string,
): Promise<BookingRow | null> {
  const result = await queryable.query<BookingRow>(
    `SELECT b.id::text AS id,
            b.status,
            b.current_step AS "currentStep",
            b.total::float8 AS total,
            b.projector,
            b.coffee_people AS "coffeePeople",
            c.full_name AS "fullName",
            c.email,
            c.company,
            r.id AS "roomId",
            r.name AS "roomName",
            r.size AS "roomSize",
            r.hourly_rate::float8 AS "hourlyRate",
            to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS date,
            to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "startTime",
            to_char(b.ends_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "endTime",
            (EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 3600)::float8 AS "durationHours"
     FROM bookings b
     JOIN rooms r ON r.id = b.room_id
    LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.id = $1 AND b.draft_token_hash = $2`,
    [bookingId, tokenHash],
  )

  return result.rows[0] ?? null
}

async function findPriceLines(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  bookingId: string,
): Promise<PriceLine[]> {
  const result = await queryable.query<PriceLine>(
    `SELECT concept, amount::float8 AS amount
     FROM booking_lines
     WHERE booking_id = $1`,
    [bookingId],
  )

  return result.rows
}

function toBookingView(row: BookingRow, lines: PriceLine[]): BookingView {
  const amountFor = (concept: string): number =>
    lines.find((line) => line.concept === concept)?.amount ?? 0

  return {
    id: row.id,
    status: row.status,
    currentStep: row.currentStep,
    customer: {
      fullName: row.fullName,
      email: row.email,
      company: row.company,
    },
    room: {
      id: row.roomId,
      name: row.roomName,
      size: row.roomSize,
      hourlyRate: row.hourlyRate,
    },
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    durationHours: row.durationHours,
    base: amountFor('base'),
    discount: Math.abs(amountFor('discount_duration')),
    surcharge: amountFor('saturday_surcharge'),
    total: row.total,
    services: {
      projector: row.projector,
      coffeePeople: row.coffeePeople,
    },
  }
}

async function insertPriceLines(
  client: PoolClient,
  bookingId: string,
  quote: Awaited<ReturnType<typeof createQuote>>,
): Promise<void> {
  const lines: PriceLine[] = [
    { concept: 'base', amount: quote.base },
    { concept: 'discount_duration', amount: -quote.discount },
    { concept: 'saturday_surcharge', amount: quote.surcharge },
  ]

  for (const line of lines) {
    await client.query(
      'INSERT INTO booking_lines (booking_id, concept, amount) VALUES ($1, $2, $3)',
      [bookingId, line.concept, line.amount],
    )
  }
}

async function withTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')

    if (isOverlapConstraintViolation(error)) {
      throw new BookingConflictError()
    }

    throw error
  } finally {
    client.release()
  }
}

async function lockDraft(
  client: PoolClient,
  bookingId: string,
  tokenHash: string,
): Promise<BookingRow> {
  const locked = await client.query(
    'SELECT id FROM bookings WHERE id = $1 AND draft_token_hash = $2 FOR UPDATE',
    [bookingId, tokenHash],
  )

  if (!locked.rowCount) {
    throw new BookingNotFoundError()
  }

  const row = await findBookingRow(client, bookingId, tokenHash)

  if (!row) {
    throw new BookingNotFoundError()
  }

  if (row.status !== 'draft') {
    throw new BookingNotEditableError()
  }

  return row
}

export async function getBookingByAccessToken(
  pool: Pool,
  bookingId: string,
  accessToken: string,
): Promise<BookingView> {
  const tokenHash = hashAccessToken(accessToken)
  const row = await findBookingRow(pool, bookingId, tokenHash)

  if (!row) {
    throw new BookingNotFoundError()
  }

  const lines = await findPriceLines(pool, bookingId)
  return toBookingView(row, lines)
}

export async function createBookingDraft(
  pool: Pool,
  quoteRepository: QuoteRepository,
  input: QuoteRequest,
): Promise<CreatedBookingDraft> {
  const quote = await createQuote(input, quoteRepository)

  if (!quote.available) {
    throw new BookingUnavailableError(quote)
  }

  const accessToken = randomBytes(32).toString('base64url')
  const tokenHash = hashAccessToken(accessToken)
  const bookingId = await withTransaction(pool, async (client) => {
    const insert = await client.query<{ id: string }>(
      `INSERT INTO bookings (
         customer_id, room_id, starts_at, ends_at, total, status,
         draft_token_hash, current_step
       )
       VALUES (
         NULL, $1, $2::timestamptz, $3::timestamptz, $4, 'draft', $5, 1
       )
       RETURNING id::text AS id`,
      [
        quote.room.id,
        toColombiaTimestamp(quote.date, quote.startTime),
        toColombiaTimestamp(quote.date, quote.endTime),
        quote.total,
        tokenHash,
      ],
    )
    const id = insert.rows[0].id
    await insertPriceLines(client, id, quote)
    return id
  })

  return {
    booking: await getBookingByAccessToken(pool, bookingId, accessToken),
    accessToken,
  }
}

export async function saveBookingProgress(
  pool: Pool,
  bookingId: string,
  accessToken: string,
  currentStep: number,
): Promise<BookingView> {
  const tokenHash = hashAccessToken(accessToken)

  await withTransaction(pool, async (client) => {
    const row = await lockDraft(client, bookingId, tokenHash)
    assertBookingProgress(row.currentStep, currentStep, Boolean(row.fullName && row.email))

    await client.query(
      'UPDATE bookings SET current_step = $2 WHERE id = $1',
      [bookingId, currentStep],
    )
  })

  return getBookingByAccessToken(pool, bookingId, accessToken)
}

export async function saveBookingCustomer(
  pool: Pool,
  bookingId: string,
  accessToken: string,
  customerInput: BookingCustomerInput,
): Promise<BookingView> {
  const tokenHash = hashAccessToken(accessToken)

  await withTransaction(pool, async (client) => {
    await lockDraft(client, bookingId, tokenHash)

    const customer = await client.query<{ id: number }>(
      `INSERT INTO customers (email, full_name, company)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             company = EXCLUDED.company
       RETURNING id`,
      [customerInput.email, customerInput.fullName, customerInput.company ?? null],
    )
    await client.query(
      'UPDATE bookings SET customer_id = $2, current_step = 1 WHERE id = $1',
      [bookingId, customer.rows[0].id],
    )
  })

  return getBookingByAccessToken(pool, bookingId, accessToken)
}

export async function saveBookingSchedule(
  pool: Pool,
  quoteRepository: QuoteRepository,
  bookingId: string,
  accessToken: string,
  request: QuoteRequest,
): Promise<BookingView> {
  const quote = await createQuote(request, quoteRepository)

  if (!quote.available) {
    throw new BookingUnavailableError(quote)
  }

  const tokenHash = hashAccessToken(accessToken)

  await withTransaction(pool, async (client) => {
    const row = await lockDraft(client, bookingId, tokenHash)

    if (!row.fullName || !row.email) {
      throw new BookingProgressError('Guarda primero los datos del cliente.')
    }

    const serviceTotal = (row.projector ? PROJECTOR_PRICE : 0)
      + row.coffeePeople * COFFEE_PER_PERSON_PRICE
    const total = quote.total + serviceTotal

    await client.query(
      `UPDATE bookings
       SET room_id = $2,
           starts_at = $3::timestamptz,
           ends_at = $4::timestamptz,
           total = $5,
           current_step = 2
       WHERE id = $1`,
      [
        bookingId,
        quote.room.id,
        toColombiaTimestamp(quote.date, quote.startTime),
        toColombiaTimestamp(quote.date, quote.endTime),
        total,
      ],
    )
    await client.query(
      `DELETE FROM booking_lines
       WHERE booking_id = $1
         AND concept IN ('base', 'discount_duration', 'saturday_surcharge')`,
      [bookingId],
    )
    await insertPriceLines(client, bookingId, quote)
  })

  return getBookingByAccessToken(pool, bookingId, accessToken)
}

export async function saveBookingServices(
  pool: Pool,
  bookingId: string,
  accessToken: string,
  services: BookingServicesInput,
): Promise<BookingView> {
  const tokenHash = hashAccessToken(accessToken)

  await withTransaction(pool, async (client) => {
    const row = await lockDraft(client, bookingId, tokenHash)

    if (row.currentStep < 2) {
      throw new BookingProgressError('Guarda primero el horario de la reserva.')
    }

    const lines = await findPriceLines(client, bookingId)
    const total = calculateBookingTotal(lines, services)

    await client.query(
      `UPDATE bookings
       SET projector = $2, coffee_people = $3, total = $4, current_step = 3
       WHERE id = $1`,
      [bookingId, services.projector, services.coffeePeople, total],
    )
    await client.query(
      `DELETE FROM booking_lines
       WHERE booking_id = $1 AND concept IN ('service_projector', 'service_coffee')`,
      [bookingId],
    )

    const serviceLines = [
      services.projector
        ? { concept: 'service_projector', amount: PROJECTOR_PRICE }
        : null,
      services.coffeePeople > 0
        ? {
            concept: 'service_coffee',
            amount: services.coffeePeople * COFFEE_PER_PERSON_PRICE,
          }
        : null,
    ].filter((line): line is PriceLine => line !== null)

    for (const line of serviceLines) {
      await client.query(
        'INSERT INTO booking_lines (booking_id, concept, amount) VALUES ($1, $2, $3)',
        [bookingId, line.concept, line.amount],
      )
    }
  })

  return getBookingByAccessToken(pool, bookingId, accessToken)
}

export async function confirmBooking(
  pool: Pool,
  bookingId: string,
  accessToken: string,
): Promise<BookingView> {
  const tokenHash = hashAccessToken(accessToken)

  await withTransaction(pool, async (client) => {
      const result = await client.query<{
        status: BookingStatus
        currentStep: number
      }>(
      `SELECT status
                , current_step AS "currentStep"
       FROM bookings
       WHERE id = $1 AND draft_token_hash = $2
       FOR UPDATE`,
      [bookingId, tokenHash],
    )
    const row = result.rows[0]

    if (!row) {
      throw new BookingNotFoundError()
    }

    if (row.status === 'draft' && row.currentStep < 3) {
      throw new BookingProgressError('Guarda los servicios antes de confirmar la reserva.')
    }

    const nextStatus = transitionBooking(row.status, 'confirmed')

    if (nextStatus !== row.status) {
      await client.query(
        'UPDATE bookings SET status = $2 WHERE id = $1',
        [bookingId, nextStatus],
      )
      await client.query(
        `INSERT INTO booking_email_jobs (booking_id, recipient, subject, body)
         SELECT b.id,
                c.email,
                'Confirmación de reserva Lumni #' || b.id::text,
                'Hola ' || c.full_name || E',\n\n' ||
                  'Tu reserva de sala quedó confirmada.' || E'\n' ||
                  'Sala: ' || r.name || E'\n' ||
                  'Fecha: ' || to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') || E'\n' ||
                  'Horario: ' || to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'HH24:MI') ||
                  '–' || to_char(b.ends_at AT TIME ZONE 'America/Bogota', 'HH24:MI') || E'\n' ||
                  'Total pactado: $' || replace(to_char(b.total, 'FM999,999,999,990'), ',', '.') || ' COP' || E'\n\n' ||
                  'Gracias por reservar con Lumni Coworking.'
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id
         JOIN rooms r ON r.id = b.room_id
         WHERE b.id = $1
         ON CONFLICT (booking_id) DO NOTHING`,
        [bookingId],
      )
    }
  })

  return getBookingByAccessToken(pool, bookingId, accessToken)
}

export { InvalidBookingTransitionError }