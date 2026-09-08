import { tripContextSchema } from '../../trips/types.js'
import { tripContextUpdateGoalParametersSchema, type GoalRecord } from './types.js'
import { GoalVerifierRegistry, type GoalVerification, type GoalVerificationContext, type GoalVerifier } from './verifier.js'
import { FlightSearchGoalVerifier } from './flight-search-verifier.js'
import { TravelGuideGoalVerifier } from './travel-guide-verifier.js'
import { RouteGenerationGoalVerifier } from './route-generation-verifier.js'
import { verificationResult } from './artifact-verification.js'

class TripContextUpdateGoalVerifier implements GoalVerifier {
  readonly kind = 'trip_context_update' as const

  async verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
    const parameters = tripContextUpdateGoalParametersSchema.safeParse(goal.parameters)
    if (!parameters.success) return verificationResult('failed', ['goal_parameters'])
    if (!context.currentTrip) return verificationResult('pending', ['current_trip_context'])
    const parsed = tripContextSchema.safeParse(context.currentTrip)
    if (!parsed.success || parsed.data.id !== context.tripId) return verificationResult('failed', ['current_trip_context'])
    const current = parsed.data
    if (current.version <= context.run.contextVersion) return verificationResult('pending', ['trip_context_version'])
    const fields = [...new Set(parameters.data.fields)]
    // Removing an optional field is a real update; absent in both snapshots is not.
    // Repository null patches become absent properties in the canonical Trip schema.
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
    .register(new TravelGuideGoalVerifier())
    .register(new FlightSearchGoalVerifier())
    .register(new TripContextUpdateGoalVerifier())
    .register(new RouteGenerationGoalVerifier())
}
