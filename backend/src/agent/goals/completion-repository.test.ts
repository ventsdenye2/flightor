import { describe, expect, it } from 'vitest'
import { emptyTripContext } from '../../trips/types.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository, type GoalCompletionInput } from './repository.js'

async function fixture() {
  let tripVersion = 0
  const goals = new InMemoryGoalRepository('owner')
  const runs = new InMemoryGoalRunRepository('owner', goals, new Map(), () => tripVersion)
  const goal = (await goals.create({ tripId: 'trip', kind: 'flight_search', parameters: { requestKey: 'fare' },
    createdContextVersion: 0, idempotencyKey: 'goal' })).goal
  const run = (await runs.create({ goalId: goal.id, tripId: 'trip', generationId: 'generation', contextVersion: 0,
    contextSnapshot: emptyTripContext('trip'), idempotencyKey: 'run' })).run
  const input: GoalCompletionInput = { goalId: goal.id, runId: run.id, expectedGoalRevision: 0, expectedRunRevision: 0,
    goalStatus: 'satisfied', runStatus: 'satisfied', currentTripVersion: 0 }
  return { goals, runs, goal, run, input, advanceTrip: () => { tripVersion += 1 } }
}

describe('atomic in-memory Goal completion', () => {
  it('commits both records once and makes a transport retry idempotent', async () => {
    const test = await fixture()
    const first = await test.runs.commitCompletion(test.input)
    expect(first).toMatchObject({ goal: { status: 'satisfied', revision: 1 }, run: { status: 'satisfied', revision: 1 } })
    expect(await test.runs.commitCompletion(test.input)).toEqual(first)
  })

  it('does not change the Goal when the later run validation fails', async () => {
    const test = await fixture()
    await expect(test.runs.commitCompletion({ ...test.input, expectedRunRevision: 7 })).rejects.toMatchObject({ code: 'GOAL_RUN_REVISION_CONFLICT' })
    expect(await test.goals.get(test.goal.id)).toMatchObject({ status: 'pending', revision: 0 })
    expect(await test.runs.get(test.run.id)).toMatchObject({ status: 'running', revision: 0 })
  })

  it('repairs a historical completed run whose Goal update did not persist', async () => {
    const test = await fixture()
    const run = await test.runs.update(test.run.id, 0, { status: 'satisfied' })
    const repaired = await test.runs.commitCompletion({ ...test.input, expectedRunRevision: run.revision })
    expect(repaired.goal).toMatchObject({ status: 'satisfied', revision: 1 })
    expect(repaired.run).toEqual(run)
  })

  it('keeps partial work running and can later atomically cancel it', async () => {
    const test = await fixture()
    const partial = await test.runs.commitCompletion({ ...test.input, goalStatus: 'partial', runStatus: 'running' })
    expect(partial).toMatchObject({ goal: { status: 'partial', revision: 1 }, run: { status: 'running', revision: 0 } })
    const cancelled = await test.runs.commitCompletion({ ...test.input, expectedGoalRevision: 1, goalStatus: 'cancelled', runStatus: 'cancelled' })
    expect(cancelled).toMatchObject({ goal: { status: 'cancelled' }, run: { status: 'cancelled' } })
    await expect(test.runs.commitCompletion({ ...test.input, expectedGoalRevision: cancelled.goal.revision, expectedRunRevision: cancelled.run.revision }))
      .rejects.toMatchObject({ code: 'GOAL_STATUS_CONFLICT' })
  })

  it('cancels an unfinished Goal while preserving an already terminal historical run', async () => {
    const test = await fixture()
    const partial = await test.runs.commitCompletion({ ...test.input, goalStatus: 'partial', runStatus: 'partial' })
    const cancelled = await test.runs.commitCompletion({ ...test.input, expectedGoalRevision: 1, expectedRunRevision: 1,
      goalStatus: 'cancelled', runStatus: 'partial' })
    expect(cancelled.goal.status).toBe('cancelled')
    expect(cancelled.run).toEqual(partial.run)
  })

  it('rejects stale Trip versions and inconsistent completion pairs before changing either record', async () => {
    const test = await fixture()
    const { currentTripVersion: _currentTripVersion, ...withoutVersion } = test.input
    await expect(test.runs.commitCompletion(withoutVersion)).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_REQUIRED' })
    await expect(test.runs.commitCompletion({ ...test.input, runStatus: 'failed' })).rejects.toMatchObject({ code: 'GOAL_COMPLETION_STATUS_MISMATCH' })
    test.advanceTrip()
    await expect(test.runs.commitCompletion(test.input)).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(await test.goals.get(test.goal.id)).toMatchObject({ status: 'pending', revision: 0 })
    expect(await test.runs.get(test.run.id)).toMatchObject({ status: 'running', revision: 0 })
  })

  it('serializes competing completion/cancellation without splitting aggregate statuses', async () => {
    const test = await fixture()
    const results = await Promise.allSettled([
      test.runs.commitCompletion({ ...test.input, goalStatus: 'cancelled', runStatus: 'cancelled' }),
      test.runs.commitCompletion(test.input)
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await test.goals.get(test.goal.id)).toMatchObject({ status: 'cancelled' })
    expect(await test.runs.get(test.run.id)).toMatchObject({ status: 'cancelled' })
  })

  it('rejects a Goal id from another aggregate', async () => {
    const test = await fixture()
    const other = (await test.goals.create({ tripId: 'trip', kind: 'flight_search', parameters: { requestKey: 'other' }, createdContextVersion: 0, idempotencyKey: 'other' })).goal
    await expect(test.runs.commitCompletion({ ...test.input, goalId: other.id })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(await test.goals.get(other.id)).toMatchObject({ status: 'pending' })
    expect(await test.runs.get(test.run.id)).toMatchObject({ status: 'running' })
  })
})
