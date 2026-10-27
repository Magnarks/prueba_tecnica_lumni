import type { Pool } from 'pg'

export type BookingEmailStatus = 'pending' | 'processing' | 'sent' | 'failed'

export interface AdminEmailFilters {
  status?: BookingEmailStatus
  page: number
  pageSize: number
}

export interface AdminEmailSummary {
  id: number
  bookingId: string
  recipient: string
  subject: string
  status: BookingEmailStatus
  attempts: number
  lastError: string | null
  createdAt: string
  nextAttemptAt: string | null
  sentAt: string | null
  capturedAt: string | null
}

export interface AdminEmailDetail extends AdminEmailSummary {
  body: string
}

export class AdminEmailNotFoundError extends Error {
  constructor() {
    super('No se encontró el correo solicitado.')
    this.name = 'AdminEmailNotFoundError'
  }
}

function whereFor(status: BookingEmailStatus | undefined): {
  clause: string
  values: string[]
} {
  return status
    ? { clause: 'WHERE j.status = $1', values: [status] }
    : { clause: '', values: [] }
}

const emailSummaryColumns = `j.id,
  j.booking_id::text AS "bookingId",
  j.recipient,
  j.subject,
  j.status,
  j.attempts,
  j.last_error AS "lastError",
  to_char(j.created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS "createdAt",
  CASE WHEN j.status = 'pending'
       THEN to_char(j.next_attempt_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI')
       ELSE NULL
  END AS "nextAttemptAt",
    CASE WHEN j.status = 'sent'
      THEN to_char(j.sent_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI')
      ELSE NULL
    END AS "sentAt",
  to_char(ce.sent_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS "capturedAt"`

export async function listAdminEmails(
  pool: Pool,
  filters: AdminEmailFilters,
): Promise<{ items: AdminEmailSummary[]; total: number; page: number; pageSize: number }> {
  const { clause, values } = whereFor(filters.status)
  const pageValues = [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]
  const limitPlaceholder = `$${values.length + 1}`
  const offsetPlaceholder = `$${values.length + 2}`
  const [countResult, jobsResult] = await Promise.all([
    pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM booking_email_jobs j ${clause}`,
      values,
    ),
    pool.query<AdminEmailSummary>(
      `SELECT ${emailSummaryColumns}
       FROM booking_email_jobs j
       LEFT JOIN captured_emails ce ON ce.job_id = j.id
       ${clause}
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      pageValues,
    ),
  ])

  return {
    items: jobsResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export async function getAdminEmailDetail(
  pool: Pool,
  emailJobId: number,
): Promise<AdminEmailDetail> {
  const result = await pool.query<AdminEmailDetail>(
    `SELECT ${emailSummaryColumns}, j.body
     FROM booking_email_jobs j
     LEFT JOIN captured_emails ce ON ce.job_id = j.id
     WHERE j.id = $1`,
    [emailJobId],
  )
  const job = result.rows[0]

  if (!job) {
    throw new AdminEmailNotFoundError()
  }

  return job
}