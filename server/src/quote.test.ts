import { describe, expect, it } from 'vitest'
import {
  calculateQuotePrice,
  getNextStartCandidates,
  getScheduleIssue,
  ROOM_HOURLY_RATES,
} from './quote'

describe('calculateQuotePrice', () => {
  it('uses the configured hourly rate for each room size', () => {
    expect(ROOM_HOURLY_RATES).toEqual({
      small: 40_000,
      medium: 70_000,
      large: 120_000,
    })
    expect(calculateQuotePrice(ROOM_HOURLY_RATES.small, '2026-10-26', 1)).toEqual({
      base: 40_000,
      discount: 0,
      surcharge: 0,
      total: 40_000,
    })
  })

  it('applies a 10% discount starting at four hours', () => {
    expect(calculateQuotePrice(ROOM_HOURLY_RATES.medium, '2026-10-26', 4)).toEqual({
      base: 280_000,
      discount: 28_000,
      surcharge: 0,
      total: 252_000,
    })
  })

  it('applies a 20% discount and the Saturday surcharge to the discounted price', () => {
    expect(calculateQuotePrice(ROOM_HOURLY_RATES.large, '2026-10-31', 8)).toEqual({
      base: 960_000,
      discount: 192_000,
      surcharge: 192_000,
      total: 960_000,
    })
  })
})

describe('getScheduleIssue', () => {
  it('accepts a weekday booking that ends at closing time', () => {
    expect(getScheduleIssue('2026-10-26', '20:00', 1)).toBeNull()
  })

  it('rejects Sundays and bookings outside opening hours', () => {
    expect(getScheduleIssue('2026-11-01', '09:00', 1)).toMatch(/cerrado los domingos/)
    expect(getScheduleIssue('2026-10-26', '06:30', 1)).toMatch(/inicia a las 07:00/)
    expect(getScheduleIssue('2026-10-26', '20:30', 1)).toMatch(/a más tardar a las 21:00/)
  })

  it('rejects invalid dates and durations', () => {
    expect(() => getScheduleIssue('2026-02-30', '09:00', 1)).toThrow(/fecha no es válida/)
    expect(() => getScheduleIssue('2026-10-26', '09:00', 1.25)).toThrow(/bloques de 30 minutos/)
  })
})

describe('getNextStartCandidates', () => {
  it('returns later 30-minute slots that still fit before closing', () => {
    const candidates = getNextStartCandidates('19:30', 1)

    expect(candidates).toEqual(['20:00'])
  })
})