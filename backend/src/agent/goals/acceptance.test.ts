import { describe, expect, it } from 'vitest'
import { emptyTripContext } from '../../trips/types.js'
import { acceptGoalRunInputSchema, plannerGoalIntentSchema, type AcceptGoalRunInput } from './acceptance-types.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from './repository.js'

function fixture() {
  let version = 0
  const tripId = 'acceptance-trip'
  const sharedGoals = new Map()
  const sharedRuns = new Map()
  const goals = new InMemoryGoalRepository('owner', sharedGoals)
  const runs = new InMemoryGoalRunRepository('owner', goals, sharedRuns, () => version)
  const input: AcceptGoalRunInput = { tripId, requestId: 'request-1', generationId: 'generation-1',
    contextSnapshot: emptyTripContext(tripId), intent: { kind: 'flight_search', parameters: { requestKey: 'flights' } } }
  return { input, goals, runs, sharedGoals, sharedRuns, setVersion: (value: number) => { version = value } }
}

describe('atomic Planner goal acceptance', () => {
  it('requires exactly one bounded Planner intent or goal reference and a same-Trip snapshot', () => {
    const { input } = fixture()
    expect(acceptGoalRunInputSchema.safeParse(input).success).toBe(true)
    expect(acceptGoalRunInputSchema.safeParse({ ...input, intent: undefined }).success).toBe(false)
    expect(acceptGoalRunInputSchema.safeParse({ ...input, goalRef: '00000000-0000-4000-8000-000000000001' }).success).toBe(false)
    expect(acceptGoalRunInputSchema.safeParse({ ...input, contextSnapshot: emptyTripContext('other') }).success).toBe(false)
    expect(plannerGoalIntentSchema.safeParse({ kind: 'route_generation', parameters: { requestKey: 'route' } }).success).toBe(false)
  })

  it('atomically accepts and concurrently replays one immutable Goal and Run', async () => {
    const { input, runs, goals } = fixture()
    const [first, replay] = await Promise.all([runs.accept(input), runs.accept(input)])
    expect(replay).toEqual(first)
    expect(await goals.listForTrip(input.tripId)).toHaveLength(1)
    expect(await runs.listForGoal(first.goal.id)).toHaveLength(1)
    expect(first.run).not.toHaveProperty('idempotencyKey')
    await expect(runs.accept({ ...input, intent: { kind: 'flight_search', parameters: { requestKey: 'changed' } } }))
      .rejects.toMatchObject({ code: 'GOAL_IDEMPOTENCY_CONFLICT' })
  })

  it('never takes over a running generation, including after the Trip version changes', async () => {
    const { input, runs, setVersion } = fixture()
    const first = await runs.accept(input)
    const continuation = { ...input, intent: undefined, goalRef: first.goal.id, requestId: 'request-2', generationId: 'generation-2' }
    await expect(runs.accept(continuation)).rejects.toMatchObject({ code: 'GOAL_RUN_ALREADY_RUNNING' })
    setVersion(1)
    await expect(runs.accept({ ...continuation, contextSnapshot: { ...input.contextSnapshot, version: 1 } }))
      .rejects.toMatchObject({ code: 'GOAL_RUN_ALREADY_RUNNING' })
    await expect(runs.accept({ ...input, contextSnapshot: { ...input.contextSnapshot, version: 1 } }))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect((await runs.get(first.run.id))?.status).toBe('running')
  })

  it.each(['failed', 'partial'] as const)('continues a %s attempt with a new generation and frozen current context', async status => {
    const { input, runs, setVersion } = fixture()
    const first = await runs.accept(input)
    await runs.commitCompletion({ goalId: first.goal.id, runId: first.run.id, expectedGoalRevision: 0, expectedRunRevision: 0,
      goalStatus: status, runStatus: status })
    await expect(runs.accept(input)).rejects.toMatchObject({ code: 'GOAL_RUN_NOT_RUNNING' })
    setVersion(1)
    const next = await runs.accept({ ...input, intent: undefined, goalRef: first.goal.id,
      requestId: 'continue', generationId: 'generation-2', contextSnapshot: { ...input.contextSnapshot, version: 1 } })
    expect(next.goal.id).toBe(first.goal.id)
    expect(next.goal.parameters).toEqual(first.goal.parameters)
    expect(next.run.id).not.toBe(first.run.id)
    expect(next.run.contextVersion).toBe(1)
    expect(next.run.status).toBe('running')
  })

  it('rejects stale current context before creating a Goal', async () => {
    const { input, runs, goals, setVersion } = fixture()
    setVersion(1)
    await expect(runs.accept(input)).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(await goals.listForTrip(input.tripId)).toEqual([])
  })

  it('preserves atomicity when committing the Run fails', async () => {
    const { input, goals } = fixture()
    class FailingMap extends Map { override set(): this { throw new Error('injected Run storage failure') } }
    const runs = new InMemoryGoalRunRepository('owner', goals, new FailingMap())
    await expect(runs.accept(input)).rejects.toThrow('injected Run storage failure')
    expect(await goals.listForTrip(input.tripId)).toEqual([])
  })

  it('rejects foreign owners, wrong Trips and route generation references', async () => {
    const { input, goals, runs, sharedGoals, sharedRuns } = fixture()
    const first = await runs.accept(input)
    const referenced = { ...input, intent: undefined, goalRef: first.goal.id }
    const foreign = new InMemoryGoalRunRepository('foreign', new InMemoryGoalRepository('foreign', sharedGoals), sharedRuns)
    await expect(foreign.accept(referenced)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(runs.accept({ ...referenced, tripId: 'other', contextSnapshot: emptyTripContext('other') }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    const route = await goals.create({ tripId: input.tripId, kind: 'route_generation', parameters: { requestKey: 'route' },
      createdContextVersion: 0, idempotencyKey: 'route', authorization: { source: 'button', grantedAt: new Date().toISOString() } })
    await expect(runs.accept({ ...referenced, goalRef: route.goal.id })).rejects.toMatchObject({ code: 'GOAL_NOT_RUNNABLE' })
  })

  it('rejects a new generation for a completed or cancelled Goal', async () => {
    const { input, runs } = fixture()
    const first = await runs.accept(input)
    await runs.commitCompletion({ goalId: first.goal.id, runId: first.run.id, expectedGoalRevision: 0, expectedRunRevision: 0,
      goalStatus: 'cancelled', runStatus: 'cancelled' })
    await expect(runs.accept(input)).rejects.toMatchObject({ code: 'GOAL_NOT_RUNNABLE' })
    await expect(runs.accept({ ...input, generationId: 'generation-2' })).rejects.toMatchObject({ code: 'GOAL_NOT_RUNNABLE' })
  })
})
