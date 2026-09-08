import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import {
  flightSearchGoalParametersSchema,
  goalRecordSchema,
  goalRunRecordSchema,
  travelGuideGoalParametersSchema,
  tripContextUpdateGoalParametersSchema,
  type GoalRecord,
  type GoalRunRecord
} from '../goals/types.js'
import type { GoalRepository, GoalRunRepository } from '../goals/repository.js'
import { goalVerificationSchema, type GoalVerifierRegistry } from '../goals/verifier.js'
import type { AgentTool } from '../runtime/registry.js'

const missing = (name: string): never => {
  throw new AppError('GOAL_RUNTIME_UNAVAILABLE', `${name} is not configured for this runtime`, 503)
}

const declareGoalInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('travel_guide'), parameters: travelGuideGoalParametersSchema }).strict(),
  z.object({ kind: z.literal('flight_search'), parameters: flightSearchGoalParametersSchema }).strict(),
  z.object({ kind: z.literal('trip_context_update'), parameters: tripContextUpdateGoalParametersSchema }).strict()
])

const declareGoalOutputSchema = z.object({ goal: goalRecordSchema, run: goalRunRecordSchema }).strict()
const goalIdInputSchema = z.object({ goalId: z.string().uuid() }).strict()
const goalOutputSchema = z.object({ goal: goalRecordSchema.optional(), run: goalRunRecordSchema.optional() }).strict()
const finishGoalOutputSchema = z.object({ goal: goalRecordSchema, run: goalRunRecordSchema, verification: goalVerificationSchema }).strict()

function repos(context: Parameters<NonNullable<AgentTool['execute']>>[1]): { goals: GoalRepository; runs: GoalRunRepository; verifiers: GoalVerifierRegistry } {
  if (!context.goalRepository || !context.goalRunRepository || !context.goalVerifiers) return missing('Goal repositories/verifiers')
  return { goals: context.goalRepository, runs: context.goalRunRepository, verifiers: context.goalVerifiers }
}

function owner(context: Parameters<NonNullable<AgentTool['execute']>>[1]): string {
  if (!context.ownerId) return missing('Authenticated Goal owner')
  return context.ownerId
}

async function selectedGoal(context: Parameters<NonNullable<AgentTool['execute']>>[1], goals: GoalRepository): Promise<GoalRecord | undefined> {
  if (context.activeGoalId) {
    const active = await goals.get(context.activeGoalId)
    if (active && active.status !== 'satisfied' && active.status !== 'cancelled') return active
  }
  return (await goals.listForTrip(context.tripId)).find(goal => goal.status !== 'satisfied' && goal.status !== 'cancelled')
}

function runMatchesGoal(
  run: GoalRunRecord | undefined,
  goal: GoalRecord,
  context: Parameters<NonNullable<AgentTool['execute']>>[1],
  contextVersion?: number
): run is GoalRunRecord {
  return run !== undefined
    && run.ownerId === owner(context)
    && run.tripId === context.tripId
    && run.goalId === goal.id
    && (contextVersion === undefined || run.contextVersion === contextVersion)
}

async function ensureCurrentRun(
  context: Parameters<NonNullable<AgentTool['execute']>>[1],
  goal: GoalRecord,
  runs: GoalRunRepository
) {
  const current = await context.trips.get(context.tripId)
  if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
  let running = (await runs.listForGoal(goal.id)).find(run => run.status === 'running')
  if (running && running.contextVersion !== current.version) {
    running = await runs.update(running.id, running.revision, { status: 'partial', workingSet: running.workingSet })
  }
  const run = running?.status === 'running'
    ? running
    : goal.status === 'satisfied' || goal.status === 'cancelled'
      ? undefined
      : (await runs.create({
        goalId: goal.id,
        tripId: context.tripId,
        generationId: context.generationId,
        contextVersion: current.version,
        contextSnapshot: current,
        idempotencyKey: `resume:${context.generationId}`
      })).run
  context.activeGoalId = goal.id
  if (run) {
    context.activeGoalRunId = run.id
    context.activeGoalContextVersion = run.contextVersion
  } else {
    delete context.activeGoalRunId
    delete context.activeGoalContextVersion
  }
  return run
}

