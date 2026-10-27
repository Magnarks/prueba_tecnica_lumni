import { describe, expect, it } from 'vitest'
import {
  createQuote,
  type QuoteRepository,
  type QuoteRoom,
} from './quote-service'

const room: QuoteRoom = {
  id: 2,
  name: 'Sala Mediana',
  size: 'medium',
  hourlyRate: 70_000,
}
const request = {
  roomId: room.id,
  date: '2026-10-26',
  startTime: '09:00',
  durationHours: 1,
}

function createRepository(availableFromQuery = 1) {
  let availabilityQueries = 0
  const queriedRanges: Array<[string, string]> = []

  const repository: QuoteRepository = {
    findRoomById: async (roomId) => (roomId === room.id ? room : null),
    isAvailable: async (_roomId, startsAt, endsAt) => {
      availabilityQueries += 1
      queriedRanges.push([startsAt, endsAt])
      return availabilityQueries >= availableFromQuery
    },
  }

  return { repository, queriedRanges }
}

describe('createQuote', () => {
  it('returns the quote when the requested time is available', async () => {
    const { repository, queriedRanges } = createRepository()
    const result = await createQuote(request, repository)

    expect(result).toMatchObject({
      base: 70_000,
      discount: 0,
      surcharge: 0,
      total: 70_000,
      available: true,
      reason: null,
      suggestedStartTime: null,
    })
    expect(queriedRanges[0]).toEqual([
      '2026-10-26T14:00:00.000Z',
      '2026-10-26T15:00:00.000Z',
    ])
  })

  it('suggests the first later slot available on the same day', async () => {
    const { repository } = createRepository(3)
    const result = await createQuote(request, repository)

    expect(result).toMatchObject({
      available: false,
      reason: 'La sala ya está reservada en ese horario.',
      suggestedStartTime: '10:00',
    })
  })

  it('reports the reason without querying availability when the coworking is closed', async () => {
    const { repository, queriedRanges } = createRepository()
    const result = await createQuote(
      { ...request, date: '2026-11-01' },
      repository,
    )

    expect(result).toMatchObject({
      available: false,
      reason: 'El coworking permanece cerrado los domingos.',
      suggestedStartTime: null,
    })
    expect(queriedRanges).toHaveLength(0)
  })

  it('rejects a room that does not exist', async () => {
    const { repository } = createRepository()

    await expect(createQuote({ ...request, roomId: 99 }, repository)).rejects.toThrow(
      'La sala seleccionada no existe.',
    )
  })
})