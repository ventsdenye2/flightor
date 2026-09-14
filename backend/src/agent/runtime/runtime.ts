import type { AgentModelClient, ChatMessage, ChatOptions, FunctionToolCall } from './model.js'
import type { ToolExecutionContext, ToolExecutionOutcome } from './registry.js'
import { ToolRegistry } from './registry.js'
import { AppError } from '../../lib/errors.js'
import { addArtifactRef, addLocationHandle } from '../goals/working-set.js'
import { completeGoal, noGoalDelivery, summarizeGoalDelivery, type GoalDelivery, type GoalDeliveryItem } from '../goals/completion.js'
import { emitActivity, type AgentActivityObserver } from './activity.js'
import { settleWithSignal } from './cancellation.js'
import { closeGoalRunAttempt } from '../goals/attempt.js'

export interface AgentTrace {
  requestId: string
  conversationId: string
  tripId: string
  generationId: string
  agentStep: number
  toolName: string
  toolDurationMs: number
  toolResultStatus: 'success' | 'error'
  provider?: string
  providerCostClass?: string
  artifactIds: string[]
  warnings: string[]
  errorCode?: string
  domainErrorCode?: string
}

export interface AgentRuntimeOptions {
  maxToolSteps?: number
  maxToolCallsPerStep?: number
  maxToolCallsPerTurn?: number
  maxCostUnits?: number
  turnTimeoutMs?: number
  model?: string
  modelOptions?: Omit<ChatOptions, 'tools' | 'toolChoice' | 'signal'>
  fallbackReply?: string
  trace?: (trace: AgentTrace) => void
  modelTrace?: (trace: { requestId: string; step: number; durationMs: number; finishReason?: string; errorCode?: string }) => void
}

export interface AgentRunInput {
  messages: ChatMessage[]
  context: ToolExecutionContext
  signal?: AbortSignal
  isGenerationCurrent?: (generationId: string) => boolean
  onActivity?: AgentActivityObserver
}

export interface AgentRunResult {
  reply: string
  messages: ChatMessage[]
  toolSteps: number
  toolCalls: number
  costUnits: number
  fallback: boolean
  stopReason: 'responded' | 'completed' | 'goal_pending' | 'goal_partial' | 'goal_failed' | 'goal_cancelled' | 'max_tool_steps' | 'tool_call_limit' | 'model_failure' | 'cancelled' | 'turn_timeout' | 'stale_generation'
  delivery: GoalDelivery
  traces: AgentTrace[]
}

const DEFAULT_FALLBACK = '本轮处理未完整结束，已保存的结果会保留。你可以继续对话重试。'
const RESEARCH_RATE_LIMIT_REPLY = '联网研究服务暂时限流，本轮未能完成攻略。已保存的结果会保留，请稍后重试。'

export function sanitizePlannerReply(value: string): string {
  const text = value.trim()
  const separators = [...text.matchAll(/\r?\n\s*---+\s*\r?\n/g)]
  for (let index = separators.length - 1; index >= 0; index -= 1) {
    const separator = separators[index]!
    const prefix = text.slice(0, separator.index).trim()
    const suffix = text.slice((separator.index ?? 0) + separator[0].length).trim()
    const prefixLatin = (prefix.match(/[A-Za-z]/g) ?? []).length
    const prefixHan = (prefix.match(/[\u3400-\u9fff]/g) ?? []).length
    const suffixHan = (suffix.match(/[\u3400-\u9fff]/g) ?? []).length
    if (prefixLatin >= 20 && prefixHan === 0 && suffixHan >= 4) return suffix
  }
  return text
}

function researchRateLimited(traces: AgentTrace[]): boolean {
  return traces.some(trace => trace.warnings.includes('research_provider_rate_limited'))
}

