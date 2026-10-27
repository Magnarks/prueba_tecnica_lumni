import { describe, expect, it } from 'vitest'
import {
  getRetryDelayMs,
  MAX_EMAIL_ATTEMPTS,
  processOneEmailJob,
  type ConfirmationEmailJob,
  type EmailJobStore,
  type EmailTransport,
} from './email-worker'

const baseJob: Omit<ConfirmationEmailJob, 'attempts'> = {
  id: 11,
  bookingId: '4',
  recipient: 'cliente@example.test',
  subject: 'Confirmación Lumni',
  body: 'Tu reserva está confirmada.',
}

function createStore() {
  let attempt = 0
  const failures: Array<{ attempts: number; error: string; delay: number }> = []
  let sentCount = 0

  const store: EmailJobStore = {
    claimNext: async () => {
      if (attempt >= MAX_EMAIL_ATTEMPTS || sentCount > 0) {
        return null
      }

      attempt += 1
      return { ...baseJob, attempts: attempt }
    },
    markSent: async () => {
      sentCount += 1
    },
    markFailed: async (_jobId, attempts, error, delay) => {
      failures.push({ attempts, error, delay })
    },
    recoverStaleJobs: async () => undefined,
  }

  return { store, failures, get sentCount() { return sentCount } }
}

describe('confirmation email worker', () => {
  it('uses exponential backoff and allows five retries after the initial attempt', async () => {
    const { store, failures, sentCount } = createStore()
    const transport: EmailTransport = {
      send: async () => { throw new Error('Fallo temporal') },
    }

    for (let attempt = 1; attempt <= MAX_EMAIL_ATTEMPTS; attempt += 1) {
      expect(await processOneEmailJob(store, transport)).toBe(true)
    }

    expect(await processOneEmailJob(store, transport)).toBe(false)
    expect(failures).toEqual([
      { attempts: 1, error: 'Fallo temporal', delay: 1_000 },
      { attempts: 2, error: 'Fallo temporal', delay: 2_000 },
      { attempts: 3, error: 'Fallo temporal', delay: 4_000 },
      { attempts: 4, error: 'Fallo temporal', delay: 8_000 },
      { attempts: 5, error: 'Fallo temporal', delay: 16_000 },
      { attempts: 6, error: 'Fallo temporal', delay: 32_000 },
    ])
    expect(sentCount).toBe(0)
  })

  it('marks a delivered email and does not create another delivery on retries', async () => {
    const state = createStore()
    let deliveryAttempts = 0
    const transport: EmailTransport = {
      send: async () => {
        deliveryAttempts += 1
        if (deliveryAttempts === 1) {
          throw new Error('Fallo temporal')
        }
      },
    }

    await processOneEmailJob(state.store, transport)
    await processOneEmailJob(state.store, transport)

    expect(state.failures).toEqual([
      { attempts: 1, error: 'Fallo temporal', delay: 1_000 },
    ])
    expect(state.sentCount).toBe(1)
    expect(getRetryDelayMs(4)).toBe(8_000)
  })
})