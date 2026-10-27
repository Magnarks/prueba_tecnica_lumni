import {
  calculateQuotePrice,
  getEndTime,
  getNextStartCandidates,
  getScheduleIssue,
  type PriceBreakdown,
  type RoomSize,
} from './quote'

export interface QuoteRequest {
  roomId: number
  date: string
  startTime: string
  durationHours: number
}

export interface QuoteRoom {
  id: number
  name: string
  size: RoomSize
  hourlyRate: number
}

export interface QuoteRepository {
  findRoomById(roomId: number): Promise<QuoteRoom | null>
  isAvailable(roomId: number, startsAt: string, endsAt: string): Promise<boolean>
}

export interface QuoteResult extends PriceBreakdown {
  room: QuoteRoom
  date: string
  startTime: string
  endTime: string
  durationHours: number
  available: boolean
  reason: string | null
  suggestedStartTime: string | null
}

export class RoomNotFoundError extends Error {
  constructor() {
    super('La sala seleccionada no existe.')
    this.name = 'RoomNotFoundError'
  }
}

function toColombiaTimestamp(date: string, time: string): string {
  return new Date(`${date}T${time}:00-05:00`).toISOString()
}

function addDuration(timestamp: string, durationHours: number): string {
  return new Date(new Date(timestamp).getTime() + durationHours * 60 * 60 * 1000).toISOString()
}

export async function createQuote(
  request: QuoteRequest,
  repository: QuoteRepository,
): Promise<QuoteResult> {
  const room = await repository.findRoomById(request.roomId)

  if (!room) {
    throw new RoomNotFoundError()
  }

  const price = calculateQuotePrice(room.hourlyRate, request.date, request.durationHours)
  const scheduleIssue = getScheduleIssue(
    request.date,
    request.startTime,
    request.durationHours,
  )
  const result: QuoteResult = {
    ...price,
    room,
    date: request.date,
    startTime: request.startTime,
    endTime: getEndTime(request.startTime, request.durationHours),
    durationHours: request.durationHours,
    available: false,
    reason: null,
    suggestedStartTime: null,
  }

  if (scheduleIssue) {
    return { ...result, reason: scheduleIssue }
  }

  const startsAt = toColombiaTimestamp(request.date, request.startTime)
  const endsAt = addDuration(startsAt, request.durationHours)

  if (await repository.isAvailable(room.id, startsAt, endsAt)) {
    return { ...result, available: true }
  }

  for (const candidate of getNextStartCandidates(request.startTime, request.durationHours)) {
    const candidateStartsAt = toColombiaTimestamp(request.date, candidate)
    const candidateEndsAt = addDuration(candidateStartsAt, request.durationHours)

    if (await repository.isAvailable(room.id, candidateStartsAt, candidateEndsAt)) {
      return {
        ...result,
        reason: 'La sala ya está reservada en ese horario.',
        suggestedStartTime: candidate,
      }
    }
  }

  return {
    ...result,
    reason: 'La sala ya está reservada en ese horario y no hay otro horario disponible ese día.',
  }
}