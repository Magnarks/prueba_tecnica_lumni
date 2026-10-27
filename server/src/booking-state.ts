export type BookingStatus = 'draft' | 'confirmed' | 'completed' | 'cancelled'

const allowedTransitions: Record<BookingStatus, BookingStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

export class InvalidBookingTransitionError extends Error {
  constructor(from: BookingStatus, to: BookingStatus) {
    super(`No se puede cambiar una reserva de ${from} a ${to}.`)
    this.name = 'InvalidBookingTransitionError'
  }
}

export function transitionBooking(
  currentStatus: BookingStatus,
  nextStatus: BookingStatus,
): BookingStatus {
  if (currentStatus === 'confirmed' && nextStatus === 'confirmed') {
    return currentStatus
  }

  if (!allowedTransitions[currentStatus].includes(nextStatus)) {
    throw new InvalidBookingTransitionError(currentStatus, nextStatus)
  }

  return nextStatus
}