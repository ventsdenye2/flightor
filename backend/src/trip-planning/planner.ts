import { type LocationRef, type VerificationRecord } from '../aviation/types.js'
import { tripDurationDays } from '../trips/dates.js'
import { cityGroupingIdentity } from '../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../locations/curated-directory.js'
import {
  destinationCandidateSchema,
  type DestinationCandidate as TypedDestinationCandidate
} from '../destinations/types.js'
import {
  tripRoutePlanInputSchema,
  tripRoutePlanResultSchema,
  type TripRoutePlanInput,
  type TripRoutePlanResult,
  type TripRoutePlanner,
  type TripRoutePlannerContext
} from './types.js'

/** Stable version for the deterministic trip-structure planner. */
export const TRIP_ROUTE_PLANNER_VERSION = 'trip-route-planner-phase4b-v1'

const DEFAULT_MAX_CITIES = 6
const CATALOG_VERIFICATION_RANK = {
  verified: 0,
  partially_verified: 1,
  stale: 2,
  unverified: 3
} as const

type Candidate = TypedDestinationCandidate

function locationIdentity(value: LocationRef): string {
  return cityGroupingIdentity(value, CURATED_LOCATION_IDENTITY_POLICY)
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return locationIdentity(left) === locationIdentity(right)
}

function uniqueLocations(values: readonly LocationRef[]): LocationRef[] {
  const seen = new Set<string>()
  const result: LocationRef[] = []
  for (const value of values) {
    const key = locationIdentity(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

function requiredLocations(input: TripRoutePlanInput): LocationRef[] {
  const overrides = input.tripContext.locationRoleOverrides
    .filter(item => item.role === 'visit')
    .map(item => item.location)
  return uniqueLocations([...input.tripContext.destinationIntent.required, ...overrides])
}

function excludedLocations(input: TripRoutePlanInput): LocationRef[] {
  const overrides = input.tripContext.locationRoleOverrides
    .filter(item => item.role === 'avoid')
    .map(item => item.location)
  return uniqueLocations([...input.tripContext.destinationIntent.excluded, ...overrides])
}

function stopoverOnlyLocations(input: TripRoutePlanInput, excluded: readonly LocationRef[]): LocationRef[] {
  const excludedKeys = new Set(excluded.map(locationIdentity))
  return uniqueLocations(input.tripContext.locationRoleOverrides
    .filter(item => item.role === 'stopover_only')
    .map(item => item.location))
    .filter(location => !excludedKeys.has(locationIdentity(location)))
}

function verificationFor(candidates: readonly Candidate[]): VerificationRecord {
  if (candidates.length === 0) {
    return {
      status: 'unverified',
      checkedAt: '1970-01-01T00:00:00.000Z',
      confidence: 0,
      sources: [{ provider: 'trip-route-planner' }]
    }
  }
  let status: VerificationRecord['status'] = 'verified'
  let confidence = 1
  const checkedAt = [...candidates].map(candidate => candidate.verification.checkedAt).sort()[0] ?? '1970-01-01T00:00:00.000Z'
  const sources = new Map<string, { provider: string; reference?: string }>()
  for (const candidate of candidates) {
    if (CATALOG_VERIFICATION_RANK[candidate.verification.status] > CATALOG_VERIFICATION_RANK[status]) status = candidate.verification.status
    confidence = Math.min(confidence, candidate.verification.confidence)
    for (const source of candidate.verification.sources) {
      const key = `${source.provider}|${source.reference ?? ''}`
      if (!sources.has(key)) {
        sources.set(key, source.reference === undefined
          ? { provider: source.provider }
          : { provider: source.provider, reference: source.reference })
      }
    }
  }
  return {
    status,
    checkedAt,
    confidence,
    sources: [...sources.values()]
      .sort((left, right) => `${left.provider}|${left.reference ?? ''}`.localeCompare(`${right.provider}|${right.reference ?? ''}`))
      .slice(0, 20)
  }
}

function candidateReason(candidate: Candidate, required: boolean, preferred: boolean): string[] {
  const reasons = [...candidate.reasons]
  if (required) reasons.unshift('required or visit override from the active trip')
  else if (preferred) reasons.unshift('selected from the active trip preference set')
  return uniqueStrings(reasons).slice(0, 12)
}

function activityRefs(input: TripRoutePlanInput): TripRoutePlanResult['unassignedActivityRefs'] {
  return input.tripContext.mustIncludeEvents.map(event => ({ id: event.id, title: event.title, reason: 'user_requested' as const }))
}

function assertNotAborted(context?: TripRoutePlannerContext): void {
  if (context?.signal?.aborted) throw new Error('Trip route planning aborted')
}

interface SelectedCandidate {
  candidate: Candidate
  required: boolean
  preferred: boolean
}

function selectCandidates(input: TripRoutePlanInput, excluded: readonly LocationRef[]): { selected: SelectedCandidate[]; stopoverOnly: LocationRef[]; warnings: string[] } {
  const required = requiredLocations(input)
  const excludedKeys = new Set(excluded.map(locationIdentity))
  const requiredKeys = new Set(required.map(locationIdentity))
  if (required.some(location => excludedKeys.has(locationIdentity(location)))) {
    throw new Error('Required destination is excluded by the active trip')
  }

  const byKey = new Map<string, Candidate>()
  for (const raw of input.candidates) {
    const candidate = destinationCandidateSchema.parse(raw)
    const key = locationIdentity(candidate.location)
    if (excludedKeys.has(key)) continue
    // A candidate artifact may contain duplicate airport aliases.  Keep the
    // first supplied record; the source artifact order is deterministic and
    // no alternate facts may be invented here.
    if (!byKey.has(key)) byKey.set(key, candidate)
  }

  const selected: SelectedCandidate[] = []
  for (const location of required) {
    const candidate = byKey.get(locationIdentity(location))
    if (!candidate) throw new Error('Required destination candidate was not supplied')
    if (!selected.some(item => locationIdentity(item.candidate.location) === locationIdentity(candidate.location))) {
      selected.push({ candidate, required: true, preferred: false })
    }
  }

  const stopoverOnly = stopoverOnlyLocations(input, excluded)
  const stopoverOnlyKeys = new Set(stopoverOnly.map(locationIdentity))
  const preferredKeys = new Set(input.tripContext.destinationIntent.preferred.map(locationIdentity))
  const optional = [...byKey.values()]
    .filter(candidate => {
      const key = locationIdentity(candidate.location)
      // A hard required/visit location wins if malformed/legacy state carries
      // both roles.  Otherwise stopover_only remains visible only in the
      // stopoverOnly seam and never receives visit days.
      return !requiredKeys.has(key) && !stopoverOnlyKeys.has(key)
    })
    .sort((left, right) => {
      const leftPreferred = preferredKeys.has(locationIdentity(left.location)) ? 1 : 0
      const rightPreferred = preferredKeys.has(locationIdentity(right.location)) ? 1 : 0
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred
      if (left.score !== right.score) return right.score - left.score
      if (left.minStayDays !== right.minStayDays) return left.minStayDays - right.minStayDays
      return locationIdentity(left.location).localeCompare(locationIdentity(right.location))
    })

  const maxCities = input.maxCities ?? DEFAULT_MAX_CITIES
  if (selected.length > maxCities) throw new Error('Required destinations exceed maxCities')
  const travelDays = input.tripContext.travelDays
  // The frozen result schema is bounded to 60 days even when the trip has no
  // declared duration.  Use that schema bound only for candidate selection;
  // an undeclared trip still receives its minimum stays rather than invented
  // extra days.
  const dayCapacity = travelDays ?? 60
  const requiredDays = selected.reduce((total, item) => total + item.candidate.minStayDays, 0)
  if (requiredDays > dayCapacity) throw new Error('Required destination minimum stays exceed travelDays')

  let usedDays = requiredDays
  for (const candidate of optional) {
    if (selected.length >= maxCities) break
    if (usedDays + candidate.minStayDays > dayCapacity) continue
    selected.push({
      candidate,
      required: false,
      preferred: preferredKeys.has(locationIdentity(candidate.location))
    })
    usedDays += candidate.minStayDays
  }

  const warnings: string[] = []
  const optionalDropped = optional.some(candidate => !selected.some(item => sameLocation(item.candidate.location, candidate.location)))
  if (optionalDropped) {
    warnings.push(travelDays === undefined
      ? 'optional_cities_dropped_to_fit_planner_bounds'
      : 'optional_cities_dropped_to_fit_travel_days')
  }
  if (selected.length === 0) throw new Error('No visit destinations remain after applying trip constraints')
  if (stopoverOnly.length > 0) warnings.push('stopover_only_locations_not_allocated_days')
  return { selected, stopoverOnly, warnings }
}

function allocateStayDays(selected: readonly SelectedCandidate[], travelDays: number | undefined): number[] {
  const stays = selected.map(item => item.candidate.minStayDays)
  if (travelDays === undefined) return stays
  let remaining = travelDays - stays.reduce((sum, value) => sum + value, 0)
  let index = 0
  // Round-robin allocation avoids silently inventing a city preference for
  // extra days while remaining fully stable for the same candidate order.
  while (remaining > 0 && stays.length > 0) {
    stays[index % stays.length] = (stays[index % stays.length] ?? 0) + 1
    index += 1
    remaining -= 1
  }
  return stays
}

function buildDays(selected: readonly SelectedCandidate[], stays: readonly number[], context: TripRoutePlannerContext | undefined): TripRoutePlanResult['days'] {
  const days: TripRoutePlanResult['days'] = []
  let day = 1
  for (let cityIndex = 0; cityIndex < selected.length; cityIndex += 1) {
    const item = selected[cityIndex]!
    const stay = stays[cityIndex] ?? 0
    for (let offset = 0; offset < stay; offset += 1) {
      assertNotAborted(context)
      days.push({ day, city: item.candidate.location, activityRefs: [] })
      day += 1
    }
  }
  return days
}

function cityResults(selected: readonly SelectedCandidate[], stays: readonly number[]): TripRoutePlanResult['cities'] {
  return selected.map((item, index) => ({
    location: item.candidate.location,
    stayDays: stays[index] ?? item.candidate.minStayDays,
    role: 'visit' as const,
    reasons: candidateReason(item.candidate, item.required, item.preferred)
  }))
}

export class DeterministicTripRoutePlanner implements TripRoutePlanner {
  async plan(input: TripRoutePlanInput, context?: TripRoutePlannerContext): Promise<TripRoutePlanResult> {
    const normalized = tripRoutePlanInputSchema.parse(input)
    const duration = tripDurationDays(normalized.tripContext)
    if (duration !== undefined) normalized.tripContext = tripRoutePlanInputSchema.shape.tripContext.parse({ ...normalized.tripContext, travelDays: duration })
    assertNotAborted(context)
    const excluded = excludedLocations(normalized)
    const selection = selectCandidates(normalized, excluded)
    assertNotAborted(context)
    const stays = allocateStayDays(selection.selected, normalized.tripContext.travelDays)
    const days = buildDays(selection.selected, stays, context)
    assertNotAborted(context)
    const unassignedActivityRefs = activityRefs(normalized)
    const warnings = uniqueStrings([
      'land_transfers_unresolved',
      ...selection.warnings,
      ...(unassignedActivityRefs.length > 0 ? ['must_include_events_unassigned'] : []),
      ...(normalized.tripContext.travelDays === undefined ? ['travel_days_not_declared'] : [])
    ]).slice(0, 30)
    const candidates = selection.selected.map(item => item.candidate)
    const result: TripRoutePlanResult = {
      plannerVersion: TRIP_ROUTE_PLANNER_VERSION,
      cities: cityResults(selection.selected, stays),
      days,
      stopoverOnly: selection.stopoverOnly,
      landTransfers: [],
      unassignedActivityRefs,
      verification: verificationFor(candidates),
      warnings
    }
    return tripRoutePlanResultSchema.parse(result)
  }
}

export function createTripRoutePlanner(): DeterministicTripRoutePlanner {
  return new DeterministicTripRoutePlanner()
}
