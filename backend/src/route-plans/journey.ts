import {
  DESTINATION_PROFILES,
  getCanonicalDestinationIata,
  getDestinationProfile,
  recommendDestinations,
  type DestinationInterest,
  type DestinationProfile,
  type DestinationRegion
} from '../destinations/catalog.js'
import {
  convergeRoutes,
  ORIGINS,
  searchRoutes,
  type CityMeta,
  type RoutePick,
  type RouteResult,
  type RouteSlots
} from './engine.js'

/** Input contract for deterministic, directory-backed cross-region planning. */
export interface JourneyPlanInput {
  /** A supported origin IATA, or its explicit city name (for example SZX/深圳). */
  origin: string
  windowFrom: string
  windowTo: string
  travelDays: number
  regions: readonly DestinationRegion[]
  requiredIatas: readonly string[]
  excludedIatas: readonly string[]
  interests: readonly DestinationInterest[]
  budgetMax: number | null
  cityTarget: number | null
  overnightPref: boolean
  directOnly: boolean
}

const ALL_REGIONS: readonly DestinationRegion[] = ['japan', 'schengen', 'visa_free']

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function normalizeOrigin(value: string): CityMeta | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const upper = trimmed.toUpperCase()
  const byIata = ORIGINS.find(origin => origin.iata === upper)
  if (byIata) return byIata
  const lower = trimmed.toLowerCase()
  return ORIGINS.find(origin => origin.city === trimmed || origin.enCity.toLowerCase() === lower)
}

function canonicalForProfile(profile: DestinationProfile): string {
  return profile.canonicalIata ?? profile.iata
}

function profileToCity(profile: DestinationProfile): CityMeta {
  return {
    iata: profile.iata,
    city: profile.cityZh,
    enCity: profile.cityEn,
    country: profile.countryCode,
    lat: profile.lat,
    lng: profile.lon
  }
}

function uniqueRegions(input: readonly DestinationRegion[]): DestinationRegion[] {
  const seen = new Set<DestinationRegion>()
  const result: DestinationRegion[] = []
  for (const region of input) {
    if (!ALL_REGIONS.includes(region) || seen.has(region)) continue
    seen.add(region)
    result.push(region)
  }
  return result
}

interface RegionSelection {
  regions: DestinationRegion[]
  /** True only when the caller supplied an explicit region order. */
  explicit: boolean
}

function selectDefaultRegions(input: JourneyPlanInput, excluded: Set<string>): RegionSelection {
  const explicit = uniqueRegions(input.regions ?? [])
  if (explicit.length > 0) return { regions: explicit, explicit: true }

  // Explicit required airport codes are stronger evidence than a generic
  // recommendation.  Preserve their first-seen region order if they span
  // more than one region, but never add an unrelated third region.
  const requiredRegions: DestinationRegion[] = []
  const requiredSeen = new Set<DestinationRegion>()
  for (const raw of input.requiredIatas) {
    const profile = getDestinationProfile(raw)
    if (!profile || excluded.has(canonicalForProfile(profile)) || requiredSeen.has(profile.region)) continue
    requiredSeen.add(profile.region)
    requiredRegions.push(profile.region)
  }
  if (requiredRegions.length > 0) return { regions: requiredRegions, explicit: false }

  // With no region constraint, ask the same directory ranking used by the
  // recommendation cards for one stable first choice.  This prevents a
  // generic recommendation request from silently becoming a three-region
  // itinerary.  The fallback is only a deterministic safety net for a future
  // empty/fully-excluded directory.
  const preferred = recommendDestinations({
    interests: input.interests,
    excludedIatas: input.excludedIatas,
    limit: 1
  })[0]
  return { regions: [preferred?.region ?? 'japan'], explicit: false }
}

function uniqueProfilesByCity(profiles: readonly DestinationProfile[]): DestinationProfile[] {
  const seen = new Set<string>()
  const result: DestinationProfile[] = []
  for (const profile of profiles) {
    const key = canonicalForProfile(profile)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(profile)
  }
  return result
}

function normalizedRequiredProfiles(input: JourneyPlanInput, regions: readonly DestinationRegion[], excluded: Set<string>): DestinationProfile[] | null {
  const result: DestinationProfile[] = []
  const seen = new Set<string>()
  const regionSet = new Set(regions)
  for (const raw of input.requiredIatas) {
    const profile = getDestinationProfile(raw)
    // A required unknown, excluded, or out-of-scope destination makes the
    // hard-constrained plan unsatisfiable; never substitute a guessed city.
    if (!profile || !regionSet.has(profile.region)) return null
    const key = canonicalForProfile(profile)
    if (excluded.has(key)) return null
    if (seen.has(key)) continue
    seen.add(key)
    result.push(profile)
  }
  return result
}

