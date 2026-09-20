import type { AppEnv } from '../../config/env.js'
import type {
  ChatCompletion,
  ChatCompletionObservation,
  ChatMessage,
  ChatOptions,
  ChatReasoning,
  FunctionToolCall
} from '../../agent/runtime/model.js'
import { createHash } from 'node:crypto'
import { AppError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'
import type { NativeResearchReceipt } from '../../research-agent/native.js'
import { fetchNativeResearch } from './native-http.js'
import { observeModelCall, recordModelObservation, recordSpanError } from '../../lib/planner-observation.js'

export type {
  ChatCompletion,
  ChatMessage,
  ChatOptions,
  ChatReasoning,
  ChatReasoningEffort,
  ChatToolChoice,
  ChatToolDefinition as ChatTool
} from '../../agent/runtime/model.js'
export type { ChatCompletionObservation } from '../../agent/runtime/model.js'
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
    return observeModelCall('openrouter', async () => {
      recordModelObservation(normalizeCompletionObservation({}, model, options, body, undefined, this.config.OPENROUTER_BASE_URL))
      const response = await fetchJson<Record<string, unknown>>(
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
      recordModelObservation(normalizeCompletionObservation(response, model, options, body, undefined, this.config.OPENROUTER_BASE_URL))
      return response
    })
  }

  async complete(
    messages: ChatMessage[],
    model = this.config.OPENROUTER_MODEL,
    options?: ChatOptions
  ): Promise<ChatCompletion> {
    return observeModelCall('openrouter', () => this.completeObserved(messages, model, options))
  }

  private async completeObserved(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatCompletion> {
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
    const observation = normalizeCompletionObservation(response, model, options, undefined, undefined, this.config.OPENROUTER_BASE_URL)
    recordModelObservation(observation)
    return { message, ...(typeof finishReason === 'string' ? { finishReason } : {}), observation }
  }

  /** Native research needs raw annotations and provider accounting; Planner completion deliberately remains compact. */
  async completeNativeResearch(body: Record<string, unknown>, options: { signal: AbortSignal; timeoutMs: number }): Promise<NativeResearchReceipt> {
    return observeModelCall('openrouter.native', () => this.nativeObserved(body, options))
  }

  private async nativeObserved(body: Record<string, unknown>, options: { signal: AbortSignal; timeoutMs: number }): Promise<NativeResearchReceipt> {
    if (!this.config.OPENROUTER_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter is not configured', 503)
    const result = await observeModelCall('openrouter', async () => {
      const actualTimeout = Math.min(95_000, Math.max(1_000, options.timeoutMs))
      recordModelObservation(normalizeCompletionObservation({}, typeof body.model === 'string' ? body.model : this.config.OPENROUTER_MODEL, undefined, body, actualTimeout, this.config.OPENROUTER_BASE_URL))
      const nativeResult = await fetchNativeResearch(`${this.config.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, body, this.config.OPENROUTER_API_KEY, { timeoutMs: Math.min(95_000, Math.max(1_000, options.timeoutMs)), signal: options.signal })
      if (nativeResult.ok && isRecord(nativeResult.payload)) recordModelObservation(normalizeCompletionObservation(nativeResult.payload, typeof body.model === 'string' ? body.model : this.config.OPENROUTER_MODEL, undefined, body, actualTimeout, this.config.OPENROUTER_BASE_URL))
      if (!nativeResult.ok) recordSpanError(`HTTP_${nativeResult.http.status}`)
      return nativeResult
    })
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

export function normalizeCompletionObservation(response: Record<string, unknown>, requestModel: string, options?: ChatOptions, actualBody?: Record<string, unknown>, effectiveTimeoutMs?: number, baseUrl?: string): ChatCompletionObservation {
  const usage = isRecord(response.usage) ? response.usage : {}
  const n = (value: unknown, _field: string): number | null => {
    if (value === undefined || value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) return null
    return value
  }
  const choice = Array.isArray(response.choices) && isRecord(response.choices[0]) ? response.choices[0] : undefined
  const body = actualBody ?? {
    ...(options?.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...reasoningBody(requestModel, options?.reasoning),
    ...(options?.toolChoice === undefined ? {} : { tool_choice: options.toolChoice }),
    ...(options?.tools === undefined ? {} : { tools: options.tools }),
    ...(options?.responseFormat ? { response_format: options.responseFormat, provider: { require_parameters: true } } : {})
  }
  const identifier = (value: unknown): string | null => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value) ? value : null
  const rawReasoning = isRecord(body.reasoning) ? body.reasoning : undefined
  const reasoning: ChatReasoning | null = rawReasoning ? {
    ...(typeof rawReasoning.enabled === 'boolean' ? { enabled: rawReasoning.enabled } : {}),
    ...(typeof rawReasoning.exclude === 'boolean' ? { exclude: rawReasoning.exclude } : {}),
    ...(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(String(rawReasoning.effort)) ? { effort: rawReasoning.effort as NonNullable<ChatReasoning['effort']> } : {})
  } : null
  const rawChoice = body.tool_choice
  const toolChoice = ['auto', 'none', 'required'].includes(String(rawChoice)) ? rawChoice as 'auto' | 'none' | 'required'
    : isRecord(rawChoice) && rawChoice.type === 'function' && isRecord(rawChoice.function) && identifier(rawChoice.function.name)
      ? { type: 'function' as const, function: { name: identifier(rawChoice.function.name)! } } : null
  const config = { maxTokens: n(body.max_tokens, 'max_tokens'),
    temperature: typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : null,
    reasoning, toolChoice, timeoutMs: effectiveTimeoutMs ?? Math.min(90_000, Math.max(1_000, options?.timeoutMs ?? 35_000)) }
  let routeFingerprint: string | null = null
  if (baseUrl) {
    try {
      const url = new URL(baseUrl)
      // Route identity excludes credentials, query and fragment; even the path is emitted only as a hash.
      routeFingerprint = createHash('sha256').update(url.origin + url.pathname.replace(/\/$/, '')).digest('hex')
    } catch { /* Invalid or unavailable route metadata remains unknown. */ }
  }
  // Hash the exact tool/schema/routing configuration; never emit its descriptions or message bodies.
  const fingerprint = createHash('sha256').update(JSON.stringify({ model: requestModel, routeFingerprint, config,
    tools: body.tools ?? null, responseFormat: body.response_format ?? null, routing: body.provider ?? null,
    maxToolCalls: body.max_tool_calls ?? null })).digest('hex')
  return { requestModel: identifier(requestModel) ?? 'unknown', responseModel: identifier(response.model), provider: identifier(response.provider), gateway: 'openrouter',
    finishReason: identifier(choice?.finish_reason),
    usage: { promptTokens: n(usage.prompt_tokens, 'prompt token usage'), completionTokens: n(usage.completion_tokens, 'completion token usage'),
      totalTokens: n(usage.total_tokens, 'total token usage'), reasoningTokens: n(isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details.reasoning_tokens : undefined, 'reasoning token usage'),
      cachedTokens: n(isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details.cached_tokens : undefined, 'cached token usage') },
    costUsdMicros: usdMicrosFromProviderCost(usage.cost) ?? null, configFingerprint: fingerprint, routeFingerprint, ...config }
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
