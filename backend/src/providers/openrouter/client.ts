import type { AppEnv } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'

export interface ChatReasoning {
  effort?: ChatReasoningEffort
  exclude?: boolean
}

export interface ChatOptions {
  /** OpenAI-compatible max_tokens request field. */
  maxTokens?: number
  /** Sampling temperature forwarded to the provider. */
  temperature?: number
  /** OpenRouter reasoning controls, forwarded only when supplied. */
  reasoning?: ChatReasoning
}

export class OpenRouterClient {
  constructor(private readonly config: AppEnv) {}

  async chat(
    messages: ChatMessage[],
    model = this.config.OPENROUTER_MODEL,
    options?: ChatOptions
  ): Promise<Record<string, unknown>> {
    if (!this.config.OPENROUTER_API_KEY) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter is not configured', 503)
    }
    const body = {
      model,
      messages,
      ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.reasoning !== undefined ? { reasoning: options.reasoning } : {})
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
        body: JSON.stringify(body)
      },
      { provider: 'openrouter', timeoutMs: 35_000 }
    )
  }
}
