import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '../../config/env.js'
import { OagClient } from './client.js'

afterEach(() => vi.unstubAllGlobals())

describe('OagClient', () => {
  it('sends the subscription key in a header and never in the URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      OAG_MASTER_DATA_KEY: 'master-secret'
    })
    await new OagClient(env).locations({ countryCode: 'cn', limit: 10 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).not.toContain('master-secret')
    expect(String(url)).toContain('CountryCode=CN')
    expect((init?.headers as Record<string, string>)['Subscription-Key']).toBe('master-secret')
  })
})
