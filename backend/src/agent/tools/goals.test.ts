import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { GoalVerifierRegistry } from '../goals/verifier.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { cancelGoalTool, finishGoalTool } from './goals.js'

const ownerId = 'owner-goal-tools'
const tripId = 'trip-goal-tools'

function context(
  goals: InMemoryGoalRepository,
  runs: InMemoryGoalRunRepository,
  activeGoalId: string,
  activeGoalRunId: string
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
    activeGoalId,
    activeGoalRunId
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
