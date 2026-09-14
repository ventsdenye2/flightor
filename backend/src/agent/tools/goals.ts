import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import {
  flightSearchGoalParametersSchema,
  goalRecordSchema,
  goalRunRecordSchema,
  goalKindSchema,
  travelGuideGoalParametersSchema,
  tripContextUpdateGoalParametersSchema,
  type GoalRecord,
  type GoalRunRecord
} from '../goals/types.js'
import type { GoalRepository, GoalRunRepository } from '../goals/repository.js'
import { goalVerificationSchema, type GoalVerifierRegistry } from '../goals/verifier.js'
import { completeGoal } from '../goals/completion.js'
import { closeGoalRunAttempt } from '../goals/attempt.js'
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
const goalOutputSchema = z.object({ goal: goalRecordSchema.optional(), run: goalRunRecordSchema.optional(), candidates: z.array(goalRecordSchema).max(40).optional() }).strict()
const getGoalInputSchema = z.object({ goalId: z.string().uuid().optional(), kind: goalKindSchema.optional() }).strict()
const finishGoalOutputSchema = z.object({ goal: goalRecordSchema, run: goalRunRecordSchema, verification: goalVerificationSchema }).strict()

function repos(context: Parameters<NonNullable<AgentTool['execute']>>[1]): { goals: GoalRepository; runs: GoalRunRepository; verifiers: GoalVerifierRegistry } {
  if (!context.goalRepository || !context.goalRunRepository || !context.goalVerifiers) return missing('Goal repositories/verifiers')
  return { goals: context.goalRepository, runs: context.goalRunRepository, verifiers: context.goalVerifiers }
}

function owner(context: Parameters<NonNullable<AgentTool['execute']>>[1]): string {
  if (!context.ownerId) return missing('Authenticated Goal owner')
  return context.ownerId
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
  runs: GoalRunRepository,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const current = await context.trips.get(context.tripId)
  signal.throwIfAborted()
  if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
  let running = (await runs.listForGoal(goal.id)).find(run => run.status === 'running')
  signal.throwIfAborted()
  if (running) assertRunGeneration(context, running)
  if (running && running.contextVersion !== current.version) {
    running = await runs.update(running.id, running.revision, { status: 'partial', workingSet: running.workingSet })
  }
  signal.throwIfAborted()
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
  if (run) await checkRunActivation(context, goal, run, runs, signal)
  context.activeGoalId = goal.id
  context.activeGoalKind = goal.kind
  if (run) {
    context.activeGoalRunId = run.id
    context.activeGoalContextVersion = run.contextVersion
  } else {
    delete context.activeGoalRunId
    delete context.activeGoalContextVersion
  }
  return run
}

function assertRunGeneration(
  context: Parameters<NonNullable<AgentTool['execute']>>[1], run: GoalRunRecord
) {
  if (run.status === 'running' && run.generationId !== context.generationId) {
    throw new AppError('GOAL_RUN_ALREADY_RUNNING', 'Goal execution belongs to another operation; wait for it to finish before resuming', 409)
  }
}

async function checkRunActivation(
  context: Parameters<NonNullable<AgentTool['execute']>>[1],
  goal: GoalRecord, run: GoalRunRecord, runs: GoalRunRepository, signal: AbortSignal
) {
  assertRunGeneration(context, run)
  if (!signal.aborted && context.isGenerationCurrent?.() !== false) return
  // A database creation can finish after the tool/turn already timed out. Its
  // promise remains observed by the registry, so close that late attempt here.
  await closeGoalRunAttempt({ ownerId: owner(context), tripId: context.tripId,
    generationId: context.generationId, runs }, { goalId: goal.id, runId: run.id, status: 'cancelled' })
  signal.throwIfAborted()
  throw new AppError('GOAL_RUN_NOT_CURRENT', 'The active operation changed', 409)
}

export const declareGoalTool: AgentTool = {
  name: 'declare_goal',
  description: 'Declare a durable planning goal for the active Trip and start a run from the current server snapshot. Provide only typed user-intent parameters. Owner, Trip, Conversation, version, timestamps, and idempotency are server-owned. Explicit final route generation uses start_route_generation instead.',
  inputSchema: declareGoalInputSchema,
  outputSchema: declareGoalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 2_000,
  async execute(input, context, signal) {
    signal.throwIfAborted()
    const { goals, runs } = repos(context)
    const current = await context.trips.get(context.tripId)
    signal.throwIfAborted()
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
    signal.throwIfAborted()
    const run = await runs.create({
      goalId: created.goal.id, tripId: context.tripId, generationId: context.generationId,
      contextVersion: current.version, contextSnapshot: current,
      idempotencyKey: `generation:${context.generationId}`
    })
    await checkRunActivation(context, created.goal, run.run, runs, signal)
    context.activeGoalId = created.goal.id
    context.activeGoalKind = created.goal.kind
    context.activeGoalRunId = run.run.id
    context.activeGoalContextVersion = run.run.contextVersion
    return { goal: created.goal, run: run.run }
  }
}

