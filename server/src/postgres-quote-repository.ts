import type { Pool } from 'pg'
import type { QuoteRepository, QuoteRoom } from './quote-service'

export class PostgresQuoteRepository implements QuoteRepository {
  constructor(private readonly pool: Pool) {}

  async findRoomById(roomId: number): Promise<QuoteRoom | null> {
    const result = await this.pool.query<QuoteRoom>(
      `SELECT id, name, size, hourly_rate::float8 AS "hourlyRate"
       FROM rooms
       WHERE id = $1`,
      [roomId],
    )

    return result.rows[0] ?? null
  }

  async isAvailable(roomId: number, startsAt: string, endsAt: string): Promise<boolean> {
    const result = await this.pool.query<{ available: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM bookings
         WHERE room_id = $1
           AND status = 'confirmed'
           AND tstzrange(starts_at, ends_at, '[)')
             && tstzrange($2::timestamptz, $3::timestamptz, '[)')
       ) AS available`,
      [roomId, startsAt, endsAt],
    )

    return result.rows[0]?.available ?? false
  }
}