export const declareGoalTool: AgentTool = {
  name: 'declare_goal',
  description: 'Declare a durable planning goal for the active Trip and start a run from the current server snapshot. Provide only typed user-intent parameters. Owner, Trip, Conversation, version, timestamps, and idempotency are server-owned. Explicit final route generation uses start_route_generation instead.',
  inputSchema: declareGoalInputSchema,
  outputSchema: declareGoalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 2_000,
  async execute(input, context) {
    const { goals, runs } = repos(context)
    const current = await context.trips.get(context.tripId)
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    const value = input as z.infer<typeof declareGoalInputSchema>
    const created = await goals.create({
      tripId: context.tripId,
      conversationId: context.conversationId,
      kind: value.kind,
      parameters: value.parameters,
      createdContextVersion: current.version,
      idempotencyKey: `request:${context.requestId}:${value.kind}`
    })
    const run = await runs.create({
      goalId: created.goal.id, tripId: context.tripId, generationId: context.generationId,
      contextVersion: current.version, contextSnapshot: current,
      idempotencyKey: `generation:${context.generationId}`
    })
    context.activeGoalId = created.goal.id
    context.activeGoalRunId = run.run.id
    context.activeGoalContextVersion = run.run.contextVersion
    return { goal: created.goal, run: run.run }
  }
}

export const getGoalTool: AgentTool = {
  name: 'get_active_goal',
  description: 'Read the server-selected active Goal for this Trip and resume it with a current-context run when needed. No owner, Trip, or Goal id is accepted from model arguments.',
  inputSchema: z.object({}).strict(),
  outputSchema: goalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 2_000,
  async execute(_input, context) {
    const { goals, runs } = repos(context)
    const goal = await selectedGoal(context, goals)
    if (!goal) return {}
    if (goal.ownerId !== owner(context) || goal.tripId !== context.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    const run = await ensureCurrentRun(context, goal, runs)
    return run ? { goal, run } : { goal }
  }
}

export const finishGoalTool: AgentTool = {
  name: 'finish_goal',
  description: 'Finish a durable Goal by running its server-side verifier. Narrated success or a tool trace alone never satisfies a Goal.',
  inputSchema: goalIdInputSchema,
  outputSchema: finishGoalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 5_000,
  async execute(input, context) {
    const { goals, runs, verifiers } = repos(context)
    const goalId = (input as z.infer<typeof goalIdInputSchema>).goalId
    const goal = await goals.get(goalId)
    if (!goal || goal.ownerId !== owner(context) || goal.tripId !== context.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    const current = await context.trips.get(context.tripId)
    const activeRun = context.activeGoalRunId ? await runs.get(context.activeGoalRunId) : undefined
    const run = current && runMatchesGoal(activeRun, goal, context, current.version)
      ? activeRun
      : current ? await runs.latestCompatible({ goalId, tripId: context.tripId, contextVersion: current.version }) : undefined
    if (!run) throw new AppError('GOAL_RUN_NOT_FOUND', 'No compatible Goal run exists', 409)
    if (!runMatchesGoal(run, goal, context, current?.version)) {
      throw new AppError('GOAL_RUN_NOT_FOUND', 'No compatible Goal run exists', 409)
    }
    const verification = await verifiers.verify(goal, { ownerId: owner(context), tripId: context.tripId, run, artifacts: context.artifacts, ...(current ? { currentTrip: current } : {}) })
    // A finish request is not permission to downgrade an unfinished run. The
    // verifier may explicitly report pending while the Agent gathers evidence.
    if (verification.status === 'pending') return { goal, run, verification }
    const runStatus = verification.status === 'satisfied' ? 'satisfied' : verification.status === 'partial' ? 'partial' : 'failed'
    const updatedRun = await runs.update(run.id, run.revision, { status: runStatus, workingSet: run.workingSet })
    const updatedGoal = await goals.update(goal.id, goal.revision, { status: verification.status })
    return { goal: updatedGoal, run: updatedRun, verification }
  }
}

export const cancelGoalTool: AgentTool = {
  name: 'cancel_goal',
  description: 'Cancel an owner-scoped durable Goal and its active run.',
  inputSchema: goalIdInputSchema,
  outputSchema: goalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 2_000,
  async execute(input, context) {
    const { goals, runs } = repos(context)
    const goalId = (input as z.infer<typeof goalIdInputSchema>).goalId
    const goal = await goals.get(goalId)
    if (!goal || goal.ownerId !== owner(context) || goal.tripId !== context.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    const activeRun = context.activeGoalRunId ? await runs.get(context.activeGoalRunId) : undefined
    const run = runMatchesGoal(activeRun, goal, context)
      ? activeRun
      : (await runs.listForGoal(goal.id)).find(candidate => runMatchesGoal(candidate, goal, context) && candidate.status === 'running')
    const updatedRun = run && run.status === 'running' ? await runs.update(run.id, run.revision, { status: 'cancelled' }) : run
    const updatedGoal = await goals.update(goal.id, goal.revision, { status: 'cancelled' })
    return updatedRun ? { goal: updatedGoal, run: updatedRun } : { goal: updatedGoal }
  }
}