function deliveryReply(delivery: GoalDelivery, modelReply: string): string {
  if (delivery.status === 'not_requested' || delivery.status === 'satisfied') return modelReply
  if (delivery.status === 'pending') return '这项任务尚未完成，当前还没有满足全部要求的结果。后台任务的进度会显示在当前行程中，也可以继续对话补齐或调整条件。'
  if (delivery.status === 'partial') return '已保存可用的部分结果，但还没有完成全部行程要求。请查看结果卡片中的覆盖情况，可以继续完善。'
  if (delivery.status === 'cancelled') return '这项任务已取消，已有结果会保留。'
  return '本次结果未通过完成校验，暂时不能作为已完成的行程。已保存的结果会保留，可以继续对话重试。'
}

function controllerFor(signal?: AbortSignal): AbortController {
  const controller = new AbortController()
  if (!signal) return controller
  if (signal.aborted) controller.abort(signal.reason)
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return controller
}

function stale(input: AgentRunInput): boolean {
  return input.isGenerationCurrent !== undefined && !input.isGenerationCurrent(input.context.generationId)
}

function toolCalls(message: Extract<ChatMessage, { role: 'assistant' }>): FunctionToolCall[] {
  return message.tool_calls ?? []
}

async function syncActiveGoalWorkingSet(context: ToolExecutionContext, outcome: ToolExecutionOutcome, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (!outcome.ok || !context.activeGoalRunId || !context.goalRunRepository) return
  const run = await context.goalRunRepository.get(context.activeGoalRunId)
  signal.throwIfAborted()
  if (!run || run.status !== 'running') return
  let workingSet = run.workingSet
  const observedAt = new Date().toISOString()
  for (const id of outcome.artifactIds) {
    const artifact = await context.artifacts.getForScope(id, {
      tripId: context.tripId,
      ...(context.activeGoalId ? { goalId: context.activeGoalId } : {}),
      runId: run.id,
      tripContextVersion: run.contextVersion
    })
    signal.throwIfAborted()
    if (!artifact) continue
    workingSet = addArtifactRef(workingSet, { id: artifact.id, type: artifact.type, schemaVersion: artifact.schemaVersion, observedAt })
  }
  for (const location of context.resolvedLocations?.values() ?? []) {
    workingSet = addLocationHandle(workingSet, {
      id: location.id,
      kind: location.type,
      observedAt
    })
  }
  if (JSON.stringify(workingSet) !== JSON.stringify(run.workingSet)) {
    signal.throwIfAborted()
    await context.goalRunRepository.update(run.id, run.revision, { status: 'running', workingSet })
  }
}

export class AgentRuntime {
  private readonly maxToolSteps: number
  private readonly maxCostUnits: number
  private readonly maxToolCallsPerStep: number
  private readonly maxToolCallsPerTurn: number
  private readonly turnTimeoutMs: number
  private readonly fallbackReply: string
  private readonly modelOptions: Omit<ChatOptions, 'tools' | 'toolChoice' | 'signal'>

