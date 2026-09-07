import type { AviationProvider } from '../aviation/providers/provider.js'
import { locationRefSchema, type AirportRoute, type LocationRef } from '../aviation/types.js'
import {
  DESTINATION_PROFILES,
  type DestinationInterest,
  type DestinationProfile,
  type DestinationRegion
} from './catalog.js'
import {
  destinationCandidateSchema,
  destinationDiscoveryInputSchema,
  destinationDiscoveryResultSchema,
  type DestinationCandidate,
  type DestinationDiscoveryInput,
  type DestinationDiscoveryResult,
  type DestinationDiscoveryService,
  type DestinationDiscoveryContext
} from './types.js'

/** Stable version for the bounded, catalog-backed destination service. */
export const DESTINATION_DISCOVERY_SERVICE_VERSION = 'destination-discovery-phase4b-v1'

/**
 * The directory is deliberately not presented as a current global travel
 * index.  A fixed catalog timestamp keeps deterministic tests and artifacts
 * stable while still carrying the required provenance record.
 */
const CATALOG_CHECKED_AT = '1970-01-01T00:00:00.000Z'
const CATALOG_PROVIDER = 'flightor-destination-catalog'
const CATALOG_REFERENCE = 'catalog://flightor-destination-profiles-v1'

const ACCESSIBILITY_WARNING = 'destination_accessibility_unknown'

export interface CatalogDestinationDiscoveryOptions {
  aviation?: AviationProvider
  catalog?: readonly DestinationProfile[]
}

type DiscoveryConstructor = CatalogDestinationDiscoveryOptions | AviationProvider | undefined

function isAviationProvider(value: DiscoveryConstructor): value is AviationProvider {
  return value !== undefined && typeof value === 'object' && 'getAirportRoutes' in value && typeof value.getAirportRoutes === 'function'
}

function normalizedIata(value: string): string {
  return value.trim().toUpperCase()
}

function profileCanonicalIata(profile: DestinationProfile): string {
  return profile.canonicalIata ?? profile.iata
}

function canonicalIata(value: string, catalog: readonly DestinationProfile[] = DESTINATION_PROFILES): string | undefined {
  const normalized = normalizedIata(value)
  const profile = catalog.find(candidate => candidate.iata === normalized || candidate.canonicalIata === normalized)
  return profile ? profileCanonicalIata(profile) : undefined
}

function profileForIata(value: string, catalog: readonly DestinationProfile[] = DESTINATION_PROFILES): DestinationProfile | undefined {
  const normalized = normalizedIata(value)
  return catalog.find(profile => profile.iata === normalized || profileCanonicalIata(profile) === normalized)
}

function locationFor(profile: DestinationProfile): LocationRef {
  // The catalog is a reviewed airport-code directory, not a provider airport
  // record.  Keep the source visible in the id and avoid inventing an airport
  // terminal/name fact that the catalog does not contain.
  return locationRefSchema.parse({
    id: `catalog:${profile.iata}`,
    type: 'airport',
    name: profile.cityEn,
    countryCode: profile.countryCode,
    iata: profile.iata,
    cityCode: profileCanonicalIata(profile),
    latitude: profile.lat,
    longitude: profile.lon
  })
}

