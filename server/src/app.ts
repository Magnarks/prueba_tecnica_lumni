import express, { type NextFunction, type Request, type Response } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'
import {
  createLoginSession,
  getSessionUser,
  InvalidCredentialsError,
  revokeLoginSession,
} from './auth-service'
import {
  AdminBookingNotFoundError,
  cancelAdminBooking,
  getAdminBookingDetail,
  listAdminBookings,
} from './admin-booking-service'
import {
  AdminEmailNotFoundError,
  getAdminEmailDetail,
  listAdminEmails,
} from './admin-email-service'
import {
  BookingConflictError,
  BookingNotEditableError,
  BookingNotFoundError,
  BookingProgressError,
  BookingUnavailableError,
  confirmBooking,
  createBookingDraft,
  getBookingByAccessToken,
  InvalidBookingTransitionError,
  saveBookingCustomer,
  saveBookingProgress,
  saveBookingSchedule,
  saveBookingServices,
} from './booking-service'
import type { RoomSize } from './quote'
import { createQuote, RoomNotFoundError } from './quote-service'
import { PostgresQuoteRepository } from './postgres-quote-repository'

const quoteRequestSchema = z.object({
  roomId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  durationHours: z.number().finite(),
}).strict()

const bookingCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(120).nullable().optional(),
})

const bookingDraftSchema = quoteRequestSchema
const bookingServicesSchema = z.object({
  projector: z.boolean(),
  coffeePeople: z.number().int().min(0).max(30),
}).strict()
const bookingStepSchema = z.object({
  currentStep: z.number().int().min(1).max(2),
}).strict()
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict()
const adminBookingFiltersSchema = z.object({
  status: z.enum(['draft', 'confirmed', 'completed', 'cancelled']).optional(),
  roomId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
}).strict()
const adminEmailFiltersSchema = z.object({
  status: z.enum(['pending', 'processing', 'sent', 'failed']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
}).strict()
const cancelBookingSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict()

function readSessionAccessToken(request: Request, response: Response): string | null {
  const authorization = request.get('authorization')
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization ?? '')

  if (!match) {
    response.status(401).json({ error: 'Inicia sesión para continuar.' })
    return null
  }

  return match[1]
}

function requireAdmin(pool: Pool) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const accessToken = readSessionAccessToken(request, response)

    if (!accessToken) {
      return
    }

    try {
      const user = await getSessionUser(pool, accessToken)

      if (!user) {
        return response.status(401).json({ error: 'La sesión expiró. Inicia sesión de nuevo.' })
      }

      if (user.role !== 'admin') {
        return response.status(403).json({ error: 'Esta acción requiere permisos de administrador.' })
      }

      return next()
    } catch (error) {
      return next(error)
    }
  }
}

function readBookingAccessToken(request: Request, response: Response): string | null {
  const authorization = request.get('authorization')
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization ?? '')

  if (!match) {
    response.status(401).json({ error: 'Se requiere un token de acceso válido.' })
    return null
  }

  return match[1]
}

function readBookingId(request: Request, response: Response): string | null {
  const result = z.string().regex(/^[1-9]\d*$/).safeParse(request.params.bookingId)

  if (!result.success) {
    response.status(400).json({ error: 'El identificador de la reserva no es válido.' })
    return null
  }

  return result.data
}

