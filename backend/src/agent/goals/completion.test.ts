import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { AppError } from '../../lib/errors.js'
import { completeGoal, refreshGoalDelivery, summarizeGoalDelivery } from './completion.js'
import { createDefaultGoalVerifierRegistry } from './default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from './repository.js'
import { GoalVerifierRegistry, type GoalVerifier } from './verifier.js'
import { observePlannerTurn, type PlannerObservation } from '../../lib/planner-observation.js'

async function fixture() {
  const trip = emptyTripContext('trip')
  const goals = new InMemoryGoalRepository('owner')
  const runs = new InMemoryGoalRunRepository('owner', goals)
  const goal = (await goals.create({
    tripId: trip.id, kind: 'travel_guide', createdContextVersion: 0, idempotencyKey: 'goal',
    parameters: { questions: ['activities'], researchTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: false }
  })).goal
  const run = (await runs.create({ goalId: goal.id, tripId: trip.id, generationId: 'generation', contextVersion: 0, contextSnapshot: trip, idempotencyKey: 'run' })).run
  const verify = vi.fn<GoalVerifier['verify']>(async () => ({ status: 'pending', artifactIds: [], missing: ['travel_guide_artifact'], warnings: [] }))
  const scope = {
    ownerId: 'owner', tripId: trip.id, goals, runs,
    trips: new InMemoryTripContextRepository([trip]),
    artifacts: new InMemoryArtifactRepository('owner', new Set([trip.id])),
    verifiers: new GoalVerifierRegistry().register({ kind: 'travel_guide', verify })
  }
  const snapshot = summarizeGoalDelivery([
    { goalId: goal.id, kind: goal.kind, status: 'pending', artifactIds: [], missing: ['travel_guide_artifact'], warnings: [] }
  ])
  return { trip, goal, run, verify, scope, snapshot }
}

