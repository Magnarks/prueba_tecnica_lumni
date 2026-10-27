import { describe, expect, it } from 'vitest'
import { getAIConfiguration } from './ai-config'

describe('getAIConfiguration', () => {
  it('uses llama.cpp-compatible local defaults', () => {
    expect(getAIConfiguration({})).toEqual({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'local-llama',
      model: 'local-model',
      timeoutMs: 45_000,
    })
  })

  it('allows the provider URL, model, key and timeout to be changed through env', () => {
    expect(getAIConfiguration({
      AI_BASE_URL: 'https://ai.example.test/v1/',
      AI_API_KEY: 'test-key',
      AI_MODEL: 'test-model',
      AI_TIMEOUT_MS: '12000',
    })).toEqual({
      baseURL: 'https://ai.example.test/v1/',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 12_000,
    })
  })

  it('falls back to a safe timeout for invalid environment values', () => {
    expect(getAIConfiguration({ AI_TIMEOUT_MS: '-1' }).timeoutMs).toBe(45_000)
  })
})