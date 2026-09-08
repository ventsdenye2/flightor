import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { routeGenerationRunSchema, toRouteGenerationRunView } from '../../route-generation/contracts.js'
import { startRouteGenerationRun } from '../../route-generation/service.js'
import type { AgentTool } from '../runtime/registry.js'

const outputSchema = z.object({
  run: routeGenerationRunSchema,
  created: z.boolean()
}).strict()

function requestKey(requestId: string): string {
  return `agent:${createHash('sha256').update(requestId).digest('hex')}`
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
