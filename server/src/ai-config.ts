import OpenAI from 'openai'

export interface AIConfiguration {
  baseURL: string
  apiKey: string
  model: string
  timeoutMs: number
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getAIConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): AIConfiguration {
  return {
    baseURL: environment.AI_BASE_URL?.trim() || 'http://localhost:11434/v1',
    apiKey: environment.AI_API_KEY?.trim() || 'local-llama',
    model: environment.AI_MODEL?.trim() || 'local-model',
    timeoutMs: parsePositiveInteger(environment.AI_TIMEOUT_MS, 45_000),
  }
}

export function createAIClient(configuration = getAIConfiguration()): OpenAI {
  return new OpenAI({
    baseURL: configuration.baseURL,
    apiKey: configuration.apiKey,
    timeout: configuration.timeoutMs,
    maxRetries: 1,
  })
}