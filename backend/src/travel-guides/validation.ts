import type { LocationRef } from '../aviation/types.js'
import { cityGroupingIdentity, locationsOverlap } from '../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../locations/curated-directory.js'
import type { ResearchArtifact } from '../research-agent/types.js'
import { tripDatesConsistent, tripDurationDays, tripTravelWindow } from '../trips/dates.js'
import type { TripRoutePlanPayload } from '../trip-planning/types.js'
import type { TripContext } from '../trips/types.js'
import type { TravelGuideArtifactPayload } from './artifact.js'

export interface TravelGuideConstraints {
  maxResults: number
  maxCities: number
  researchTypes: ResearchArtifact['brief']['researchTypes']
  allowPartial: boolean
  allowRestDays?: boolean | undefined
}

export interface GuideContentValidation {
  status: 'satisfied' | 'partial' | 'failed'
  missing: string[]
  warnings: string[]
  details?: Array<{
    code: string; day?: number; sourceFindingId?: string; fieldPath?: string; affectedDays?: number[];
    category?: string; location?: string; date?: string; blockedChecks?: string[]
  }>
}

const overlaps = (left: LocationRef, right: LocationRef) => locationsOverlap(left, right, CURATED_LOCATION_IDENTITY_POLICY)

function coversWindow(actual: ResearchArtifact['brief']['travelWindow'], expected: ResearchArtifact['brief']['travelWindow']): boolean {
  return (!expected?.from || (actual?.from !== undefined && actual.from <= expected.from))
    && (!expected?.to || (actual?.to !== undefined && actual.to >= expected.to))
}

