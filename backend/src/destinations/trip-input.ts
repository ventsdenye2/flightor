import { representativeAirportCode } from '../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../locations/curated-directory.js'
import { destinationDiscoveryInputSchema, destinationInterestSchema, type DestinationDiscoveryInput } from './types.js'
import type { LocationRef } from '../aviation/types.js'
import type { TripContext } from '../trips/types.js'

function codes(locations: readonly LocationRef[]): string[] {
  return [...new Set(locations.flatMap(location => {
    const value = location.iata ?? location.cityCode
    return value ? [representativeAirportCode(location, CURATED_LOCATION_IDENTITY_POLICY)] : []
  }))]
}

export function destinationInterests(values: readonly string[]): DestinationDiscoveryInput['interests'] {
  return [...new Set(values)].flatMap(value => { const parsed = destinationInterestSchema.safeParse(value); return parsed.success ? [parsed.data] : [] })
}

export function destinationInputForTrip(trip: TripContext, filter: Pick<DestinationDiscoveryInput, 'regions' | 'interests' | 'limit'>, memoryPreferred: readonly string[] = []): DestinationDiscoveryInput {
  return destinationDiscoveryInputSchema.parse({
    ...filter,
    requiredIatas: codes([...trip.destinationIntent.required, ...trip.locationRoleOverrides.filter(item => item.role === 'visit').map(item => item.location)]),
    preferredIatas: [...new Set([...codes(trip.destinationIntent.preferred), ...memoryPreferred])],
    excludedIatas: codes([...trip.destinationIntent.excluded, ...trip.locationRoleOverrides.filter(item => item.role === 'avoid').map(item => item.location)]),
    ...(trip.origin ? { origin: trip.origin } : {})
  })
}
