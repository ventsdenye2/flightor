import type { ArtifactRepository } from '../../artifacts/repository.js'
import { z } from 'zod'
import { goalKindSchema, goalRunRecordSchema, goalStatusSchema, type GoalKind, type GoalRecord, type GoalRunRecord, type GoalStatus, type GoalWorkingSet } from './types.js'
import type { TripContext } from '../../trips/types.js'

export interface GoalVerificationContext {
  ownerId: string
  tripId: string
  run: GoalRunRecord
  artifacts: ArtifactRepository
  currentTrip?: TripContext
  now?: string
}

export interface GoalVerification {
  status: GoalStatus
  artifactIds: string[]
  missing: string[]
  warnings: string[]
}

export const goalVerificationSchema = z.object({
  status: goalStatusSchema,
  artifactIds: z.array(z.string().uuid()).max(100),
  missing: z.array(z.string().min(1).max(160)).max(40),
  warnings: z.array(z.string().min(1).max(240)).max(40)
}).strict()

export interface GoalVerifier {
  readonly kind: GoalKind
  verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification>
}

function normalizeVerification(value: GoalVerification): GoalVerification {
  return goalVerificationSchema.parse({
    status: goalStatusSchema.parse(value.status),
    artifactIds: [...new Set(value.artifactIds)].slice(0, 100),
    missing: [...new Set(value.missing)].slice(0, 40),
    warnings: [...new Set(value.warnings)].slice(0, 40)
  })
}

export class GoalVerifierRegistry {
  private readonly verifiers = new Map<GoalKind, GoalVerifier>()

  register(verifier: GoalVerifier): this {
    const kind = goalKindSchema.parse(verifier.kind)
    if (this.verifiers.has(kind)) throw new Error(`Duplicate goal verifier: ${kind}`)
    this.verifiers.set(kind, verifier)
    return this
  }

  get(kind: GoalKind): GoalVerifier | undefined {
    return this.verifiers.get(kind)
  }

  async verify(goal: GoalRecord, context: GoalVerificationContext): Promise<GoalVerification> {
    const run = goalRunRecordSchema.parse(context.run)
    if (goal.status === 'cancelled' || goal.tripId !== context.tripId || goal.ownerId !== context.ownerId
      || run.ownerId !== context.ownerId || run.goalId !== goal.id || run.tripId !== context.tripId) {
      return { status: 'failed', artifactIds: [], missing: ['goal_scope'], warnings: [] }
    }
    if (run.status === 'cancelled') {
      return { status: 'failed', artifactIds: [], missing: ['run_cancelled'], warnings: [] }
    }
    const verifier = this.verifiers.get(goal.kind)
    if (!verifier) return { status: 'failed', artifactIds: [], missing: ['goal_verifier'], warnings: [] }
    return normalizeVerification(await verifier.verify(goal, context))
  }
}

export function artifactIdsFromWorkingSet(workingSet: GoalWorkingSet): string[] {
  return [...new Set(workingSet.artifactRefs.map(ref => ref.id))]
}
