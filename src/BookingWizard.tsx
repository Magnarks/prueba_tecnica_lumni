import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  Coffee,
  LoaderCircle,
  Monitor,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import type {
  BookingDraftAccess,
  BookingView,
  QuoteForm,
  QuoteResult,
  Room,
} from './contracts'
import './BookingWizard.css'

interface BookingWizardProps {
  quote: QuoteResult | null
  rooms: Room[]
  initialAccess: BookingDraftAccess | null
  onDraftAccessChange: (access: BookingDraftAccess | null) => void
  onClose: () => void
}

interface CustomerForm {
  fullName: string
  email: string
  company: string
}

interface ServicesForm {
  projector: boolean
  coffeePeople: number
}

interface ApiErrorPayload {
  error?: unknown
  quote?: QuoteResult
}

class BookingApiError extends Error {
  readonly status: number
  readonly payload: ApiErrorPayload

  constructor(
    message: string,
    status: number,
    payload: ApiErrorPayload,
  ) {
    super(message)
    this.name = 'BookingApiError'
    this.status = status
    this.payload = payload
  }
}

async function requestJson<T>(
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
  const payload = await response.json().catch(() => ({})) as ApiErrorPayload

  if (!response.ok) {
    throw new BookingApiError(
      typeof payload.error === 'string'
        ? payload.error
        : 'No fue posible guardar la reserva.',
      response.status,
      payload,
    )
  }

  return payload as T
}

