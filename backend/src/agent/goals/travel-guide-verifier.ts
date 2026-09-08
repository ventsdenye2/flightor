import type { ArtifactRecord } from '../../artifacts/repository.js'
import type { LocationRef } from '../../aviation/types.js'
import { researchArtifactSchema, type ResearchArtifact } from '../../research-agent/types.js'
import { researchTravelWindow } from '../../research-agent/workspace.js'
import { tripRoutePlanPayloadSchema } from '../../trip-planning/types.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { cityGroupingIdentity, locationsOverlap } from '../../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../../locations/curated-directory.js'
import { travelGuideGoalParametersSchema, type GoalRecord } from './types.js'
import type { GoalVerification, GoalVerificationContext, GoalVerifier } from './verifier.js'
import { currentContextFailure, currentEvidenceStatus, goalArtifacts, hasCurrentArtifactScope, selectVerification, verificationResult } from './artifact-verification.js'

const overlaps = (left: LocationRef, right: LocationRef) => locationsOverlap(left, right, CURATED_LOCATION_IDENTITY_POLICY)

function coversWindow(actual: ResearchArtifact['brief']['travelWindow'], expected: ResearchArtifact['brief']['travelWindow']): boolean {
  return (!expected?.from || (actual?.from !== undefined && actual.from <= expected.from))
    && (!expected?.to || (actual?.to !== undefined && actual.to >= expected.to))
}

