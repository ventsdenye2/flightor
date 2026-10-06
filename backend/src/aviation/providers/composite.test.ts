import { describe, expect, it, vi } from 'vitest'
import type { LocationResolver } from '../location-resolver.js'
import { MockAviationProvider } from './mock.js'
import { CompositeAviationProvider } from './composite.js'

const city = { id: 'city-tokyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const verification = { status: 'verified' as const, checkedAt: '2026-09-07T00:00:00.000Z', confidence: 1, sources: [{ provider: 'reference-data' }] }

describe('CompositeAviationProvider', () => {
  it('resolves city-only queries locally without calling the remote provider', async () => {
    const remote = new MockAviationProvider({ failure: new Error('must not be called') })
    const local: LocationResolver = { resolveLocation: vi.fn().mockResolvedValue({ matches: [city], verification }) }
    const result = await new CompositeAviationProvider(remote, local).resolveLocation({ query: '东京', types: ['city'] })
    expect(result.matches).toEqual([city])
    expect(local.resolveLocation).toHaveBeenCalledOnce()
  })

  it('keeps verified local results when the external provider is unavailable', async () => {
    const remote = new MockAviationProvider({ failure: new Error('not configured') })
    const local: LocationResolver = { resolveLocation: vi.fn().mockResolvedValue({ matches: [city], verification }) }
    await expect(new CompositeAviationProvider(remote, local).resolveLocation({ query: 'Tokyo' })).resolves.toMatchObject({ matches: [city] })
  })

  it('uses the city fallback only after a city-only local miss', async () => {
    const remote = new MockAviationProvider({ failure: new Error('aviation provider must not be called') })
    const fallback = { resolveLocation: vi.fn().mockResolvedValue({ matches: [city], verification }) }
    const local: LocationResolver = { resolveLocation: vi.fn().mockResolvedValue({ matches: [], verification: { ...verification, status: 'unverified', confidence: 0 } }) }
    const result = await new CompositeAviationProvider(remote, local, fallback).resolveLocation({ query: 'Kyoto', types: ['city'] })
    expect(result.matches).toEqual([city])
    expect(fallback.resolveLocation).toHaveBeenCalledOnce()
    expect(fallback.resolveLocation).toHaveBeenCalledWith({ query: 'Kyoto', types: ['city'] }, undefined)
  })

  it('does not use the city fallback for local hits, airport queries, or mixed queries', async () => {
    const remote = new MockAviationProvider()
    const fallback = { resolveLocation: vi.fn().mockResolvedValue({ matches: [], verification }) }
    const local: LocationResolver = { resolveLocation: vi.fn()
      .mockResolvedValueOnce({ matches: [city], verification })
      .mockResolvedValue({ matches: [], verification: { ...verification, status: 'unverified', confidence: 0 } }) }
    const composite = new CompositeAviationProvider(remote, local, fallback)
    await composite.resolveLocation({ query: 'Tokyo', types: ['city'] })
    await composite.resolveLocation({ query: 'Kansai', types: ['airport'] })
    await composite.resolveLocation({ query: 'Osaka', types: ['city', 'airport'] })
    expect(fallback.resolveLocation).not.toHaveBeenCalled()
  })

  it('passes the caller cancellation signal into the city fallback', async () => {
    const remote = new MockAviationProvider()
    const local: LocationResolver = { resolveLocation: vi.fn().mockResolvedValue({ matches: [], verification: { ...verification, status: 'unverified', confidence: 0 } }) }
    const fallback = { resolveLocation: vi.fn().mockResolvedValue({ matches: [], verification }) }
    const controller = new AbortController()
    const composite = new CompositeAviationProvider(remote, local, fallback)
    await composite.resolveLocation({ query: 'Tallinn', types: ['city'] }, { signal: controller.signal })
    expect(fallback.resolveLocation).toHaveBeenCalledWith({ query: 'Tallinn', types: ['city'] }, { signal: controller.signal })
  })
})
