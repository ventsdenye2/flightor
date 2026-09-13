import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '../../config/env.js'
import { NativeResearchAgent } from '../../research-agent/native.js'
import type { NativeResearchAuditFinish, NativeResearchLedger } from '../../research-agent/native-infrastructure.js'
import { OpenRouterClient } from './client.js'
import { OpenRouterNativeResearchTransport } from './native-research.js'

const apiKey = 'sk-or-native-offline-test-secret'
const client = new OpenRouterClient(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor', REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters', OPENROUTER_API_KEY: apiKey }))
const brief = { destinations: [{ id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP' }], interests: ['museums'], questions: ['What is open?'], researchTypes: ['activity' as const], maxResults: 2 }
const complete = () => client.completeNativeResearch({ model: 'qwen/qwen3.8-flash' }, { signal: new AbortController().signal, timeoutMs: 1_000 })

afterEach(() => vi.unstubAllGlobals())

describe('native HTTP audit receipts (offline)', () => {
  it.each([
    [429, JSON.stringify({ error: { message: 'upstream rate limit', code: 429, metadata: { raw: 'try later' } }, usage: { cost: 0 } })],
    [503, '<html>upstream unavailable</html>']
  ])('preserves HTTP %i through the client, transport and failed audit without settling unknown cost or retrying', async (status, body) => {
    const fetchMock = vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Retry-After': '30', 'X-Request-Id': 'request-upstream-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const finish = vi.fn<NativeResearchLedger['finish']>()
    const ledger: NativeResearchLedger = { reserve: vi.fn(async () => ({ auditId: 'audit-1' })), finish }
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: new OpenRouterNativeResearchTransport(client), ledger, budgetId: 'shared', maxCallUsdMicros: 40 })
    const code = status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE'
    await expect(agent.research(brief, { requestId: 'request-1' })).rejects.toMatchObject({ code, message: `openrouter returned HTTP ${status}`,
      details: { provider: 'openrouter', status, ...(status === 429 ? { retryAfter: 30 } : {}) }
    })
    if (status === 429) {
      await expect(agent.research(brief, { requestId: 'request-2' })).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ledger.reserve).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledExactlyOnceWith('audit-1', {
      status: 'failed', receipt: { provider: 'openrouter', http: { status, body, bodyTruncated: false, bodyIncomplete: false, headers: { 'content-type': 'text/plain', 'retry-after': '30', 'x-request-id': 'request-upstream-1' } } },
      error: { code, message: `openrouter returned HTTP ${status}` }
    })
    expect(finish.mock.calls[0]?.[1]).not.toHaveProperty('settledUsdMicros')
  })

  it('redacts echoed credentials and retains only capped allowed response headers', async () => {
    const body = JSON.stringify({ error: { message: `key rejected: ${apiKey}`, headers: { Authorization: 'Bearer other-auth-secret', 'x-api-key': 'other-api-secret' }, access_token: 'other-access-secret' } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 401, headers: {
      Authorization: `Bearer ${apiKey}`, 'Set-Cookie': 'session=cookie-secret', 'X-Api-Key': apiKey,
      'X-Request-Id': `${apiKey}${'r'.repeat(700)}`, 'Content-Type': 'application/json'
    } })))
    const receipt = await complete()
    expect(receipt.http?.body).toContain('[REDACTED]')
    const serialized = JSON.stringify(receipt)
    for (const secret of [apiKey, 'other-auth-secret', 'other-api-secret', 'other-access-secret', 'cookie-secret']) expect(serialized).not.toContain(secret)
    expect(Object.keys(receipt.http!.headers)).toEqual(['content-type', 'x-request-id'])
    expect(receipt.http!.headers['x-request-id']).toHaveLength(512)
  })

  it('caps the streamed body, cancels the remaining stream and redacts a key cut off at the cap', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(16_384 - 10)))
        controller.enqueue(new TextEncoder().encode(`${apiKey}${'y'.repeat(20_000)}`))
      }, cancel
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 502 })))
    const receipt = await complete()
    expect(receipt.http).toMatchObject({ status: 502, bodyTruncated: true, bodyIncomplete: false })
    expect(receipt.http!.body.length).toBeLessThanOrEqual(16_384)
    expect(receipt.http!.body).not.toContain(apiKey.slice(0, 10))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('retains status and received text if the error response stream fails', async () => {
    let reads = 0
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode('upstream connection ended'))
      else controller.error(new Error(`failed with ${apiKey}`))
    } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 502 })))
    expect(await complete()).toEqual({ provider: 'openrouter', http: { status: 502, headers: {}, body: 'upstream connection ended', bodyTruncated: false, bodyIncomplete: true } })
  })

  it('keeps native success annotations, usage and rounded cost intact', async () => {
    const annotations = [{ type: 'url_citation', url_citation: { url: 'https://example.com' } }]
    const usage = { cost: 0.0000011, server_tool_use: { web_search_requests: 1 } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'generation-1', model: 'qwen/qwen3.8-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}', annotations } }], usage }))))
    expect(await complete()).toMatchObject({ id: 'generation-1', model: 'qwen/qwen3.8-flash', finishReason: 'stop', message: { role: 'assistant', content: '{}', annotations }, usage, costUsdMicros: 2 })
  })

  it('keeps caller cancellation unbilled and does not expose a fetch error secret', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => { controller.abort(); throw new Error(apiKey) })
    vi.stubGlobal('fetch', fetchMock)
    const finishes: NativeResearchAuditFinish[] = []
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: new OpenRouterNativeResearchTransport(client), ledger: {
      reserve: async () => ({ auditId: 'audit-cancel' }), finish: async (_id, input) => { finishes.push(input) }
    }, budgetId: 'shared', maxCallUsdMicros: 40 })
    await expect(agent.research(brief, { requestId: 'request-cancel', signal: controller.signal })).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
    expect(finishes).toEqual([{ status: 'cancelled', error: { code: 'PROVIDER_CANCELLED', message: 'openrouter request was cancelled' } }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
