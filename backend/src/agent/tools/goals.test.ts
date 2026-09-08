import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { GoalVerifierRegistry } from '../goals/verifier.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { createPlannerToolRegistry } from './core.js'
import { cancelGoalTool, finishGoalTool, getGoalTool, resumeGoalTool } from './goals.js'

const ownerId = 'owner-goal-tools'
const tripId = 'trip-goal-tools'
const call = (id: string, name: string, args = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

function context(
  goals: InMemoryGoalRepository,
  runs: InMemoryGoalRunRepository,
  activeGoalId?: string,
  activeGoalRunId?: string
): ToolExecutionContext {
  return {
    ownerId,
    requestId: 'request-1',
    conversationId: '018f3f7a-75a4-7cc7-b926-7f8fe2d39410',
    tripId,
    generationId: 'generation-1',
    trips: new InMemoryTripContextRepository([{ ...emptyTripContext(tripId), version: 0 }]),
    artifacts: new InMemoryArtifactRepository(ownerId, new Set([tripId])),
    goalRepository: goals,
    goalRunRepository: runs,
    goalVerifiers: new GoalVerifierRegistry().register({
      kind: 'travel_guide',
      async verify() { return { status: 'satisfied', artifactIds: [], missing: [], warnings: [] } }
    }),
    ...(activeGoalId ? { activeGoalId } : {}),
    ...(activeGoalRunId ? { activeGoalRunId } : {})
  } as ToolExecutionContext
}

async function goal(goals: InMemoryGoalRepository, key: string) {
  return (await goals.create({
    tripId,
    kind: 'travel_guide',
    parameters: {
      questions: ['museums'], researchTypes: ['activity'],
      maxResults: 10, maxCities: 1, allowPartial: true
    },
    createdContextVersion: 0,
    idempotencyKey: key
  })).goal
}

async function run(runs: InMemoryGoalRunRepository, goalId: string, key: string) {
  return (await runs.create({
    goalId,
    tripId,
    generationId: key,
    contextVersion: 0,
    contextSnapshot: { ...emptyTripContext(tripId), version: 0 },
    idempotencyKey: key
  })).run
}

describe('Goal control tools', () => {
  it('reads a selected Goal and its old run without accepting it or changing durable state', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const savedGoal = await goal(goals, 'saved-goal')
    const savedRun = await run(runs, savedGoal.id, 'saved-run')
    const state = context(goals, runs)
    await state.trips.update(tripId, { notes: ['updated user objective'] })
    const create = vi.spyOn(runs, 'create')
    const update = vi.spyOn(runs, 'update')

    const result = await getGoalTool.execute({ goalId: savedGoal.id }, state, new AbortController().signal)

    expect(result).toEqual({ goal: savedGoal, run: savedRun })
    expect(getGoalTool).toMatchObject({ sideEffect: 'none', parallelSafe: true })
    expect(state.activeGoalId).toBeUndefined()
    expect(state.activeGoalKind).toBeUndefined()
    expect(state.activeGoalRunId).toBeUndefined()
    expect(state.activeGoalContextVersion).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(await runs.listForGoal(savedGoal.id)).toEqual([savedRun])
  })

  it('returns ambiguous candidates without creating or activating any run', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const first = await goal(goals, 'first-goal')
    const second = await goal(goals, 'second-goal')
    const state = context(goals, runs)
    const result = await getGoalTool.execute({ kind: 'travel_guide' }, state, new AbortController().signal)
    expect(result).toMatchObject({ candidates: expect.arrayContaining([first, second]) })
    expect(result).not.toHaveProperty('goal')
    expect(state.activeGoalId).toBeUndefined()
    expect(await runs.listForGoal(first.id)).toEqual([])
    expect(await runs.listForGoal(second.id)).toEqual([])
  })

  it('does not switch the active Goal when another Goal is inspected', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const activeGoal = await goal(goals, 'active-goal')
    const activeRun = await run(runs, activeGoal.id, 'active-run')
    const inspectedGoal = await goal(goals, 'inspected-goal')
    const inspectedRun = await run(runs, inspectedGoal.id, 'inspected-run')
    const state = context(goals, runs, activeGoal.id, activeRun.id)
    expect(await getGoalTool.execute({ goalId: inspectedGoal.id }, state, new AbortController().signal))
      .toMatchObject({ goal: { id: inspectedGoal.id }, run: { id: inspectedRun.id } })
    expect(state).toMatchObject({ activeGoalId: activeGoal.id, activeGoalRunId: activeRun.id })
  })

  it('only an explicit resume starts and activates a current-context run', async () => {
    expect(createPlannerToolRegistry().get('resume_goal')).toBe(resumeGoalTool)
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const savedGoal = await goal(goals, 'saved-goal')
    const savedRun = await run(runs, savedGoal.id, 'saved-run')
    const state = context(goals, runs)
    const current = await state.trips.update(tripId, { notes: ['new context version'] })
    await getGoalTool.execute({ goalId: savedGoal.id }, state, new AbortController().signal)
    expect(await runs.listForGoal(savedGoal.id)).toEqual([savedRun])

    const resumed = await resumeGoalTool.execute({ goalId: savedGoal.id }, state, new AbortController().signal)
    expect(resumed).toMatchObject({ goal: { id: savedGoal.id }, run: { status: 'running', contextVersion: current.version, contextSnapshot: current } })
    expect(state.activeGoalId).toBe(savedGoal.id)
    expect(state.activeGoalKind).toBe('travel_guide')
    expect(state.activeGoalRunId).not.toBe(savedRun.id)
    expect(state.activeGoalContextVersion).toBe(current.version)
    expect((await runs.get(savedRun.id))?.status).toBe('partial')
    expect(await runs.listForGoal(savedGoal.id)).toHaveLength(2)

    const repeated = await resumeGoalTool.execute({ goalId: savedGoal.id }, state, new AbortController().signal)
    expect(repeated).toEqual(resumed)
    expect(await runs.listForGoal(savedGoal.id)).toHaveLength(2)
  })

  it.each(['satisfied', 'cancelled'] as const)('does not reactivate a %s Goal', async status => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const savedGoal = await goal(goals, 'terminal-goal')
    const savedRun = await run(runs, savedGoal.id, 'terminal-run')
    await runs.commitCompletion({
      goalId: savedGoal.id, runId: savedRun.id, expectedGoalRevision: savedGoal.revision,
      expectedRunRevision: savedRun.revision, goalStatus: status, runStatus: status, currentTripVersion: 0
    })
    const state = context(goals, runs)
    await expect(resumeGoalTool.execute({ goalId: savedGoal.id }, state, new AbortController().signal))
      .rejects.toMatchObject({ code: 'GOAL_NOT_RUNNABLE' })
    expect(state.activeGoalId).toBeUndefined()
    expect(state.activeGoalRunId).toBeUndefined()
    expect(await runs.listForGoal(savedGoal.id)).toHaveLength(1)
  })

  it('does not include an inspected Goal in turn delivery or run its verifier', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const savedGoal = await goal(goals, 'saved-goal')
    const savedRun = await run(runs, savedGoal.id, 'saved-run')
    const state = context(goals, runs)
    const verify = vi.spyOn(state.goalVerifiers!, 'verify')
    const complete = vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('inspect', 'get_active_goal')] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'The saved objective requests museum activities.' } })
    const result = await new AgentRuntime({ complete }, createPlannerToolRegistry()).run({
      messages: [{ role: 'user', content: 'What does the previous objective request?' }], context: state
    })
    expect(result).toMatchObject({ stopReason: 'responded', delivery: { status: 'not_requested', goals: [] } })
    expect(verify).not.toHaveBeenCalled()
    expect(await goals.get(savedGoal.id)).toEqual(savedGoal)
    expect(await runs.listForGoal(savedGoal.id)).toEqual([savedRun])
  })

  it('includes only the newly declared objective after inspecting incompatible saved parameters', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const savedGoal = (await goals.create({
      tripId, kind: 'travel_guide', createdContextVersion: 0, idempotencyKey: 'events-goal',
      parameters: { questions: ['exhibitions and festivals'], researchTypes: ['event'], maxResults: 10, maxCities: 1, allowPartial: false }
    })).goal
    const savedRun = await run(runs, savedGoal.id, 'events-run')
    const state = context(goals, runs)
    const verify = vi.spyOn(state.goalVerifiers!, 'verify')
    const revised = { questions: ['museum visits and meals'], researchTypes: ['activity', 'practical'], maxResults: 10, maxCities: 1, allowPartial: false }
    const complete = vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('inspect', 'get_active_goal', { goalId: savedGoal.id })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('declare', 'declare_goal', { kind: 'travel_guide', parameters: revised })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'The revised guide is ready.' } })
    const result = await new AgentRuntime({ complete }, createPlannerToolRegistry()).run({
      messages: [{ role: 'user', content: 'No exhibitions or festivals are needed; prepare museum visits and meals.' }], context: state
    })
    const created = (await goals.listForTrip(tripId)).find(value => value.id !== savedGoal.id)!
    expect(created.parameters).toEqual(revised)
    expect(result).toMatchObject({ stopReason: 'completed', delivery: { status: 'satisfied', goalId: created.id, goals: [{ goalId: created.id }] } })
    expect(result.delivery.goals).toHaveLength(1)
    expect(verify.mock.calls.map(([value]) => value.id)).toEqual([created.id])
    expect(await goals.get(savedGoal.id)).toEqual(savedGoal)
    expect(await runs.listForGoal(savedGoal.id)).toEqual([savedRun])
  })

  it('finishes only a run that belongs to the requested goal', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const firstGoal = await goal(goals, 'goal-1')
    const firstRun = await run(runs, firstGoal.id, 'run-1')
    const secondGoal = await goal(goals, 'goal-2')
    const secondRun = await run(runs, secondGoal.id, 'run-2')

    const result = await finishGoalTool.execute(
      { goalId: secondGoal.id }, context(goals, runs, firstGoal.id, firstRun.id), new AbortController().signal
    )

    expect(result).toMatchObject({ goal: { id: secondGoal.id, status: 'satisfied' }, run: { id: secondRun.id, status: 'satisfied' } })
    await expect(runs.get(firstRun.id)).resolves.toMatchObject({ status: 'running' })
  })

  it('cancels only a run that belongs to the requested goal', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const firstGoal = await goal(goals, 'goal-1')
    const firstRun = await run(runs, firstGoal.id, 'run-1')
    const secondGoal = await goal(goals, 'goal-2')
    const secondRun = await run(runs, secondGoal.id, 'run-2')

    const result = await cancelGoalTool.execute(
      { goalId: secondGoal.id }, context(goals, runs, firstGoal.id, firstRun.id), new AbortController().signal
    )

    expect(result).toMatchObject({ goal: { id: secondGoal.id, status: 'cancelled' }, run: { id: secondRun.id, status: 'cancelled' } })
    await expect(runs.get(firstRun.id)).resolves.toMatchObject({ status: 'running' })
  })
})
