import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, Mail, RefreshCw, X } from 'lucide-react'
import type {
  AdminEmailDetail,
  BookingEmailStatus,
  PaginatedAdminEmails,
} from './contracts'

interface AdminEmailJobsProps {
  accessToken: string
}

interface ApiError {
  error?: string
}

const emailStatuses: Array<{ value: BookingEmailStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos los correos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'processing', label: 'En proceso' },
  { value: 'sent', label: 'Enviados' },
  { value: 'failed', label: 'Fallidos' },
]

const emailStatusLabels: Record<BookingEmailStatus, string> = {
  pending: 'Pendiente',
  processing: 'En proceso',
  sent: 'Enviado',
  failed: 'Fallido',
}

const MAX_EMAIL_ATTEMPTS = 6

async function requestAdmin<T>(
  url: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  const payload = await response.json().catch(() => ({})) as ApiError

  if (!response.ok) {
    throw new Error(payload.error ?? 'No fue posible consultar los correos.')
  }

  return payload as T
}

export function AdminEmailJobs({ accessToken }: AdminEmailJobsProps) {
  const [emails, setEmails] = useState<PaginatedAdminEmails>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  })
  const [statusFilter, setStatusFilter] = useState<BookingEmailStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminEmailDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ page: String(page), pageSize: '10' })

    if (statusFilter !== 'all') {
      params.set('status', statusFilter)
    }

    async function loadEmails(): Promise<void> {
      setIsLoading(true)
      setError(null)

      try {
        const result = await requestAdmin<PaginatedAdminEmails>(
          `/api/admin/emails?${params}`,
          accessToken,
          controller.signal,
        )

        if (!controller.signal.aborted) {
          setEmails(result)
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error
            ? requestError.message
            : 'No fue posible cargar los correos.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadEmails()
    return () => controller.abort()
  }, [accessToken, page, reloadKey, statusFilter])

  useEffect(() => {
    if (selectedId === null) {
      return
    }

    const controller = new AbortController()

    async function loadEmailDetail(): Promise<void> {
      try {
        const result = await requestAdmin<{ email: AdminEmailDetail }>(
          `/api/admin/emails/${selectedId}`,
          accessToken,
          controller.signal,
        )

        if (!controller.signal.aborted) {
          setDetail(result.email)
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error
            ? requestError.message
            : 'No fue posible cargar el contenido del correo.')
        }
      }
    }

    void loadEmailDetail()
    return () => controller.abort()
  }, [accessToken, reloadKey, selectedId])

  const pageCount = Math.max(1, Math.ceil(emails.total / emails.pageSize))

  return (
    <section className="admin-email-view" aria-label="Correos de confirmación">
      <div className="admin-email-toolbar">
        <label className="admin-filter" htmlFor="admin-email-status">
          <span>Estado del envío</span>
          <select
            id="admin-email-status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as BookingEmailStatus | 'all')
              setPage(1)
            }}
          >
            {emailStatuses.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        </label>
        <span className="admin-count">{emails.total} {emails.total === 1 ? 'correo' : 'correos'}</span>
        <button
          className="admin-icon-button"
          type="button"
          aria-label="Actualizar correos"
          title="Actualizar correos"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={isLoading}
        >
          <RefreshCw size={17} className={isLoading ? 'spinner' : ''} />
        </button>
      </div>

      {error && <div className="admin-error" role="alert"><CircleAlert size={17} /> {error}</div>}

      <div className={`admin-email-workspace ${selectedId !== null ? 'with-email-detail' : ''}`}>
        <div className="admin-email-list">
          {isLoading && emails.items.length === 0 ? (
            <div className="admin-empty"><LoaderCircle className="spinner" size={22} /> Cargando correos...</div>
          ) : emails.items.length === 0 ? (
            <div className="admin-empty">
              <span className="admin-empty-icon"><Mail size={21} /></span>
              <strong>No hay correos para mostrar</strong>
              <span>Las confirmaciones aparecerán aquí.</span>
            </div>
          ) : (
            <div className="admin-email-rows">
              {emails.items.map((email) => (
                <button
                  type="button"
                  className={`admin-email-row ${selectedId === email.id ? 'row-selected' : ''}`}
                  key={email.id}
                  onClick={() => {
                    setSelectedId(email.id)
                    setDetail(null)
                  }}
                >
                  <span className={`admin-email-icon email-${email.status}`}><Mail size={17} /></span>
                  <span className="admin-email-main">
                    <strong>{email.subject}</strong>
                    <small>Reserva #{email.bookingId} · {email.recipient}</small>
                    <small>{email.createdAt}</small>
                  </span>
                  <span className="admin-email-meta">
                    <span className={`email-status email-status-${email.status}`}>
                      {emailStatusLabels[email.status]}
                    </span>
                    <small>{email.attempts}/{MAX_EMAIL_ATTEMPTS} intentos</small>
                    <small>{email.sentAt ? `Enviado ${email.sentAt}` : email.nextAttemptAt ? `Próximo ${email.nextAttemptAt}` : ''}</small>
                  </span>
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
                aria-label="Página anterior de correos"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ArrowLeft size={16} />
              </button>
              <button
                className="admin-page-button"
                type="button"
                aria-label="Página siguiente de correos"
                disabled={page >= pageCount || isLoading}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </footer>
        </div>

        {selectedId !== null && (
          <aside className="admin-email-detail" aria-label={`Contenido del correo ${selectedId}`}>
            <header className="admin-detail-header">
              <div>
                <p className="admin-eyebrow">DETALLE DEL CORREO</p>
                <h2>#{selectedId}</h2>
              </div>
              <button
                className="admin-icon-button"
                type="button"
                aria-label="Cerrar detalle del correo"
                onClick={() => {
                  setSelectedId(null)
                  setDetail(null)
                }}
              >
                <X size={18} />
              </button>
            </header>
            {!detail ? (
              <div className="admin-detail-loading"><LoaderCircle className="spinner" size={20} /></div>
            ) : (
              <div className="admin-email-detail-body">
                <span className={`email-status email-status-${detail.status}`}>
                  {emailStatusLabels[detail.status]}
                </span>
                <p><strong>Para</strong>{detail.recipient}</p>
                <p><strong>Asunto</strong>{detail.subject}</p>
                <p><strong>Reserva</strong>#{detail.bookingId}</p>
                <p><strong>Intentos</strong>{detail.attempts} de {MAX_EMAIL_ATTEMPTS}</p>
                {detail.capturedAt && <p><strong>Capturado</strong>{detail.capturedAt}</p>}
                {detail.sentAt && <p><strong>Enviado</strong>{detail.sentAt}</p>}
                {detail.nextAttemptAt && <p><strong>Próximo intento</strong>{detail.nextAttemptAt}</p>}
                {detail.lastError && (
                  <div className="email-last-error">
                    <strong>Último error</strong>
                    <p>{detail.lastError}</p>
                  </div>
                )}
                <pre className="admin-email-body">{detail.body}</pre>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}
