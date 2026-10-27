export const ROOM_HOURLY_RATES = {
  small: 40_000,
  medium: 70_000,
  large: 120_000,
} as const

export type RoomSize = keyof typeof ROOM_HOURLY_RATES

export interface PriceBreakdown {
  base: number
  discount: number
  surcharge: number
  total: number
}

const OPENING_MINUTE = 7 * 60
const CLOSING_MINUTE = 21 * 60

function parseDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)

  if (!match) {
    throw new RangeError('La fecha debe tener el formato AAAA-MM-DD.')
  }

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const parsedDate = new Date(Date.UTC(year, month - 1, day))

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new RangeError('La fecha no es válida.')
  }

  return parsedDate
}

function parseTime(time: string): number {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(time)

  if (!match) {
    throw new RangeError('La hora debe tener el formato HH:MM.')
  }

  return Number(match[1]) * 60 + Number(match[2])
}

function formatTime(minute: number): string {
  const hour = String(Math.floor(minute / 60)).padStart(2, '0')
  const minutes = String(minute % 60).padStart(2, '0')

  return `${hour}:${minutes}`
}

function assertDuration(durationHours: number): void {
  if (
    !Number.isFinite(durationHours) ||
    durationHours < 1 ||
    durationHours > 10 ||
    !Number.isInteger(durationHours * 2)
  ) {
    throw new RangeError('La duración debe estar entre 1 y 10 horas, en bloques de 30 minutos.')
  }
}

export function calculateQuotePrice(
  hourlyRate: number,
  date: string,
  durationHours: number,
): PriceBreakdown {
  assertDuration(durationHours)

  if (!Number.isSafeInteger(hourlyRate) || hourlyRate <= 0) {
    throw new RangeError('La tarifa por hora no es válida.')
  }

  const dayOfWeek = parseDate(date).getUTCDay()
  const base = hourlyRate * durationHours
  const discountRate = durationHours >= 8 ? 0.2 : durationHours >= 4 ? 0.1 : 0
  const discount = Math.round(base * discountRate)
  const discountedTotal = base - discount
  const surcharge = dayOfWeek === 6 ? Math.round(discountedTotal * 0.25) : 0

  return {
    base,
    discount,
    surcharge,
    total: discountedTotal + surcharge,
  }
}

export function getScheduleIssue(
  date: string,
  startTime: string,
  durationHours: number,
): string | null {
  assertDuration(durationHours)

  if (parseDate(date).getUTCDay() === 0) {
    return 'El coworking permanece cerrado los domingos.'
  }

  const startMinute = parseTime(startTime)
  const endMinute = startMinute + durationHours * 60

  if (startMinute < OPENING_MINUTE) {
    return 'El horario de atención inicia a las 07:00.'
  }

  if (endMinute > CLOSING_MINUTE) {
    return 'La reserva debe finalizar a más tardar a las 21:00.'
  }

  return null
}

export function getNextStartCandidates(
  startTime: string,
  durationHours: number,
): string[] {
  assertDuration(durationHours)

  const firstCandidate = parseTime(startTime) + 30
  const latestCandidate = CLOSING_MINUTE - durationHours * 60
  const candidates: string[] = []

  for (let minute = firstCandidate; minute <= latestCandidate; minute += 30) {
    candidates.push(formatTime(minute))
  }

  return candidates
}

export function getEndTime(startTime: string, durationHours: number): string {
  assertDuration(durationHours)

  return formatTime(parseTime(startTime) + durationHours * 60)
}