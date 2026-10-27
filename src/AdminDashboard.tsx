import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Mail,
  RefreshCw,
  UserRound,
  X,
} from 'lucide-react'
import type {
  AdminBookingDetail,
  AuthenticatedUser,
  BookingStatus,
  PaginatedAdminBookings,
  Room,
} from './contracts'
import { AdminEmailJobs } from './AdminEmailJobs'
import './Admin.css'

interface AdminDashboardProps {
  accessToken: string
  user: AuthenticatedUser
  onBack: () => void
}

interface ApiError {
  error?: string
}

const statusLabels: Record<BookingStatus, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
}

const statusFilters: Array<{ value: BookingStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'draft', label: 'Borradores' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
]

const bookingLineLabels: Record<string, string> = {
  base: 'Precio base',
  discount_duration: 'Descuento por duración',
  saturday_surcharge: 'Recargo sábado',
  service_projector: 'Proyector',
  service_coffee: 'Café',
}

const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

async function adminRequest<T>(
  url: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(url, { ...options, headers })
  const payload = await response.json().catch(() => ({})) as ApiError

  if (!response.ok) {
    throw new Error(payload.error ?? 'No fue posible completar la solicitud.')
  }

  return payload as T
}

function displayCustomer(name: string | null, email: string | null): string {
  return name || email || 'Sin datos de cliente'
}

