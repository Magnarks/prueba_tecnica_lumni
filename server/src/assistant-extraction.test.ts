import { describe, expect, it } from 'vitest'
import {
  assistantExtractionSchema,
  emptyAssistantContext,
  mergeAssistantEvidence,
  parseDurationEvidence,
  parseStartTimeEvidence,
  resolveDateEvidence,
} from './assistant-extraction'
import type { QuoteRoom } from './quote-service'

const referenceDate = new Date('2026-10-27T17:00:00.000Z')
const rooms: QuoteRoom[] = [
  { id: 1, name: 'Sala pequeña 1', size: 'small', hourlyRate: 40_000 },
  { id: 2, name: 'Sala mediana 1', size: 'medium', hourlyRate: 70_000 },
  { id: 3, name: 'Sala grande 1', size: 'large', hourlyRate: 120_000 },
]

describe('assistant extraction schema', () => {
  it('rejects extra fields such as a model-generated price or confirmation command', () => {
    const result = assistantExtractionSchema.safeParse({
      roomNameEvidence: null,
      roomSizeEvidence: 'mediana',
      dateEvidence: 'el sábado',
      timeEvidence: null,
      durationEvidence: '4 horas',
      fullNameEvidence: null,
      emailEvidence: null,
      attendeeCountEvidence: null,
      projectorEvidence: 'con proyector',
      coffeeEvidence: null,
      price: 1,
      confirm: true,
    })

    expect(result.success).toBe(false)
  })
})

describe('Spanish evidence parsing', () => {
  it('resolves relative Saturday dates in Bogotá in server code', () => {
    expect(resolveDateEvidence('el sábado', referenceDate)).toBe('2026-10-31')
  })

  it('parses explicit dates, clock times and durations', () => {
    expect(resolveDateEvidence('2026-11-02', referenceDate)).toBe('2026-11-02')
    expect(resolveDateEvidence('31 de octubre', referenceDate)).toBe('2026-10-31')
    expect(parseStartTimeEvidence('a las 10 de la mañana')).toBe('10:00')
    expect(parseStartTimeEvidence('2:30 p. m.')).toBe('14:30')
    expect(parseStartTimeEvidence('en la mañana')).toBeNull()
    expect(parseDurationEvidence('una hora y media')).toBe(1.5)
    expect(parseDurationEvidence('cuatro horas')).toBe(4)
    expect(parseDurationEvidence('12 horas')).toBeNull()
  })

  it('does not trust model evidence absent from the user message', () => {
    const context = mergeAssistantEvidence(
      'Necesito una sala para 6 personas el sábado en la mañana',
      emptyAssistantContext,
      {
        roomNameEvidence: null,
        roomSizeEvidence: 'mediana',
        dateEvidence: 'el sábado',
        timeEvidence: '10:00',
        durationEvidence: '4 horas',
        fullNameEvidence: 'Diego Perez',
        emailEvidence: 'diego@example.test',
        attendeeCountEvidence: '6 personas',
        projectorEvidence: 'proyector',
        coffeeEvidence: null,
      },
      rooms,
      referenceDate,
    )

    expect(context).toMatchObject({
      roomId: null,
      date: '2026-10-31',
      startTime: null,
      suggestedStartTime: null,
      durationHours: null,
      fullName: null,
      email: null,
      attendeeCount: 6,
      projector: false,
    })
  })

  it('extracts explicit room, time, duration and services only from present phrases', () => {
    const context = mergeAssistantEvidence(
      'Prefiero una mediana para 2 personas, el sábado a las 10:30 por una hora y media, con proyector y 2 cafés',
      emptyAssistantContext,
      {
        roomNameEvidence: null,
        roomSizeEvidence: 'mediana',
        dateEvidence: 'el sábado',
        timeEvidence: 'a las 10:30',
        durationEvidence: 'una hora y media',
        fullNameEvidence: null,
        emailEvidence: null,
        attendeeCountEvidence: '2 personas',
        projectorEvidence: 'con proyector',
        coffeeEvidence: '2 cafés',
      },
      rooms,
      referenceDate,
    )

    expect(context).toEqual({
      roomId: 2,
      date: '2026-10-31',
      startTime: '10:30',
      suggestedStartTime: null,
      durationHours: 1.5,
      fullName: null,
      email: null,
      attendeeCount: 2,
      projector: true,
      coffeePeople: 2,
    })
  })

  it('asks for a quantity when coffee is requested without a count', () => {
    const context = mergeAssistantEvidence(
      'Quiero café',
      emptyAssistantContext,
      {
        roomNameEvidence: null,
        roomSizeEvidence: null,
        dateEvidence: null,
        timeEvidence: null,
        durationEvidence: null,
        fullNameEvidence: null,
        emailEvidence: null,
        attendeeCountEvidence: null,
        projectorEvidence: null,
        coffeeEvidence: 'café',
      },
      rooms,
      referenceDate,
    )

    expect(context.coffeePeople).toBeNull()
  })

  it('accepts a count-only coffee reply only when that field is pending', () => {
    const extraction: AssistantExtraction = {
      roomNameEvidence: null,
      roomSizeEvidence: null,
      dateEvidence: null,
      timeEvidence: null,
      durationEvidence: null,
      fullNameEvidence: null,
      emailEvidence: null,
      attendeeCountEvidence: null,
      projectorEvidence: null,
      coffeeEvidence: 'dos',
    }

    const pending = mergeAssistantEvidence(
      'dos',
      { ...emptyAssistantContext, coffeePeople: null },
      extraction,
      rooms,
      referenceDate,
    )
    const notPending = mergeAssistantEvidence(
      'dos',
      emptyAssistantContext,
      extraction,
      rooms,
      referenceDate,
    )

    expect(pending.coffeePeople).toBe(2)
    expect(notPending.coffeePeople).toBe(0)
  })

  it('only accepts well-formed explicit customer details', () => {
    const context = mergeAssistantEvidence(
      'Soy Ana Pérez, mi correo es ana@example.com',
      emptyAssistantContext,
      {
        roomNameEvidence: null,
        roomSizeEvidence: null,
        dateEvidence: null,
        timeEvidence: null,
        durationEvidence: null,
        fullNameEvidence: 'Ana Pérez',
        emailEvidence: 'ana@example.com',
        attendeeCountEvidence: null,
        projectorEvidence: null,
        coffeeEvidence: null,
      },
      rooms,
      referenceDate,
    )

    expect(context.fullName).toBe('Ana Pérez')
    expect(context.email).toBe('ana@example.com')
  })
})