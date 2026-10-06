import { locationRefKey, type LocationRef } from '../../aviation/types.js'
import type { TripContext } from '../../trips/types.js'

/** Returns the sole selected Trip city; candidate prose never adds or chooses a destination. */
export function uniqueSelectedTripCity(trip: Pick<TripContext, 'destinationIntent'>): LocationRef | undefined {
  const selected = [...trip.destinationIntent.required, ...trip.destinationIntent.preferred]
  if (selected.length === 0 || selected.some(location => location.type !== 'city')) return undefined
  const identities = new Map(selected.map(location => [locationRefKey(location), location] as const))
  if (identities.size !== 1) return undefined
  return structuredClone(identities.values().next().value!)
}
