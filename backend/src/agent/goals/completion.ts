import { z } from 'zod'
import type { ArtifactRepository } from '../../artifacts/repository.js'
import { AppError } from '../../lib/errors.js'
import type { TripContextRepository } from '../../trips/repository.js'
import type { GoalRepository, GoalRunRepository } from './repository.js'
import type { SelectedFlightContext } from '../../workspaces/flight-selection.js'
import { goalKindSchema, goalRunStatusSchema, goalStatusSchema, type GoalRecord, type GoalRunRecord } from './types.js'
import { goalVerificationSchema, type GoalVerification, type GoalVerifierRegistry } from './verifier.js'

export const goalDeliveryItemSchema = goalVerificationSchema.extend({
  goalId: z.string().uuid(),
  kind: goalKindSchema
}).strict()

/** Turn termination and durable business delivery are separate contracts. */
export const goalDeliverySchema = z.object({
  status: z.enum(['not_requested', ...goalStatusSchema.options]),
  goalId: z.string().uuid().optional(),
  kind: goalKindSchema.optional(),
  artifactIds: z.array(z.string().uuid()).max(100),
  missing: z.array(z.string().min(1).max(160)).max(40),
  warnings: z.array(z.string().min(1).max(240)).max(40),
  goals: z.array(goalDeliveryItemSchema).max(64)
}).strict()
export type GoalDelivery = z.infer<typeof goalDeliverySchema>
export type GoalDeliveryItem = z.infer<typeof goalDeliveryItemSchema>

export function noGoalDelivery(): GoalDelivery {
  return { status: 'not_requested', artifactIds: [], missing: [], warnings: [], goals: [] }
}

export interface GoalCompletionScope {
  ownerId: string
  tripId: string
  trips: TripContextRepository
  artifacts: ArtifactRepository
  goals: GoalRepository
  runs: GoalRunRepository
  verifiers: GoalVerifierRegistry
  signal?: AbortSignal
  isCurrent?: () => boolean
  selectedFlight?: SelectedFlightContext
  assertFlightSelectionCurrent?: () => Promise<void>
}

async function checkpoint(scope: GoalCompletionScope): Promise<void> {
  scope.signal?.throwIfAborted()
  if (scope.isCurrent?.() === false) throw new AppError('GOAL_RUN_NOT_CURRENT', 'The active operation changed', 409)
  await scope.assertFlightSelectionCurrent?.()
  scope.signal?.throwIfAborted()
  if (scope.isCurrent?.() === false) throw new AppError('GOAL_RUN_NOT_CURRENT', 'The active operation changed', 409)
}

