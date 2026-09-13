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
import type { NativeResearchReceipt } from '../../research-agent/native.js'
import { fetchNativeResearch } from './native-http.js'

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

function isDeepSeekV4Model(model: string): boolean {
  const normalized = normalizedModel(model)
  return normalized === DEEPSEEK_V4_PRO_MODEL || normalized.startsWith(`${DEEPSEEK_V4_PRO_MODEL}:`)
    || normalized === 'deepseek/deepseek-v4-flash' || normalized.startsWith('deepseek/deepseek-v4-flash-')
}

function supportsReasoning(model: string, reasoning: ChatReasoning): boolean {
  if (isDeepSeekChatModel(model)) return false
  if (isDeepSeekV4Model(model)) {
    if (reasoning.enabled === false) return true
    // Keep the previously validated explicit efforts. Disabled reasoning is
    // normalized separately so effort=none never becomes a provider 400.
    return reasoning.effort === 'high' || reasoning.effort === 'xhigh'
  }
  return true
}

function reasoningBody(model: string, reasoning: ChatReasoning | undefined): { reasoning: ChatReasoning } | Record<string, never> {
  // V4 rejects effort=none but supports the gateway's explicit disabled flag.
  if (isDeepSeekV4Model(model) && reasoning?.effort === 'none') {
    return { reasoning: { enabled: false, ...(reasoning.exclude === undefined ? {} : { exclude: reasoning.exclude }) } }
  }
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
      ...(options?.responseFormat ? { response_format: options.responseFormat, provider: { require_parameters: true } } : {}),
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
      { provider: 'openrouter', timeoutMs: Math.min(90_000, Math.max(1_000, options?.timeoutMs ?? 35_000)), ...(options?.signal ? { signal: options.signal } : {}) }
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

  /** Native research needs raw annotations and provider accounting; Planner completion deliberately remains compact. */
  async completeNativeResearch(body: Record<string, unknown>, options: { signal: AbortSignal; timeoutMs: number }): Promise<NativeResearchReceipt> {
    if (!this.config.OPENROUTER_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter is not configured', 503)
    const result = await fetchNativeResearch(
      `${this.config.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      body, this.config.OPENROUTER_API_KEY,
      { timeoutMs: Math.min(95_000, Math.max(1_000, options.timeoutMs)), signal: options.signal }
    )
    if (!result.ok) return { provider: 'openrouter', http: result.http }
    const response = result.payload
    if (!isRecord(response)) throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned no native research completion', 502)
    const choice = Array.isArray(response.choices) ? response.choices[0] : undefined
    if (!isRecord(choice) || !isRecord(choice.message)) throw new AppError('PROVIDER_UNAVAILABLE', 'OpenRouter returned no native research completion', 502)
    const rawUsage = isRecord(response.usage) ? response.usage : undefined
    const costUsdMicros = usdMicrosFromProviderCost(rawUsage?.cost)
    return {
      ...(typeof response.id === 'string' ? { id: response.id } : {}), ...(typeof response.model === 'string' ? { model: response.model } : {}), provider: 'openrouter',
      ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
      message: { ...(typeof choice.message.role === 'string' ? { role: choice.message.role } : {}), content: choice.message.content, ...(choice.message.annotations === undefined ? {} : { annotations: choice.message.annotations }), ...(choice.message.tool_calls === undefined ? {} : { tool_calls: choice.message.tool_calls }) },
      ...(rawUsage ? { usage: rawUsage } : {}), ...(costUsdMicros === undefined ? {} : { costUsdMicros })
    }
  }
}

/** Provider costs may have sub-micro precision; round upward so accounting never understates a known bill. */
export function usdMicrosFromProviderCost(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  const micros = Math.ceil(value * 1_000_000)
  return Number.isSafeInteger(micros) ? micros : undefined
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
