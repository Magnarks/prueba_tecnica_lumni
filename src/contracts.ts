export type RoomSize = 'small' | 'medium' | 'large'

export interface Room {
  id: number
  name: string
  size: RoomSize
  hourlyRate: number
}

export interface QuoteForm {
  roomId: string
  date: string
  startTime: string
  durationHours: number
}

export interface QuoteResult {
  room: Room
  date: string
  startTime: string
  endTime: string
  durationHours: number
  base: number
  discount: number
  surcharge: number
  total: number
  available: boolean
  reason: string | null
  suggestedStartTime: string | null
}

export interface BookingDraftAccess {
  bookingId: string
  accessToken: string
}

export interface BookingView {
  id: string
  status: 'draft' | 'confirmed' | 'completed' | 'cancelled'
  currentStep: number
  customer: {
    fullName: string | null
    email: string | null
    company: string | null
  }
  room: Room
  date: string
  startTime: string
  endTime: string
  durationHours: number
  base: number
  discount: number
  surcharge: number
  total: number
  services: {
    projector: boolean
    coffeePeople: number
  }
}