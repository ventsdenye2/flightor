import { locationRefKey, type LocationRef } from '../../aviation/types.js'
import { AppError } from '../../lib/errors.js'
import type { ToolExecutionContext } from '../runtime/registry.js'

/** Only provider/directory tool results populate this per-turn authority ledger. */
export function recordResolvedLocations(context: Pick<ToolExecutionContext, 'resolvedLocationKeys' | 'resolvedLocations'>, locations: readonly LocationRef[]): void {
  const records = context.resolvedLocations ??= new Map<string, LocationRef>()
  for (const location of locations) {
    context.resolvedLocationKeys?.add(locationRefKey(location))
    records.set(`${location.type}:${location.id}`, structuredClone(location))
  }
}

/** Model arguments select a known identity; all location facts come from the ledger. */
export function canonicalResolvedLocation(context: ToolExecutionContext, input: LocationRef | string): LocationRef {
  const candidates = [...(context.resolvedLocations?.values() ?? [])].filter(location => typeof input === 'string'
    ? location.id === input
    : location.id === input.id && location.type === input.type)
  if (candidates.length === 1) return structuredClone(candidates[0]!)
  // Compatibility for direct domain callers supplying the exact trusted object.
  if (typeof input !== 'string' && context.resolvedLocationKeys?.has(locationRefKey(input))) return structuredClone(input)
  throw new AppError('LOCATION_NOT_RESOLVED', 'Location was not resolved by an authoritative provider in this turn')
}