function baseVerification() {
  return {
    status: 'partially_verified' as const,
    checkedAt: CATALOG_CHECKED_AT,
    confidence: 0.5,
    sources: [{ provider: CATALOG_PROVIDER, reference: CATALOG_REFERENCE }]
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function uniqueWarnings(values: readonly string[]): string[] {
  return unique(values.filter(value => value.length > 0)).slice(0, 30)
}

function validCatalogInterests(values: readonly DestinationInterest[]): DestinationInterest[] {
  return unique(values)
}

function locationCode(location: LocationRef): string | undefined {
  const value = location.iata ?? location.cityCode
  return value ? normalizedIata(value) : undefined
}

function directRouteCode(route: AirportRoute): string | undefined {
  const value = route.destination?.iata ?? route.destination?.cityCode
  return value ? normalizedIata(value) : undefined
}

function routeMatchesProfile(routeCode: string, profile: DestinationProfile, catalog: readonly DestinationProfile[]): boolean {
  const routeCanonical = canonicalIata(routeCode, catalog) ?? routeCode
  return routeCode === normalizedIata(profile.iata) || routeCanonical === profileCanonicalIata(profile)
}

function interestMatches(profile: DestinationProfile, interests: readonly DestinationInterest[]): DestinationInterest[] {
  return interests.filter(interest => profile.tags.includes(interest))
}

interface ProfileSelection {
  profile: DestinationProfile
  key: string
  required: boolean
  preferred: boolean
}

function requestedProfileMap(values: readonly string[], catalog: readonly DestinationProfile[]): Map<string, DestinationProfile> {
  const result = new Map<string, DestinationProfile>()
  for (const raw of values) {
    const profile = profileForIata(raw, catalog)
    if (!profile) continue
    const key = profileCanonicalIata(profile)
    if (!result.has(key)) result.set(key, profile)
  }
  return result
}

function scoreFor(selection: ProfileSelection, matchedInterestCount: number, direct: boolean): number {
  // The weights encode a product ordering, rather than an attempt to estimate
  // travel quality: hard required intent, then soft preference, then interests,
  // then lower catalog cost, with direct accessibility as a small tie-break.
  const raw = (selection.required ? 1_000_000 : 0)
    + (selection.preferred ? 100_000 : 0)
    + matchedInterestCount * 1_000
    + (5 - selection.profile.costTier) * 10
    + (direct ? 1 : 0)
  return Math.max(0, Math.min(1, raw / 1_001_041))
}

function sortSelections(
  left: ProfileSelection,
  right: ProfileSelection,
  interests: readonly DestinationInterest[],
  directCodes: ReadonlySet<string>,
  catalogOrder: ReadonlyMap<string, number>
): number {
  if (left.required !== right.required) return left.required ? -1 : 1
  if (left.preferred !== right.preferred) return left.preferred ? -1 : 1
  const leftInterests = interestMatches(left.profile, interests).length
  const rightInterests = interestMatches(right.profile, interests).length
  if (leftInterests !== rightInterests) return rightInterests - leftInterests
  if (left.profile.costTier !== right.profile.costTier) return left.profile.costTier - right.profile.costTier
  const leftDirect = directCodes.has(left.key) ? 1 : 0
  const rightDirect = directCodes.has(right.key) ? 1 : 0
  if (leftDirect !== rightDirect) return rightDirect - leftDirect
  const leftOrder = catalogOrder.get(left.profile.iata) ?? Number.MAX_SAFE_INTEGER
  const rightOrder = catalogOrder.get(right.profile.iata) ?? Number.MAX_SAFE_INTEGER
  return leftOrder - rightOrder || left.profile.iata.localeCompare(right.profile.iata)
}

function reasonsFor(
  selection: ProfileSelection,
  interests: readonly DestinationInterest[],
  direct: boolean
): string[] {
  const reasons: string[] = []
  if (selection.required) reasons.push('required destination from the active trip')
  else if (selection.preferred) reasons.push('soft preferred destination from the active trip or enabled Memory')
  const matched = interestMatches(selection.profile, interests)
  if (matched.length > 0) reasons.push(`matches interests: ${matched.join(', ')}`)
  reasons.push(`catalog cost tier ${selection.profile.costTier}`)
  if (direct) reasons.push('an aviation provider route matched this catalog airport')
  else reasons.push('accessibility is unknown; no matching provider route was established')
  return reasons.slice(0, 12)
}

function unknownInputWarnings(input: DestinationDiscoveryInput, catalog: readonly DestinationProfile[]): string[] {
  const known = new Set(catalog.flatMap(profile => [profile.iata, profileCanonicalIata(profile)]))
  const values = [
    ...input.requiredIatas.map(value => ['required', value] as const),
    ...input.preferredIatas.map(value => ['preferred', value] as const),
    ...input.excludedIatas.map(value => ['excluded', value] as const)
  ]
  return values
    .filter(([, value]) => !known.has(normalizedIata(value)))
    .map(([kind, value]) => `destination_${kind}_outside_curated_catalog:${normalizedIata(value)}`)
}

function selectedProfiles(
  input: DestinationDiscoveryInput,
  catalog: readonly DestinationProfile[]
): { selections: ProfileSelection[]; warnings: string[] } {
  const excluded = new Set<string>()
  for (const raw of input.excludedIatas) {
    const profile = profileForIata(raw, catalog)
    if (profile) excluded.add(profileCanonicalIata(profile))
  }

  const requiredMap = requestedProfileMap(input.requiredIatas, catalog)
  const preferredMap = requestedProfileMap(input.preferredIatas, catalog)
  const regionSet = new Set<DestinationRegion>(input.regions)
  const candidateByCity = new Map<string, DestinationProfile>()
  const warnings: string[] = unknownInputWarnings(input, catalog)

  // Explicit required intent is retained even when a region/interest filter
  // would otherwise omit it.  Exclusion/avoid is always stronger.
  for (const profile of requiredMap.values()) {
    const key = profileCanonicalIata(profile)
    if (excluded.has(key)) {
      warnings.push(`required_destination_excluded:${key}`)
      continue
    }
    candidateByCity.set(key, profile)
  }

  for (const profile of catalog) {
    const key = profileCanonicalIata(profile)
    if (excluded.has(key)) continue
    if (regionSet.size > 0 && !regionSet.has(profile.region)) continue
    const existing = candidateByCity.get(key)
    if (existing !== undefined) continue
    // Prefer an explicitly requested airport alias (for example HND) over the
    // canonical NRT profile.  Otherwise retain the first canonical profile in
    // the reviewed directory and never emit duplicate same-city aliases.
    const preferred = preferredMap.get(key)
    if (preferred !== undefined) candidateByCity.set(key, preferred)
    else if (!profile.canonicalIata) candidateByCity.set(key, profile)
  }

  // If a required city was not part of an explicit region filter, it remains
  // hard-retained above; if a preferred city is out of scope, it stays soft
  // and is omitted as a normal filter result.
  const selections = [...candidateByCity.entries()].map(([key, profile]) => ({
    key,
    profile,
    required: requiredMap.has(key) && !excluded.has(key),
    preferred: preferredMap.has(key) && !excluded.has(key)
  }))
  return { selections, warnings }
}

async function directCodesFor(
  input: DestinationDiscoveryInput,
  aviation: AviationProvider | undefined,
  context: DestinationDiscoveryContext | undefined,
  catalog: readonly DestinationProfile[]
): Promise<{ directCodes: Set<string>; warnings: string[] }> {
  const warnings: string[] = []
  if (context?.signal?.aborted) throw new Error('Destination discovery aborted')
  const origin = input.origin ? locationCode(input.origin) : undefined
  if (!origin) {
    warnings.push(`${ACCESSIBILITY_WARNING}:origin_missing`)
    return { directCodes: new Set<string>(), warnings }
  }
  if (!aviation) {
    warnings.push(`${ACCESSIBILITY_WARNING}:provider_unavailable`)
    return { directCodes: new Set<string>(), warnings }
  }
  try {
    // This is intentionally the sole provider call made by discovery.  A
    // route-statistics response is enough to annotate accessibility, but not
    // enough to establish fare, schedule, visa, or global reachability facts.
    const routes = await aviation.getAirportRoutes(
      { origin },
      context?.signal === undefined ? undefined : { signal: context.signal }
    )
    if (context?.signal?.aborted) throw new Error('Destination discovery aborted')
    const directCodes = new Set<string>()
    for (const route of routes ?? []) {
      const code = directRouteCode(route)
      if (!code) continue
      const profile = catalog.find(candidate => routeMatchesProfile(code, candidate, catalog))
      if (profile) directCodes.add(profileCanonicalIata(profile))
    }
    if (directCodes.size === 0) warnings.push(`${ACCESSIBILITY_WARNING}:no_matching_route`)
    return { directCodes, warnings }
  } catch (error) {
    if (context?.signal?.aborted || (error instanceof Error && error.message === 'Destination discovery aborted')) throw new Error('Destination discovery aborted')
    warnings.push(`${ACCESSIBILITY_WARNING}:provider_failure`)
    return { directCodes: new Set<string>(), warnings }
  }
}

function buildCandidate(selection: ProfileSelection, interests: readonly DestinationInterest[], direct: boolean): DestinationCandidate {
  const matched = interestMatches(selection.profile, interests)
  return destinationCandidateSchema.parse({
    location: locationFor(selection.profile),
    cityZh: selection.profile.cityZh,
    cityEn: selection.profile.cityEn,
    region: selection.profile.region,
    // Preserve the full reviewed catalog tag set as candidate metadata; the
    // matched subset remains explicit in deterministic reasons/score.
    interests: selection.profile.tags,
    minStayDays: selection.profile.minStayDays,
    costTier: selection.profile.costTier,
    score: scoreFor(selection, matched.length, direct),
    reasons: reasonsFor(selection, interests, direct),
    accessibility: direct ? 'direct' : 'unknown',
    verification: baseVerification()
  })
}

export class CatalogDestinationDiscoveryService implements DestinationDiscoveryService {
  private readonly aviation: AviationProvider | undefined
  private readonly catalog: readonly DestinationProfile[]

  constructor(options?: DiscoveryConstructor) {
    this.aviation = isAviationProvider(options) ? options : options?.aviation
    this.catalog = isAviationProvider(options) || options === undefined
      ? DESTINATION_PROFILES
      : options.catalog ?? DESTINATION_PROFILES
  }

  async discover(input: DestinationDiscoveryInput, context?: DestinationDiscoveryContext): Promise<DestinationDiscoveryResult> {
    const normalized = destinationDiscoveryInputSchema.parse(input)
    if (context?.signal?.aborted) throw new Error('Destination discovery aborted')
    const selected = selectedProfiles(normalized, this.catalog)
    const accessibility = await directCodesFor(normalized, this.aviation, context, this.catalog)
    const interests = validCatalogInterests(normalized.interests)
    const catalogOrder = new Map(this.catalog.map((profile, index) => [profile.iata, index]))
    const sorted = selected.selections.sort((left, right) => sortSelections(left, right, interests, accessibility.directCodes, catalogOrder))
    const candidates = sorted
      .slice(0, Math.max(normalized.limit, sorted.filter(item => item.required).length))
      .map(selection => buildCandidate(selection, interests, accessibility.directCodes.has(selection.key)))
    const result: DestinationDiscoveryResult = {
      candidates,
      serviceVersion: DESTINATION_DISCOVERY_SERVICE_VERSION,
      verification: baseVerification(),
      warnings: uniqueWarnings([
        'destination_catalog_is_curated_and_not_globally_complete',
        ...selected.warnings,
        ...accessibility.warnings
      ])
    }
    return destinationDiscoveryResultSchema.parse(result)
  }
}

export function createDestinationDiscoveryService(
  options?: CatalogDestinationDiscoveryOptions | AviationProvider
): CatalogDestinationDiscoveryService {
  return new CatalogDestinationDiscoveryService(options)
}
