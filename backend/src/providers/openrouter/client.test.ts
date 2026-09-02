import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '../../config/env.js'
import { OpenRouterClient } from './client.js'

afterEach(() => vi.unstubAllGlobals())

describe('OpenRouterClient', () => {
  it('keeps the legacy call shape and maps optional generation options', async () => {
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
      OPENROUTER_MODEL: 'openrouter/free'
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
    expect(firstBody).toEqual({ model: 'openrouter/free', messages })
    expect(secondBody).toMatchObject({
      model: 'provider/free-model',
      messages,
      max_tokens: 1_700,
      temperature: 0.2,
      reasoning: { effort: 'none', exclude: true }
    })
  })
})
