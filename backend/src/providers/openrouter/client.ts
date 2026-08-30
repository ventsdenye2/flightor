import type { AppEnv } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class OpenRouterClient {
  constructor(private readonly config: AppEnv) {}

  async chat(messages: ChatMessage[], model = this.config.OPENROUTER_MODEL): Promise<Record<string, unknown>> {
    if (!this.config.OPENROUTER_API_KEY) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter is not configured', 503)
    }
    return fetchJson<Record<string, unknown>>(
      `${this.config.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({ model, messages })
      },
      { provider: 'openrouter', timeoutMs: 35_000 }
    )
  }
}
