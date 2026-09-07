import { locationRefKey, locationResolutionSchema, type LocationResolution } from '../types.js'
import type { LocationResolver } from '../location-resolver.js'
import type {
  AviationProvider, AirportLookupInput, AirportRoutesInput, FlightStatusInput,
  ProviderCallOptions, ResolveLocationInput, ScheduleSearchInput
} from './provider.js'

export class CompositeAviationProvider implements AviationProvider {
  readonly name = 'flightor-aviation'
  constructor(private readonly primary: AviationProvider, private readonly local: LocationResolver) {}

  async resolveLocation(input: ResolveLocationInput, options?: ProviderCallOptions): Promise<LocationResolution> {
    const local = await this.local.resolveLocation(input, options)
    const cityOnly = input.types?.length === 1 && input.types[0] === 'city'
    if (cityOnly) return local
    let remote: LocationResolution
    try {
      remote = await this.primary.resolveLocation({ ...input, types: ['airport'] }, options)
    } catch (error) {
      if (local.matches.length > 0) return local
      throw error
    }
    const limit = Math.max(1, Math.min(input.limit ?? 20, 20))
    const seen = new Set<string>()
    const matches = [...local.matches, ...remote.matches].filter(value => {
      const key = locationRefKey(value)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, limit)
    return locationResolutionSchema.parse({
      matches,
      verification: matches.length > 0
        ? {
            status: local.verification.status === 'verified' || remote.verification.status === 'verified' ? 'verified' : 'partially_verified',
            checkedAt: [local.verification.checkedAt, remote.verification.checkedAt].sort()[0],
            confidence: Math.max(local.verification.confidence, remote.verification.confidence),
            sources: [...local.verification.sources, ...remote.verification.sources].slice(0, 20)
          }
        : remote.verification
    })
  }

  async getAirport(input: AirportLookupInput, options?: ProviderCallOptions) {
    const local = await this.local.resolveLocation({ query: input.iata, types: ['airport'], limit: 1 }, options)
    if (local.matches[0]) return local.matches[0]
    return this.primary.getAirport(input, options)
  }

  getAirportRoutes(input: AirportRoutesInput, options?: ProviderCallOptions) { return this.primary.getAirportRoutes(input, options) }
  getSchedules(input: ScheduleSearchInput, options?: ProviderCallOptions) { return this.primary.getSchedules(input, options) }
  getFlightStatus(input: FlightStatusInput, options?: ProviderCallOptions) { return this.primary.getFlightStatus(input, options) }
}