  constructor(
    private readonly modelClient: AgentModelClient,
    private readonly registry: ToolRegistry,
    private readonly options: AgentRuntimeOptions = {}
  ) {
    this.maxToolSteps = Math.max(0, Math.min(20, options.maxToolSteps ?? 6))
    this.maxToolCallsPerStep = Math.max(1, Math.min(20, options.maxToolCallsPerStep ?? 8))
    this.maxToolCallsPerTurn = Math.max(1, Math.min(100, options.maxToolCallsPerTurn ?? 24))
    this.maxCostUnits = Math.max(0, Math.min(100, options.maxCostUnits ?? 12))
    this.turnTimeoutMs = Math.max(1_000, Math.min(300_000, options.turnTimeoutMs ?? 90_000))
    this.fallbackReply = options.fallbackReply ?? DEFAULT_FALLBACK
    this.modelOptions = {
      ...options.modelOptions,
      maxTokens: Math.max(1, Math.min(4_096, options.modelOptions?.maxTokens ?? 1_200)),
      ...(options.modelOptions?.temperature === undefined
        ? {}
        : { temperature: Math.max(0, Math.min(2, options.modelOptions.temperature)) })
    }
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const controller = new AbortController()
    const onParentAbort = () => controller.abort(input.signal?.reason)
    if (input.signal?.aborted) onParentAbort()
    else input.signal?.addEventListener('abort', onParentAbort, { once: true })
    let turnTimedOut = false
    const turnTimer = setTimeout(() => {
      turnTimedOut = true
      controller.abort(new Error('Agent turn timeout'))
    }, this.turnTimeoutMs)
    const messages = structuredClone(input.messages)
    const traces: AgentTrace[] = []
    let costUnits = 0
    let toolSteps = 0
    let executedToolCalls = 0
    const executionContext: ToolExecutionContext = {
      ...input.context,
      resolvedLocationKeys: new Set<string>(),
      resolvedLocations: new Map(),
      isGenerationCurrent: () => !stale(input)
    }
    const touchedGoals = new Map<string, { runId: string; kind: ToolExecutionContext['activeGoalKind'] }>()
    const touchedRuns = new Map<string, string>()
    let result: AgentRunResult | undefined
    const observeGoal = () => {
      if (executionContext.activeGoalId && executionContext.activeGoalRunId) {
        touchedGoals.set(executionContext.activeGoalId, { runId: executionContext.activeGoalRunId, kind: executionContext.activeGoalKind })
        touchedRuns.set(executionContext.activeGoalRunId, executionContext.activeGoalId)
      }
    }
    observeGoal()

    const readDelivery = async (persist: boolean): Promise<GoalDelivery> => {
      if (touchedGoals.size === 0) return noGoalDelivery()
      const items: GoalDeliveryItem[] = [...touchedGoals].flatMap(([goalId, { kind }]) => kind ? [{
        goalId, kind, status: 'pending' as const, artifactIds: [], missing: ['goal_verification'], warnings: []
      }] : [])
      const finalizationController = controllerFor(persist ? controller.signal : undefined)
      const interrupted = (): GoalDelivery => ({
        status: 'pending', artifactIds: [], missing: ['goal_verification'],
        warnings: ['goal_verification_interrupted'], goals: structuredClone(items)
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<GoalDelivery>(resolve => {
        timer = setTimeout(() => {
          finalizationController.abort(new Error('Goal finalization timeout'))
          resolve(interrupted())
        }, 3_000)
      })
      const verify = async (): Promise<GoalDelivery> => {
        try {
          if (!executionContext.ownerId || !executionContext.goalRepository
            || !executionContext.goalRunRepository || !executionContext.goalVerifiers) {
            throw new Error('Goal completion is not configured')
          }
          for (const [goalId, { runId }] of touchedGoals) {
            const completed = await completeGoal({
              ownerId: executionContext.ownerId, tripId: executionContext.tripId,
              trips: executionContext.trips, artifacts: executionContext.artifacts,
              goals: executionContext.goalRepository, runs: executionContext.goalRunRepository,
              verifiers: executionContext.goalVerifiers,
              signal: finalizationController.signal,
              ...(executionContext.selectedFlight ? { selectedFlight: executionContext.selectedFlight } : {}),
              ...(executionContext.assertFlightSelectionCurrent ? { assertFlightSelectionCurrent: executionContext.assertFlightSelectionCurrent } : {}),
              ...(persist && executionContext.isGenerationCurrent ? { isCurrent: executionContext.isGenerationCurrent } : {})
            }, { goalId, runId, persist })
            const item = { goalId, kind: completed.goal.kind, ...completed.verification }
            const index = items.findIndex(value => value.goalId === goalId)
            if (index < 0) items.push(item)
            else items[index] = item
          }
          return summarizeGoalDelivery(items)
        } catch {
          if (finalizationController.signal.aborted) return interrupted()
          return {
            status: 'failed', artifactIds: [], missing: ['goal_verification'],
            warnings: ['goal_verification_failed'], goals: items
          }
        }
      }
      try { return await Promise.race([verify(), deadline]) }
      finally { clearTimeout(timer) }
    }

    const fallback = async (stopReason: AgentRunResult['stopReason'], delivery?: GoalDelivery): Promise<AgentRunResult> => (result = {
      reply: this.options.fallbackReply === undefined && researchRateLimited(traces) && stopReason !== 'cancelled' && stopReason !== 'stale_generation'
        ? RESEARCH_RATE_LIMIT_REPLY
        : stopReason === 'turn_timeout' && this.options.fallbackReply === undefined
        ? '本轮处理已超时，已保存的结果会保留。你可以继续对话，复用现有结果完成规划。'
        : this.fallbackReply,
      messages,
      toolSteps,
      toolCalls: executedToolCalls,
      costUnits,
      fallback: true,
      stopReason,
      delivery: delivery ?? await readDelivery(false),
      traces
    })

    try {
      while (true) {
        if (controller.signal.aborted) return await fallback(turnTimedOut ? 'turn_timeout' : 'cancelled')
        if (stale(input)) return await fallback('stale_generation')

        let completion
        const modelStarted = Date.now()
        try {
          completion = await settleWithSignal(() => {
            emitActivity(input.onActivity, { type: 'model_start' })
            return this.modelClient.complete(messages, this.options.model, {
              ...this.modelOptions,
              tools: this.registry.definitions(),
              toolChoice: 'auto',
              signal: controller.signal
            })
          }, controller.signal)
          this.options.modelTrace?.({ requestId: input.context.requestId, step: toolSteps + 1, durationMs: Date.now() - modelStarted,
            ...(completion.finishReason ? { finishReason: completion.finishReason } : {}) })
        } catch (error) {
          this.options.modelTrace?.({ requestId: input.context.requestId, step: toolSteps + 1, durationMs: Date.now() - modelStarted,
            errorCode: error instanceof AppError ? error.code : 'MODEL_FAILURE' })
          return await fallback(controller.signal.aborted ? (turnTimedOut ? 'turn_timeout' : 'cancelled') : 'model_failure')
        } finally {
          emitActivity(input.onActivity, { type: 'model_end' })
        }

        if (controller.signal.aborted) return await fallback(turnTimedOut ? 'turn_timeout' : 'cancelled')
        if (stale(input)) return await fallback('stale_generation')
        // Truncated text or tool arguments must never be accepted as a completed turn.
        if (completion.finishReason === 'length' || completion.finishReason === 'content_filter') return await fallback('model_failure')
        messages.push(completion.message)
        const calls = toolCalls(completion.message)
        if (calls.length === 0) {
          const reply = completion.message.content ? sanitizePlannerReply(completion.message.content) : ''
          if (!reply) return await fallback('model_failure')
          emitActivity(input.onActivity, { type: 'finalizing' })
          const delivery = await readDelivery(true)
          if (controller.signal.aborted) return await fallback(turnTimedOut ? 'turn_timeout' : 'cancelled', delivery)
          if (stale(input)) return await fallback('stale_generation', delivery)
          const stopReason: AgentRunResult['stopReason'] = delivery.status === 'not_requested' ? 'responded'
            : delivery.status === 'satisfied' ? 'completed' : `goal_${delivery.status}`
          return result = {
            reply: researchRateLimited(traces) && (delivery.status === 'pending' || delivery.status === 'partial' || delivery.status === 'failed')
              ? RESEARCH_RATE_LIMIT_REPLY : deliveryReply(delivery, reply), messages, toolSteps,
            toolCalls: executedToolCalls, costUnits, fallback: false, stopReason, delivery, traces
          }
        }
        if (toolSteps >= this.maxToolSteps) return await fallback('max_tool_steps')
        if (calls.length > this.maxToolCallsPerStep || executedToolCalls + calls.length > this.maxToolCallsPerTurn) {
          return await fallback('tool_call_limit')
        }

        const executable: Array<{ call: FunctionToolCall; allowed: boolean }> = []
        let reservedCost = costUnits
        for (const call of calls) {
          const tool = this.registry.get(call.function.name)
          const allowed = tool === undefined || reservedCost + tool.costUnits <= this.maxCostUnits
          if (allowed && tool) reservedCost += tool.costUnits
          executable.push({ call, allowed })
        }
        const canRunInParallel = executable.every(({ call, allowed }) => {
          const tool = this.registry.get(call.function.name)
          return !allowed || (tool !== undefined && tool.parallelSafe && tool.sideEffect === 'none')
        })
        const executeOne = async ({ call, allowed }: { call: FunctionToolCall; allowed: boolean }) => {
          const outcome = allowed
            ? await this.registry.execute(call, executionContext, controller.signal, input.onActivity)
            : this.registry.budgetExceeded(call)
          observeGoal()
          try {
            await settleWithSignal(() => syncActiveGoalWorkingSet(executionContext, outcome, controller.signal), controller.signal)
          } catch {
            outcome.warnings = [...new Set([...outcome.warnings, 'goal_working_set_update_failed'])]
          }
          return outcome
        }
        const outcomes: ToolExecutionOutcome[] = []
        if (canRunInParallel) outcomes.push(...await Promise.all(executable.map(executeOne)))
        else {
          for (const item of executable) outcomes.push(await executeOne(item))
        }
        toolSteps += 1
        executedToolCalls += outcomes.length
        costUnits += outcomes.reduce((sum, outcome) => sum + outcome.costUnits, 0)

        for (const outcome of outcomes) {
          const definition = this.registry.get(outcome.toolName)
          const trace: AgentTrace = {
            requestId: input.context.requestId,
            conversationId: input.context.conversationId,
            tripId: input.context.tripId,
            generationId: input.context.generationId,
            agentStep: toolSteps,
            toolName: outcome.toolName,
            toolDurationMs: outcome.durationMs,
            toolResultStatus: outcome.ok ? 'success' : 'error',
            artifactIds: outcome.artifactIds,
            warnings: outcome.warnings,
            ...(outcome.provider ? { provider: outcome.provider } : {}),
            ...(definition ? { providerCostClass: definition.costClass } : {}),
            ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
            ...(outcome.domainErrorCode ? { domainErrorCode: outcome.domainErrorCode } : {})
          }
          traces.push(trace)
          this.options.trace?.(trace)
          messages.push({
            role: 'tool',
            tool_call_id: outcome.toolCallId,
            name: outcome.toolName,
            content: outcome.content
          })
        }
      }
    } finally {
      clearTimeout(turnTimer)
      input.signal?.removeEventListener('abort', onParentAbort)
      const attemptStatus = input.signal?.aborted || stale(input) ? 'cancelled' : 'failed'
      controller.abort(new Error('Agent turn ended'))
      const cleanup = new AbortController()
      const cleanupTimer = setTimeout(() => cleanup.abort(new Error('Goal attempt cleanup timeout')), 3_000)
      try {
        if (executionContext.ownerId && executionContext.goalRunRepository) {
          await settleWithSignal(async () => {
            const outcomes = await Promise.allSettled([...touchedRuns].map(([runId, goalId]) =>
              closeGoalRunAttempt({
                ownerId: executionContext.ownerId!, tripId: executionContext.tripId,
                generationId: executionContext.generationId, runs: executionContext.goalRunRepository!,
                signal: cleanup.signal
              }, { goalId, runId, status: attemptStatus })))
            if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('Goal attempt cleanup failed')
          }, cleanup.signal)
        }
      } catch {
        if (result) result.delivery.warnings = [...new Set([...result.delivery.warnings, 'goal_attempt_cleanup_failed'])].slice(0, 40)
      } finally { clearTimeout(cleanupTimer) }
    }
  }
}
