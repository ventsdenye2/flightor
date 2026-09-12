import { createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { checkpoint, loadWorkspaceArtifact, saveWorkspaceArtifact, type ArtifactWorkspace } from '../artifacts/workspace.js'
import type { LocationRef } from '../aviation/types.js'
import { AppError } from '../lib/errors.js'
import { cityGroupingIdentity } from '../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../locations/curated-directory.js'
import { locationIdSelectorSchema } from '../locations/selector.js'
import { researchArtifactSchema, type ResearchArtifact } from '../research-agent/types.js'
import { tripRoutePlanPayloadSchema } from '../trip-planning/types.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { aggregateGuideVerification } from './artifact-builder.js'
import { validateGuideContent, type TravelGuideConstraints, type GuideContentValidation } from './validation.js'

export const authoredGuideInputSchema = z.object({
  researchArtifactIds: z.array(z.string().uuid()).min(1).max(20),
  days: z.array(z.object({
    day: z.number().int().min(1).max(60),
    cityId: locationIdSelectorSchema,
    theme: z.string().trim().min(1).max(160),
    notes: z.string().trim().min(1).max(500).optional(),
    kind: z.enum(['visit', 'rest', 'travel']),
    items: z.array(z.object({
      researchIndex: z.number().int().min(0).max(19),
      findingId: z.string().min(1).max(160),
      timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'flexible']),
      planningNote: z.string().trim().min(1).max(500),
      requestedActivityIds: z.array(z.string().min(1).max(160)).max(32).optional()
    }).strict()).max(6)
  }).strict()).min(1).max(60)
}).strict()

export type AuthoredGuideInput = z.infer<typeof authoredGuideInputSchema>

const revisionNeeded = (issues: string[], details?: GuideContentValidation['details']) => ({
  status: 'needs_revision' as const, issues: [...new Set(issues)], ...(details ? { details } : {})
})
const cityKey = (city: LocationRef) => cityGroupingIdentity(city, CURATED_LOCATION_IDENTITY_POLICY)

