import * as chrono from 'chrono-node'
import { z } from 'zod'
import type { RoomSize } from './quote'
import type { QuoteRoom } from './quote-service'

export const assistantExtractionSchema = z.object({
  roomNameEvidence: z.string().max(120).nullable(),
  roomSizeEvidence: z.string().max(80).nullable(),
  dateEvidence: z.string().max(120).nullable(),
  timeEvidence: z.string().max(80).nullable(),
  durationEvidence: z.string().max(80).nullable(),
  fullNameEvidence: z.string().max(120).nullable(),
  emailEvidence: z.string().max(254).nullable(),
  attendeeCountEvidence: z.string().max(80).nullable(),
  projectorEvidence: z.string().max(120).nullable(),
  coffeeEvidence: z.string().max(120).nullable(),
}).strict()

export type AssistantExtraction = z.infer<typeof assistantExtractionSchema>

export interface AssistantContext {
  roomId: number | null
  date: string | null
  startTime: string | null
  suggestedStartTime: string | null
  durationHours: number | null
  fullName: string | null
  email: string | null
  attendeeCount: number | null
  projector: boolean
  coffeePeople: number | null
}

export const emptyAssistantContext: AssistantContext = {
  roomId: null,
  date: null,
  startTime: null,
  suggestedStartTime: null,
  durationHours: null,
  fullName: null,
  email: null,
  attendeeCount: null,
  projector: false,
  coffeePeople: 0,
}

const numberWords: Record<string, number> = {
  una: 1,
  un: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
}

const relativeDateWords = /\b(?:hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|fin de semana|proximo|proxima|este|esta)\b/u
const explicitSpanishDate = /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/u

function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function verifiedEvidence(message: string, evidence: string | null): string | null {
  if (!evidence || !normalizeText(message).includes(normalizeText(evidence))) {
    return null
  }

  return evidence
}

function bogotaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return year && month && day ? `${year}-${month}-${day}` : ''
}

export function resolveDateEvidence(
  evidence: string | null,
  referenceDate: Date,
): string | null {
  if (!evidence) {
    return null
  }

  const explicitDate = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(evidence)

  if (explicitDate) {
    const [, yearText, monthText, dayText] = explicitDate
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const parsed = new Date(Date.UTC(year, month - 1, day))

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return null
    }

    return `${yearText}-${monthText}-${dayText}`
  }

  if (
    !relativeDateWords.test(normalizeText(evidence)) &&
    !explicitSpanishDate.test(normalizeText(evidence))
  ) {
    return null
  }

  const parsedDate = chrono.es.parseDate(evidence, referenceDate, { forwardDate: true })

  if (!parsedDate) {
    return null
  }

  return bogotaDate(parsedDate) || null
}

export function parseStartTimeEvidence(evidence: string | null): string | null {
  if (!evidence) {
    return null
  }

  const normalized = normalizeText(evidence)
  const meridian = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche|del mediodia)\b/u.exec(normalized)

  if (meridian) {
    let hour = Number(meridian[1])
    const minute = Number(meridian[2] ?? '0')
    const period = meridian[3]

    if (period.startsWith('p') || period === 'de la tarde' || period === 'de la noche') {
      if (hour < 12) {
        hour += 12
      }
    } else if ((period.startsWith('a') || period === 'de la manana') && hour === 12) {
      hour = 0
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const clock = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(normalized)

  if (clock) {
    return `${clock[1].padStart(2, '0')}:${clock[2]}`
  }

  const explicitHour = /\ba las?\s+(2[0-3]|1\d|0?\d)\b/u.exec(normalized)

  if (explicitHour) {
    return `${String(Number(explicitHour[1])).padStart(2, '0')}:00`
  }

  return null
}

export function parseDurationEvidence(evidence: string | null): number | null {
  if (!evidence) {
    return null
  }

  const normalized = normalizeText(evidence)
  const match = /\b(\d+(?:[,.]\d+)?|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:horas?|hrs?|h)\b/u.exec(normalized)

  if (!match) {
    return null
  }

  const value = NumberWordsOrDecimal(match[1])
  const withHalf = /\b(?:y\s+)?media\b/u.test(normalized) ? value + 0.5 : value

  if (
    !Number.isFinite(withHalf) ||
    withHalf < 1 ||
    withHalf > 10 ||
    !Number.isInteger(withHalf * 2)
  ) {
    return null
  }

  return withHalf
}

function NumberWordsOrDecimal(value: string): number {
  const normalized = value.replace(',', '.')

  if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
    return Number(normalized)
  }

  return numberWords[normalized] ?? Number.NaN
}

