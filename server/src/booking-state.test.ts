import { describe, expect, it } from 'vitest'
import {
  InvalidBookingTransitionError,
  transitionBooking,
} from './booking-state'

describe('transitionBooking', () => {
  it('allows the defined reservation lifecycle transitions', () => {
    expect(transitionBooking('draft', 'confirmed')).toBe('confirmed')
    expect(transitionBooking('confirmed', 'completed')).toBe('completed')
    expect(transitionBooking('confirmed', 'cancelled')).toBe('cancelled')
    expect(transitionBooking('draft', 'cancelled')).toBe('cancelled')
  })

  it('treats a repeated confirmation as idempotent', () => {
    expect(transitionBooking('confirmed', 'confirmed')).toBe('confirmed')
  })

  it('rejects invalid transitions and changes from terminal states', () => {
    expect(() => transitionBooking('draft', 'completed')).toThrow(
      InvalidBookingTransitionError,
    )
    expect(() => transitionBooking('completed', 'confirmed')).toThrow(
      InvalidBookingTransitionError,
    )
    expect(() => transitionBooking('cancelled', 'confirmed')).toThrow(
      InvalidBookingTransitionError,
    )
  })
})