export function AdminDashboard({ accessToken, user, onBack }: AdminDashboardProps) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [activePanel, setActivePanel] = useState<'bookings' | 'emails'>('bookings')
  const [bookings, setBookings] = useState<PaginatedAdminBookings>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  })
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all')
  const [roomFilter, setRoomFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminBookingDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadRooms(): Promise<void> {
      try {
        const response = await fetch('/api/rooms', { signal: controller.signal })
        const result = await response.json() as { rooms?: Room[] }
        if (!controller.signal.aborted && response.ok) {
          setRooms(result.rooms ?? [])
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('No fue posible cargar el filtro de salas.')
        }
      }
    }

    void loadRooms()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadBookings(): Promise<void> {
      setIsLoading(true)
      setError(null)

      const params = new URLSearchParams({ page: String(page), pageSize: '10' })
      if (statusFilter !== 'all') {
        params.set('status', statusFilter)
      }
      if (roomFilter !== 'all') {
        params.set('roomId', roomFilter)
      }

      try {
        const result = await adminRequest<PaginatedAdminBookings>(
          `/api/admin/bookings?${params}`,
          accessToken,
          { signal: controller.signal },
        )

        if (!controller.signal.aborted) {
          setBookings(result)
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error
            ? requestError.message
            : 'No fue posible cargar las reservas.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadBookings()
    return () => controller.abort()
  }, [accessToken, page, reloadKey, roomFilter, statusFilter])

  useEffect(() => {
    if (!selectedId) {
      return
    }

    const controller = new AbortController()

    async function loadDetail(): Promise<void> {
      setDetail(null)
      setDetailError(null)

      try {
        const result = await adminRequest<{ booking: AdminBookingDetail }>(
          `/api/admin/bookings/${selectedId}`,
          accessToken,
          { signal: controller.signal },
        )

        if (!controller.signal.aborted) {
          setDetail(result.booking)
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setDetailError(requestError instanceof Error
            ? requestError.message
            : 'No fue posible cargar el detalle.')
        }
      }
    }

    void loadDetail()
    return () => controller.abort()
  }, [accessToken, selectedId, reloadKey])

  async function cancelBooking(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!detail || !cancelReason.trim()) {
      setCancelError('Escribe un motivo para cancelar la reserva.')
      return
    }

    setCancelError(null)
    setIsCancelling(true)

    try {
      await adminRequest<{ booking: AdminBookingDetail }>(
        `/api/admin/bookings/${detail.id}/cancel`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ reason: cancelReason.trim() }),
        },
      )
      setCancelReason('')
      setReloadKey((key) => key + 1)
    } catch (requestError) {
      setCancelError(requestError instanceof Error
        ? requestError.message
        : 'No fue posible cancelar la reserva.')
    } finally {
      setIsCancelling(false)
    }
  }

  const pageCount = Math.max(1, Math.ceil(bookings.total / bookings.pageSize))

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="admin-eyebrow">LUMNI COWORKING / ADMINISTRACIÓN</p>
          <h1>{activePanel === 'bookings' ? 'Reservas' : 'Correos'}</h1>
        </div>
        <div className="admin-header-actions">
          <span className="admin-user"><UserRound size={15} /> {user.fullName ?? user.email}</span>
          <button className="admin-back-button" type="button" onClick={onBack}>
            <ArrowLeft size={16} /> Cotizador
          </button>
        </div>
      </header>

      <nav className="admin-section-tabs" aria-label="Secciones de administración">
        <button
          className={activePanel === 'bookings' ? 'admin-section-tab is-active' : 'admin-section-tab'}
          type="button"
          aria-current={activePanel === 'bookings' ? 'page' : undefined}
          onClick={() => setActivePanel('bookings')}
        >
          <Building2 size={15} /> Reservas
        </button>
        <button
          className={activePanel === 'emails' ? 'admin-section-tab is-active' : 'admin-section-tab'}
          type="button"
          aria-current={activePanel === 'emails' ? 'page' : undefined}
          onClick={() => setActivePanel('emails')}
        >
          <Mail size={15} /> Correos
        </button>
      </nav>

      {activePanel === 'emails' ? (
        <AdminEmailJobs accessToken={accessToken} />
      ) : (
      <>
      <section className="admin-toolbar" aria-label="Filtros de reservas">
        <label className="admin-filter" htmlFor="admin-status-filter">
          <span>Estado</span>
          <select
            id="admin-status-filter"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as BookingStatus | 'all')
              setPage(1)
            }}
          >
            {statusFilters.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
        <label className="admin-filter" htmlFor="admin-room-filter">
          <span>Sala</span>
          <select
            id="admin-room-filter"
            value={roomFilter}
            onChange={(event) => {
              setRoomFilter(event.target.value)
              setPage(1)
            }}
          >
            <option value="all">Todas las salas</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
        <div className="admin-toolbar-spacer" />
        <span className="admin-count">{bookings.total} {bookings.total === 1 ? 'reserva' : 'reservas'}</span>
        <button
          className="admin-icon-button"
          type="button"
          aria-label="Actualizar reservas"
          title="Actualizar reservas"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={isLoading}
        >
          <RefreshCw size={17} className={isLoading ? 'spinner' : ''} />
        </button>
      </section>

      {error && <div className="admin-error" role="alert"><CircleAlert size={17} /> {error}</div>}

      <div className={`admin-workspace ${selectedId ? 'with-detail' : ''}`}>
        <section className="admin-list" aria-label="Listado paginado de reservas">
          <div className="admin-table-heading" aria-hidden="true">
            <span>Reserva</span>
            <span>Cliente</span>
            <span>Sala y horario</span>
            <span>Estado</span>
            <span>Total</span>
            <span />
          </div>

          {isLoading && bookings.items.length === 0 ? (
            <div className="admin-empty"><LoaderCircle className="spinner" size={22} /> Cargando reservas...</div>
          ) : bookings.items.length === 0 ? (
            <div className="admin-empty">
              <span className="admin-empty-icon"><CalendarDays size={21} /></span>
              <strong>No hay reservas para mostrar</strong>
              <span>Ajusta los filtros o revisa más tarde.</span>
            </div>
          ) : (
            <div className="admin-table-rows">
              {bookings.items.map((booking) => (
                <button
                  className={`admin-booking-row ${selectedId === booking.id ? 'row-selected' : ''}`}
                  type="button"
                  key={booking.id}
                  onClick={() => setSelectedId(booking.id)}
                >
                  <span className="admin-booking-id">#{booking.id}<small>{booking.createdAt}</small></span>
                  <span className="admin-booking-customer">
                    <strong>{displayCustomer(booking.customerName, booking.customerEmail)}</strong>
                    {booking.customerName && <small>{booking.customerEmail ?? ''}</small>}
                  </span>
                  <span className="admin-booking-schedule">
                    <strong>{booking.roomName}</strong>
                    <small>{booking.date} · {booking.startTime}–{booking.endTime}</small>
                  </span>
                  <span className={`admin-status status-${booking.status}`}>{statusLabels[booking.status]}</span>
                  <strong className="admin-booking-total">{currencyFormatter.format(booking.total)}</strong>
                  <ArrowRight className="admin-row-arrow" size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          <footer className="admin-pagination">
            <span>Página {page} de {pageCount}</span>
            <div>
              <button
                className="admin-page-button"
                type="button"
                aria-label="Página anterior"
                title="Página anterior"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ArrowLeft size={16} />
              </button>
              <button
                className="admin-page-button"
                type="button"
                aria-label="Página siguiente"
                title="Página siguiente"
                disabled={page >= pageCount || isLoading}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </footer>
        </section>

        {selectedId && (
          <aside className="admin-detail" aria-label={`Detalle de reserva ${selectedId}`}>
            <header className="admin-detail-header">
              <div>
                <p className="admin-eyebrow">DETALLE DE RESERVA</p>
                <h2>#{selectedId}</h2>
              </div>
              <button
                className="admin-icon-button"
                type="button"
                aria-label="Cerrar detalle"
                title="Cerrar detalle"
                onClick={() => setSelectedId(null)}
              >
                <X size={18} />
              </button>
            </header>

            {detailError && <p className="admin-error" role="alert">{detailError}</p>}
            {!detail && !detailError && <div className="admin-detail-loading"><LoaderCircle className="spinner" size={20} /></div>}

            {detail && (
              <div className="admin-detail-body">
                <div className="admin-detail-status-row">
                  <span className={`admin-status status-${detail.status}`}>{statusLabels[detail.status]}</span>
                  <strong>{currencyFormatter.format(detail.total)}</strong>
                </div>

                <section className="admin-detail-section">
                  <h3>Cliente</h3>
                  <p>{displayCustomer(detail.customerName, detail.customerEmail)}</p>
                  {detail.customerEmail && <p className="admin-detail-muted">{detail.customerEmail}</p>}
                  {detail.company && <p className="admin-detail-muted">{detail.company}</p>}
                </section>

                <section className="admin-detail-section">
                  <h3>Reserva</h3>
                  <p className="admin-detail-line"><Building2 size={15} /> {detail.roomName}</p>
                  <p className="admin-detail-line"><CalendarDays size={15} /> {detail.date}</p>
                  <p className="admin-detail-line"><Clock3 size={15} /> {detail.startTime}–{detail.endTime}</p>
                  <p className="admin-detail-muted">Creada el {detail.createdAt}</p>
                </section>

                <section className="admin-detail-section">
                  <h3>Desglose</h3>
                  <dl className="admin-lines">
                    {detail.lines.map((line, index) => (
                      <div key={`${line.concept}-${index}`}>
                        <dt>{bookingLineLabels[line.concept] ?? line.concept.replaceAll('_', ' ')}</dt>
                        <dd>{currencyFormatter.format(line.amount)}</dd>
                      </div>
                    ))}
                    <div className="admin-lines-total"><dt>Total pactado</dt><dd>{currencyFormatter.format(detail.total)}</dd></div>
                  </dl>
                  {(detail.projector || detail.coffeePeople > 0) && (
                    <p className="admin-detail-muted admin-services-note">
                      {detail.projector ? 'Proyector' : ''}
                      {detail.projector && detail.coffeePeople > 0 ? ' · ' : ''}
                      {detail.coffeePeople > 0 ? `${detail.coffeePeople} cafés` : ''}
                    </p>
                  )}
                </section>

                {detail.status === 'cancelled' && detail.cancellationReason && (
                  <section className="admin-cancellation-note">
                    <strong>Motivo de cancelación</strong>
                    <p>{detail.cancellationReason}</p>
                    {detail.cancelledAt && <small>{detail.cancelledAt}</small>}
                  </section>
                )}

                {(detail.status === 'draft' || detail.status === 'confirmed') && (
                  <form className="admin-cancel-form" onSubmit={cancelBooking}>
                    <label htmlFor="cancel-reason">Cancelar reserva</label>
                    <textarea
                      id="cancel-reason"
                      maxLength={500}
                      minLength={1}
                      placeholder="Escribe el motivo"
                      required
                      rows={3}
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                    />
                    {cancelError && <p className="admin-cancel-error" role="alert">{cancelError}</p>}
                    <button
                      className="admin-cancel-button"
                      type="submit"
                      disabled={isCancelling || !cancelReason.trim()}
                    >
                      {isCancelling ? <LoaderCircle className="spinner" size={16} /> : <X size={16} />}
                      Cancelar reserva
                    </button>
                  </form>
                )}

                {detail.status === 'cancelled' && <p className="admin-cancelled-confirmation"><Check size={15} /> Reserva cancelada</p>}
              </div>
            )}
          </aside>
        )}
      </div>
      </>
      )}
    </main>
  )
}