/** Shared pre-save and delivery check. Reads facts only; never plans, searches or writes. */
export function validateGuideContent(input: {
  guide: TravelGuideArtifactPayload
  route: TripRoutePlanPayload
  research: ReadonlyMap<string, ResearchArtifact>
  trip: TripContext
  constraints: TravelGuideConstraints
  now?: string
}): GuideContentValidation {
  const { guide, route, research, trip, constraints } = input
  const missing: string[] = []
  const warnings: string[] = []
  const details: NonNullable<GuideContentValidation['details']> = []
  let invalid = false
  const reject = (code: string, detail?: Omit<NonNullable<GuideContentValidation['details']>[number], 'code'>) => {
    invalid = true
    missing.push(code)
    if (detail) details.push({ code, ...detail })
  }
  const datesConsistent = tripDatesConsistent(trip)
  if (!datesConsistent) reject('trip_dates_inconsistent', { fieldPath: 'trip.dates', blockedChecks: ['research_travel_window', 'guide_day_coverage'] })
  // Old persisted v1 guides remain readable. New authored guides must carry the server budget snapshot.
  if (guide.budget || (guide.builderVersion === 'agent-authored-guide-v2' && trip.budget)) {
    if (!trip.budget || !guide.budget || guide.budget.amount !== trip.budget.amount
      || guide.budget.currency !== trip.budget.currency || guide.budget.scope !== trip.budget.scope
      || guide.budget.partyBasis !== 'unspecified' || guide.budget.period !== 'trip_total') {
      reject('guide_budget_mismatch', { fieldPath: 'budget' })
    }
  }
  const expectedDays = (datesConsistent ? tripDurationDays(trip) : undefined) ?? route.days.length
  const dayNumbers = new Set(guide.days.map(day => day.day))
  if (guide.days.length !== expectedDays || dayNumbers.size !== expectedDays
    || guide.days.some((day, index) => day.day !== index + 1)) missing.push('guide_day_coverage')
  if (guide.days.length !== route.days.length || guide.days.some(day => {
    const routeDay = route.days.find(candidate => candidate.day === day.day)
    return !routeDay || !overlaps(day.city, routeDay.city)
  })) missing.push('guide_route_day_mismatch')
  if (guide.flightSelection) {
    if (!guide.sourceArtifactIds.includes(guide.flightSelection.artifactId)) missing.push('guide_flight_selection_lineage')
    const start = trip.departureWindow?.from
    const arrival = guide.flightSelection.destinationArrivalAt
    if (start && arrival && /^\d{4}-\d{2}-\d{2}/.test(arrival)) {
      const arrivalDay = Math.floor((Date.parse(`${arrival.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
      for (const day of guide.days) {
        if (day.day < arrivalDay && (day.kind !== 'travel' || day.items.length > 0)) missing.push('guide_before_flight_arrival')
        if (day.day === arrivalDay) {
          const hour = Number(arrival.slice(11, 13))
          const blocked = hour >= 15 ? ['morning', 'afternoon'] : hour >= 10 ? ['morning'] : []
          if (day.items.some(item => item.timeOfDay && blocked.includes(item.timeOfDay))) missing.push('guide_arrival_day_time_conflict')
        }
      }
    }
    const departure = guide.flightSelection.destinationDepartureAt
    if (start && departure && /^\d{4}-\d{2}-\d{2}/.test(departure)) {
      const departureDay = Math.floor((Date.parse(`${departure.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
      const hour = Number(departure.slice(11, 13))
      const blocked = hour < 12 ? ['morning', 'afternoon', 'evening'] : hour < 18 ? ['afternoon', 'evening'] : ['evening']
      const day = guide.days.find(value => value.day === departureDay)
      if (day?.items.some(item => item.timeOfDay && blocked.includes(item.timeOfDay))) missing.push('guide_departure_day_time_conflict')
    }
    warnings.push('flight_schedule_uses_coarse_time_slots')
  }

  const cities = guide.days.map(day => day.city)
  const required = [...trip.destinationIntent.required, ...trip.locationRoleOverrides.filter(value => value.role === 'visit').map(value => value.location)]
  const excluded = [...trip.destinationIntent.excluded, ...trip.locationRoleOverrides.filter(value => value.role === 'avoid' || value.role === 'stopover_only').map(value => value.location)]
  if (required.some(location => !cities.some(city => overlaps(location, city)))) missing.push('guide_required_city_coverage')
  if (cities.some(city => excluded.some(location => overlaps(location, city)))) missing.push('guide_excluded_city')
  if (new Set(cities.map(city => cityGroupingIdentity(city, CURATED_LOCATION_IDENTITY_POLICY))).size > constraints.maxCities) missing.push('guide_city_limit')
  if (guide.unassignedActivityRefs.length > 0 || route.unassignedActivityRefs.length > 0
    || trip.mustIncludeEvents.some(event => !route.days.some(day => day.activityRefs.some(activity => activity.id === event.id)))) missing.push('guide_required_activity_coverage')

  const expectedWindow = datesConsistent ? tripTravelWindow(trip) : undefined
  const usedFindings = new Set<string>()
  const checkedResearch = new Set<string>()
  const coveredTypes = new Set<string>()
  let partialEvidence = false
  const now = Date.parse(input.now ?? new Date().toISOString())
  type Evidence = TravelGuideArtifactPayload['days'][number]['items'][number]
    | NonNullable<TravelGuideArtifactPayload['supportingEvidence']>[number]
  const checkEvidence = (item: Evidence, destinations: LocationRef[], fieldPath: string, day?: number): boolean => {
      const detail = { fieldPath, sourceFindingId: item.sourceFindingId, ...(day === undefined ? {} : { day, affectedDays: [day] }) }
      if (!guide.sourceArtifactIds.includes(item.sourceArtifactId)) reject('guide_item_lineage', detail)
      const source = research.get(item.sourceArtifactId)
      if (!source || source.id !== item.sourceArtifactId) {
        reject('guide_research_payload', { ...detail, blockedChecks: ['guide_item_evidence_mismatch', 'guide_evidence_source_mismatch', 'eligible_research_evidence'] })
        return false
      }
      if (!checkedResearch.has(source.id)) {
        checkedResearch.add(source.id)
        if (datesConsistent && !coversWindow(source.brief.travelWindow, expectedWindow)) {
          missing.push('research_travel_window')
          details.push({ code: 'research_travel_window', ...detail, ...(expectedWindow?.from ? { date: expectedWindow.from } : {}) })
        }
      }
      const matchingFindings = source.findings.filter(candidate => candidate.id === item.sourceFindingId)
      if (matchingFindings.length > 1) {
        reject('guide_ambiguous_finding', { ...detail, blockedChecks: ['guide_item_evidence_mismatch', 'eligible_research_evidence'] })
        return false
      }
      const finding = matchingFindings[0]
      // Facts remain source-owned. The separate planningNote/theme fields are recommendations.
      if (!finding || finding.title !== item.title || finding.summary !== item.description || finding.category !== item.category
        || !source.brief.researchTypes.includes(finding.category)
        || !destinations.some(city => finding.destinations.some(destination => overlaps(destination, city))
          && source.brief.destinations.some(destination => overlaps(destination, city)))
        || ('destinations' in item && JSON.stringify(item.destinations) !== JSON.stringify(finding.destinations))
        || JSON.stringify(finding.verification) !== JSON.stringify(item.verification)) {
        reject('guide_item_evidence_mismatch', detail)
        return false
      }
      const reference = `${item.sourceArtifactId}:${item.sourceFindingId}`
      if (usedFindings.has(reference)) {
        reject('guide_duplicate_evidence', detail)
        // It is selected content, though invalid duplication. Avoid a misleading empty-day diagnosis.
        return true
      }
      usedFindings.add(reference)
      const status = finding.verification.expiresAt && Date.parse(finding.verification.expiresAt) <= now ? 'stale' : finding.verification.status
      const evidenceReferences = finding.verification.sources.map(value => value.reference)
      if (evidenceReferences.length === 0 || evidenceReferences.some(value => !value || !finding.sources.some(candidate => candidate.url === value))) {
        reject('guide_evidence_source_mismatch', detail)
        return false
      }
      if (status === 'unverified' || status === 'stale') {
        missing.push('eligible_research_evidence')
        details.push({ code: 'eligible_research_evidence', ...detail, category: finding.category,
          ...(finding.destinations[0] ? { location: finding.destinations[0].id } : {}) })
        return false
      }
      coveredTypes.add(finding.category)
      partialEvidence ||= status === 'partially_verified'
      return true
  }
  for (const [dayIndex, day] of guide.days.entries()) {
    let eligibleItems = 0
    for (const [itemIndex, item] of day.items.entries()) {
      const fieldPath = `days.${dayIndex}.items.${itemIndex}`
      if (!overlaps(item.city, day.city)) reject('guide_item_lineage', { day: day.day, sourceFindingId: item.sourceFindingId, fieldPath })
      if (checkEvidence(item, [day.city], fieldPath, day.day)) eligibleItems += 1
    }
    // Existing guides retain their coverage contract. An authored non-visit day needs an explicit plan.
    const intentionalBreak = constraints.allowRestDays === true && guide.composition === 'agent_authored'
      && (day.kind === 'rest' || day.kind === 'travel') && Boolean(day.notes?.trim())
    if (eligibleItems === 0 && !intentionalBreak) missing.push('guide_daily_activity_coverage')
  }
  for (const [index, evidence] of (guide.supportingEvidence ?? []).entries()) {
    checkEvidence(evidence, cities, `supportingEvidence.${index}`)
  }
  if (usedFindings.size > constraints.maxResults) missing.push('guide_result_limit')
  for (const category of constraints.researchTypes) if (!coveredTypes.has(category)) {
    missing.push(`guide_research_type:${category}`)
    details.push({ code: `guide_research_type:${category}`, category })
  }
  if (partialEvidence) {
    warnings.push('evidence_partially_verified')
    if (!constraints.allowPartial) missing.push('verified_evidence')
  }
  return { status: invalid ? 'failed' : missing.length === 0 ? 'satisfied' : 'partial', missing: [...new Set(missing)], warnings,
    ...(details.length ? { details } : {}) }
}
