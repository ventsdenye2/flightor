import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { routeGenerationRunSchema, toRouteGenerationRunView } from '../../route-generation/contracts.js'
import { cancelRouteGenerationRun, executeRouteGenerationRun, startRouteGenerationRun } from '../../route-generation/service.js'
import { routeSetPayloadSchema } from '../../flight-routing/types.js'
import type { AgentTool } from '../runtime/registry.js'

const outputSchema = z.object({
  run: routeGenerationRunSchema,
  created: z.boolean()
}).strict()

function requestKey(requestId: string): string {
  return `agent:${createHash('sha256').update(requestId).digest('hex')}`
}

const budgetRouteSummarySchema = z.object({
  scope: z.literal('Lowest fare among candidates returned by this one-way search window; review the route artifact for fare and ticketing risks.'),
  candidateCount: z.number().int().nonnegative(),
  lowestFare: z.object({ amount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
  routes: z.array(z.object({
    id: z.string().min(1).max(160), locations: z.array(z.string().min(1).max(128)).min(2).max(32),
    transferCount: z.number().int().nonnegative(), totalFare: z.object({ amount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
    badges: z.array(z.enum(['cheapest', 'balanced', 'most_fun', 'best_match'])).max(4),
    riskNotices: z.array(z.string().min(1).max(240)).max(12)
  }).strict()).max(5),
  risks: z.array(z.string().min(1).max(240)).max(20)
}).strict()

const budgetOutputSchema = outputSchema.extend({
  artifact: z.object({ id: z.string().uuid(), type: z.literal('route_set'), schemaVersion: z.literal(1) }).strict().optional(),
  summary: budgetRouteSummarySchema.optional()
})

const BUDGET_ROUTE_TIMEOUT_MS = 110_000

function activeGoalConflict(context: Parameters<AgentTool['execute']>[1]): AppError | undefined {
  if (context.acceptedGoalIntent && context.acceptedGoalIntent.kind !== 'trip_context_update') {
    return new AppError('GOAL_INTENT_CONFLICT', 'Budget route search requires its own objective, separate from the active planning intent', 409)
  }
  if (context.activeGoalId && context.activeGoalKind !== 'trip_context_update' && context.activeGoalKind !== 'route_generation') {
    return new AppError('GOAL_INTENT_CONFLICT', 'Another planning objective is active; start budget route search in a separate turn', 409)
  }
  return undefined
}

async function verifyPrecedingTripUpdate(context: Parameters<AgentTool['execute']>[1]): Promise<void> {
  const accepted = context.acceptedGoalIntent
  if (!accepted) return
  if (!context.ownerId || !context.goalRepository || !context.goalRunRepository) {
    throw new AppError('GOAL_RUNTIME_UNAVAILABLE', 'Goal state is unavailable for this route request', 503)
  }
  const [goal, run] = await Promise.all([
    context.goalRepository.get(accepted.goalId), context.goalRunRepository.get(accepted.runId)
  ])
  if (!goal || !run || goal.ownerId !== context.ownerId || run.ownerId !== context.ownerId
    || goal.tripId !== context.tripId || run.tripId !== context.tripId || run.goalId !== goal.id
    || run.generationId !== context.generationId || goal.kind !== 'trip_context_update'
    || goal.status !== 'satisfied' || run.status !== 'satisfied') {
    throw new AppError('GOAL_NOT_RUNNABLE', 'Complete the Trip constraint update before starting a separate budget route search', 409)
  }
}

function budgetSummary(payload: Extract<z.infer<typeof routeSetPayloadSchema>, { kind: 'optimized_routes' }>) {
  const routes = payload.representatives.slice(0, 5).map(({ path, badges }) => ({
    id: path.id,
    locations: path.nodes.map(node => node.location.iata ?? node.location.cityCode ?? node.location.id),
    transferCount: path.transferCount,
    ...(path.totalFare ? { totalFare: path.totalFare } : {}),
    badges,
    riskNotices: [...new Set(path.edges.flatMap(edge => edge.warnings))].slice(0, 12)
  }))
  const cheapest = payload.representatives.find(value => value.badges.includes('cheapest'))
  return budgetRouteSummarySchema.parse({
    scope: 'Lowest fare among candidates returned by this one-way search window; review the route artifact for fare and ticketing risks.',
    candidateCount: payload.paretoFrontierCount,
    ...(cheapest?.path.totalFare ? { lowestFare: cheapest.path.totalFare } : {}),
    routes,
    risks: [...new Set([...payload.warnings, ...payload.representatives.flatMap(value => value.path.edges.flatMap(edge => edge.warnings))])].slice(0, 20)
  })
}

/** Queue the deterministic engine only for an explicit instruction in the active user message. */
export const startRouteGenerationTool: AgentTool<Record<string, never>, z.infer<typeof outputSchema>> = {
  name: 'start_route_generation',
  description: 'Queue final deterministic route generation only when the current user message unambiguously asks to generate the route. Readiness, discussion, recommendations, or Agent inference are not authorization. Owner, Trip, Conversation, idempotency, and authorization source are server-owned.',
  inputSchema: z.object({}).strict(),
  outputSchema,
  costClass: 'expensive',
  // The current milestone does not use provider cost as a functional gate.
  costUnits: 0,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 5_000,
  async execute(_input, context) {
    if (!context.ownerId || !context.routeGeneration) {
      throw new AppError('ROUTE_GENERATION_UNAVAILABLE', 'Route generation is not configured for this runtime', 503)
    }
    const result = await startRouteGenerationRun(context.routeGeneration, {
      ownerId: context.ownerId,
      tripId: context.tripId,
      conversationId: context.conversationId,
      idempotencyKey: requestKey(context.requestId),
      authorizationSource: 'explicit_user_message'
    })
    if (!result.run.goalId || !result.run.goalRunId) {
      throw new AppError('INVALID_ROUTE_GENERATION_LINEAGE', 'Route generation did not create durable Goal lineage', 500)
    }
    context.activeGoalId = result.run.goalId
    context.activeGoalKind = 'route_generation'
    context.activeGoalRunId = result.run.goalRunId
    context.activeGoalContextVersion = result.run.contextVersion
    return { run: toRouteGenerationRunView(result.run, { stale: false }), created: result.created }
  }
}

/** Search the current canonical one-way Trip constraints and finish inside the requesting turn. */
export const searchBudgetRoutesTool: AgentTool<Record<string, never>, z.infer<typeof budgetOutputSchema>> = {
  name: 'search_budget_routes',
  description: 'Use only after the user explicitly asks for cheaper flight routing or says connections are acceptable. First collect and save canonical origin, one required destination airport, and a one-way departure window with update_trip_context; this tool never adopts or guesses missing constraints. It searches only the current saved window and returns the lowest priced candidate found in that scope. Ordinary fare lookup belongs to search_flights. Review the linked route artifact for ticketing, transfer, fare-source, and protection risks.',
  inputSchema: z.object({}).strict(),
  outputSchema: budgetOutputSchema,
  costClass: 'expensive', costUnits: 0, sideEffect: 'state', parallelSafe: false,
  timeoutMs: BUDGET_ROUTE_TIMEOUT_MS,
  provider: 'route_generation',
  async execute(_input, context, parentSignal) {
    if (!context.ownerId || !context.routeGeneration) {
      throw new AppError('ROUTE_GENERATION_UNAVAILABLE', 'Route generation is not configured for this runtime', 503)
    }
    const conflict = activeGoalConflict(context)
    if (conflict) throw conflict
    parentSignal.throwIfAborted()
    await context.assertFlightSelectionCurrent?.()
    parentSignal.throwIfAborted()
    await verifyPrecedingTripUpdate(context)

    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(new AppError('ROUTE_GENERATION_TIMEOUT', 'Budget route search exceeded its time limit', 504)), BUDGET_ROUTE_TIMEOUT_MS)
    const signal = AbortSignal.any([parentSignal, timeoutController.signal])
    let runId: string | undefined
    try {
      const idempotencyKey = `budget:${createHash('sha256').update(context.requestId).digest('hex')}`
      const started = await startRouteGenerationRun(context.routeGeneration, {
        ownerId: context.ownerId, tripId: context.tripId, conversationId: context.conversationId,
        idempotencyKey, authorizationSource: 'explicit_user_message', dispatch: 'inline'
      })
      runId = started.run.id
      if (!started.run.goalId || !started.run.goalRunId) {
        throw new AppError('INVALID_ROUTE_GENERATION_LINEAGE', 'Route generation did not create durable Goal lineage', 500)
      }
      context.activeGoalId = started.run.goalId
      context.activeGoalKind = 'route_generation'
      context.activeGoalRunId = started.run.goalRunId
      context.activeGoalContextVersion = started.run.contextVersion
      delete context.acceptedGoalIntent

      parentSignal.throwIfAborted()
      await context.assertFlightSelectionCurrent?.()
      signal.throwIfAborted()
      const executed = await executeRouteGenerationRun(context.routeGeneration, runId, {
        signal, ...(context.assertFlightSelectionCurrent ? { assertActive: context.assertFlightSelectionCurrent } : {})
      })
      parentSignal.throwIfAborted()
      await context.assertFlightSelectionCurrent?.()
      signal.throwIfAborted()
      if (!executed) throw new AppError('ROUTE_GENERATION_FAILED', 'Route generation did not return a durable run', 500)
      const run = executed
      if (run.status !== 'succeeded') {
        throw new AppError(run.errorCode ?? (run.status === 'cancelled' ? 'ROUTE_GENERATION_CANCELLED' : 'ROUTE_GENERATION_FAILED'),
          run.errorMessage ?? 'Budget route search did not complete', run.status === 'failed' ? 422 : 409)
      }
      const view = toRouteGenerationRunView(run, { stale: false })
      if (!run.resultArtifactId) throw new AppError('INVALID_ROUTE_GENERATION_LINEAGE', 'Completed route search has no result artifact', 500)
      const record = await context.artifacts.get(run.resultArtifactId)
      if (!record || record.tripId !== context.tripId || record.goalId !== run.goalId || record.runId !== run.goalRunId
        || record.type !== 'route_set' || record.schemaVersion !== 1) {
        throw new AppError('INVALID_ROUTE_GENERATION_LINEAGE', 'Completed route artifact is outside this Trip and Goal scope', 500)
      }
      const payload = routeSetPayloadSchema.parse(record.payload)
      if (payload.kind !== 'optimized_routes') throw new AppError('INVALID_ROUTE_GENERATION_LINEAGE', 'Completed route artifact has an unexpected kind', 500)
      return budgetOutputSchema.parse({ run: view, created: started.created,
        artifact: { id: record.id, type: 'route_set', schemaVersion: 1 }, summary: budgetSummary(payload) })
    } catch (error) {
      if (runId && (parentSignal.aborted || timeoutController.signal.aborted || signal.aborted)) {
        await cancelRouteGenerationRun(context.routeGeneration, runId).catch(() => undefined)
      }
      if (timeoutController.signal.aborted && !parentSignal.aborted) {
        throw timeoutController.signal.reason instanceof Error ? timeoutController.signal.reason
          : new AppError('ROUTE_GENERATION_TIMEOUT', 'Budget route search exceeded its time limit', 504)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
