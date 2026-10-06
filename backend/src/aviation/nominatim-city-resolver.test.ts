import { describe, expect, it, vi } from 'vitest'
import type { LocationResolution } from './types.js'
import { NominatimCityLocationResolver } from './nominatim-city-resolver.js'
import type { NominatimProvider } from '../places/nominatim.js'
import type { PostgresPlaceRepository } from '../places/postgres.js'

const checkedAt = '2026-10-06T00:00:00.000Z'
const result: LocationResolution = { matches: [{ id: 'osm:relation:987', type: 'city', name: 'Kyoto', countryCode: 'JP', latitude: 35.0116, longitude: 135.7681 }],
  verification: { status: 'verified', checkedAt, confidence: 0.9, sources: [{ provider: 'nominatim', reference: 'Kyoto' }] } }

function harness(cached: LocationResolution | undefined) {
  const repository = { cachedCityQuery: vi.fn().mockResolvedValue(cached), cacheCityQuery: vi.fn().mockImplementation(async (_key: string, value: LocationResolution) => value) }
  const provider = { searchCity: vi.fn().mockImplementation(async (_query: string, _signal: AbortSignal, _limit: number, readCache: () => Promise<LocationResolution | undefined>) => {
    return await readCache() ?? result
  }) }
  const resolver = new NominatimCityLocationResolver(repository as unknown as PostgresPlaceRepository,
    provider as unknown as NominatimProvider, 'nominatim:test-city:v1')
  return { resolver, repository, provider }
}

describe('NominatimCityLocationResolver', () => {
  it('uses validated cached city results without calling Nominatim', async () => {
    const h = harness(result)
    await expect(h.resolver.resolveLocation({ query: '  Kyoto ', types: ['city'] })).resolves.toEqual(result)
    expect(h.provider.searchCity).not.toHaveBeenCalled()
    expect(h.repository.cachedCityQuery).toHaveBeenCalledOnce()
  })

  it('keys external city lookups by namespace, normalized query, and result limit', async () => {
    const h = harness(undefined), controller = new AbortController()
    await expect(h.resolver.resolveLocation({ query: '  Kyo\tt o ', types: ['city'], limit: 4 }, { signal: controller.signal })).resolves.toEqual(result)
    expect(h.provider.searchCity).toHaveBeenCalledWith('Kyo t o', controller.signal, 4, expect.any(Function))
    expect(h.repository.cachedCityQuery).toHaveBeenCalledTimes(2)
    expect(h.repository.cacheCityQuery).toHaveBeenCalledOnce()
    expect(h.repository.cachedCityQuery.mock.calls[0]?.[0]).toMatch(/^[a-f0-9]{64}$/)
  })

  it('never delegates non-city requests and preserves cancellation', async () => {
    const h = harness(undefined), controller = new AbortController()
    await h.resolver.resolveLocation({ query: 'Narita', types: ['airport'] }, { signal: controller.signal })
    expect(h.provider.searchCity).not.toHaveBeenCalled()
    controller.abort()
    await expect(h.resolver.resolveLocation({ query: 'Kyoto', types: ['city'] }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.provider.searchCity).not.toHaveBeenCalled()
  })

  it('does not return a cached identity when cancellation arrives during the cache read', async () => {
    const h = harness(result), controller = new AbortController()
    let finish!: (value: LocationResolution | undefined) => void
    h.repository.cachedCityQuery.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = h.resolver.resolveLocation({ query: 'Kyoto', types: ['city'] }, { signal: controller.signal })
    controller.abort()
    finish(result)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.provider.searchCity).not.toHaveBeenCalled()
  })

  it('does not start a cache write or return a result when cancelled after the provider responds', async () => {
    const h = harness(undefined), controller = new AbortController()
    h.provider.searchCity.mockImplementationOnce(async () => { controller.abort(); return result })
    await expect(h.resolver.resolveLocation({ query: 'Kyoto', types: ['city'] }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.repository.cacheCityQuery).not.toHaveBeenCalled()
  })
})
