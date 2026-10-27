import type { Pool } from 'pg'

export const MAX_EMAIL_RETRIES = 5
export const MAX_EMAIL_ATTEMPTS = MAX_EMAIL_RETRIES + 1
const RETRY_DELAY_BASE_MS = 1_000
const STALE_JOB_LOCK_MS = 5 * 60 * 1_000
const STALE_JOB_RECOVERY_INTERVAL_MS = 30_000
const WORKER_POLL_INTERVAL_MS = 750

export interface ConfirmationEmailJob {
  id: number
  bookingId: string
  recipient: string
  subject: string
  body: string
  attempts: number
}

export interface EmailJobStore {
  claimNext(): Promise<ConfirmationEmailJob | null>
  markSent(jobId: number): Promise<void>
  markFailed(jobId: number, attempts: number, error: string, retryDelayMs: number): Promise<void>
  recoverStaleJobs(): Promise<void>
}

export interface EmailTransport {
  send(job: ConfirmationEmailJob): Promise<void>
}

export function getRetryDelayMs(attempts: number): number {
  return RETRY_DELAY_BASE_MS * 2 ** Math.max(0, attempts - 1)
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Error desconocido al enviar el correo.'
  return message.slice(0, 1_000)
}

export async function processOneEmailJob(
  store: EmailJobStore,
  transport: EmailTransport,
): Promise<boolean> {
  const job = await store.claimNext()

  if (!job) {
    return false
  }

  try {
    await transport.send(job)
    await store.markSent(job.id)
  } catch (error) {
    await store.markFailed(
      job.id,
      job.attempts,
      errorMessage(error),
      getRetryDelayMs(job.attempts),
    )
  }

  return true
}

export class PostgresEmailJobStore implements EmailJobStore {
  constructor(private readonly pool: Pool) {}

  async claimNext(): Promise<ConfirmationEmailJob | null> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const selected = await client.query<{
        id: number
        bookingId: string
        recipient: string
        subject: string
        body: string
      }>(
        `SELECT id, booking_id::text AS "bookingId", recipient, subject, body
         FROM booking_email_jobs
         WHERE status = 'pending'
           AND attempts < $1
           AND next_attempt_at <= now()
         ORDER BY next_attempt_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [MAX_EMAIL_ATTEMPTS],
      )
      const job = selected.rows[0]

      if (!job) {
        await client.query('COMMIT')
        return null
      }

      const claimed = await client.query<{ attempts: number }>(
        `UPDATE booking_email_jobs
         SET status = 'processing', attempts = attempts + 1, locked_at = now()
         WHERE id = $1
         RETURNING attempts`,
        [job.id],
      )
      await client.query('COMMIT')

      return { ...job, attempts: claimed.rows[0].attempts }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async markSent(jobId: number): Promise<void> {
    await this.pool.query(
      `UPDATE booking_email_jobs
       SET status = 'sent', sent_at = now(), locked_at = NULL, last_error = NULL
       WHERE id = $1 AND status = 'processing'`,
      [jobId],
    )
  }

  async markFailed(
    jobId: number,
    attempts: number,
    error: string,
    retryDelayMs: number,
  ): Promise<void> {
    const isFinalAttempt = attempts >= MAX_EMAIL_ATTEMPTS

    await this.pool.query(
      `UPDATE booking_email_jobs
       SET status = $2,
           next_attempt_at = CASE
             WHEN $2 = 'pending' THEN now() + ($4 * interval '1 millisecond')
             ELSE next_attempt_at
           END,
           locked_at = NULL,
           last_error = $3
       WHERE id = $1 AND status = 'processing'`,
      [jobId, isFinalAttempt ? 'failed' : 'pending', error, retryDelayMs],
    )
  }

  async recoverStaleJobs(): Promise<void> {
    await this.pool.query(
      `UPDATE booking_email_jobs
       SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'pending' END,
           next_attempt_at = CASE
             WHEN attempts >= $1 THEN next_attempt_at
             ELSE now()
           END,
           locked_at = NULL,
           last_error = COALESCE(last_error, 'El proceso de envío se interrumpió.')
       WHERE status = 'processing'
         AND locked_at < now() - ($2 * interval '1 millisecond')`,
      [MAX_EMAIL_ATTEMPTS, STALE_JOB_LOCK_MS],
    )
  }
}

export class CapturedEmailTransport implements EmailTransport {
  constructor(private readonly pool: Pool) {}

  async send(job: ConfirmationEmailJob): Promise<void> {
    await this.pool.query(
      `INSERT INTO captured_emails (job_id, recipient, subject, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (job_id) DO NOTHING`,
      [job.id, job.recipient, job.subject, job.body],
    )
  }
}

export function startEmailWorker(pool: Pool): () => void {
  const store = new PostgresEmailJobStore(pool)
  const transport = new CapturedEmailTransport(pool)
  let stopping = false
  let running = false
  let initializing = true
  let lastRecoveryAt = 0

  async function poll(): Promise<void> {
    if (stopping || running || initializing) {
      return
    }

    running = true

    try {
      if (Date.now() - lastRecoveryAt >= STALE_JOB_RECOVERY_INTERVAL_MS) {
        await store.recoverStaleJobs()
        lastRecoveryAt = Date.now()
      }

      for (let processed = 0; processed < 10 && !stopping; processed += 1) {
        if (!(await processOneEmailJob(store, transport))) {
          break
        }
      }
    } catch (error) {
      console.error('Falló el worker de correos de confirmación.', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void poll(), WORKER_POLL_INTERVAL_MS)

  void store.recoverStaleJobs()
    .then(() => {
      lastRecoveryAt = Date.now()
      initializing = false
      return poll()
    })
    .catch((error: unknown) => {
      initializing = false
      console.error('No se pudieron recuperar los jobs de correo.', error)
    })

  return () => {
    stopping = true
    clearInterval(timer)
  }
}