async function verifyGuide(record: ArtifactRecord, goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
  const parsed = travelGuideArtifactPayloadSchema.safeParse(record.payload)
  if (record.schemaVersion !== 1 || !parsed.success) return verificationResult('failed', ['travel_guide_payload'])
  const guide = parsed.data
  const parameters = travelGuideGoalParametersSchema.parse(goal.parameters)
  const trip = context.run.contextSnapshot
  const sourceIds = new Set([...guide.sourceArtifactIds, ...(record.sourceArtifactIds ?? [])])
  if (!guide.sourceArtifactIds.includes(guide.routeArtifactId) || !record.sourceArtifactIds?.includes(guide.routeArtifactId)) {
    return verificationResult('failed', ['guide_source_lineage'])
  }
  const sources = new Map<string, ArtifactRecord>()
  const loaded = await Promise.all([...sourceIds].map(id => context.artifacts.get(id)))
  if (loaded.some(source => !source || !hasCurrentArtifactScope(source, context))) return verificationResult('failed', ['guide_source_scope'])
  for (const source of loaded) if (source) sources.set(source.id, source)
  const routeRecord = sources.get(guide.routeArtifactId)
  const route = tripRoutePlanPayloadSchema.safeParse(routeRecord?.payload)
  if (routeRecord?.type !== 'route' || routeRecord.schemaVersion !== 1 || !route.success
    || route.data.tripContextVersion !== context.run.contextVersion) return verificationResult('failed', ['guide_route_payload'])
  if (route.data.sourceArtifactIds.some(id => !sourceIds.has(id) || !routeRecord.sourceArtifactIds?.includes(id))) {
    return verificationResult('failed', ['guide_source_lineage'])
  }

  const missing: string[] = []
  const warnings: string[] = []
  const expectedDays = trip.travelDays ?? route.data.days.length
  const dayNumbers = new Set(guide.days.map(day => day.day))
  if (guide.days.length !== expectedDays || dayNumbers.size !== expectedDays
    || Array.from({ length: expectedDays }, (_, index) => index + 1).some(day => !dayNumbers.has(day))) missing.push('guide_day_coverage')
  if (guide.days.length !== route.data.days.length || guide.days.some(day => {
    const routeDay = route.data.days.find(candidate => candidate.day === day.day)
    return !routeDay || !overlaps(day.city, routeDay.city)
  })) missing.push('guide_route_day_mismatch')
  if (guide.days.some(day => day.items.length === 0)) missing.push('guide_daily_activity_coverage')

  const cities = guide.days.map(day => day.city)
  const required = [...trip.destinationIntent.required, ...trip.locationRoleOverrides.filter(value => value.role === 'visit').map(value => value.location)]
  const excluded = [...trip.destinationIntent.excluded, ...trip.locationRoleOverrides.filter(value => value.role === 'avoid' || value.role === 'stopover_only').map(value => value.location)]
  if (required.some(location => !cities.some(city => overlaps(location, city)))) missing.push('guide_required_city_coverage')
  if (cities.some(city => excluded.some(location => overlaps(location, city)))) missing.push('guide_excluded_city')
  if (new Set(cities.map(city => cityGroupingIdentity(city, CURATED_LOCATION_IDENTITY_POLICY))).size > parameters.maxCities) missing.push('guide_city_limit')
  if (guide.unassignedActivityRefs.length > 0 || route.data.unassignedActivityRefs.length > 0
    || trip.mustIncludeEvents.some(event => !route.data.days.some(day => day.activityRefs.some(activity => activity.id === event.id)))) missing.push('guide_required_activity_coverage')

  const research = new Map<string, ResearchArtifact>()
  const expectedWindow = researchTravelWindow(trip)
  const usedFindings = new Set<string>()
  const coveredTypes = new Set<string>()
  let partialEvidence = false
  for (const day of guide.days) {
    let eligibleItems = 0
    for (const item of day.items) {
      if (!overlaps(item.city, day.city) || !guide.sourceArtifactIds.includes(item.sourceArtifactId)
        || !record.sourceArtifactIds?.includes(item.sourceArtifactId)) return verificationResult('failed', ['guide_item_lineage'])
      let source = research.get(item.sourceArtifactId)
      if (!source) {
        const sourceRecord = sources.get(item.sourceArtifactId)
        const parsedSource = researchArtifactSchema.safeParse(sourceRecord?.payload)
        if (sourceRecord?.type !== 'research' || sourceRecord.schemaVersion !== 2 || !parsedSource.success || parsedSource.data.id !== sourceRecord.id) {
          return verificationResult('failed', ['guide_research_payload'])
        }
        source = parsedSource.data
        research.set(item.sourceArtifactId, source)
        if (!coversWindow(source.brief.travelWindow, expectedWindow)) missing.push('research_travel_window')
      }
      const finding = source.findings.find(candidate => candidate.id === item.sourceFindingId)
      if (!finding || finding.title !== item.title || finding.summary !== item.description || finding.category !== item.category
        || !source.brief.researchTypes.includes(finding.category)
        || !finding.destinations.some(destination => overlaps(destination, day.city))
        || !source.brief.destinations.some(destination => overlaps(destination, day.city))
        || JSON.stringify(finding.verification) !== JSON.stringify(item.verification)) return verificationResult('failed', ['guide_item_evidence_mismatch'])
      const reference = `${item.sourceArtifactId}:${item.sourceFindingId}`
      if (usedFindings.has(reference)) return verificationResult('failed', ['guide_duplicate_evidence'])
      usedFindings.add(reference)
      const status = currentEvidenceStatus(finding.verification, context)
      const evidenceReferences = finding.verification.sources.map(value => value.reference)
      if (evidenceReferences.length === 0 || evidenceReferences.some(value => !value || !finding.sources.some(candidate => candidate.url === value))) {
        return verificationResult('failed', ['guide_evidence_source_mismatch'])
      }
      if (status === 'unverified' || status === 'stale') {
        missing.push('eligible_research_evidence')
        continue
      }
      eligibleItems += 1
      coveredTypes.add(finding.category)
      partialEvidence ||= status === 'partially_verified'
    }
    if (eligibleItems === 0) missing.push('guide_daily_activity_coverage')
  }
  if (usedFindings.size > parameters.maxResults) missing.push('guide_result_limit')
  for (const category of parameters.researchTypes) if (!coveredTypes.has(category)) missing.push(`guide_research_type:${category}`)
  if (partialEvidence) {
    warnings.push('evidence_partially_verified')
    if (!parameters.allowPartial) missing.push('verified_evidence')
  }
  // allowPartial concerns evidence quality, never missing days or unmet explicit Trip constraints.
  return verificationResult(missing.length === 0 ? 'satisfied' : 'partial', missing, [record.id], warnings)
}

export class TravelGuideGoalVerifier implements GoalVerifier {
  readonly kind = 'travel_guide' as const

  async verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
    const contextFailure = currentContextFailure(context)
    if (contextFailure) return contextFailure
    if (!travelGuideGoalParametersSchema.safeParse(goal.parameters).success) return verificationResult('failed', ['goal_parameters'])
    const records = await goalArtifacts(goal, context, 'travel_guide')
    return selectVerification(await Promise.all(records.map(record => verifyGuide(record, goal, context))), 'travel_guide_artifact')
  }
}