function destinationCandidates(
  regions: readonly DestinationRegion[],
  interests: readonly DestinationInterest[],
  required: readonly DestinationProfile[],
  excluded: Set<string>
): DestinationProfile[] {
  const requiredByRegion = new Map<DestinationRegion, string[]>()
  for (const profile of required) {
    const current = requiredByRegion.get(profile.region) ?? []
    current.push(profile.iata)
    requiredByRegion.set(profile.region, current)
  }

  // Keep each selected region represented in the candidate beam.  Four per
  // region is enough for the existing DFS while avoiding a factorial explosion
  // when a user requests several continents/regions at once.
  const result: DestinationProfile[] = []
  const seen = new Set<string>()
  for (const region of regions) {
    const recommendations = recommendDestinations({
      regions: [region],
      interests,
      requiredIatas: requiredByRegion.get(region) ?? [],
      excludedIatas: [...excluded],
      limit: regions.length > 1 ? 4 : 8
    })
    for (const recommendation of recommendations) {
      const profile = getDestinationProfile(recommendation.iata)
      if (!profile) continue
      const key = canonicalForProfile(profile)
      if (excluded.has(key) || seen.has(key)) continue
      seen.add(key)
      result.push(profile)
    }
  }

  // Required profiles are always retained even if a future recommendation
  // limit or directory ranking changes.
  for (const profile of required) {
    const key = canonicalForProfile(profile)
    if (excluded.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(profile)
  }
  return result
}

function haversineKm(origin: CityMeta, profile: DestinationProfile): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(profile.lat - origin.lat)
  const dLon = toRad(profile.lon - origin.lng)
  const lat1 = toRad(origin.lat)
  const lat2 = toRad(profile.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6_371 * 2 * Math.asin(Math.sqrt(h))
}

/** Put closer region anchors first, which yields Asia → Europe for China origins. */
function orderRegions(regions: readonly DestinationRegion[], origin: CityMeta): DestinationRegion[] {
  const firstAnchor = new Map<DestinationRegion, number>()
  for (const region of regions) {
    const anchor = DESTINATION_PROFILES
      .filter(profile => profile.region === region && !profile.canonicalIata)
      .map(profile => haversineKm(origin, profile))
      .sort((left, right) => left - right)[0]
    firstAnchor.set(region, anchor ?? Number.MAX_SAFE_INTEGER)
  }
  return [...regions].sort((left, right) => {
    const distance = (firstAnchor.get(left) ?? Number.MAX_SAFE_INTEGER) - (firstAnchor.get(right) ?? Number.MAX_SAFE_INTEGER)
    return distance || left.localeCompare(right)
  })
}

function maxCitiesFor(input: JourneyPlanInput, regionCount: number): number {
  const target = input.cityTarget && Number.isInteger(input.cityTarget) && input.cityTarget > 0
    ? input.cityTarget
    : Number.MAX_SAFE_INTEGER
  const dayBound = Math.max(0, input.travelDays - 1)
  let bound = Math.min(6, target, dayBound)
  if (regionCount > 1) {
    // Long-haul region changes consume transfer time.  In particular, a
    // seven-day Japan + Europe request is capped at three cities, rather than
    // filling every nominal day with another airport transfer.
    const conservative = input.travelDays <= 4
      ? 2
      : input.travelDays <= 7
        ? 3
        : input.travelDays <= 10
          ? 4
          : Math.min(6, Math.max(3, Math.floor(input.travelDays / 2)))
    bound = Math.min(bound, conservative)
  }
  return Math.max(0, bound)
}

function makeSlots(input: JourneyPlanInput, origin: CityMeta, regions: readonly DestinationRegion[], required: readonly DestinationProfile[]): RouteSlots {
  const region = regions.length === 1 ? regions[0]! : null
  return {
    origin: origin.iata,
    window_from: input.windowFrom,
    window_to: input.windowTo,
    travel_days: input.travelDays,
    region: region === 'schengen' || region === 'visa_free' ? region : null,
    visa: region === 'visa_free' ? 'none' : null,
    must_visit: required.map(profile => profile.iata),
    overnight_pref: input.overnightPref,
    direct_only: input.directOnly,
    budget_max: input.budgetMax && input.budgetMax > 0 ? input.budgetMax : null,
    city_target: input.cityTarget && input.cityTarget > 0 ? input.cityTarget : null
  }
}

function profileForRouteCity(iata: string): DestinationProfile | undefined {
  return getDestinationProfile(iata)
}

function routeRegionSequence(route: RouteResult): DestinationRegion[] {
  return route.cities
    .map(profileForRouteCity)
    .filter((profile): profile is DestinationProfile => profile !== undefined)
    .map(profile => profile.region)
}

function includesEveryRequestedRegion(route: RouteResult, regions: readonly DestinationRegion[]): boolean {
  const routeRegions = new Set(routeRegionSequence(route))
  return regions.every(region => routeRegions.has(region))
}

function hasContiguousRegionOrder(route: RouteResult, orderedRegions: readonly DestinationRegion[]): boolean {
  const sequence = routeRegionSequence(route)
  if (sequence.length === 0) return false
  const runs: DestinationRegion[] = []
  for (const region of sequence) {
    if (runs.at(-1) !== region) runs.push(region)
  }
  // Each region should form one run in the geography-first order.  This rules
  // out Japan → Europe → Japan and avoids sending a China-origin itinerary
  // west first and then back east when an Asia → Europe order is available.
  return runs.length === orderedRegions.length && runs.every((region, index) => region === orderedRegions[index])
}

function hasObviousLongitudeBacktrack(route: RouteResult): boolean {
  const profiles = route.cities.map(profileForRouteCity).filter((profile): profile is DestinationProfile => profile !== undefined)
  for (let index = 2; index < profiles.length; index += 1) {
    const previous = profiles[index - 2]!
    const current = profiles[index - 1]!
    const next = profiles[index]!
    if (previous.region !== current.region || current.region !== next.region) continue
    const firstDelta = current.lon - previous.lon
    const secondDelta = next.lon - current.lon
    if (Math.abs(firstDelta) >= 8 && Math.abs(secondDelta) >= 8 && Math.sign(firstDelta) !== Math.sign(secondDelta)) return true
  }
  return false
}

function filterRoutes(routes: readonly RouteResult[], regions: readonly DestinationRegion[], orderedRegions: readonly DestinationRegion[], maxCities: number): RouteResult[] {
  const valid = routes.filter(route => route.cities.length <= maxCities && includesEveryRequestedRegion(route, regions) && hasContiguousRegionOrder(route, orderedRegions))
  const nonBacktracking = valid.filter(route => !hasObviousLongitudeBacktrack(route))
  return nonBacktracking.length > 0 ? nonBacktracking : valid
}

/**
 * Plan at most three differentiated route picks with stable local estimates.
 * No model or provider is consulted here; confirmation remains a separate
 * operation handled by `confirmRoutePicks`.
 */
export function planJourney(input: JourneyPlanInput): RoutePick[] {
  if (!input || typeof input.origin !== 'string' || typeof input.windowFrom !== 'string' || typeof input.windowTo !== 'string') return []
  if (!isIsoDate(input.windowFrom) || !isIsoDate(input.windowTo) || input.windowFrom > input.windowTo) return []
  if (!Number.isInteger(input.travelDays) || input.travelDays < 3) return []
  if (input.budgetMax !== null && (!Number.isFinite(input.budgetMax) || input.budgetMax <= 0)) return []

  const origin = normalizeOrigin(input.origin)
  if (!origin) return []

  const excluded = new Set<string>()
  for (const raw of input.excludedIatas) {
    const canonical = getCanonicalDestinationIata(raw)
    if (canonical) excluded.add(canonical)
  }
  const regionSelection = selectDefaultRegions(input, excluded)
  const selectedRegions = regionSelection.regions
  const required = normalizedRequiredProfiles(input, selectedRegions, excluded)
  if (!required) return []

  const maxCities = maxCitiesFor(input, selectedRegions.length)
  const minimumCities = selectedRegions.length === 1 && required.length === 1 ? 1 : 2
  if (maxCities < minimumCities || required.length > maxCities) return []

  const orderedRegions = regionSelection.explicit || required.length > 1
    ? [...selectedRegions]
    : orderRegions(selectedRegions, origin)
  const candidateProfiles = destinationCandidates(orderedRegions, input.interests, required, excluded)
  const candidates = uniqueProfilesByCity(candidateProfiles)
    .filter(profile => !excluded.has(canonicalForProfile(profile)))
    .map(profileToCity)
  const minimumCandidates = selectedRegions.length === 1 && required.length === 1 ? 1 : 2
  if (candidates.length < minimumCandidates) return []

  const slots = makeSlots(input, origin, selectedRegions, required)
  // Keep the engine's stable DFS and pricing model; the candidate list is the
  // only extension needed for multi-region planning.
  const searched = searchRoutes(slots, {
    cities: candidates,
    allCities: candidates,
    poolSize: candidates.length,
    allowSingleCity: minimumCities === 1
  })
  const valid = filterRoutes(searched, selectedRegions, orderedRegions, maxCities)
  return convergeRoutes(valid).slice(0, 3)
}
