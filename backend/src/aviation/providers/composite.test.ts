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
})
