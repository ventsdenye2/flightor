import { locationRefKey, type LocationRef } from '../../aviation/types.js'
import { AppError } from '../../lib/errors.js'
import type { LocationSelector } from '../../locations/selector.js'
import type { TripContext } from '../../trips/types.js'
import type { ToolExecutionContext } from '../runtime/registry.js'

/** Only provider/directory results and server-owned Trip facts populate this ledger. */
export function recordResolvedLocations(context: Pick<ToolExecutionContext, 'resolvedLocationKeys' | 'resolvedLocations'>, locations: readonly LocationRef[]): void {
  const records = context.resolvedLocations ??= new Map<string, LocationRef>()
  for (const location of locations) {
    context.resolvedLocationKeys?.add(locationRefKey(location))
    records.set(`${location.type}:${location.id}`, structuredClone(location))
  }
}

/** Seed the per-turn ledger from the current server-owned Trip snapshot. */
export function recordTripLocations(context: Pick<ToolExecutionContext, 'resolvedLocationKeys' | 'resolvedLocations'>, trip: TripContext): void {
  recordResolvedLocations(context, [
    ...(trip.origin ? [trip.origin] : []),
    ...trip.destinationIntent.required,
    ...trip.destinationIntent.preferred,
    ...trip.destinationIntent.excluded,
    ...trip.locationRoleOverrides.map(item => item.location),
    ...trip.requiredGroundLegs.flatMap(leg => [leg.from, leg.to])
  ])
}

/** Model arguments select a known identity; all location facts come from the ledger. */
export function canonicalResolvedLocation(context: ToolExecutionContext, input: LocationSelector): LocationRef {
  const id = typeof input === 'object' ? input.id : String(input)
  const candidates = [...(context.resolvedLocations?.values() ?? [])].filter(location => location.id === id
    && (typeof input !== 'object' || location.type === input.type))
  if (candidates.length === 1) return structuredClone(candidates[0]!)
  // Compatibility for direct domain callers supplying the exact trusted object.
  if (typeof input === 'object' && context.resolvedLocationKeys?.has(locationRefKey(input))) return structuredClone(input)
  throw new AppError('LOCATION_NOT_RESOLVED', 'Location was not resolved by an authoritative provider in this turn')
}