export function createApp(pool: Pool) {
  const app = express()
  const quoteRepository = new PostgresQuoteRepository(pool)

  app.use(express.json({ limit: '16kb' }))

  app.post('/api/auth/login', async (request, response, next) => {
    const credentials = loginSchema.safeParse(request.body)

    if (!credentials.success) {
      return response.status(400).json({
        error: 'Ingresa un correo y una contraseña válidos.',
        details: credentials.error.issues,
      })
    }

    try {
      const session = await createLoginSession(
        pool,
        credentials.data.email,
        credentials.data.password,
      )
      return response.json(session)
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/auth/session', async (request, response, next) => {
    const accessToken = readSessionAccessToken(request, response)

    if (!accessToken) {
      return
    }

    try {
      const user = await getSessionUser(pool, accessToken)

      if (!user) {
        return response.status(401).json({ error: 'La sesión expiró. Inicia sesión de nuevo.' })
      }

      return response.json({ user })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/auth/logout', async (request, response, next) => {
    const accessToken = readSessionAccessToken(request, response)

    if (!accessToken) {
      return
    }

    try {
      await revokeLoginSession(pool, accessToken)
      return response.status(204).end()
    } catch (error) {
      return next(error)
    }
  })

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

  app.post('/api/bookings/drafts', async (request, response, next) => {
    const parsedRequest = bookingDraftSchema.safeParse(request.body)

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: 'Los datos del borrador no son válidos.',
        details: parsedRequest.error.issues,
      })
    }

    try {
      const draft = await createBookingDraft(pool, quoteRepository, parsedRequest.data)
      return response.status(201).json(draft)
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/bookings/:bookingId', async (request, response, next) => {
    const bookingId = readBookingId(request, response)
    const accessToken = readBookingAccessToken(request, response)

    if (!bookingId || !accessToken) {
      return
    }

    try {
      const booking = await getBookingByAccessToken(pool, bookingId, accessToken)
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/bookings/:bookingId/customer', async (request, response, next) => {
    const bookingId = readBookingId(request, response)
    const accessToken = readBookingAccessToken(request, response)
    const customer = bookingCustomerSchema.safeParse(request.body)

    if (!bookingId || !accessToken) {
      return
    }

    if (!customer.success) {
      return response.status(400).json({
        error: 'Los datos del cliente no son válidos.',
        details: customer.error.issues,
      })
    }

    try {
      const booking = await saveBookingCustomer(pool, bookingId, accessToken, customer.data)
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/bookings/:bookingId/schedule', async (request, response, next) => {
    const bookingId = readBookingId(request, response)
    const accessToken = readBookingAccessToken(request, response)
    const schedule = quoteRequestSchema.safeParse(request.body)

    if (!bookingId || !accessToken) {
      return
    }

    if (!schedule.success) {
      return response.status(400).json({
        error: 'Los datos del horario no son válidos.',
        details: schedule.error.issues,
      })
    }

    try {
      const booking = await saveBookingSchedule(
        pool,
        quoteRepository,
        bookingId,
        accessToken,
        schedule.data,
      )
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/bookings/:bookingId/step', async (request, response, next) => {
    const bookingId = readBookingId(request, response)
    const accessToken = readBookingAccessToken(request, response)
    const parsedStep = bookingStepSchema.safeParse(request.body)

    if (!bookingId || !accessToken) {
      return
    }

    if (!parsedStep.success) {
      return response.status(400).json({
        error: 'El paso de la reserva no es válido.',
        details: parsedStep.error.issues,
      })
    }

    try {
      const booking = await saveBookingProgress(
        pool,
        bookingId,
        accessToken,
        parsedStep.data.currentStep,
      )
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/bookings/:bookingId/services', async (request, response, next) => {
    const bookingId = readBookingId(request, response)
    const accessToken = readBookingAccessToken(request, response)
    const services = bookingServicesSchema.safeParse(request.body)

    if (!bookingId || !accessToken) {
      return
    }

    if (!services.success) {
      return response.status(400).json({
        error: 'Los servicios adicionales no son válidos.',
        details: services.error.issues,
      })
    }

    try {
      const booking = await saveBookingServices(pool, bookingId, accessToken, services.data)
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/bookings/:bookingId/confirm', async (request, response, next) => {
    const bookingId = readBookingId(request, response)
    const accessToken = readBookingAccessToken(request, response)

    if (!bookingId || !accessToken) {
      return
    }

    try {
      const booking = await confirmBooking(pool, bookingId, accessToken)
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/bookings', requireAdmin(pool), async (request, response, next) => {
    const filters = adminBookingFiltersSchema.safeParse(request.query)

    if (!filters.success) {
      return response.status(400).json({
        error: 'Los filtros de reservas no son válidos.',
        details: filters.error.issues,
      })
    }

    try {
      const result = await listAdminBookings(pool, filters.data)
      return response.json(result)
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/bookings/:bookingId', requireAdmin(pool), async (request, response, next) => {
    const bookingId = readBookingId(request, response)

    if (!bookingId) {
      return
    }

    try {
      const booking = await getAdminBookingDetail(pool, bookingId)
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/admin/bookings/:bookingId/cancel', requireAdmin(pool), async (request, response, next) => {
    const bookingId = readBookingId(request, response)
    const body = cancelBookingSchema.safeParse(request.body)

    if (!bookingId) {
      return
    }

    if (!body.success) {
      return response.status(400).json({
        error: 'El motivo de cancelación es obligatorio (máximo 500 caracteres).',
        details: body.error.issues,
      })
    }

    try {
      const booking = await cancelAdminBooking(pool, bookingId, body.data.reason)
      return response.json({ booking })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/emails', requireAdmin(pool), async (request, response, next) => {
    const filters = adminEmailFiltersSchema.safeParse(request.query)

    if (!filters.success) {
      return response.status(400).json({
        error: 'Los filtros de correo no son válidos.',
        details: filters.error.issues,
      })
    }

    try {
      const result = await listAdminEmails(pool, filters.data)
      return response.json(result)
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/emails/:emailJobId', requireAdmin(pool), async (request, response, next) => {
    const emailJobId = z.coerce.number().int().positive().safeParse(request.params.emailJobId)

    if (!emailJobId.success) {
      return response.status(400).json({ error: 'El identificador del correo no es válido.' })
    }

    try {
      const email = await getAdminEmailDetail(pool, emailJobId.data)
      return response.json({ email })
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

    if (error instanceof BookingNotFoundError) {
      return response.status(404).json({ error: error.message })
    }

    if (error instanceof AdminBookingNotFoundError) {
      return response.status(404).json({ error: error.message })
    }

    if (error instanceof AdminEmailNotFoundError) {
      return response.status(404).json({ error: error.message })
    }

    if (error instanceof InvalidCredentialsError) {
      return response.status(401).json({ error: error.message })
    }

    if (error instanceof RangeError) {
      return response.status(400).json({ error: error.message })
    }

    if (
      error instanceof BookingConflictError ||
      error instanceof BookingNotEditableError ||
      error instanceof BookingProgressError ||
      error instanceof BookingUnavailableError ||
      error instanceof InvalidBookingTransitionError
    ) {
      return response.status(409).json({
        error: error.message,
        ...(error instanceof BookingUnavailableError ? { quote: error.quote } : {}),
      })
    }

    console.error(error)
    return response.status(500).json({ error: 'No fue posible procesar la cotización.' })
  })

  return app
}