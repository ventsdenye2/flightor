import type { AppEnv } from '../../config/env.js'
import type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatReasoning,
  FunctionToolCall
} from '../../agent/runtime/model.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'

export type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatReasoning,
  ChatReasoningEffort,
  ChatToolChoice,
  ChatToolDefinition as ChatTool
} from '../../agent/runtime/model.js'
export type ChatToolCall = FunctionToolCall

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
      ...(options?.tools !== undefined ? { tools: options.tools } : {}),
      ...(options?.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
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
      { provider: 'openrouter', timeoutMs: 35_000, ...(options?.signal ? { signal: options.signal } : {}) }
    )
  }

  async complete(
    messages: ChatMessage[],
    model = this.config.OPENROUTER_MODEL,
    options?: ChatOptions
  ): Promise<ChatCompletion> {
    const response = await this.chat(messages, model, options)
    const choices = response.choices
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned no completion choices', 502)
    }
    const first = choices[0]
    if (!isRecord(first) || !isRecord(first.message) || first.message.role !== 'assistant') {
      throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned a malformed assistant message', 502)
    }
    const rawMessage = first.message
    if (rawMessage.content !== null && typeof rawMessage.content !== 'string') {
      throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned malformed assistant content', 502)
    }
    let toolCalls: FunctionToolCall[] | undefined
    if (rawMessage.tool_calls !== undefined) {
      if (!Array.isArray(rawMessage.tool_calls)) {
        throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned malformed tool calls', 502)
      }
      toolCalls = rawMessage.tool_calls.map(parseToolCall)
    }
    const message: Extract<ChatMessage, { role: 'assistant' }> = {
      role: 'assistant',
      content: rawMessage.content,
      ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {})
    }
    const finishReason = first.finish_reason
    if (finishReason !== undefined && finishReason !== null && typeof finishReason !== 'string') {
      throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned malformed finish reason', 502)
    }
    return { message, ...(typeof finishReason === 'string' ? { finishReason } : {}) }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseToolCall(value: unknown): FunctionToolCall {
  if (!isRecord(value) || typeof value.id !== 'string' || value.type !== 'function' || !isRecord(value.function) ||
      typeof value.function.name !== 'string' || typeof value.function.arguments !== 'string' ||
      value.id.length < 1 || value.id.length > 160 ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(value.function.name) || value.function.arguments.length > 100_000) {
    throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned malformed tool call', 502)
  }
  return {
    id: value.id,
    type: 'function',
    function: { name: value.function.name, arguments: value.function.arguments }
  }
}
