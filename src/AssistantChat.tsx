import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  Building2,
  CalendarDays,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Sparkles,
  X,
} from 'lucide-react'
import type {
  AssistantChatAccess,
  AssistantChatMessage,
  AssistantChatView,
  AssistantTurnResult,
  BookingDraftAccess,
  QuoteResult,
} from './contracts'
import './AssistantChat.css'

interface AssistantChatProps {
  initialAccess: AssistantChatAccess | null
  onChatAccessChange: (access: AssistantChatAccess | null) => void
  onDraftCreated: (access: BookingDraftAccess) => void
  onOpenDraft: (access: BookingDraftAccess) => void
  onClose: () => void
}

interface ApiError {
  error?: string
}

interface CreatedAssistantChat extends AssistantChatView {
  accessToken: string
}

function makeMessage(role: 'user' | 'assistant', content: string): AssistantChatMessage {
  return { role, content, createdAt: new Date().toISOString() }
}

async function assistantRequest<T>(
  url: string,
  options: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers)

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const response = await fetch(url, { ...options, headers })
  const payload = await response.json().catch(() => ({})) as ApiError

  if (!response.ok) {
    throw new Error(payload.error ?? 'No fue posible continuar la conversación.')
  }

  return payload as T
}

function currency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatQuoteDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00-05:00`))
}

function QuoteCard({ quote }: { quote: QuoteResult }) {
  return (
    <div className={`assistant-quote ${quote.available ? 'quote-is-available' : 'quote-is-unavailable'}`}>
      <div className="assistant-quote-topline">
        <span>{quote.available ? 'Disponible' : 'No disponible'}</span>
        <span>{currency(quote.total)} COP</span>
      </div>
      <div className="assistant-quote-meta">
        <span><Building2 size={13} /> {quote.room.name}</span>
        <span><CalendarDays size={13} /> {formatQuoteDate(quote.date)}</span>
        <span><Clock3 size={13} /> {quote.startTime}–{quote.endTime} · {quote.durationHours} h</span>
      </div>
      <div className="assistant-quote-lines">
        <span>Base <strong>{currency(quote.base)}</strong></span>
        <span>Descuento <strong>−{currency(quote.discount)}</strong></span>
        <span>Recargo sábado <strong>{currency(quote.surcharge)}</strong></span>
        <span>Total <strong>{currency(quote.total)}</strong></span>
      </div>
    </div>
  )
}

export function AssistantChat({
  initialAccess,
  onChatAccessChange,
  onDraftCreated,
  onOpenDraft,
  onClose,
}: AssistantChatProps) {
  const [access, setAccess] = useState<AssistantChatAccess | null>(initialAccess)
  const [messages, setMessages] = useState<AssistantChatMessage[]>(() => initialAccess
    ? []
    : [makeMessage('assistant', 'Hola. Te ayudo a cotizar una sala. ¿Qué tamaño prefieres, para qué fecha y a qué hora?')])
  const [input, setInput] = useState('')
  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [suggestedStartTime, setSuggestedStartTime] = useState<string | null>(null)
  const [draftBookingId, setDraftBookingId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isResuming, setIsResuming] = useState(Boolean(initialAccess))
  const endOfMessagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!initialAccess) {
      return
    }

    const savedAccess = initialAccess
    const controller = new AbortController()

    async function resumeChat(): Promise<void> {
      try {
        const chat = await assistantRequest<AssistantChatView>(
          `/api/assistant/chats/${savedAccess.chatId}`,
          { signal: controller.signal },
          savedAccess.accessToken,
        )

        if (controller.signal.aborted) {
          return
        }

        setAccess(savedAccess)
        setMessages(chat.messages)
        setDraftBookingId(chat.draftBookingId)
        setQuote(chat.quote)

        if (chat.draftBookingId) {
          onDraftCreated({
            bookingId: chat.draftBookingId,
            accessToken: savedAccess.accessToken,
          })
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          if (requestError instanceof Error && requestError.message.includes('expiró')) {
            onChatAccessChange(null)
          }
          setError(requestError instanceof Error
            ? requestError.message
            : 'No fue posible recuperar la conversación.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsResuming(false)
        }
      }
    }

    void resumeChat()
    return () => controller.abort()
  }, [initialAccess, onChatAccessChange, onDraftCreated])

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [error, isSending, messages, quote])

  async function ensureChat(): Promise<AssistantChatAccess> {
    if (access) {
      return access
    }

    const created = await assistantRequest<CreatedAssistantChat>('/api/assistant/chats', {
      method: 'POST',
    })
    const newAccess = { chatId: created.chatId, accessToken: created.accessToken }
    setAccess(newAccess)
    setMessages(created.messages)
    onChatAccessChange(newAccess)
    return newAccess
  }

  async function sendMessage(messageText: string): Promise<void> {
    const trimmed = messageText.trim()

    if (!trimmed || isSending || isResuming || draftBookingId) {
      return
    }

    setIsSending(true)
    setError(null)
    setQuote(null)
    setSuggestedStartTime(null)

    try {
      const currentAccess = await ensureChat()
      const result = await assistantRequest<AssistantTurnResult>(
        `/api/assistant/chats/${currentAccess.chatId}/messages`,
        { method: 'POST', body: JSON.stringify({ message: trimmed }) },
        currentAccess.accessToken,
      )

      setMessages(result.messages)
      setQuote(result.quote)
      setSuggestedStartTime(result.suggestedStartTime)
      setDraftBookingId(result.draftBookingId)

      if (result.draftBookingId) {
        onDraftCreated({
          bookingId: result.draftBookingId,
          accessToken: currentAccess.accessToken,
        })
      }

      setInput('')
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'No fue posible conectar con el asistente local.')
    } finally {
      setIsSending(false)
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void sendMessage(input)
  }

  return (
    <div className="assistant-overlay">
      <section className="assistant-panel" role="dialog" aria-modal="true" aria-labelledby="assistant-title">
        <header className="assistant-header">
          <div className="assistant-header-mark"><Sparkles size={18} /></div>
          <div className="assistant-header-copy">
            <p>ASISTENTE DE RESERVAS</p>
            <h2 id="assistant-title">Lumni</h2>
          </div>
          <button
            className="assistant-close"
            type="button"
            aria-label="Cerrar asistente"
            title="Cerrar"
            onClick={onClose}
            disabled={isSending}
          >
            <X size={19} />
          </button>
        </header>

        <div className="assistant-messages" aria-live="polite" aria-label="Conversación">
          {isResuming ? (
            <div className="assistant-loading"><LoaderCircle className="spinner" size={18} /> Recuperando conversación...</div>
          ) : messages.map((message, index) => (
            <div className={`assistant-message message-${message.role}`} key={`${message.createdAt}-${index}`}>
              {message.role === 'assistant' && <span className="assistant-message-icon"><Sparkles size={13} /></span>}
              <p>{message.content}</p>
            </div>
          ))}

          {quote && <QuoteCard quote={quote} />}

          {suggestedStartTime && !draftBookingId && (
            <button
              className="assistant-suggestion-button"
              type="button"
              disabled={isSending}
              onClick={() => void sendMessage('Sí, por favor')}
            >
              Usar las {suggestedStartTime}
            </button>
          )}

          {draftBookingId && (
            <div className="assistant-draft-ready">
              <strong>Borrador listo para revisar</strong>
              <span>La confirmación se hace desde la reserva, no desde el chat.</span>
              <button
                type="button"
                onClick={() => {
                  if (access && draftBookingId) {
                    onOpenDraft({ bookingId: draftBookingId, accessToken: access.accessToken })
                  }
                }}
              >
                Abrir mi borrador
              </button>
            </div>
          )}

          {isSending && <div className="assistant-loading"><LoaderCircle className="spinner" size={17} /> Revisando la información...</div>}
          {error && <div className="assistant-error" role="alert"><CircleAlert size={16} /> {error}</div>}
          <div ref={endOfMessagesRef} />
        </div>

        <form className="assistant-composer" onSubmit={submitMessage}>
          <textarea
            aria-label="Mensaje para el asistente"
            maxLength={1_000}
            placeholder="Escribe tu mensaje..."
            rows={2}
            value={input}
            disabled={isSending || isResuming || Boolean(draftBookingId)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage(input)
              }
            }}
          />
          <button
            className="assistant-send"
            type="submit"
            aria-label="Enviar mensaje"
            title="Enviar mensaje"
            disabled={!input.trim() || isSending || isResuming || Boolean(draftBookingId)}
          >
            {isSending ? <LoaderCircle className="spinner" size={17} /> : <ArrowUp size={18} />}
          </button>
        </form>
      </section>
    </div>
  )
}