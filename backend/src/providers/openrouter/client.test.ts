import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '../../config/env.js'
import { OpenRouterClient, normalizeCompletionObservation, usdMicrosFromProviderCost } from './client.js'
import { observePlannerTurn, observeSpan, type PlannerObservation } from '../../lib/planner-observation.js'

afterEach(() => vi.unstubAllGlobals())

describe('OpenRouterClient', () => {
  it('records normalized config, research children, HTTP attempts and unknown totals without source data', async () => {
    const env = parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor', REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters', OPENROUTER_API_KEY: 'SECRET-KEY' })
    const client = new OpenRouterClient(env), captured: PlannerObservation[] = []
    const response = { model: 'reported/model', provider: 'reported-provider', choices: [{ message: { role: 'assistant', content: 'SECRET-OUTPUT' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, cost: 0 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(response)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...response, usage: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify(response)))
      .mockResolvedValueOnce(new Response('SECRET-FAILURE', { status: 429 })))
    await observePlannerTurn({ requestId: 'r', tripId: 't', conversationId: 'c', generationId: 'g' }, async () => {
      const completed = await client.complete([{ role: 'user', content: 'SECRET-INPUT' }], 'deepseek/deepseek-v4-pro-0813', { reasoning: { effort: 'none', exclude: true }, maxTokens: 100 })
      expect(completed.observation).toMatchObject({ reasoning: { enabled: false, exclude: true }, timeoutMs: 35000 })
      expect(completed.observation?.routeFingerprint).toMatch(/^[a-f0-9]{64}$/)
      await observeSpan('tool', 'research', async () => {
        await client.chat([{ role: 'user', content: 'SECRET-RESEARCH' }], 'provider/research')
        await client.completeNativeResearch({ model: 'provider/native', max_tokens: 777, tools: [{ type: 'web_search', description: 'SECRET-DESCRIPTION' }] }, { signal: new AbortController().signal, timeoutMs: 94000 })
        const failure = await client.completeNativeResearch({ model: 'provider/native' }, { signal: new AbortController().signal, timeoutMs: 94000 })
        expect(failure.http?.status).toBe(429)
      })
    }, value => captured.push(value))
    const observation = captured[0]!, models = observation.spans.filter(span => span.kind === 'model')
    expect(observation.counts).toMatchObject({ modelCalls: 4, toolCalls: 1, httpAttempts: 4 })
    expect(models[0]!.model).toMatchObject({ reasoning: { enabled: false, exclude: true }, costUsdMicros: 0, provider: 'reported-provider' })
    expect(models[1]!.model?.costUsdMicros).toBeNull()
    expect(models[2]!.model).toMatchObject({ maxTokens: 777, timeoutMs: 94000 })
    expect(models[3]).toMatchObject({ status: 'error', model: { responseModel: null, costUsdMicros: null, timeoutMs: 94000 } })
    expect(observation.modelCostUsdMicros).toBeNull()
    expect(observation.knownModelCostUsdMicros).toBe(0)
    expect(observation.unknownModelCostCalls).toBe(2)
    expect(observation.modelUsage.totalTokens).toBeNull()
    expect(JSON.stringify(captured)).not.toContain('SECRET-')
  })

  it('fingerprints normalized tools/schema and sanitizes invalid accounting without failing business output', () => {
    const one = normalizeCompletionObservation({}, 'deepseek/deepseek-v4-pro-0813', { reasoning: { effort: 'none' } })
    const two = normalizeCompletionObservation({}, 'deepseek/deepseek-v4-pro-0813', { reasoning: { enabled: false } })
    expect(one.configFingerprint).toBe(two.configFingerprint)
    const route = (url: string) => normalizeCompletionObservation({}, 'model', undefined, undefined, undefined, url)
    const official = route('https://openrouter.ai/api/v1')
    const proxy = route('https://private-proxy.example/api/v1')
    expect(proxy.configFingerprint).not.toBe(official.configFingerprint)
    expect(proxy.routeFingerprint).not.toBe(official.routeFingerprint)
    expect(route('https://user:SECRET@private-proxy.example/api/v1/?key=SECRET#SECRET')).toEqual(proxy)
    expect(JSON.stringify(proxy)).not.toContain('private-proxy')
    const tool = (name: string) => [{ type: 'function' as const, function: { name, description: 'private schema text', parameters: { type: 'object' } } }]
    expect(normalizeCompletionObservation({}, 'model', { tools: tool('a') }).configFingerprint)
      .not.toBe(normalizeCompletionObservation({}, 'model', { tools: tool('b') }).configFingerprint)
    const invalid = normalizeCompletionObservation({ model: 'Bearer secret', provider: 'https://host?key=secret', usage: { cost: -1, prompt_tokens: NaN, completion_tokens: 1.5 } }, 'model')
    expect(invalid).toMatchObject({ responseModel: null, provider: null, costUsdMicros: null, usage: { promptTokens: null, completionTokens: null } })
  })

  it('normalizes observable metadata without messages or gateway secrets', () => {
    const observation = normalizeCompletionObservation({ model: 'provider/actual', choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 3, total_tokens: 3, completion_tokens_details: { reasoning_tokens: 0 }, prompt_tokens_details: { cached_tokens: 0 }, cost: 0 } }, 'provider/requested', { maxTokens: 1700, temperature: 0, reasoning: { effort: 'high' } })
    expect(observation).toMatchObject({ requestModel: 'provider/requested', responseModel: 'provider/actual', provider: null, gateway: 'openrouter', finishReason: 'stop', costUsdMicros: 0, usage: { promptTokens: 0, completionTokens: 3, reasoningTokens: 0, cachedTokens: 0 } })
    expect(observation.configFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(observation)).not.toContain('messages')
  })
  it('keeps unknown usage and cost null and rejects malformed numeric usage', () => {
    const observation = normalizeCompletionObservation({ choices: [{}] }, 'provider/model')
    expect(observation.usage.promptTokens).toBeNull()
    expect(observation.costUsdMicros).toBeNull()
    expect(normalizeCompletionObservation({ usage: { prompt_tokens: '3' } }, 'provider/model').usage.promptTokens).toBeNull()
  })
  it('rounds a known fractional USD cost upward and rejects invalid values', () => {
    expect(usdMicrosFromProviderCost(0.000000001)).toBe(1)
    expect(usdMicrosFromProviderCost(0.123456789)).toBe(123457)
    expect(usdMicrosFromProviderCost(-0.1)).toBeUndefined()
    expect(usdMicrosFromProviderCost(Number.NaN)).toBeUndefined()
  })
  it('uses the V4 Flash default and translates none to explicit disabled reasoning', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      OPENROUTER_API_KEY: 'openrouter-test'
    })
    const client = new OpenRouterClient(env)
    const messages = [{ role: 'user' as const, content: 'Plan a trip' }]

    await client.chat(messages, undefined, {
      maxTokens: 1_700,
      temperature: 0,
      reasoning: { effort: 'none', exclude: true }
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>
    expect(body).toEqual({
      model: 'deepseek/deepseek-v4-flash-0731',
      messages,
      max_tokens: 1_700,
      temperature: 0,
      reasoning: { enabled: false, exclude: true }
    })
  })

  it.each(['high', 'xhigh'] as const)('forwards V4 Pro %s reasoning', async effort => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      OPENROUTER_API_KEY: 'openrouter-test',
      OPENROUTER_MODEL: 'deepseek/deepseek-v4-pro-0813'
    })
    const client = new OpenRouterClient(env)
    const messages = [{ role: 'user' as const, content: 'Plan a trip' }]

    await client.chat(messages, undefined, { reasoning: { effort, exclude: true } })

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'deepseek/deepseek-v4-pro-0813',
      messages,
      reasoning: { effort, exclude: true }
    })
  })

  it('keeps DeepSeek Chat compatibility by omitting reasoning', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      OPENROUTER_API_KEY: 'openrouter-test',
      OPENROUTER_MODEL: 'deepseek/deepseek-chat'
    })
    const client = new OpenRouterClient(env)
    const messages = [{ role: 'user' as const, content: 'Plan a trip' }]

    await client.chat(messages, undefined, { reasoning: { effort: 'high', exclude: true } })

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>
    expect(body).toEqual({ model: 'deepseek/deepseek-chat', messages })
  })

  it('keeps the legacy call shape and maps optional generation options for another model', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      OPENROUTER_API_KEY: 'openrouter-test',
      OPENROUTER_MODEL: 'provider/default-model'
    })
    const client = new OpenRouterClient(env)
    const messages = [{ role: 'user' as const, content: 'Plan a trip' }]

    await client.chat(messages)
    await client.chat(messages, 'provider/free-model', {
      maxTokens: 1_700,
      temperature: 0.2,
      reasoning: { effort: 'none', exclude: true }
    })

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as Record<string, unknown>
    expect(firstBody).toEqual({ model: 'provider/default-model', messages })
    expect(secondBody).toMatchObject({
      model: 'provider/free-model',
      messages,
      max_tokens: 1_700,
      temperature: 0.2,
      reasoning: { effort: 'none', exclude: true }
    })
  })

  it('forwards tool definitions and tool choice unchanged', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor', REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters', OPENROUTER_API_KEY: 'key' })
    const client = new OpenRouterClient(env)
    const tools = [{ type: 'function' as const, function: { name: 'search_flights', description: 'Search flights', parameters: { type: 'object', properties: {} } } }]
    await client.chat([{ role: 'user', content: 'find flights' }], undefined, { tools, toolChoice: 'required' })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({ tools, tool_choice: 'required' })
  })

  it('parses assistant tool calls and tool result messages', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_flights', arguments: '{"from":"PEK"}' } }] }, finish_reason: 'tool_calls' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor', REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters', OPENROUTER_API_KEY: 'key' })
    const client = new OpenRouterClient(env)
    const messages = [{ role: 'assistant' as const, content: null, tool_calls: [{ id: 'call-1', type: 'function' as const, function: { name: 'search_flights', arguments: '{}' } }] }, { role: 'tool' as const, tool_call_id: 'call-1', name: 'search_flights', content: '{"results":[]}' }]
    const completion = await client.complete(messages)
    expect(completion.message.tool_calls?.[0]?.function.name).toBe('search_flights')
    expect(completion.finishReason).toBe('tool_calls')
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).messages).toEqual(messages)
  })

  it.each([
    [{ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'f', arguments: 1 } }] } }] }],
    [{ choices: [{ message: { role: 'assistant', content: 3 } }] }]
  ])('rejects malformed completions and tool calls', async payload => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor', REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters', OPENROUTER_API_KEY: 'key' })
    await expect(new OpenRouterClient(env).complete([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', statusCode: 502 })
  })

  it('fails fast without a key without contacting OpenRouter or exposing secret values', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      OPENROUTER_API_KEY: '',
      OPENROUTER_MODEL: 'deepseek/deepseek-chat'
    })
    const client = new OpenRouterClient(env)

    await expect(client.chat([{ role: 'user', content: 'Plan a trip' }])).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
      statusCode: 503
    })
    expect(fetchMock).not.toHaveBeenCalled()
    try {
      await client.chat([{ role: 'user', content: 'Plan a trip' }])
    } catch (error) {
      expect(String(error)).not.toContain('openrouter-test')
    }
  })
})