export const getGoalTool: AgentTool = {
  name: 'get_active_goal',
  description: 'Read unfinished goals and their existing runs for this Trip. Returns a selected goal or bounded candidates without activating a goal, creating a run, or accepting its parameters for this turn. To continue a matching objective use resume_goal; to accept new parameters use declare_goal. Owner and Trip are server-owned.',
  inputSchema: getGoalInputSchema,
  outputSchema: goalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'none', parallelSafe: true, timeoutMs: 2_000,
  async execute(input, context) {
    const { goals, runs } = repos(context)
    const selector = input as z.infer<typeof getGoalInputSchema>
    const ownerId = owner(context)
    const candidates = (await goals.listForTrip(context.tripId)).filter(goal => goal.ownerId === ownerId && goal.tripId === context.tripId
      && goal.status !== 'satisfied' && goal.status !== 'cancelled'
      && (selector.kind === undefined || goal.kind === selector.kind)
      && (selector.goalId === undefined || goal.id === selector.goalId)).slice(0, 40)
    const goal = selector.goalId ? candidates.find(item => item.id === selector.goalId)
      : candidates.find(item => item.id === context.activeGoalId) ?? (candidates.length === 1 ? candidates[0] : undefined)
    if (!goal) return { candidates }
    if (goal.ownerId !== owner(context) || goal.tripId !== context.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    const activeRun = context.activeGoalRunId ? await runs.get(context.activeGoalRunId) : undefined
    const run = runMatchesGoal(activeRun, goal, context) ? activeRun
      : (await runs.listForGoal(goal.id)).find(candidate => runMatchesGoal(candidate, goal, context))
    return run ? { goal, run } : { goal }
  }
}

export const resumeGoalTool: AgentTool = {
  name: 'resume_goal',
  description: 'Explicitly continue a durable Goal after inspecting that its saved parameters match the current user objective. Reuse only this turn\'s current-context run, or start a run from the current server Trip snapshot once earlier attempts have ended. A running attempt owned by another operation returns GOAL_RUN_ALREADY_RUNNING; wait for it rather than taking it over. Use declare_goal for a new objective or changed parameters. Satisfied and cancelled Goals cannot be resumed.',
  inputSchema: goalIdInputSchema,
  outputSchema: declareGoalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 2_000,
  async execute(input, context, signal) {
    const { goals, runs } = repos(context)
    const goal = await goals.get((input as z.infer<typeof goalIdInputSchema>).goalId)
    if (!goal || goal.ownerId !== owner(context) || goal.tripId !== context.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
    if (goal.status === 'satisfied' || goal.status === 'cancelled') {
      throw new AppError('GOAL_NOT_RUNNABLE', 'A satisfied or cancelled Goal cannot be resumed', 409)
    }
    const run = await ensureCurrentRun(context, goal, runs, signal)
    return { goal, run }
  }
}

export const finishGoalTool: AgentTool = {
  name: 'finish_goal',
  description: 'Finish a durable Goal by running its server-side verifier. Narrated success or a tool trace alone never satisfies a Goal.',
  inputSchema: goalIdInputSchema,
  outputSchema: finishGoalOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 5_000,
  async execute(input, context, signal) {
    const { goals, runs, verifiers } = repos(context)
    const goalId = (input as z.infer<typeof goalIdInputSchema>).goalId
    return completeGoal({
      ownerId: owner(context), tripId: context.tripId, trips: context.trips,
      artifacts: context.artifacts, goals, runs, verifiers, signal,
      ...(context.selectedFlight ? { selectedFlight: context.selectedFlight } : {}),
      ...(context.assertFlightSelectionCurrent ? { assertFlightSelectionCurrent: context.assertFlightSelectionCurrent } : {}),
      ...(context.isGenerationCurrent ? { isCurrent: context.isGenerationCurrent } : {})
    }, { goalId, ...(context.activeGoalRunId ? { runId: context.activeGoalRunId } : {}), closePartialRun: false })
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
    if (run) {
      const result = await runs.commitCompletion({
        goalId: goal.id, runId: run.id,
        expectedGoalRevision: goal.revision, expectedRunRevision: run.revision,
        goalStatus: 'cancelled', runStatus: run.status === 'running' ? 'cancelled' : run.status
      })
      context.activeGoalId = result.goal.id
      context.activeGoalKind = result.goal.kind
      context.activeGoalRunId = result.run.id
      context.activeGoalContextVersion = result.run.contextVersion
      return result
    }
    return { goal: await goals.update(goal.id, goal.revision, { status: 'cancelled' }) }
  }
}
