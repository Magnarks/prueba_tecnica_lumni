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

export interface AuthenticatedUser {
  id: number
  email: string
  role: 'customer' | 'admin'
  customerId: number | null
  fullName: string | null
}

export interface AuthSession {
  accessToken: string
  expiresAt: string
  user: AuthenticatedUser
}

export type BookingStatus = BookingView['status']

export interface AdminBookingSummary {
  id: string
  status: BookingStatus
  roomId: number
  roomName: string
  customerName: string | null
  customerEmail: string | null
  date: string
  startTime: string
  endTime: string
  total: number
  createdAt: string
}

export interface AdminBookingDetail extends AdminBookingSummary {
  company: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  projector: boolean
  coffeePeople: number
  lines: Array<{ concept: string; amount: number }>
}

export interface PaginatedAdminBookings {
  items: AdminBookingSummary[]
  total: number
  page: number
  pageSize: number
}