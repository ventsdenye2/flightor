import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { plannerGoalIntentSchema } from '../goals/acceptance-types.js'
import { canonicalFingerprint } from '../goals/repository.js'
import { closeGoalRunAttempt } from '../goals/attempt.js'
import { completeGoal } from '../goals/completion.js'
import { goalVerificationSchema } from '../goals/verifier.js'
import type { GoalKind } from '../goals/types.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'
import { syncActiveGoalWorkingSet } from '../goals/working-set-observer.js'
import { settleWithSignal } from '../runtime/cancellation.js'

const acceptedGoalSchema = z.object({
  goalId: z.string().uuid(), runId: z.string().uuid(), kind: z.enum(['travel_guide', 'flight_search', 'trip_context_update']),
  contextVersion: z.number().int().nonnegative()
}).strict()

function checkpoint(context: ToolExecutionContext, signal: AbortSignal) {
  signal.throwIfAborted()
  if (context.isGenerationCurrent?.() === false) throw new AppError('GOAL_RUN_NOT_CURRENT', 'The active operation changed', 409)
}

/** Opt-in adapter for semantic acceptance at the first business operation.
 * No keywords, implicit old-goal selection or alternative completion authority. */
export function withGoalIntent<Input, Output>(tool: AgentTool<Input, Output>, kinds: readonly GoalKind[], options: {
  required?: boolean
  completeAfter?: boolean
} = {}): AgentTool {
  if (!(tool.inputSchema instanceof z.ZodObject) || !(tool.outputSchema instanceof z.ZodObject)) {
    throw new Error(`Goal intent requires object contracts: ${tool.name}`)
  }
  const inputSchema = tool.inputSchema.safeExtend({
    intent: plannerGoalIntentSchema.optional().describe('On the first durable operation, accept the user objective once. Keep its constraints fixed for this turn.'),
    goalRef: z.string().uuid().optional().describe('Alternatively resume this existing Goal only if its parameters match the current user request.')
  }).superRefine((value, issue) => {
    if (value.intent !== undefined && value.goalRef !== undefined) issue.addIssue({ code: 'custom', message: 'Use intent or goalRef, not both.' })
  })
  // Leave room for acceptance/finalization without changing the whole-turn deadline.
  const timeoutMs = Math.min(120_000, tool.timeoutMs + 5_000)
  return {
    ...tool,
    description: `${tool.description} Lean Goal protocol: first durable operation carries intent or goalRef; later operations use the same accepted goal without repeating it. Allowed goal kinds: ${kinds.join(', ')}. ${options.required ? 'An accepted goal is required.' : 'Omit both for an ephemeral operation before accepting any goal.'} Completion feedback is server-owned; no declare/resume/finish call is needed.`,
    inputSchema,
    outputSchema: tool.outputSchema.extend({ acceptedGoal: acceptedGoalSchema.optional(), completion: goalVerificationSchema.optional() }),
    sideEffect: 'state', parallelSafe: false, timeoutMs,
    async execute(raw, context, signal) {
      const started = performance.now()
      const { intent, goalRef, ...args } = raw as Record<string, unknown>
      checkpoint(context, signal)
      const bound = context.acceptedGoalIntent
      if (!bound && context.activeGoalId) throw new AppError('GOAL_INTENT_CONFLICT', 'Another objective is already active in this turn', 409)
      if (bound && (context.activeGoalId !== bound.goalId || (goalRef !== undefined && goalRef !== bound.goalId)
        || (intent !== undefined && canonicalFingerprint(intent) !== bound.fingerprint))) {
        throw new AppError('GOAL_INTENT_CONFLICT', 'Keep the accepted goal constraints; change objectives in a new user turn', 409)
      }
      if (bound || intent !== undefined || goalRef !== undefined || options.required) {
        if (!context.ownerId || !context.goalRepository || !context.goalRunRepository?.accept || !context.goalVerifiers) {
          throw new AppError('GOAL_RUNTIME_UNAVAILABLE', 'Goal acceptance is not configured', 503)
        }
        if (!bound && intent === undefined && goalRef === undefined) {
          throw new AppError('GOAL_INTENT_REQUIRED', 'Provide intent or goalRef on the first durable business operation', 409)
        }
        const requested = intent === undefined ? undefined : plannerGoalIntentSchema.parse(intent)
        const referenced = !bound && typeof goalRef === 'string' ? await context.goalRepository.get(goalRef) : undefined
        checkpoint(context, signal)
        if (goalRef !== undefined && !bound && (!referenced || referenced.ownerId !== context.ownerId || referenced.tripId !== context.tripId)) {
          throw new AppError('RESOURCE_NOT_FOUND', 'Goal was not found', 404)
        }
        const kind = bound?.kind ?? requested?.kind ?? referenced?.kind
        if (!kind || !kinds.includes(kind)) throw new AppError('GOAL_KIND_MISMATCH', 'This business operation does not match the accepted goal kind', 409)
        const trip = await context.trips.get(context.tripId)
        checkpoint(context, signal)
        if (!trip) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
        if (bound) {
          if (trip.version !== bound.contextVersion) throw new AppError('TRIP_CONTEXT_VERSION_CONFLICT', 'Accepted Goal context changed; start a new turn', 409)
          const goal = await context.goalRepository.get(bound.goalId)
          const run = await context.goalRunRepository.get(bound.runId)
          checkpoint(context, signal)
          if (!goal || !run || goal.ownerId !== context.ownerId || run.ownerId !== context.ownerId
            || goal.tripId !== context.tripId || run.tripId !== context.tripId || run.goalId !== goal.id
            || run.generationId !== context.generationId || run.contextVersion !== bound.contextVersion) {
            throw new AppError('GOAL_RUN_NOT_CURRENT', 'The accepted Goal run changed', 409)
          }
          if (canonicalFingerprint({ kind: goal.kind, parameters: goal.parameters }) !== bound.fingerprint) {
            throw new AppError('GOAL_INTENT_CONFLICT', 'Accepted Goal parameters changed', 409)
          }
          if (goal.status === 'cancelled' || goal.status === 'satisfied' || run.status !== 'running') {
            throw new AppError('GOAL_NOT_RUNNABLE', 'The accepted Goal no longer accepts business writes', 409)
          }
        } else {
          await context.assertFlightSelectionCurrent?.()
          checkpoint(context, signal)
          const { goal, run } = await context.goalRunRepository.accept({
            tripId: context.tripId, conversationId: context.conversationId, requestId: context.requestId,
            generationId: context.generationId, contextSnapshot: trip,
            ...(requested ? { intent: requested } : { goalRef: goalRef as string })
          })
          // Track before checking cancellation. A late acceptance must close its own attempt.
          context.activeGoalId = goal.id
          context.activeGoalKind = goal.kind
          context.activeGoalRunId = run.id
          context.activeGoalContextVersion = run.contextVersion
          context.acceptedGoalIntent = { goalId: goal.id, runId: run.id, kind: goal.kind,
            contextVersion: run.contextVersion, fingerprint: canonicalFingerprint({ kind: goal.kind, parameters: goal.parameters }) }
          try { checkpoint(context, signal) } catch (error) {
            await closeGoalRunAttempt({ ownerId: context.ownerId, tripId: context.tripId,
              generationId: context.generationId, runs: context.goalRunRepository }, { goalId: goal.id, runId: run.id, status: 'cancelled' })
            throw error
          }
          if (goal.status === 'satisfied' || goal.status === 'cancelled' || run.status !== 'running') {
            throw new AppError('GOAL_NOT_RUNNABLE', 'The accepted Goal no longer accepts business writes', 409)
          }
        }
      }
      const result = await tool.execute(tool.inputSchema.parse(args), context, signal)
      const accepted = context.acceptedGoalIntent
      if (!accepted) return result
      const { fingerprint: _fingerprint, ...acceptedGoal } = accepted
      let completion: z.infer<typeof goalVerificationSchema> | undefined
      if (options.completeAfter) {
        const finalize = new AbortController()
        const onAbort = () => finalize.abort(signal.reason)
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
        const remainingMs = Math.min(2_500, timeoutMs - (performance.now() - started) - 500)
        const timer = setTimeout(() => finalize.abort(new Error('Goal verification timeout')), Math.max(0, remainingMs))
        if (remainingMs <= 0) finalize.abort(new Error('Goal verification timeout'))
        try {
          const completed = await settleWithSignal(async () => {
            const artifact = (result as { artifact?: { id?: unknown } }).artifact
            await syncActiveGoalWorkingSet(context, { ok: true,
              artifactIds: typeof artifact?.id === 'string' ? [artifact.id] : [] }, finalize.signal)
            return completeGoal({ ownerId: context.ownerId!, tripId: context.tripId,
            trips: context.trips, artifacts: context.artifacts, goals: context.goalRepository!,
            runs: context.goalRunRepository!, verifiers: context.goalVerifiers!, signal: finalize.signal,
            ...(context.isGenerationCurrent ? { isCurrent: context.isGenerationCurrent } : {}),
            ...(context.selectedFlight ? { selectedFlight: context.selectedFlight } : {}),
            ...(context.assertFlightSelectionCurrent ? { assertFlightSelectionCurrent: context.assertFlightSelectionCurrent } : {})
            }, { goalId: accepted.goalId, runId: accepted.runId, closePartialRun: false })
          }, finalize.signal)
          completion = completed.verification
        } catch {
          checkpoint(context, signal)
          // A committed artifact remains in the result even when verification storage is unavailable.
          completion = { status: 'pending', artifactIds: [], missing: ['goal_verification'],
            warnings: [finalize.signal.aborted ? 'goal_verification_timeout' : 'goal_verification_unavailable'] }
        } finally {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
        }
      }
      return { ...result, acceptedGoal, ...(completion ? { completion } : {}) }
    }
  }
}
