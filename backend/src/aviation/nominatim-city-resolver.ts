import { createHash } from 'node:crypto'
import { locationResolutionSchema, type LocationResolution } from './types.js'
import type { LocationResolver } from './location-resolver.js'
import type { ProviderCallOptions, ResolveLocationInput } from './providers/provider.js'
import type { NominatimProvider } from '../places/nominatim.js'
import { PostgresPlaceRepository } from '../places/postgres.js'

export class NominatimCityLocationResolver implements LocationResolver {
  constructor(
    private readonly repository: PostgresPlaceRepository,
    private readonly provider: NominatimProvider,
    private readonly namespace: string
  ) {}

  async resolveLocation(input: ResolveLocationInput, options: ProviderCallOptions = {}): Promise<LocationResolution> {
    options.signal?.throwIfAborted()
    if (input.types?.length !== 1 || input.types[0] !== 'city') return this.empty(input.query)
    const query = input.query.normalize('NFKC').trim().replace(/\s+/g, ' ')
    if (query.length < 2) return this.empty(query)
    const limit = Math.max(1, Math.min(input.limit ?? 20, 20))
    const key = createHash('sha256').update(JSON.stringify([this.namespace, query.toLowerCase(), limit])).digest('hex')
    const cached = await this.repository.cachedCityQuery(key)
    options.signal?.throwIfAborted()
    if (cached) return cached
    const signal = options.signal ?? new AbortController().signal
    const result = await this.provider.searchCity(query, signal, limit, () => this.repository.cachedCityQuery(key))
    signal.throwIfAborted()
    const stored = await this.repository.cacheCityQuery(key, locationResolutionSchema.parse(result))
    signal.throwIfAborted()
    return stored
  }

  private empty(query: string): LocationResolution {
    return { matches: [], verification: { status: 'unverified', checkedAt: new Date().toISOString(), confidence: 0,
      sources: [{ provider: 'nominatim', ...(query ? { reference: query.slice(0, 500) } : {}) }] } }
  }
}
