import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '../../config/env.js'
import { OpenRouterClient } from '../../providers/openrouter/client.js'
import { FileDshBudget } from './budget.js'
import { createDshLocalizationClient } from './localization-client.js'

const servers: Server[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture(options: { maxModelCalls?: number; fail?: boolean; cost?: number } = {}) {
  const requests: Record<string, any>[] = []
  const server = createServer(async (request, response) => {
    let content = ''
    for await (const chunk of request) content += String(chunk)
    requests.push(JSON.parse(content))
    response.writeHead(options.fail ? 503 : 200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(options.fail ? { error: 'local failure' } : { model: 'deepseek-v4-flash',
      choices: [{ message: { role: 'assistant', content: '{"translated":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, ...(options.cost === undefined ? {} : { cost: options.cost }) } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing fixture port')
  const baseURL = `http://127.0.0.1:${address.port}/v1`
  const env = parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://offline:offline@localhost:1/test', REDIS_URL: 'redis://localhost:1',
    JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters', DSH_MODEL_PROVIDER: 'deepseek', DSH_MODEL: 'deepseek-v4-flash',
    DEEPSEEK_API_KEY: 'local-fixture', DEEPSEEK_BASE_URL: baseURL, OPENROUTER_API_KEY: 'local-fixture', OPENROUTER_BASE_URL: baseURL })
  const directory = await mkdtemp(join(tmpdir(), 'flightor-dsh-localize-')); directories.push(directory)
  const budget = new FileDshBudget({ path: join(directory, 'budget.json'), authorizedUsd: 1, maxModelCalls: options.maxModelCalls ?? 2, maxSearchCalls: 0 })
  return { env, budget, requests }
}
const messages = [{ role: 'user' as const, content: 'Translate this accepted text into English as JSON.' }]
const options = { maxTokens: 8000, temperature: 0, responseFormat: { type: 'json_schema' as const,
  json_schema: { name: 'localization', strict: true, schema: { type: 'object', properties: { translated: { type: 'boolean' } }, required: ['translated'] } } } }

describe('DSH localization provider HTTP protocol and accounting', () => {
  it('sends official thinking disabled and JSON object without gateway fields, recording tokens and finish reason', async () => {
    const { env, budget, requests } = await fixture()
    const unusedGateway = { complete: vi.fn() }
    const client = createDshLocalizationClient(env, unusedGateway, budget)
    const result = await client.complete(messages, undefined, options)
    expect(unusedGateway.complete).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ model: env.DSH_MODEL, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 8000 })
    for (const field of ['reasoning', 'provider', 'tools', 'tool_choice']) expect(requests[0]).not.toHaveProperty(field)
    expect(requests[0]!.messages[0].content).toContain(JSON.stringify(options.responseFormat.json_schema.schema))
    expect(result.observation).toMatchObject({ gateway: 'deepseek', reasoning: { enabled: false }, finishReason: 'stop', costUsdMicros: null,
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 } })
    const snapshot = await budget.readSnapshot()
    expect(snapshot).toMatchObject({ modelCalls: 1, unknownCostCalls: 1, pendingCalls: 0, unknownReservedUsdMicros: 40000 })
    expect(snapshot.entries[0]!.receipt).toMatchObject({ usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      finishReason: 'stop', model: env.DSH_MODEL, maxTokens: 8000, thinking: 'disabled' })
  })

  it('preserves gateway reasoning/json_schema protocol and settles only actual monetary receipts', async () => {
    const { env, budget, requests } = await fixture({ cost: 0.000321 })
    env.DSH_MODEL_PROVIDER = 'openrouter'; env.DSH_MODEL = 'deepseek/deepseek-v4-flash-0731'
    const client = createDshLocalizationClient(env, new OpenRouterClient(env), budget)
    await client.complete(messages, undefined, options)
    expect(requests[0]).toMatchObject({ reasoning: { enabled: false, exclude: true }, provider: { require_parameters: true },
      response_format: options.responseFormat, tools: [], tool_choice: 'none' })
    expect(requests[0]).not.toHaveProperty('thinking')
    expect(await budget.readSnapshot()).toMatchObject({ knownCostUsdMicros: 321, unknownCostCalls: 0 })
  })

  it('denies a repair request at the shared call cap before sending HTTP', async () => {
    const { env, budget, requests } = await fixture({ maxModelCalls: 1 })
    const client = createDshLocalizationClient(env, { complete: vi.fn() }, budget)
    await client.complete(messages, undefined, options)
    await expect(client.complete(messages, undefined, options)).rejects.toMatchObject({ code: 'DSH_BUDGET_CALL_LIMIT' })
    expect(requests).toHaveLength(1)
  })

  it('settles failed HTTP with unknown cost reservation and does not retry implicitly', async () => {
    const { env, budget, requests } = await fixture({ fail: true })
    const client = createDshLocalizationClient(env, { complete: vi.fn() }, budget)
    await expect(client.complete(messages, undefined, options)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(requests).toHaveLength(1)
    const snapshot = await budget.readSnapshot()
    expect(snapshot).toMatchObject({ pendingCalls: 0, unknownCostCalls: 1, unknownReservedUsdMicros: 40000 })
    expect(snapshot.entries[0]!.receipt).toMatchObject({ errorCode: 'LOCALIZATION_FAILURE' })
  })

  it('does not admit or send an already cancelled localization request', async () => {
    const { env, budget, requests } = await fixture()
    const client = createDshLocalizationClient(env, { complete: vi.fn() }, budget)
    await expect(client.complete(messages, undefined, { ...options, signal: AbortSignal.abort() })).rejects.toBeDefined()
    expect(requests).toHaveLength(0)
    expect(await budget.readSnapshot()).toMatchObject({ modelCalls: 0, pendingCalls: 0 })
  })
})