function resolveRoom(
  message: string,
  extraction: AssistantExtraction,
  rooms: QuoteRoom[],
): number | null | undefined {
  const roomNameEvidence = verifiedEvidence(message, extraction.roomNameEvidence)
  const normalizedMessage = normalizeText(message)

  if (roomNameEvidence) {
    const matchingRoom = rooms.find((room) =>
      normalizeText(roomNameEvidence).includes(normalizeText(room.name)) ||
      normalizedMessage.includes(normalizeText(room.name))
    )

    if (matchingRoom) {
      return matchingRoom.id
    }
  }

  const sizeEvidence = verifiedEvidence(message, extraction.roomSizeEvidence)

  if (!sizeEvidence) {
    return undefined
  }

  const normalizedEvidence = normalizeText(sizeEvidence)
  const size: RoomSize | null =
    /\b(pequena|pequeno)\b/u.test(normalizedEvidence) ? 'small' :
      /\b(mediana|mediano)\b/u.test(normalizedEvidence) ? 'medium' :
        /\b(grande)\b/u.test(normalizedEvidence) ? 'large' : null

  if (!size) {
    return undefined
  }

  const matchingRooms = rooms.filter((room) => room.size === size)
  return matchingRooms.length === 1 ? matchingRooms[0].id : null
}

function parseProjector(evidence: string | null): boolean | null {
  if (!evidence) {
    return null
  }

  const normalized = normalizeText(evidence)
  if (!/\bproyector\b/u.test(normalized)) {
    return null
  }

  return !/\b(sin|no quiero|no necesito|no incluyas)\s+(el\s+)?proyector\b/u.test(normalized)
}

function parseCoffeePeople(
  evidence: string | null,
  acceptCountOnly: boolean,
): number | null {
  if (!evidence) {
    return null
  }

  const normalized = normalizeText(evidence)

  if (/\b(sin|no quiero|no necesito)\s+(cafe|cafes)\b/u.test(normalized)) {
    return 0
  }

  if (!/\bcafe(s)?\b/u.test(normalized)) {
    if (!acceptCountOnly) {
      return null
    }

    const countOnly = /^(?:para\s+)?(\d{1,2}|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+personas?)?$/u.exec(normalized)

    if (!countOnly) {
      return null
    }

    const count = NumberWordsOrDecimal(countOnly[1])
    return Number.isInteger(count) && count >= 0 && count <= 30 ? count : null
  }

  const count = /\b(\d{1,2}|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/u.exec(normalized)

  if (!count) {
    return null
  }

  const people = NumberWordsOrDecimal(count[1])
  return Number.isInteger(people) && people >= 0 && people <= 30 ? people : null
}

function parseAttendeeCount(evidence: string | null): number | null {
  if (!evidence) {
    return null
  }

  const normalized = normalizeText(evidence)
  const match = /\b(\d{1,3}|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:personas|asistentes|participantes)\b/u.exec(normalized)

  if (!match) {
    return null
  }

  const count = NumberWordsOrDecimal(match[1])
  return Number.isInteger(count) && count >= 1 && count <= 100 ? count : null
}

function parseFullName(evidence: string | null): string | null {
  const name = evidence?.trim()

  if (!name || name.length < 2 || name.length > 120) {
    return null
  }

  return /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)*$/u.test(name)
    ? name
    : null
}

function parseEmail(evidence: string | null): string | null {
  if (!evidence) {
    return null
  }

  const parsed = z.string().email().max(254).safeParse(evidence.trim())
  return parsed.success ? parsed.data.toLowerCase() : null
}

export function mergeAssistantEvidence(
  message: string,
  current: AssistantContext,
  extraction: AssistantExtraction,
  rooms: QuoteRoom[],
  referenceDate: Date,
): AssistantContext {
  const dateEvidence = verifiedEvidence(message, extraction.dateEvidence)
  const timeEvidence = verifiedEvidence(message, extraction.timeEvidence)
  const durationEvidence = verifiedEvidence(message, extraction.durationEvidence)
  const fullNameEvidence = verifiedEvidence(message, extraction.fullNameEvidence)
  const emailEvidence = verifiedEvidence(message, extraction.emailEvidence)
  const attendeeCountEvidence = verifiedEvidence(message, extraction.attendeeCountEvidence)
  const projectorEvidence = verifiedEvidence(message, extraction.projectorEvidence)
  const coffeeEvidence = verifiedEvidence(message, extraction.coffeeEvidence)
  const coffeeCountIsPending = current.coffeePeople === null
  const coffeeEvidenceNamesCoffee = coffeeEvidence
    ? /\bcafe(s)?\b/u.test(normalizeText(coffeeEvidence))
    : false
  const roomId = resolveRoom(message, extraction, rooms)

  return {
    roomId: roomId === undefined ? current.roomId : roomId,
    date: resolveDateEvidence(dateEvidence, referenceDate) ?? current.date,
    startTime: parseStartTimeEvidence(timeEvidence) ?? current.startTime,
    suggestedStartTime: current.suggestedStartTime,
    durationHours: parseDurationEvidence(durationEvidence) ?? current.durationHours,
    fullName: parseFullName(fullNameEvidence) ?? current.fullName,
    email: parseEmail(emailEvidence) ?? current.email,
    attendeeCount: parseAttendeeCount(attendeeCountEvidence) ?? current.attendeeCount,
    projector: parseProjector(projectorEvidence) ?? current.projector,
    coffeePeople: coffeeEvidence && (coffeeCountIsPending || coffeeEvidenceNamesCoffee)
      ? parseCoffeePeople(coffeeEvidence, coffeeCountIsPending)
      : current.coffeePeople,
  }
}