function getTodayInBogota(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return year && month && day
    ? `${year}-${month}-${day}`
    : new Date().toISOString().slice(0, 10)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00-05:00`))
}

function getApiErrorMessage(error: unknown): string {
  if (error instanceof BookingApiError && error.payload.quote?.suggestedStartTime) {
    return `${error.message} Prueba a las ${error.payload.quote.suggestedStartTime}.`
  }

  return error instanceof Error
    ? error.message
    : 'No fue posible conectar con el servicio de reservas.'
}

export function BookingWizard({
  quote,
  rooms,
  initialAccess,
  onDraftAccessChange,
  onClose,
}: BookingWizardProps) {
  const [booking, setBooking] = useState<BookingView | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const [isLoading, setIsLoading] = useState(Boolean(initialAccess))
  const [isWorking, setIsWorking] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customer, setCustomer] = useState<CustomerForm>({
    fullName: '',
    email: '',
    company: '',
  })
  const [schedule, setSchedule] = useState<QuoteForm>(() => ({
    roomId: quote ? String(quote.room.id) : '',
    date: quote?.date ?? getTodayInBogota(),
    startTime: quote?.startTime ?? '09:00',
    durationHours: quote?.durationHours ?? 1,
  }))
  const [services, setServices] = useState<ServicesForm>({
    projector: false,
    coffeePeople: 0,
  })

  useEffect(() => {
    if (!initialAccess) {
      return
    }

    const draftAccess = initialAccess
    const controller = new AbortController()

    async function resumeDraft(): Promise<void> {
      try {
        const result = await requestJson<{ booking: BookingView }>(
          `/api/bookings/${draftAccess.bookingId}`,
          { signal: controller.signal },
          draftAccess.accessToken,
        )

        if (controller.signal.aborted) {
          return
        }

        setBooking(result.booking)
        setAccessToken(draftAccess.accessToken)
        setCustomer({
          fullName: result.booking.customer.fullName ?? '',
          email: result.booking.customer.email ?? '',
          company: result.booking.customer.company ?? '',
        })
        setSchedule({
          roomId: String(result.booking.room.id),
          date: result.booking.date,
          startTime: result.booking.startTime,
          durationHours: result.booking.durationHours,
        })
        setServices(result.booking.services)
        setStep(result.booking.currentStep)

        if (result.booking.status === 'confirmed') {
          onDraftAccessChange(null)
        }
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }

        if (requestError instanceof BookingApiError && requestError.status === 404) {
          onDraftAccessChange(null)
        }
        setError(getApiErrorMessage(requestError))
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void resumeDraft()
    return () => controller.abort()
  }, [initialAccess, onDraftAccessChange])

  async function ensureDraft(): Promise<{ bookingId: string; token: string }> {
    if (booking && accessToken) {
      return { bookingId: booking.id, token: accessToken }
    }

    if (!quote?.available) {
      throw new Error('Primero necesitas una cotización disponible.')
    }

    const created = await requestJson<{
      booking: BookingView
      accessToken: string
    }>('/api/bookings/drafts', {
      method: 'POST',
      body: JSON.stringify({
        roomId: quote.room.id,
        date: quote.date,
        startTime: quote.startTime,
        durationHours: quote.durationHours,
      }),
    })
    const pointer = { bookingId: created.booking.id, accessToken: created.accessToken }

    setBooking(created.booking)
    setAccessToken(created.accessToken)
    onDraftAccessChange(pointer)

    return { bookingId: pointer.bookingId, token: pointer.accessToken }
  }

  async function saveCustomerAndContinue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsWorking(true)
    setError(null)

    try {
      const draft = await ensureDraft()
      await requestJson<{ booking: BookingView }>(
        `/api/bookings/${draft.bookingId}/customer`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: customer.fullName,
            email: customer.email,
            company: customer.company.trim() || null,
          }),
        },
        draft.token,
      )
      const result = await requestJson<{ booking: BookingView }>(
        `/api/bookings/${draft.bookingId}/step`,
        { method: 'PATCH', body: JSON.stringify({ currentStep: 2 }) },
        draft.token,
      )

      setBooking(result.booking)
      setStep(2)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
  }

  async function saveScheduleAndContinue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!booking || !accessToken) {
      setError('No se pudo recuperar el borrador de la reserva.')
      return
    }

    setIsWorking(true)
    setError(null)

    try {
      const scheduled = await requestJson<{ booking: BookingView }>(
        `/api/bookings/${booking.id}/schedule`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            ...schedule,
            roomId: Number(schedule.roomId),
          }),
        },
        accessToken,
      )
      const withServices = await requestJson<{ booking: BookingView }>(
        `/api/bookings/${booking.id}/services`,
        { method: 'PATCH', body: JSON.stringify(services) },
        accessToken,
      )

      setBooking(withServices.booking ?? scheduled.booking)
      setStep(3)
      setIsSaved(true)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
  }

  async function saveServices(): Promise<BookingView | null> {
    if (!booking || !accessToken) {
      setError('No se pudo recuperar el borrador de la reserva.')
      return null
    }

    setIsWorking(true)
    setError(null)

    try {
      const result = await requestJson<{ booking: BookingView }>(
        `/api/bookings/${booking.id}/services`,
        { method: 'PATCH', body: JSON.stringify(services) },
        accessToken,
      )
      setBooking(result.booking)
      setIsSaved(true)
      return result.booking
    } catch (requestError) {
      setError(getApiErrorMessage(requestError))
      return null
    } finally {
      setIsWorking(false)
    }
  }

  async function confirmReservation(): Promise<void> {
    if (!booking || !accessToken) {
      setError('No se pudo recuperar el borrador de la reserva.')
      return
    }

    const savedBooking = await saveServices()

    if (!savedBooking) {
      return
    }

    setIsWorking(true)

    try {
      const result = await requestJson<{ booking: BookingView }>(
        `/api/bookings/${booking.id}/confirm`,
        { method: 'POST' },
        accessToken,
      )
      setBooking(result.booking)
      onDraftAccessChange(null)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
  }

  async function goBack(targetStep: 1 | 2): Promise<void> {
    if (booking && accessToken) {
      setIsWorking(true)

      try {
        const result = await requestJson<{ booking: BookingView }>(
          `/api/bookings/${booking.id}/step`,
          { method: 'PATCH', body: JSON.stringify({ currentStep: targetStep }) },
          accessToken,
        )
        setBooking(result.booking)
      } catch (requestError) {
        setError(getApiErrorMessage(requestError))
        return
      } finally {
        setIsWorking(false)
      }
    }

    setError(null)
    setStep(targetStep)
  }

  const stepNames = ['Cliente', 'Sala y horario', 'Adicionales']

  return (
    <div className="wizard-overlay">
      <section
        className="wizard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
      >
        <header className="wizard-header">
          <div>
            <p className="wizard-eyebrow">RESERVA DE SALA</p>
            <h2 id="wizard-title">
              {booking?.status === 'confirmed' ? 'Reserva confirmada' : 'Completa tu reserva'}
            </h2>
          </div>
          <button
            className="wizard-close"
            type="button"
            aria-label="Cerrar reserva"
            title="Cerrar reserva"
            onClick={onClose}
            disabled={isWorking}
          >
            <X size={20} />
          </button>
        </header>

        {booking?.status !== 'confirmed' && (
          <ol className="wizard-progress" aria-label="Pasos de la reserva">
            {stepNames.map((name, index) => {
              const stepNumber = index + 1
              return (
                <li className={stepNumber <= step ? 'step-active' : ''} key={name}>
                  <span className="step-marker">
                    {stepNumber < step ? <Check size={14} /> : stepNumber}
                  </span>
                  <span>{name}</span>
                </li>
              )
            })}
          </ol>
        )}

        {error && (
          <div className="wizard-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="wizard-loading"><LoaderCircle className="spinner" /> Recuperando borrador...</div>
        ) : booking?.status === 'confirmed' ? (
          <div className="wizard-confirmed" aria-live="polite">
            <span className="confirmed-icon"><ShieldCheck size={30} /></span>
            <p className="confirmed-kicker">CONFIRMACIÓN #{booking.id}</p>
            <h3>{booking.customer.fullName ?? 'Tu reserva'} está lista.</h3>
            <p>{booking.room.name} · {formatDate(booking.date)} · {booking.startTime}–{booking.endTime}</p>
            <strong>{formatCurrency(booking.total)}</strong>
            <button type="button" className="wizard-primary" onClick={onClose}>Listo</button>
          </div>
        ) : (
          <div className="wizard-body">
            {step === 1 && (
              <form className="wizard-form" onSubmit={saveCustomerAndContinue}>
                <div className="wizard-step-heading">
                  <span className="wizard-step-icon"><UserRound size={19} /></span>
                  <div>
                    <p className="wizard-step-kicker">PASO 1 DE 3</p>
                    <h3>Datos del cliente</h3>
                  </div>
                </div>
                <label className="wizard-field" htmlFor="booking-name">
                  <span>Nombre completo</span>
                  <input
                    id="booking-name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={120}
                    required
                    value={customer.fullName}
                    onChange={(event) => setCustomer({ ...customer, fullName: event.target.value })}
                  />
                </label>
                <label className="wizard-field" htmlFor="booking-email">
                  <span>Correo electrónico</span>
                  <input
                    id="booking-email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={customer.email}
                    onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
                  />
                </label>
                <label className="wizard-field" htmlFor="booking-company">
                  <span>Empresa <span className="optional-label">Opcional</span></span>
                  <input
                    id="booking-company"
                    autoComplete="organization"
                    maxLength={120}
                    value={customer.company}
                    onChange={(event) => setCustomer({ ...customer, company: event.target.value })}
                  />
                </label>
                <div className="wizard-actions wizard-actions-end">
                  <button className="wizard-primary" type="submit" disabled={isWorking}>
                    {isWorking ? <LoaderCircle className="spinner" size={17} /> : null}
                    Guardar y continuar <ArrowRight size={17} />
                  </button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form className="wizard-form" onSubmit={saveScheduleAndContinue}>
                <div className="wizard-step-heading">
                  <span className="wizard-step-icon"><CalendarDays size={19} /></span>
                  <div>
                    <p className="wizard-step-kicker">PASO 2 DE 3</p>
                    <h3>Sala y horario</h3>
                  </div>
                </div>
                <label className="wizard-field" htmlFor="booking-room">
                  <span>Sala</span>
                  <select
                    id="booking-room"
                    required
                    value={schedule.roomId}
                    onChange={(event) => setSchedule({ ...schedule, roomId: event.target.value })}
                  >
                    {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                  </select>
                </label>
                <div className="wizard-field-row">
                  <label className="wizard-field" htmlFor="booking-date">
                    <span>Fecha</span>
                    <input
                      id="booking-date"
                      type="date"
                      min={getTodayInBogota()}
                      required
                      value={schedule.date}
                      onChange={(event) => setSchedule({ ...schedule, date: event.target.value })}
                    />
                  </label>
                  <label className="wizard-field" htmlFor="booking-time">
                    <span>Hora de inicio</span>
                    <input
                      id="booking-time"
                      type="time"
                      min="07:00"
                      max="21:00"
                      step={1800}
                      required
                      value={schedule.startTime}
                      onChange={(event) => setSchedule({ ...schedule, startTime: event.target.value })}
                    />
                  </label>
                </div>
                <label className="wizard-field" htmlFor="booking-duration">
                  <span>Duración</span>
                  <select
                    id="booking-duration"
                    value={schedule.durationHours}
                    onChange={(event) => setSchedule({ ...schedule, durationHours: Number(event.target.value) })}
                  >
                    {Array.from({ length: 19 }, (_, index) => 1 + index / 2).map((duration) => (
                      <option key={duration} value={duration}>
                        {duration.toLocaleString('es-CO')} {duration === 1 ? 'hora' : 'horas'}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="wizard-actions">
                  <button className="wizard-secondary" type="button" disabled={isWorking} onClick={() => void goBack(1)}>
                    <ArrowLeft size={17} /> Atrás
                  </button>
                  <button className="wizard-primary" type="submit" disabled={isWorking}>
                    {isWorking ? <LoaderCircle className="spinner" size={17} /> : null}
                    Guardar y continuar <ArrowRight size={17} />
                  </button>
                </div>
              </form>
            )}

            {step === 3 && (
              <div className="wizard-form">
                <div className="wizard-step-heading">
                  <span className="wizard-step-icon"><Check size={19} /></span>
                  <div>
                    <p className="wizard-step-kicker">PASO 3 DE 3</p>
                    <h3>Servicios adicionales</h3>
                  </div>
                </div>
                <label className="service-option">
                  <span className="service-option-icon"><Monitor size={19} /></span>
                  <span className="service-option-copy">
                    <strong>Proyector</strong>
                    <span>Equipo de proyección para tu reunión</span>
                  </span>
                  <span className="service-option-price">{formatCurrency(50_000)}</span>
                  <input
                    type="checkbox"
                    checked={services.projector}
                    onChange={(event) => {
                      setServices({ ...services, projector: event.target.checked })
                      setIsSaved(false)
                    }}
                  />
                </label>
                <label className="service-option service-coffee">
                  <span className="service-option-icon"><Coffee size={19} /></span>
                  <span className="service-option-copy">
                    <strong>Café</strong>
                    <span>{formatCurrency(8_000)} por persona</span>
                  </span>
                  <input
                    aria-label="Cantidad de cafés"
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    value={services.coffeePeople}
                    onChange={(event) => {
                      const coffeePeople = Number(event.target.value)
                      setServices({ ...services, coffeePeople })
                      setIsSaved(false)
                    }}
                  />
                </label>
                <div className="wizard-total-row">
                  <span>Total pactado</span>
                  <strong>{formatCurrency(booking?.total ?? quote?.total ?? 0)}</strong>
                </div>
                <div className="wizard-actions">
                  <button className="wizard-secondary" type="button" disabled={isWorking} onClick={() => void goBack(2)}>
                    <ArrowLeft size={17} /> Atrás
                  </button>
                  <button className="wizard-secondary" type="button" disabled={isWorking} onClick={() => void saveServices()}>
                    {isSaved ? <><Check size={17} /> Guardado</> : 'Guardar borrador'}
                  </button>
                  <button className="wizard-primary" type="button" disabled={isWorking} onClick={() => void confirmReservation()}>
                    {isWorking ? <LoaderCircle className="spinner" size={17} /> : null}
                    Confirmar reserva <ArrowRight size={17} />
                  </button>
                </div>
                <p className="wizard-security"><ShieldCheck size={15} /> Solo se confirma al pulsar el botón.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}