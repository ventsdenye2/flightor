import { createHash, randomUUID } from 'node:crypto'
import type { AppEnv } from '../../config/env.js'
import type { AgentModelClient, ChatCompletion, ChatMessage, ChatOptions } from '../runtime/model.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson } from '../../lib/http.js'
import { observeModelCall, recordModelObservation } from '../../lib/planner-observation.js'
import { normalizeCompletionObservation } from '../../providers/openrouter/client.js'
import type { FileDshBudget } from './budget.js'

/** Text-only official protocol. It is intentionally separate from gateway routing. */
class DeepSeekLocalizationClient implements AgentModelClient {
  constructor(private readonly env: Pick<AppEnv, 'DEEPSEEK_API_KEY' | 'DEEPSEEK_BASE_URL' | 'DSH_MODEL'>) {}

  async complete(messages: ChatMessage[], model = this.env.DSH_MODEL, options?: ChatOptions): Promise<ChatCompletion> {
    if (!this.env.DEEPSEEK_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'DeepSeek localization is not configured', 503)
    if (options?.tools?.length) throw new AppError('DSH_LOCALIZATION_TOOLS_FORBIDDEN', 'Localization is text only', 400)
    const timeoutMs = Math.min(90_000, Math.max(1, options?.timeoutMs ?? 35_000))
    const body = { model,
      messages: options?.responseFormat ? [{ role: 'system', content: `Return one JSON object matching this schema: ${JSON.stringify(options.responseFormat.json_schema.schema)}` }, ...messages] : messages,
      thinking: { type: 'disabled' },
      ...(options?.responseFormat ? { response_format: { type: 'json_object' } } : {}),
      ...(options?.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...(options?.temperature === undefined ? {} : { temperature: options.temperature }) }
    const observationFor = (response: Record<string, unknown>) => {
      const normalized = normalizeCompletionObservation(response, model, options, body, timeoutMs, this.env.DEEPSEEK_BASE_URL)
      return { ...normalized, gateway: 'deepseek', provider: 'deepseek', reasoning: { enabled: false },
        configFingerprint: createHash('sha256').update(`${normalized.configFingerprint}:deepseek:thinking-disabled`).digest('hex') }
    }
    return observeModelCall('deepseek', async () => {
      recordModelObservation(observationFor({}))
      const response = await fetchJson<Record<string, unknown>>(`${this.env.DEEPSEEK_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify(body),
      }, { provider: 'deepseek', timeoutMs, ...(options?.signal ? { signal: options.signal } : {}) })
      const observation = observationFor(response)
      recordModelObservation(observation)
      const first: unknown = Array.isArray(response.choices) ? response.choices[0] : undefined
      if (!isRecord(first) || !isRecord(first.message) || first.message.role !== 'assistant'
        || typeof first.message.content !== 'string' || (Array.isArray(first.message.tool_calls) && first.message.tool_calls.length > 0)) {
        throw new AppError('PROVIDER_UNAVAILABLE', 'DeepSeek returned malformed localization text', 502)
      }
      return { message: { role: 'assistant', content: first.message.content }, observation,
        ...(observation.finishReason ? { finishReason: observation.finishReason } : {}) }
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }

/** Every initial/repair localization request shares the current durable DSH budget. */
export function createDshLocalizationClient(env: Pick<AppEnv, 'DSH_MODEL_PROVIDER' | 'DSH_MODEL' | 'DEEPSEEK_API_KEY' | 'DEEPSEEK_BASE_URL'>,
  openrouter: AgentModelClient, budget: Pick<FileDshBudget, 'admit' | 'settle'>): AgentModelClient {
  const client = env.DSH_MODEL_PROVIDER === 'openrouter' ? openrouter : new DeepSeekLocalizationClient(env)
  return { complete: async (messages, model = env.DSH_MODEL, options) => {
    options?.signal?.throwIfAborted()
    const id = `localize:${randomUUID()}`, started = performance.now()
    await budget.admit('model', id, env.DSH_MODEL_PROVIDER)
    let result: ChatCompletion | undefined
    try {
      // Hold the same text-only/thinking-off intent on both provider protocols.
      result = await client.complete(messages, model, { ...options, tools: [], toolChoice: 'none', reasoning: { enabled: false, exclude: true } })
      return result
    } finally {
      const observation = result?.observation, usage = observation?.usage
      await budget.settle(id, { durationMs: performance.now() - started,
        ...(usage ? { usage: { ...(usage.promptTokens === null ? {} : { promptTokens: usage.promptTokens }),
          ...(usage.completionTokens === null ? {} : { completionTokens: usage.completionTokens }),
          ...(usage.totalTokens === null ? {} : { totalTokens: usage.totalTokens }) } } : {}),
        ...(observation?.costUsdMicros == null ? {} : { actualCostUsd: observation.costUsdMicros / 1_000_000 }),
        ...(observation?.finishReason ? { finishReason: observation.finishReason } : {}),
        model, ...(options?.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }), thinking: 'disabled',
        ...(!result ? { errorCode: 'LOCALIZATION_FAILURE' } : {}) })
    }
  } }
}
