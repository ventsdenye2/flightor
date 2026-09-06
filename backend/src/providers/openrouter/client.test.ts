import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '../../config/env.js'
import { OpenRouterClient } from './client.js'

afterEach(() => vi.unstubAllGlobals())

describe('OpenRouterClient', () => {
  it('uses the V4 Pro default and omits unsupported none reasoning', async () => {
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
      model: 'deepseek/deepseek-v4-pro-0813',
      messages,
      max_tokens: 1_700,
      temperature: 0
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
