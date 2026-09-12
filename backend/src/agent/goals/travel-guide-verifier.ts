import type { ArtifactRecord } from '../../artifacts/repository.js'
import { researchArtifactSchema, type ResearchArtifact } from '../../research-agent/types.js'
import { tripRoutePlanPayloadSchema } from '../../trip-planning/types.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { validateGuideContent } from '../../travel-guides/validation.js'
import { travelGuideGoalParametersSchema, type GoalRecord } from './types.js'
import type { GoalVerification, GoalVerificationContext, GoalVerifier } from './verifier.js'
import { currentContextFailure, goalArtifacts, hasCurrentArtifactScope, selectVerification, verificationResult } from './artifact-verification.js'

async function verifyGuide(record: ArtifactRecord, goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
  const parsed = travelGuideArtifactPayloadSchema.safeParse(record.payload)
  if (record.schemaVersion !== 1 || !parsed.success) return verificationResult('failed', ['travel_guide_payload'])
  const guide = parsed.data
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

  const research = new Map<string, ResearchArtifact>()
  for (const day of guide.days) {
    for (const item of day.items) {
      if (!guide.sourceArtifactIds.includes(item.sourceArtifactId) || !record.sourceArtifactIds?.includes(item.sourceArtifactId)) {
        return verificationResult('failed', ['guide_item_lineage'])
      }
      if (research.has(item.sourceArtifactId)) continue
      const sourceRecord = sources.get(item.sourceArtifactId)
      const source = researchArtifactSchema.safeParse(sourceRecord?.payload)
      if (sourceRecord?.type !== 'research' || sourceRecord.schemaVersion !== 2 || !source.success || source.data.id !== sourceRecord.id) {
        return verificationResult('failed', ['guide_research_payload'])
      }
      research.set(sourceRecord.id, source.data)
    }
  }
  const result = validateGuideContent({
    guide, route: route.data, research, trip: context.run.contextSnapshot,
    constraints: travelGuideGoalParametersSchema.parse(goal.parameters),
    ...(context.now ? { now: context.now } : {})
  })
  return verificationResult(result.status, result.missing, result.status === 'failed' ? [] : [record.id], result.warnings)
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
