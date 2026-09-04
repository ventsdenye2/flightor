import type { AppEnv } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ChatReasoning {
  effort?: ChatReasoningEffort
  exclude?: boolean
}

export interface ChatOptions {
  /** OpenAI-compatible max_tokens request field. */
  maxTokens?: number
  /** Sampling temperature forwarded to the provider. */
  temperature?: number
  /** OpenRouter reasoning controls, forwarded when supported by the model. */
  reasoning?: ChatReasoning
}

const DEEPSEEK_CHAT_MODEL = 'deepseek/deepseek-chat'
const DEEPSEEK_V4_PRO_MODEL = 'deepseek/deepseek-v4-pro-0813'

function normalizedModel(model: string): string {
  return model.trim().toLowerCase()
}

function isDeepSeekChatModel(model: string): boolean {
  const normalized = normalizedModel(model)
  return normalized === DEEPSEEK_CHAT_MODEL || normalized.startsWith(`${DEEPSEEK_CHAT_MODEL}:`)
}

function isDeepSeekV4ProModel(model: string): boolean {
  const normalized = normalizedModel(model)
  return normalized === DEEPSEEK_V4_PRO_MODEL || normalized.startsWith(`${DEEPSEEK_V4_PRO_MODEL}:`)
}

function supportsReasoning(model: string, reasoning: ChatReasoning): boolean {
  if (isDeepSeekChatModel(model)) return false
  if (isDeepSeekV4ProModel(model)) {
    // V4 Pro accepts the explicit high-effort modes.  The business callers
    // intentionally send effort=none to disable thinking; omit that (and any
    // other unsupported effort) instead of turning it into a provider 400.
    return reasoning.effort === 'high' || reasoning.effort === 'xhigh'
  }
  return true
}

function reasoningBody(model: string, reasoning: ChatReasoning | undefined): { reasoning: ChatReasoning } | Record<string, never> {
  return reasoning !== undefined && supportsReasoning(model, reasoning)
    ? { reasoning }
    : {}
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
      // DeepSeek model capabilities are normalized in this shared adapter so
      // callers can keep sending their model-agnostic reasoning preference.
      ...reasoningBody(model, options?.reasoning)
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
