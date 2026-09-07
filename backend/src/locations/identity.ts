import type { LocationRef } from '../aviation/types.js'

/** A read-only, product-owned grouping entry for one location code. */
export interface LocationIdentityGroup {
  readonly cityCode: string
  readonly representativeAirport: string
}

/**
 * The identity algorithms are deliberately data-free. Applications inject a
 * directory when they want aliases such as a multi-airport city; unknown
 * codes remain distinct and are never guessed into a city.
 */
export interface LocationIdentityDirectory {
  readonly groups: Readonly<Record<string, LocationIdentityGroup>>
}

export interface LocationIdentityPolicy {
  readonly directory: LocationIdentityDirectory
}

export const EMPTY_LOCATION_IDENTITY_DIRECTORY: LocationIdentityDirectory = { groups: {} }
export const EMPTY_LOCATION_IDENTITY_POLICY: LocationIdentityPolicy = { directory: EMPTY_LOCATION_IDENTITY_DIRECTORY }

function normalizedCode(value: string): string {
  return value.trim().toUpperCase()
}

function locationCode(value: LocationRef): string | undefined {
  return value.type === 'city'
    ? value.cityCode ?? value.iata
    : value.cityCode ?? value.iata
}

function groupFor(code: string, policy: LocationIdentityPolicy): LocationIdentityGroup | undefined {
  return policy.directory.groups[normalizedCode(code)]
}

/** Return the exact airport identity. NRT and HND intentionally differ. */
export function airportExactIdentity(value: LocationRef): string {
  const iata = value.iata ? normalizedCode(value.iata) : undefined
  return iata ? `airport:${iata}` : `airport-id:${value.id}`
}

/**
 * Return the stable city grouping code for a LocationRef or a known code.
 * Unknown codes remain distinct instead of being guessed into a city.
 */
export function cityGroupingCode(
  value: LocationRef | string,
  policy: LocationIdentityPolicy = EMPTY_LOCATION_IDENTITY_POLICY
): string {
  const raw = typeof value === 'string' ? value : locationCode(value)
  if (!raw) return typeof value === 'string' ? normalizedCode(value) : `id:${value.id}`
  const code = normalizedCode(raw)
  return groupFor(code, policy)?.cityCode ?? code
}

/** Return the city identity used for preference/exclusion de-duplication. */
export function cityGroupingIdentity(
  value: LocationRef,
  policy: LocationIdentityPolicy = EMPTY_LOCATION_IDENTITY_POLICY
): string {
  return `city:${cityGroupingCode(value, policy)}`
}

/**
 * Return the representative airport code expected by catalog-backed
 * destination ranking. This is a representation policy, not an airport fact
 * lookup; callers that need authoritative airport facts must resolve through
 * the aviation boundary first.
 */
export function representativeAirportCode(
  value: LocationRef | string,
  policy: LocationIdentityPolicy = EMPTY_LOCATION_IDENTITY_POLICY
): string {
  const raw = typeof value === 'string' ? value : locationCode(value)
  if (!raw) return typeof value === 'string' ? normalizedCode(value) : value.id
  const code = normalizedCode(raw)
  return groupFor(code, policy)?.representativeAirport ?? code
}

/**
 * Product-level overlap: exact airport identity for airport/airport pairs;
 * city grouping identity whenever a city reference participates.
 */
export function locationsOverlap(
  left: LocationRef,
  right: LocationRef,
  policy: LocationIdentityPolicy = EMPTY_LOCATION_IDENTITY_POLICY
): boolean {
  if (left.id === right.id) return true
  if (left.type === 'airport' && right.type === 'airport') {
    return airportExactIdentity(left) === airportExactIdentity(right)
  }
  return cityGroupingIdentity(left, policy) === cityGroupingIdentity(right, policy)
}