/** Shared by business-tool completion, finish_goal and runtime finalization; never inspects model text. */
export async function completeGoal(
  scope: GoalCompletionScope,
  input: { goalId: string; runId?: string; persist?: boolean; closePartialRun?: boolean }
): Promise<{ goal: GoalRecord; run: GoalRunRecord; verification: GoalVerification }> {
  await checkpoint(scope)
  const goal = await scope.goals.get(input.goalId)
  await checkpoint(scope)
  if (!goal || goal.ownerId !== scope.ownerId || goal.tripId !== scope.tripId) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
  }
  const current = await scope.trips.get(scope.tripId)
  await checkpoint(scope)
  if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
  const candidate = input.runId ? await scope.runs.get(input.runId) : undefined
  await checkpoint(scope)
  const matches = (value: GoalRunRecord | undefined): value is GoalRunRecord => Boolean(value
    && value.ownerId === scope.ownerId && value.goalId === goal.id && value.tripId === scope.tripId)
  let run = matches(candidate) ? candidate
    : goal.kind === 'trip_context_update'
      ? (await scope.runs.listForGoal(goal.id)).find(matches)
      : await scope.runs.latestCompatible({
        goalId: goal.id, tripId: scope.tripId, contextVersion: current.version,
        statuses: goalRunStatusSchema.options
      })
  await checkpoint(scope)
  // A terminal failure or cancellation remains observable after the Trip changes.
  // A newer compatible run takes precedence so an explicit retry can still finish.
  if (!run && (goal.status === 'failed' || goal.status === 'cancelled')) {
    run = (await scope.runs.listForGoal(goal.id)).find(value => matches(value)
      && (goal.status === 'cancelled' || value.status === 'failed'))
  }
  await checkpoint(scope)
  if (!matches(run)) throw new AppError('GOAL_RUN_NOT_FOUND', 'No compatible Goal run exists', 409)
  if (goal.status === 'cancelled' || run.status === 'cancelled') {
    return { goal, run, verification: { status: 'cancelled', artifactIds: [], missing: [], warnings: [] } }
  }
  if (run.status === 'failed') {
    return { goal, run, verification: { status: 'failed', artifactIds: [], missing: ['goal_run_failed'], warnings: [] } }
  }
  const verification = await scope.verifiers.verify(goal, {
    ownerId: scope.ownerId, tripId: scope.tripId, run, currentTrip: current, artifacts: scope.artifacts,
    ...(scope.selectedFlight ? { selectedFlight: scope.selectedFlight } : {})
  })
  await checkpoint(scope)
  const latest = await scope.trips.get(scope.tripId)
  await checkpoint(scope)
  if (!latest || latest.version !== current.version) {
    return { goal, run, verification: { status: 'pending', artifactIds: [], missing: ['current_trip_context'], warnings: ['run_context_stale'] } }
  }
  // A closed partial run cannot accept later evidence. Both restored views and
  // finish_goal must require an explicit new run before reporting completion.
  if (run.status === 'partial' && verification.status === 'satisfied') {
    return { goal, run, verification: { ...verification, status: 'partial', missing: ['goal_run_resume_required'] } }
  }
  if (input.persist === false || verification.status === 'pending') return { goal, run, verification }
  const runStatus = verification.status === 'partial' && input.closePartialRun === false && run.status === 'running'
    ? 'running' : verification.status
  // Historical terminal records are immutable. Reconcile a legacy half-write
  // only when the verified result agrees with that run's terminal status.
  if ((run.status !== 'running' && run.status !== runStatus)
    || (goal.status === 'satisfied' && verification.status !== 'satisfied')) return { goal, run, verification }
  await checkpoint(scope)
  const completed = await scope.runs.commitCompletion({
    goalId: goal.id, runId: run.id,
    expectedGoalRevision: goal.revision, expectedRunRevision: run.revision,
    goalStatus: verification.status, runStatus, currentTripVersion: current.version
  })
  return { ...completed, verification }
}

/** Refresh unfinished turn snapshots after background work, using the same verifier. */
export async function refreshGoalDelivery(scope: GoalCompletionScope, snapshot: GoalDelivery): Promise<GoalDelivery> {
  if (snapshot.status === 'not_requested' || snapshot.status === 'satisfied' || snapshot.status === 'cancelled') return snapshot
  const items = await Promise.all(snapshot.goals.map(async item => {
    if (item.status === 'satisfied' || item.status === 'cancelled') return item
    try {
      const result = await completeGoal(scope, { goalId: item.goalId, persist: false })
      return { goalId: item.goalId, kind: result.goal.kind, ...result.verification }
    } catch {
      return { ...item, status: item.status === 'failed' ? 'failed' as const : 'pending' as const,
        artifactIds: [], missing: ['goal_verification'], warnings: ['goal_verification_unavailable'] }
    }
  }))
  return items.length > 0 ? summarizeGoalDelivery(items) : snapshot
}

export function summarizeGoalDelivery(items: GoalDeliveryItem[]): GoalDelivery {
  if (items.length === 0) return noGoalDelivery()
  const applicable = items.filter(item => item.status !== 'cancelled')
  const statuses = applicable.map(item => item.status)
  const status = statuses.length === 0 ? 'cancelled' : statuses.every(value => value === 'satisfied') ? 'satisfied'
    : statuses.includes('failed') ? 'failed'
      : statuses.includes('pending') ? 'pending'
        : statuses.includes('partial') ? 'partial' : 'cancelled'
  const single = applicable.length === 1 ? applicable[0] : items.length === 1 ? items[0] : undefined
  return goalDeliverySchema.parse({
    status,
    ...(single ? { goalId: single.goalId, kind: single.kind } : {}),
    artifactIds: [...new Set(items.flatMap(item => item.artifactIds))].slice(0, 100),
    missing: [...new Set(items.flatMap(item => item.missing))].slice(0, 40),
    warnings: [...new Set(items.flatMap(item => item.warnings))].slice(0, 40),
    goals: items
  })
}
