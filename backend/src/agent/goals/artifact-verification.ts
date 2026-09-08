import { assertArtifactContextVersion, type ArtifactRecord, type ArtifactType } from '../../artifacts/repository.js'
import type { VerificationRecord } from '../../aviation/types.js'
import type { GoalRecord } from './types.js'
import type { GoalVerification, GoalVerificationContext } from './verifier.js'

export function verificationResult(
  status: GoalVerification['status'],
  missing: string[] = [],
  artifactIds: string[] = [],
  warnings: string[] = []
): GoalVerification {
  return { status, missing: [...new Set(missing)], artifactIds, warnings: [...new Set(warnings)] }
}

export function currentContextFailure(context: GoalVerificationContext): GoalVerification | undefined {
  if (!context.currentTrip) return verificationResult('pending', ['current_trip_context'])
  if (context.currentTrip.version !== context.run.contextVersion) {
    return verificationResult('pending', ['current_trip_context'], [], ['run_context_stale'])
  }
  return undefined
}

export function hasCurrentArtifactScope(record: ArtifactRecord, context: GoalVerificationContext): boolean {
  if (record.tripId !== context.tripId) return false
  try {
    assertArtifactContextVersion(record, context.run.contextVersion)
    return true
  } catch {
    return false
  }
}

export async function goalArtifacts(goal: GoalRecord, context: GoalVerificationContext, type: ArtifactType): Promise<ArtifactRecord[]> {
  return (await context.artifacts.listForRun(context.run.id, 100)).filter(record => record.type === type
    && record.goalId === goal.id && record.runId === context.run.id && hasCurrentArtifactScope(record, context))
}

/** Alternatives stay independent: evidence from an unrelated candidate never completes another. */
export function selectVerification(results: GoalVerification[], missingArtifact: string): GoalVerification {
  if (results.length === 0) return verificationResult('pending', [missingArtifact])
  const complete = results.find(result => result.status === 'satisfied')
  if (complete) return complete
  const partial = results.filter(result => result.status === 'partial').sort((a, b) => a.missing.length - b.missing.length)[0]
  if (partial) return partial
  const pending = results.filter(result => result.status === 'pending')
  if (pending.length > 0) return verificationResult('pending', pending.flatMap(result => result.missing), [], pending.flatMap(result => result.warnings))
  return verificationResult('failed', results.flatMap(result => result.missing), [], results.flatMap(result => result.warnings))
}

/** Evidence freshness is independent of whether the requested business result is complete. */
export function currentEvidenceStatus(value: VerificationRecord, context: GoalVerificationContext): VerificationRecord['status'] {
  if (value.expiresAt && Date.parse(value.expiresAt) <= Date.parse(context.now ?? new Date().toISOString())) return 'stale'
  return value.status
}
