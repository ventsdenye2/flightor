import type { ArtifactRecord, ArtifactType } from '../../artifacts/repository.js'
import type { GoalRecord } from './types.js'
import { GoalVerifierRegistry, type GoalVerification, type GoalVerificationContext, type GoalVerifier } from './verifier.js'

type EvidenceStatus = 'verified' | 'partially_verified' | 'stale' | 'unverified' | 'unknown'

function evidenceStatus(value: unknown): EvidenceStatus {
  if (Array.isArray(value)) {
    const values = value.map(evidenceStatus)
    if (values.includes('unverified')) return 'unverified'
    if (values.includes('stale')) return 'stale'
    if (values.includes('partially_verified')) return 'partially_verified'
    if (values.length > 0 && values.every(status => status === 'verified')) return 'verified'
    return 'unknown'
  }
  if (!value || typeof value !== 'object') return 'unknown'
  const status = (value as { status?: unknown }).status
  return status === 'verified' || status === 'partially_verified' || status === 'stale' || status === 'unverified' ? status : 'unknown'
}

function compatibleArtifacts(records: readonly ArtifactRecord[], goal: GoalRecord, context: GoalVerificationContext): ArtifactRecord[] {
  return records.filter(record => record.tripId === context.tripId
    && record.goalId === goal.id
    && record.runId === context.run.id
    && record.tripContextVersion === context.run.contextVersion)
}

function resultForArtifacts(records: readonly ArtifactRecord[], missing: string): GoalVerification {
  if (records.length === 0) return { status: 'pending', artifactIds: [], missing: [missing], warnings: [] }
  const statuses = records.map(record => evidenceStatus(record.verification))
  if (statuses.includes('verified')) return { status: 'satisfied', artifactIds: records.map(record => record.id), missing: [], warnings: [] }
  if (statuses.includes('partially_verified')) return { status: 'partial', artifactIds: records.map(record => record.id), missing: [], warnings: ['evidence_partially_verified'] }
  return { status: 'partial', artifactIds: records.map(record => record.id), missing: ['verified_evidence'], warnings: ['evidence_not_currently_verified'] }
}

class ArtifactGoalVerifier implements GoalVerifier {
  constructor(readonly kind: GoalRecord['kind'], private readonly type: ArtifactType, private readonly payloadKind?: string) {}

  async verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
    if (context.currentTrip && context.currentTrip.version !== context.run.contextVersion) {
      return { status: 'pending', artifactIds: [], missing: ['current_trip_context'], warnings: ['run_context_stale'] }
    }
    const records = compatibleArtifacts(await context.artifacts.listForRun(context.run.id, 100), goal, context)
      .filter(record => record.type === this.type && (this.payloadKind === undefined
        || (record.payload !== null && typeof record.payload === 'object' && (record.payload as { kind?: unknown }).kind === this.payloadKind)))
    return resultForArtifacts(records, `${this.type}_artifact`)
  }
}

class TripContextUpdateGoalVerifier implements GoalVerifier {
  readonly kind = 'trip_context_update' as const

  async verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
    const current = context.currentTrip
    if (!current) return { status: 'pending', artifactIds: [], missing: ['current_trip_context'], warnings: [] }
    const parameters = goal.parameters as { fields?: unknown }
    const fields = Array.isArray(parameters.fields) ? parameters.fields.filter((field): field is keyof typeof current => typeof field === 'string' && field in current) : []
    const changed = fields.filter(field => JSON.stringify(current[field]) !== JSON.stringify(context.run.contextSnapshot[field]))
    const missing = fields.filter(field => !changed.includes(field))
    return missing.length === 0
      ? { status: 'satisfied', artifactIds: [], missing: [], warnings: [] }
      : changed.length > 0
        ? { status: 'partial', artifactIds: [], missing: missing.map(field => `trip_field:${field}`), warnings: [] }
        : { status: 'pending', artifactIds: [], missing: fields.map(field => `trip_field:${field}`), warnings: [] }
  }
}

export function createDefaultGoalVerifierRegistry(): GoalVerifierRegistry {
  return new GoalVerifierRegistry()
    .register(new ArtifactGoalVerifier('travel_guide', 'travel_guide'))
    .register(new ArtifactGoalVerifier('flight_search', 'flight_search'))
    .register(new TripContextUpdateGoalVerifier())
    .register(new ArtifactGoalVerifier('route_generation', 'route_set', 'optimized_routes'))
}
