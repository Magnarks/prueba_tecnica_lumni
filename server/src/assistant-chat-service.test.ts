import { describe, expect, it } from 'vitest'
import { emptyAssistantContext } from './assistant-extraction'
import { getNextAssistantQuestion } from './assistant-chat-service'
import { explicitlyAcceptsSuggestedTime } from './assistant-chat-service'

describe('getNextAssistantQuestion', () => {
  it('does not infer room capacity from the number of attendees', () => {
    expect(getNextAssistantQuestion({
      ...emptyAssistantContext,
      attendeeCount: 6,
      date: '2026-10-31',
      startTime: '10:00',
      durationHours: 2,
    })).toContain('No tengo capacidad registrada')
  })

  it('asks only for the first missing quote field', () => {
    expect(getNextAssistantQuestion(emptyAssistantContext)).toContain('¿Qué tamaño')
    expect(getNextAssistantQuestion({
      ...emptyAssistantContext,
      roomId: 2,
    })).toContain('¿Para qué fecha')
    expect(getNextAssistantQuestion({
      ...emptyAssistantContext,
      roomId: 2,
      date: '2026-10-31',
      startTime: '10:00',
    })).toContain('¿Cuánto tiempo')
  })

  it('does not request optional services before quote data is complete', () => {
    expect(getNextAssistantQuestion({
      ...emptyAssistantContext,
      roomId: 2,
      date: '2026-10-31',
      startTime: '10:00',
      durationHours: 2,
    })).toBeNull()
  })
})

describe('explicitlyAcceptsSuggestedTime', () => {
  it('accepts a clear affirmative but not an ambiguous message', () => {
    expect(explicitlyAcceptsSuggestedTime('Sí, por favor')).toBe(true)
    expect(explicitlyAcceptsSuggestedTime('me sirve')).toBe(true)
    expect(explicitlyAcceptsSuggestedTime('¿Y el café?')).toBe(false)
  })
})