import { describe, expect, it } from 'vitest'
import {
  assertBookingProgress,
  BookingProgressError,
  calculateBookingTotal,
} from './booking-service'

describe('calculateBookingTotal', () => {
  it('replaces previously saved service lines instead of counting them twice', () => {
    const linesFromEarlierSave = [
      { concept: 'base', amount: 280_000 },
      { concept: 'discount_duration', amount: -28_000 },
      { concept: 'saturday_surcharge', amount: 0 },
      { concept: 'service_projector', amount: 50_000 },
      { concept: 'service_coffee', amount: 16_000 },
    ]

    expect(calculateBookingTotal(linesFromEarlierSave, {
      projector: false,
      coffeePeople: 1,
    })).toBe(260_000)
  })
})

describe('assertBookingProgress', () => {
  it('requires saved customer details before advancing to the schedule step', () => {
    expect(() => assertBookingProgress(1, 2, false)).toThrow(BookingProgressError)
    expect(() => assertBookingProgress(1, 2, true)).not.toThrow()
  })

  it('does not allow the progress endpoint to skip the services step', () => {
    expect(() => assertBookingProgress(2, 3, true)).toThrow(BookingProgressError)
    expect(() => assertBookingProgress(3, 2, true)).not.toThrow()
  })
})