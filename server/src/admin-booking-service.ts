import type { Pool } from 'pg'
import {
  InvalidBookingTransitionError,
  transitionBooking,
  type BookingStatus,
} from './booking-state'

export interface AdminBookingFilters {
  status?: BookingStatus
  roomId?: number
  page: number
  pageSize: number
}

export interface AdminBookingSummary {
  id: string
  status: BookingStatus
  roomId: number
  roomName: string
  customerName: string | null
  customerEmail: string | null
  date: string
  startTime: string
  endTime: string
  total: number
  createdAt: string
}

export interface AdminBookingDetail extends AdminBookingSummary {
  company: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  projector: boolean
  coffeePeople: number
  lines: Array<{ concept: string; amount: number }>
}

export class AdminBookingNotFoundError extends Error {
  constructor() {
    super('No se encontró la reserva solicitada.')
    this.name = 'AdminBookingNotFoundError'
  }
}

function whereFor(filters: Pick<AdminBookingFilters, 'status' | 'roomId'>): {
  clause: string
  values: Array<string | number>
} {
  const conditions: string[] = []
  const values: Array<string | number> = []

  if (filters.status) {
    values.push(filters.status)
    conditions.push(`b.status = $${values.length}`)
  }

  if (filters.roomId) {
    values.push(filters.roomId)
    conditions.push(`b.room_id = $${values.length}`)
  }

  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  }
}

export async function listAdminBookings(
  pool: Pool,
  filters: AdminBookingFilters,
): Promise<{ items: AdminBookingSummary[]; total: number; page: number; pageSize: number }> {
  const { clause, values } = whereFor(filters)
  const offset = (filters.page - 1) * filters.pageSize
  const pageValues = [...values, filters.pageSize, offset]
  const limitPlaceholder = `$${values.length + 1}`
  const offsetPlaceholder = `$${values.length + 2}`

  const [countResult, bookingsResult] = await Promise.all([
    pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM bookings b ${clause}`,
      values,
    ),
    pool.query<AdminBookingSummary>(
      `SELECT b.id::text AS id,
              b.status,
              r.id AS "roomId",
              r.name AS "roomName",
              c.full_name AS "customerName",
              c.email AS "customerEmail",
              to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS date,
              to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "startTime",
              to_char(b.ends_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "endTime",
              b.total::float8 AS total,
              to_char(b.created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS "createdAt"
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       LEFT JOIN customers c ON c.id = b.customer_id
       ${clause}
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      pageValues,
    ),
  ])

  return {
    items: bookingsResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export async function getAdminBookingDetail(
  pool: Pool,
  bookingId: string,
): Promise<AdminBookingDetail> {
  const result = await pool.query<AdminBookingDetail>(
    `SELECT b.id::text AS id,
            b.status,
            r.id AS "roomId",
            r.name AS "roomName",
            c.full_name AS "customerName",
            c.email AS "customerEmail",
            c.company,
            to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS date,
            to_char(b.starts_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "startTime",
            to_char(b.ends_at AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "endTime",
            b.total::float8 AS total,
            to_char(b.created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS "createdAt",
            b.cancellation_reason AS "cancellationReason",
            to_char(b.cancelled_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS "cancelledAt",
            b.projector,
            b.coffee_people AS "coffeePeople",
            '[]'::json AS lines
     FROM bookings b
     JOIN rooms r ON r.id = b.room_id
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.id = $1`,
    [bookingId],
  )
  const booking = result.rows[0]

  if (!booking) {
    throw new AdminBookingNotFoundError()
  }

  const linesResult = await pool.query<{ concept: string; amount: number }>(
    `SELECT concept, amount::float8 AS amount
     FROM booking_lines
     WHERE booking_id = $1
     ORDER BY id`,
    [bookingId],
  )

  return { ...booking, lines: linesResult.rows }
}

export async function cancelAdminBooking(
  pool: Pool,
  bookingId: string,
  reason: string,
): Promise<AdminBookingDetail> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await client.query<{ status: BookingStatus }>(
      'SELECT status FROM bookings WHERE id = $1 FOR UPDATE',
      [bookingId],
    )
    const booking = result.rows[0]

    if (!booking) {
      throw new AdminBookingNotFoundError()
    }

    const nextStatus = transitionBooking(booking.status, 'cancelled')
    await client.query(
      `UPDATE bookings
       SET status = $2, cancellation_reason = $3, cancelled_at = now()
       WHERE id = $1`,
      [bookingId, nextStatus, reason],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')

    if (error instanceof InvalidBookingTransitionError) {
      throw error
    }

    throw error
  } finally {
    client.release()
  }

  return getAdminBookingDetail(pool, bookingId)
}