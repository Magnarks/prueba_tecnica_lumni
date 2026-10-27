import express, { type NextFunction, type Request, type Response } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { RoomSize } from './quote'
import { createQuote, RoomNotFoundError } from './quote-service'
import { PostgresQuoteRepository } from './postgres-quote-repository'

const quoteRequestSchema = z.object({
  roomId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  durationHours: z.number().finite(),
}).strict()

export function createApp(pool: Pool) {
  const app = express()
  const quoteRepository = new PostgresQuoteRepository(pool)

  app.use(express.json({ limit: '16kb' }))

  app.get('/api/rooms', async (_request, response, next) => {
    try {
      const result = await pool.query<{
        id: number
        name: string
        size: RoomSize
        hourlyRate: number
      }>(
        `SELECT id, name, size, hourly_rate::float8 AS "hourlyRate"
         FROM rooms
         ORDER BY id`,
      )

      return response.json({ rooms: result.rows })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/quotes', async (request, response, next) => {
    const parsedRequest = quoteRequestSchema.safeParse(request.body)

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: 'Los datos de la cotización no son válidos.',
        details: parsedRequest.error.issues,
      })
    }

    try {
      const quote = await createQuote(parsedRequest.data, quoteRepository)
      return response.json(quote)
    } catch (error) {
      return next(error)
    }
  })

  app.use((
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    void _next

    if (error instanceof RoomNotFoundError) {
      return response.status(404).json({ error: error.message })
    }

    if (error instanceof RangeError) {
      return response.status(400).json({ error: error.message })
    }

    console.error(error)
    return response.status(500).json({ error: 'No fue posible procesar la cotización.' })
  })

  return app
}