/** Project the Planner's choices into the existing route/guide artifacts; no allocation or remote calls. */
export async function saveAuthoredTravelGuide(
  input: AuthoredGuideInput,
  constraints: TravelGuideConstraints,
  scope: ArtifactWorkspace,
  resolvedLocations: readonly LocationRef[] = []
) {
  const draft = authoredGuideInputSchema.parse(input)
  await checkpoint(scope)
  const trip = await scope.trips.get(scope.tripId)
  if (!trip) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
  const selectedItems = draft.days.flatMap(day => day.items)
  if (selectedItems.length === 0) return revisionNeeded(['guide_no_selected_findings'])

  // Unselected old research must not enter the new guide's lineage or coverage checks.
  const selectedIndexes = [...new Set(selectedItems.map(item => item.researchIndex))]
  if (selectedIndexes.some(index => draft.researchArtifactIds[index] === undefined)) return revisionNeeded(['guide_research_index'])
  const research = new Map<string, ResearchArtifact>()
  for (const index of selectedIndexes) {
    const id = draft.researchArtifactIds[index]!
    if (research.has(id)) continue
    const record = await loadWorkspaceArtifact(scope, id, 'research', [2])
    const source = researchArtifactSchema.parse(record.payload)
    if (source.id !== record.id) return revisionNeeded(['guide_research_identity'])
    research.set(id, source)
  }
  const locations = new Map([
    ...resolvedLocations,
    ...trip.destinationIntent.required, ...trip.destinationIntent.preferred,
    ...trip.locationRoleOverrides.map(value => value.location),
    ...[...research.values()].flatMap(source => [...source.brief.destinations, ...source.findings.flatMap(finding => finding.destinations)])
  ].map(location => [location.id, location] as const))
  const unknownCities = draft.days.filter(day => !locations.has(String(day.cityId)))
  if (unknownCities.length) return revisionNeeded(unknownCities.map(day => `guide_unknown_city:day_${day.day}`))

  const now = new Date().toISOString()
  const selectedActivityIds = new Set<string>()
  const userActivities = new Map(trip.mustIncludeEvents.map(activity => [activity.id, activity]))
  const issues: string[] = []
  const days = draft.days.map(day => {
    const city = locations.get(String(day.cityId))!
    const items = day.items.flatMap(choice => {
      const sourceId = draft.researchArtifactIds[choice.researchIndex]!
      const finding = research.get(sourceId)?.findings.find(value => value.id === choice.findingId)
      if (!finding) {
        issues.push(`guide_unknown_finding:day_${day.day}:${choice.findingId}`)
        return []
      }
      for (const id of choice.requestedActivityIds ?? []) {
        if (!userActivities.has(id)) issues.push(`guide_unknown_requested_activity:${id}`)
        else selectedActivityIds.add(id)
      }
      return [{
        id: `guide_${createHash('sha256').update(`${sourceId}:${finding.id}:${day.day}`).digest('hex').slice(0, 24)}`,
        title: finding.title, description: finding.summary, city, category: finding.category,
        reason: choice.requestedActivityIds?.length ? 'user_requested' as const : 'interest_match' as const,
        sourceArtifactId: sourceId, sourceFindingId: finding.id, verification: finding.verification,
        timeOfDay: choice.timeOfDay, planningNote: choice.planningNote
      }]
    })
    return { day: day.day, city, kind: day.kind, theme: day.theme, ...(day.notes ? { notes: day.notes } : {}), items }
  })
  if (issues.length) return revisionNeeded(issues)
  const verification = aggregateGuideVerification(days.flatMap(day => day.items), now)
  const sourceArtifactIds = [...research.keys()]
  const warnings = [...new Set([
    'guide_schedule_is_suggested_not_time_verified',
    ...[...research.values()].flatMap(source => source.warnings),
    ...(verification.status === 'partially_verified' ? ['guide_contains_partially_verified_research'] : []),
    ...(new Set(days.map(day => cityKey(day.city))).size > 1 ? ['land_transfers_unresolved'] : [])
  ])].slice(0, 40)
  const cities = [...new Map(days.map(day => [cityKey(day.city), day.city])).values()].map(location => ({
    location, stayDays: days.filter(day => cityKey(day.city) === cityKey(location)).length,
    role: 'visit' as const, reasons: ['Planner-selected visit structure']
  }))
  const unassignedActivityRefs = trip.mustIncludeEvents.filter(activity => !selectedActivityIds.has(activity.id))
    .map(activity => ({ ...activity, reason: 'user_requested' as const }))
  const routeId = uuidv7()
  const route = tripRoutePlanPayloadSchema.parse({
    kind: 'trip_route_plan', schemaVersion: 1, plannerVersion: 'agent-authored-guide-v1',
    tripContextVersion: scope.tripContextVersion, sourceArtifactIds, cities,
    days: days.map((day, index) => ({
      day: day.day, city: day.city,
      activityRefs: [...new Set(draft.days[index]!.items.flatMap(item => item.requestedActivityIds ?? []))]
        .map(id => ({ ...userActivities.get(id)!, reason: 'user_requested' as const }))
    })),
    stopoverOnly: [], landTransfers: [], unassignedActivityRefs, verification, warnings
  })
  const guide = travelGuideArtifactPayloadSchema.parse({
    kind: 'trip_travel_guide', schemaVersion: 1, builderVersion: 'agent-authored-guide-v1', composition: 'agent_authored',
    sourceArtifactIds: [routeId, ...sourceArtifactIds], routeArtifactId: routeId,
    days, unassignedActivityRefs, verification, warnings, createdAt: now
  })
  const validation = validateGuideContent({ guide, route, research, trip, constraints, now })
  if (validation.status !== 'satisfied') return revisionNeeded(validation.missing, validation.details)

  await saveWorkspaceArtifact(scope, { id: routeId, type: 'route', schemaVersion: 1, payload: route, verification, sourceArtifactIds })
  const record = await saveWorkspaceArtifact(scope, {
    id: uuidv7(), type: 'travel_guide', schemaVersion: 1, payload: guide, verification,
    sourceArtifactIds: guide.sourceArtifactIds
  })
  return { status: 'saved' as const, record, payload: guide, issues: [] }
}
