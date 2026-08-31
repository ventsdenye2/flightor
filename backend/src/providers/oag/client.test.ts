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
    expect(String(url)).toContain('version=v1')
    expect((init?.headers as Record<string, string>)['Subscription-Key']).toBe('master-secret')
  })

  it('uses the current connections endpoint contract', async () => {
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
      OAG_CONNECTIONS_KEY: 'connections-secret'
    })
    await new OagClient(env).connections({
      origin: 'szx', destination: 'lhr', dateFrom: '2026-09-15', dateTo: '2026-09-17', limit: 10
    })
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/flight-connections?')
    expect(String(url)).toContain('DepartureDate=2026-09-15%2F2026-09-17')
    expect(String(url)).toContain('Service=p')
    expect(String(url)).toContain('version=v1')
    expect(String(url)).not.toContain('ToDate=')
  })
})
