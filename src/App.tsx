import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CircleAlert,
  Clock3,
  LogIn,
  LogOut,
  LoaderCircle,
  MapPin,
  MessageCircle,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { AdminDashboard } from './AdminDashboard'
import { AssistantChat } from './AssistantChat'
import { BookingWizard } from './BookingWizard'
import { LoginDialog } from './LoginDialog'
import type {
  AuthSession,
  AssistantChatAccess,
  BookingDraftAccess,
  QuoteForm,
  QuoteResult,
  Room,
  RoomSize,
} from './contracts'
import './App.css'

const savedDraftKey = 'lumni.bookingDraft.v1'
const savedAssistantChatKey = 'lumni.assistantChat.v1'
const authSessionKey = 'lumni.authSession.v1'

const roomSizeLabels: Record<RoomSize, string> = {
  small: 'Pequeña',
  medium: 'Mediana',
  large: 'Grande',
}

const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

const durationOptions = Array.from({ length: 19 }, (_, index) => 1 + index / 2)

function getTodayInBogota(): string {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = dateParts.find((part) => part.type === 'year')?.value
  const month = dateParts.find((part) => part.type === 'month')?.value
  const day = dateParts.find((part) => part.type === 'day')?.value

  return year && month && day
    ? `${year}-${month}-${day}`
    : new Date().toISOString().slice(0, 10)
}

function formatDuration(durationHours: number): string {
  const durationLabel = durationHours.toLocaleString('es-CO')
  return `${durationLabel} ${durationHours === 1 ? 'hora' : 'horas'}`
}

function formatBookingDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00-05:00`))
}

function readSavedDraftAccess(): BookingDraftAccess | null {
  try {
    const saved = localStorage.getItem(savedDraftKey)
    const parsed: unknown = saved ? JSON.parse(saved) : null

    if (
      typeof parsed === 'object' && parsed !== null &&
      'bookingId' in parsed && typeof parsed.bookingId === 'string' &&
      'accessToken' in parsed && typeof parsed.accessToken === 'string'
    ) {
      return { bookingId: parsed.bookingId, accessToken: parsed.accessToken }
    }
  } catch {
    localStorage.removeItem(savedDraftKey)
  }

  return null
}

function readSavedAuthSession(): AuthSession | null {
  try {
    const saved = localStorage.getItem(authSessionKey)
    const parsed: unknown = saved ? JSON.parse(saved) : null

    if (
      typeof parsed === 'object' && parsed !== null &&
      'accessToken' in parsed && typeof parsed.accessToken === 'string' &&
      'expiresAt' in parsed && typeof parsed.expiresAt === 'string' &&
      'user' in parsed && typeof parsed.user === 'object' && parsed.user !== null
    ) {
      return parsed as AuthSession
    }
  } catch {
    localStorage.removeItem(authSessionKey)
  }

  return null
}

function readSavedAssistantChatAccess(): AssistantChatAccess | null {
  try {
    const saved = localStorage.getItem(savedAssistantChatKey)
    const parsed: unknown = saved ? JSON.parse(saved) : null

    if (
      typeof parsed === 'object' && parsed !== null &&
      'chatId' in parsed && typeof parsed.chatId === 'string' &&
      'accessToken' in parsed && typeof parsed.accessToken === 'string'
    ) {
      return { chatId: parsed.chatId, accessToken: parsed.accessToken }
    }
  } catch {
    localStorage.removeItem(savedAssistantChatKey)
  }

  return null
}

function App() {
  const today = getTodayInBogota()
  const [rooms, setRooms] = useState<Room[]>([])
  const [isLoadingRooms, setIsLoadingRooms] = useState(true)
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [roomsReloadKey, setRoomsReloadKey] = useState(0)
  const [form, setForm] = useState<QuoteForm>({
    roomId: '',
    date: today,
    startTime: '09:00',
    durationHours: 1,
  })
  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [isQuoting, setIsQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [authSession, setAuthSession] = useState(readSavedAuthSession)
  const [assistantChatAccess, setAssistantChatAccess] = useState(readSavedAssistantChatAccess)
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isAdminViewOpen, setIsAdminViewOpen] = useState(false)
  const [savedDraftAccess, setSavedDraftAccess] = useState(readSavedDraftAccess)
  const [isBookingWizardOpen, setIsBookingWizardOpen] = useState(false)
  const [wizardInitialAccess, setWizardInitialAccess] = useState<BookingDraftAccess | null>(null)

  const handleDraftAccessChange = useCallback((access: BookingDraftAccess | null) => {
    if (access) {
      localStorage.setItem(savedDraftKey, JSON.stringify(access))
    } else {
      localStorage.removeItem(savedDraftKey)
    }

    setSavedDraftAccess(access)
  }, [])

  const handleChatAccessChange = useCallback((access: AssistantChatAccess | null) => {
    if (access) {
      localStorage.setItem(savedAssistantChatKey, JSON.stringify(access))
    } else {
      localStorage.removeItem(savedAssistantChatKey)
    }

    setAssistantChatAccess(access)
  }, [])

  const handleOpenAssistantDraft = useCallback((access: BookingDraftAccess) => {
    handleDraftAccessChange(access)
    setWizardInitialAccess(access)
    setIsAssistantOpen(false)
    setIsBookingWizardOpen(true)
  }, [handleDraftAccessChange])

  function handleLogin(session: AuthSession): void {
    localStorage.setItem(authSessionKey, JSON.stringify(session))
    setAuthSession(session)
    setIsLoginOpen(false)
  }

  async function handleLogout(): Promise<void> {
    if (authSession) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authSession.accessToken}` },
      }).catch(() => undefined)
    }

    localStorage.removeItem(authSessionKey)
    setAuthSession(null)
    setIsAdminViewOpen(false)
  }

  function openBookingWizard(): void {
    setWizardInitialAccess(savedDraftAccess)
    setIsBookingWizardOpen(true)
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadRooms(): Promise<void> {
      setIsLoadingRooms(true)
      setRoomsError(null)

      try {
        const response = await fetch('/api/rooms', { signal: controller.signal })
        const payload = (await response.json()) as { rooms?: Room[]; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'No fue posible cargar las salas.')
        }

        const loadedRooms = payload.rooms ?? []
        setRooms(loadedRooms)
        setForm((currentForm) => ({
          ...currentForm,
          roomId: currentForm.roomId || String(loadedRooms[0]?.id ?? ''),
        }))

        if (loadedRooms.length === 0) {
          setRoomsError('Aún no hay salas registradas para cotizar.')
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setRoomsError(
            error instanceof Error
              ? error.message
              : 'No fue posible conectar con el servicio de salas.',
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingRooms(false)
        }
      }
    }

    void loadRooms()

    return () => controller.abort()
  }, [roomsReloadKey])

  useEffect(() => {
    const accessToken = authSession?.accessToken

    if (!accessToken) {
      return
    }

    const controller = new AbortController()

    async function validateSession(): Promise<void> {
      try {
        const response = await fetch('/api/auth/session', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        })

        if (response.status === 401 && !controller.signal.aborted) {
          localStorage.removeItem(authSessionKey)
          setAuthSession(null)
          setIsAdminViewOpen(false)
          return
        }

        if (response.ok && !controller.signal.aborted) {
          const result = await response.json() as { user: AuthSession['user'] }
          setAuthSession((current) => {
            if (!current || current.accessToken !== accessToken) {
              return current
            }

            return {
              accessToken: current.accessToken,
              expiresAt: current.expiresAt,
              user: result.user,
            }
          })
        }
      } catch {
        return
      }
    }

    void validateSession()
    return () => controller.abort()
  }, [authSession?.accessToken])

  function updateForm<Field extends keyof QuoteForm>(
    field: Field,
    value: QuoteForm[Field],
  ): void {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
    setQuote(null)
    setQuoteError(null)
  }

  async function requestQuote(values: QuoteForm): Promise<void> {
    setIsQuoting(true)
    setQuote(null)
    setQuoteError(null)

    try {
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          roomId: Number(values.roomId),
        }),
      })
      const payload = (await response.json()) as QuoteResult | { error?: string }

      if (!response.ok) {
        throw new Error(
          'error' in payload
            ? payload.error ?? 'No fue posible calcular la cotización.'
            : 'No fue posible calcular la cotización.',
        )
      }

      setQuote(payload as QuoteResult)
    } catch (error) {
      setQuoteError(
        error instanceof Error
          ? error.message
          : 'No fue posible conectar con el servicio de cotización.',
      )
    } finally {
      setIsQuoting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void requestQuote(form)
  }

  function trySuggestedTime(): void {
    if (!quote?.suggestedStartTime) {
      return
    }

    const suggestedForm = { ...form, startTime: quote.suggestedStartTime }
    setForm(suggestedForm)
    void requestQuote(suggestedForm)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Lumni Coworking, inicio">
          <span className="brand-icon"><Building2 size={21} strokeWidth={2.2} /></span>
          <span className="brand-copy">
            <span className="brand-name">lumni</span>
            <span className="brand-subtitle">coworking</span>
          </span>
        </a>
        <div className="topbar-actions">
          <button
            className="assistant-trigger"
            type="button"
            onClick={() => setIsAssistantOpen(true)}
          >
            <MessageCircle size={15} /> Asistente
          </button>
          {savedDraftAccess && (
            <button className="resume-draft-button" type="button" onClick={openBookingWizard}>
              <RotateCcw size={15} /> Retomar borrador
            </button>
          )}
          {authSession?.user.role === 'admin' && (
            <button
              className="admin-nav-button"
              type="button"
              onClick={() => setIsAdminViewOpen(true)}
            >
              <ShieldCheck size={15} /> Administración
            </button>
          )}
          {authSession ? (
            <button className="logout-button" type="button" onClick={() => void handleLogout()}>
              <LogOut size={15} /> Salir
            </button>
          ) : (
            <button className="login-trigger" type="button" onClick={() => setIsLoginOpen(true)}>
              <LogIn size={15} /> Iniciar sesión
            </button>
          )}
          <div className="location-label"><MapPin size={15} /> Bogotá, Colombia</div>
        </div>
      </header>

      {isAdminViewOpen && authSession?.user.role === 'admin' ? (
        <AdminDashboard
          accessToken={authSession.accessToken}
          user={authSession.user}
          onBack={() => setIsAdminViewOpen(false)}
        />
      ) : (
      <main id="inicio" className="main-content">
        <div className="page-intro">
          <p className="eyebrow"><span /> RESERVAS <span className="eyebrow-divider">/</span> COTIZADOR</p>
          <h1>Cotiza una sala</h1>
          <p className="intro-copy">Un buen encuentro empieza con el espacio adecuado.</p>
        </div>

        <div className="quote-layout">
          <section className="form-panel" aria-labelledby="form-title">
            <div className="section-heading">
              <span className="section-icon"><CalendarDays size={19} /></span>
              <div>
                <p className="section-kicker">DISPONIBILIDAD</p>
                <h2 id="form-title">Define tu horario</h2>
              </div>
            </div>

            {roomsError && (
              <div className="inline-alert" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <span>{roomsError}</span>
                <button
                  type="button"
                  className="icon-button retry-button"
                  aria-label="Volver a cargar salas"
                  title="Volver a cargar salas"
                  onClick={() => setRoomsReloadKey((key) => key + 1)}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            )}

            <form className="quote-form" onSubmit={handleSubmit}>
              <label className="field field-wide" htmlFor="room">
                <span className="field-label">Sala</span>
                <span className="select-wrap">
                  <Building2 size={17} aria-hidden="true" />
                  <select
                    id="room"
                    value={form.roomId}
                    onChange={(event) => updateForm('roomId', event.target.value)}
                    disabled={isLoadingRooms || rooms.length === 0}
                    required
                  >
                    {rooms.length === 0 && <option value="">Selecciona una sala</option>}
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name} · {roomSizeLabels[room.size]}
                      </option>
                    ))}
                  </select>
                </span>
              </label>

              <label className="field" htmlFor="date">
                <span className="field-label">Fecha</span>
                <span className="input-wrap">
                  <CalendarDays size={17} aria-hidden="true" />
                  <input
                    id="date"
                    type="date"
                    min={today}
                    value={form.date}
                    onChange={(event) => updateForm('date', event.target.value)}
                    required
                  />
                </span>
              </label>

              <label className="field" htmlFor="start-time">
                <span className="field-label">Hora de inicio</span>
                <span className="input-wrap">
                  <Clock3 size={17} aria-hidden="true" />
                  <input
                    id="start-time"
                    type="time"
                    min="07:00"
                    max="21:00"
                    step={1800}
                    value={form.startTime}
                    onChange={(event) => updateForm('startTime', event.target.value)}
                    required
                  />
                </span>
              </label>

              <label className="field field-wide" htmlFor="duration">
                <span className="field-label">Duración</span>
                <span className="select-wrap">
                  <Clock3 size={17} aria-hidden="true" />
                  <select
                    id="duration"
                    value={form.durationHours}
                    onChange={(event) => updateForm('durationHours', Number(event.target.value))}
                  >
                    {durationOptions.map((duration) => (
                      <option key={duration} value={duration}>
                        {formatDuration(duration)}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="field-hint">En bloques de 30 minutos, hasta 10 horas.</span>
              </label>

              {quoteError && <p className="form-error" role="alert">{quoteError}</p>}

              <button
                className="submit-button field-wide"
                type="submit"
                disabled={isLoadingRooms || rooms.length === 0 || isQuoting}
              >
                {isQuoting ? (
                  <><LoaderCircle className="spinner" size={18} /> Calculando</>
                ) : (
                  <>Calcular cotización <ArrowRight size={18} /></>
                )}
              </button>
            </form>

            <div className="schedule-note">
              <Clock3 size={16} aria-hidden="true" />
              <span>Lunes a sábado · 07:00 a 21:00</span>
            </div>
          </section>

          <aside className="result-panel" aria-labelledby="result-title" aria-live="polite">
            <div className="result-topline">
              <span className="result-kicker">RESUMEN DE COTIZACIÓN</span>
              <ReceiptText size={19} aria-hidden="true" />
            </div>
            <h2 id="result-title">Tu espacio,<br />a tu medida.</h2>

            {!quote && !isQuoting && (
              <div className="empty-result">
                <div className="empty-icon"><Sparkles size={22} /></div>
                <p>Completa los datos para consultar el precio y la disponibilidad.</p>
              </div>
            )}

            {isQuoting && (
              <div className="empty-result loading-result">
                <LoaderCircle className="spinner" size={24} />
                <p>Consultando disponibilidad...</p>
              </div>
            )}

            {quote && (
              <div className="quote-result">
                <div className={`availability ${quote.available ? 'is-available' : 'is-unavailable'}`}>
                  <span className="availability-dot" />
                  {quote.available ? 'Disponible' : 'No disponible'}
                </div>

                <div className="booking-summary">
                  <div className="summary-room-icon"><Building2 size={18} /></div>
                  <div>
                    <p className="summary-room-name">{quote.room.name}</p>
                    <p className="summary-room-meta">{roomSizeLabels[quote.room.size]} · {formatDuration(quote.durationHours)}</p>
                  </div>
                </div>

                <div className="summary-date">
                  <CalendarCheck2 size={16} aria-hidden="true" />
                  <span>{formatBookingDate(quote.date)}</span>
                  <span className="summary-time">{quote.startTime}–{quote.endTime}</span>
                </div>

                <div className="price-breakdown">
                  <div className="price-row">
                    <dt>Precio base</dt>
                    <dd>{currencyFormatter.format(quote.base)}</dd>
                  </div>
                  <div className="price-row price-discount">
                    <dt>Descuento por duración</dt>
                    <dd>−{currencyFormatter.format(quote.discount)}</dd>
                  </div>
                  <div className="price-row">
                    <dt>Recargo sábado</dt>
                    <dd>{currencyFormatter.format(quote.surcharge)}</dd>
                  </div>
                  <div className="price-total">
                    <dt>Total</dt>
                    <dd>{currencyFormatter.format(quote.total)}</dd>
                  </div>
                </div>

                {quote.available && (
                  <button
                    className="start-booking-button"
                    type="button"
                    onClick={openBookingWizard}
                  >
                    <span>{savedDraftAccess ? 'Retomar borrador' : 'Iniciar reserva'}</span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                )}

                {!quote.available && quote.reason && (
                  <div className="availability-message">
                    <CircleAlert size={17} aria-hidden="true" />
                    <p>{quote.reason}</p>
                  </div>
                )}

                {!quote.available && quote.suggestedStartTime && (
                  <button className="suggestion-button" type="button" onClick={trySuggestedTime}>
                    <span>Probar las {quote.suggestedStartTime}</span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            <p className="currency-note">Valores en pesos colombianos (COP)</p>
          </aside>
        </div>

        <footer className="page-footer">
          <span>ESPACIOS PARA TRABAJAR MEJOR</span>
          <span>BOGOTÁ · COLOMBIA</span>
        </footer>
      </main>
      )}

      {isBookingWizardOpen && (
        <BookingWizard
          quote={quote}
          rooms={rooms}
          initialAccess={wizardInitialAccess}
          onDraftAccessChange={handleDraftAccessChange}
          onClose={() => setIsBookingWizardOpen(false)}
        />
      )}

      {isLoginOpen && (
        <LoginDialog
          onLogin={handleLogin}
          onClose={() => setIsLoginOpen(false)}
        />
      )}

      {isAssistantOpen && (
        <AssistantChat
          initialAccess={assistantChatAccess}
          onChatAccessChange={handleChatAccessChange}
          onDraftCreated={handleDraftAccessChange}
          onOpenDraft={handleOpenAssistantDraft}
          onClose={() => setIsAssistantOpen(false)}
        />
      )}
    </div>
  )
}

export default App