describe('Goal completion service', () => {
  it.each(['read_only', 'failed_commit', 'committed'] as const)('records durable verification only after a committed verdict: %s', async mode => {
    const { scope, goal, run, verify } = await fixture()
    verify.mockResolvedValue({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    if (mode === 'failed_commit') vi.spyOn(scope.runs, 'commitCompletion').mockRejectedValue(new Error('database failed'))
    let snapshot!: PlannerObservation
    const promise = observePlannerTurn({ requestId: 'r', tripId: 'trip', conversationId: 'c', generationId: 'g' },
      () => completeGoal(scope, { goalId: goal.id, runId: run.id, persist: mode !== 'read_only' }), value => { snapshot = value })
    if (mode === 'failed_commit') await expect(promise).rejects.toThrow('database failed')
    else await promise
    expect(snapshot.spans).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'goal_verify' })]))
    if (mode === 'committed') expect(snapshot.milestones.firstVerifiedMs).toEqual(expect.any(Number))
    else expect(snapshot.milestones.firstVerifiedMs).toBeNull()
  })

  it('allows the Agent to improve partial results in the same active run', async () => {
    const { scope, goal, run, verify } = await fixture()
    verify.mockResolvedValue({ status: 'partial', artifactIds: [], missing: ['guide_daily_activity_coverage'], warnings: [] })
    const partial = await completeGoal(scope, { goalId: goal.id, runId: run.id, closePartialRun: false })
    expect(partial).toMatchObject({ goal: { status: 'partial' }, run: { status: 'running' }, verification: { status: 'partial' } })
    verify.mockResolvedValue({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    const completed = await completeGoal(scope, { goalId: goal.id, runId: run.id })
    expect(completed).toMatchObject({ goal: { status: 'satisfied' }, run: { id: run.id, status: 'satisfied' } })
  })

  it('requires a new run when later Trip updates satisfy an already closed partial run', async () => {
    const { scope, trip } = await fixture()
    scope.verifiers = createDefaultGoalVerifierRegistry()
    const goal = (await scope.goals.create({
      tripId: trip.id, kind: 'trip_context_update', createdContextVersion: 0, idempotencyKey: 'update-goal',
      parameters: { fields: ['notes', 'travelDays'] }
    })).goal
    const run = (await scope.runs.create({
      goalId: goal.id, tripId: trip.id, generationId: 'update-generation', contextVersion: 0,
      contextSnapshot: trip, idempotencyKey: 'update-run'
    })).run
    await scope.trips.update(trip.id, { notes: ['accepted conditions'] })
    const partial = await completeGoal(scope, { goalId: goal.id, runId: run.id })
    expect(partial).toMatchObject({ goal: { status: 'partial' }, run: { status: 'partial' },
      verification: { status: 'partial', missing: ['trip_field:travelDays'] } })
    const current = await scope.trips.update(trip.id, { travelDays: 5 })
    expect(await scope.verifiers.verify(partial.goal, {
      ownerId: scope.ownerId, tripId: trip.id, run: partial.run, currentTrip: current, artifacts: scope.artifacts
    })).toMatchObject({ status: 'satisfied' })

    const commit = vi.spyOn(scope.runs, 'commitCompletion')
    const finished = await completeGoal(scope, { goalId: goal.id, runId: run.id, closePartialRun: false })
    const restored = await refreshGoalDelivery(scope, summarizeGoalDelivery([
      { goalId: goal.id, kind: goal.kind, ...partial.verification }
    ]))
    expect(finished.verification).toMatchObject({ status: 'partial', missing: ['goal_run_resume_required'] })
    expect(restored).toMatchObject({ status: 'partial', missing: ['goal_run_resume_required'],
      goals: [{ goalId: goal.id, status: 'partial' }] })
    expect(commit).not.toHaveBeenCalled()
    expect(await scope.goals.get(goal.id)).toEqual(partial.goal)
    expect(await scope.runs.get(run.id)).toEqual(partial.run)
  })

  it('still reconciles a succeeded run whose Goal completion was not persisted', async () => {
    const { scope, goal, run, snapshot, verify } = await fixture()
    const succeeded = await scope.runs.update(run.id, run.revision, { status: 'satisfied' })
    verify.mockResolvedValue({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    expect((await refreshGoalDelivery(scope, snapshot)).status).toBe('satisfied')
    expect((await scope.goals.get(goal.id))?.status).toBe('pending')
    const completed = await completeGoal(scope, { goalId: goal.id, runId: run.id })
    expect(completed).toMatchObject({ goal: { status: 'satisfied' }, verification: { status: 'satisfied' } })
    expect(completed.run).toEqual(succeeded)
    expect(await scope.goals.get(goal.id)).toEqual(completed.goal)
  })

  it.each(['failed', 'cancelled'] as const)('restores a background %s result from a pending turn snapshot', async status => {
    const { scope, goal, run, snapshot, verify } = await fixture()
    await scope.runs.commitCompletion({
      goalId: goal.id, runId: run.id, expectedGoalRevision: goal.revision, expectedRunRevision: run.revision,
      goalStatus: status, runStatus: status
    })
    verify.mockResolvedValue({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    const delivery = await refreshGoalDelivery(scope, snapshot)
    expect(delivery).toMatchObject({ status, goalId: goal.id, goals: [{ status, goalId: goal.id }] })
    expect(delivery.warnings).not.toContain('goal_verification_unavailable')
    expect(verify).not.toHaveBeenCalled()
  })

  it('preserves a failed result when the Trip changes after the run failed', async () => {
    const { scope, goal, run, snapshot } = await fixture()
    await scope.runs.commitCompletion({
      goalId: goal.id, runId: run.id, expectedGoalRevision: goal.revision, expectedRunRevision: run.revision,
      goalStatus: 'failed', runStatus: 'failed'
    })
    await scope.trips.update(scope.tripId, { notes: ['new accepted conditions'] })
    expect((await refreshGoalDelivery(scope, snapshot)).status).toBe('failed')
  })

  it('verifies a new run after an earlier run failed for the same Goal', async () => {
    const { scope, trip, goal, run, snapshot, verify } = await fixture()
    await scope.runs.commitCompletion({
      goalId: goal.id, runId: run.id, expectedGoalRevision: goal.revision, expectedRunRevision: run.revision,
      goalStatus: 'failed', runStatus: 'failed'
    })
    const retried = (await scope.runs.create({
      goalId: goal.id, tripId: trip.id, generationId: 'retry-generation', contextVersion: 0,
      contextSnapshot: trip, idempotencyKey: 'retry-run'
    })).run
    verify.mockResolvedValue({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    expect((await refreshGoalDelivery(scope, snapshot)).status).toBe('satisfied')
    expect(verify.mock.calls[0]?.[1].run.id).toBe(retried.id)
    expect((await scope.runs.get(run.id))?.status).toBe('failed')
  })

  it('keeps a known failure in the turn snapshot if the Goal store is unavailable', async () => {
    const { scope, snapshot } = await fixture()
    const failed = summarizeGoalDelivery(snapshot.goals.map(item => ({ ...item, status: 'failed' as const })))
    vi.spyOn(scope.goals, 'get').mockRejectedValue(new Error('storage unavailable'))
    expect(await refreshGoalDelivery(scope, failed)).toMatchObject({ status: 'failed', warnings: ['goal_verification_unavailable'] })
  })

  it('does not let a deliberately cancelled objective hide a completed replacement', () => {
    const delivery = summarizeGoalDelivery([
      { goalId: '019c6e27-e55b-73d1-87d8-4e01f1f75043', kind: 'travel_guide', status: 'cancelled', artifactIds: [], missing: [], warnings: [] },
      { goalId: '019c7714-3b77-74d1-9866-e1f484aae2ab', kind: 'travel_guide', status: 'satisfied', artifactIds: [], missing: [], warnings: [] }
    ])
    expect(delivery.status).toBe('satisfied')
    expect(delivery.goals.map(goal => goal.status)).toEqual(['cancelled', 'satisfied'])
  })

  it('reports an unfinished goal even when another goal has a valid result', () => {
    const delivery = summarizeGoalDelivery([
      { goalId: '019c6e27-e55b-73d1-87d8-4e01f1f75043', kind: 'flight_search', status: 'satisfied', artifactIds: [], missing: [], warnings: [] },
      { goalId: '019c7714-3b77-74d1-9866-e1f484aae2ab', kind: 'travel_guide', status: 'pending', artifactIds: [], missing: ['travel_guide_artifact'], warnings: [] }
    ])
    expect(delivery).toMatchObject({ status: 'pending', missing: ['travel_guide_artifact'] })
  })

  it('stops completion when the confirmed flight revision changes', async () => {
    const { scope, goal, run, verify } = await fixture()
    verify.mockResolvedValue({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    const assertFlightSelectionCurrent = vi.fn().mockRejectedValue(
      new AppError('FLIGHT_SELECTION_CHANGED', 'The confirmed flight changed', 409)
    )
    await expect(completeGoal({ ...scope, assertFlightSelectionCurrent }, { goalId: goal.id, runId: run.id }))
      .rejects.toMatchObject({ code: 'FLIGHT_SELECTION_CHANGED' })
    expect(verify).not.toHaveBeenCalled()
    expect(await scope.goals.get(goal.id)).toMatchObject({ status: 'pending' })
    expect(await scope.runs.get(run.id)).toMatchObject({ status: 'running' })
  })
})
