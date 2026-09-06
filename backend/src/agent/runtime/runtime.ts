import type { AgentModelClient, ChatMessage, ChatOptions, FunctionToolCall } from './model.js'
import type { ToolExecutionContext, ToolExecutionOutcome } from './registry.js'
import { ToolRegistry } from './registry.js'

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
}

export interface AgentRunInput {
  messages: ChatMessage[]
  context: ToolExecutionContext
  signal?: AbortSignal
  isGenerationCurrent?: (generationId: string) => boolean
}

export interface AgentRunResult {
  reply: string
  messages: ChatMessage[]
  toolSteps: number
  toolCalls: number
  costUnits: number
  fallback: boolean
  stopReason: 'completed' | 'max_tool_steps' | 'tool_call_limit' | 'model_failure' | 'cancelled' | 'turn_timeout' | 'stale_generation'
  traces: AgentTrace[]
}

const DEFAULT_FALLBACK = '抱歉，本轮处理没有完整结束。你的行程状态没有被猜测性修改，请稍后重试。'

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
    const controller = controllerFor(input.signal)
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
      isGenerationCurrent: () => !stale(input)
    }

    const fallback = (stopReason: AgentRunResult['stopReason']): AgentRunResult => ({
      reply: this.fallbackReply,
      messages,
      toolSteps,
      toolCalls: executedToolCalls,
      costUnits,
      fallback: true,
      stopReason,
      traces
    })

    try {
      while (true) {
      if (controller.signal.aborted) return fallback(turnTimedOut ? 'turn_timeout' : 'cancelled')
      if (stale(input)) return fallback('stale_generation')

      let completion
      try {
        completion = await this.modelClient.complete(messages, this.options.model, {
          ...this.modelOptions,
          tools: this.registry.definitions(),
          toolChoice: 'auto',
          signal: controller.signal
        })
      } catch {
        return fallback(controller.signal.aborted ? (turnTimedOut ? 'turn_timeout' : 'cancelled') : 'model_failure')
      }

      if (controller.signal.aborted) return fallback(turnTimedOut ? 'turn_timeout' : 'cancelled')
      if (stale(input)) return fallback('stale_generation')
      messages.push(completion.message)
      const calls = toolCalls(completion.message)
      if (calls.length === 0) {
        const reply = completion.message.content?.trim()
        return reply
          ? { reply, messages, toolSteps, toolCalls: executedToolCalls, costUnits, fallback: false, stopReason: 'completed', traces }
          : fallback('model_failure')
      }
      if (toolSteps >= this.maxToolSteps) return fallback('max_tool_steps')
      if (calls.length > this.maxToolCallsPerStep || executedToolCalls + calls.length > this.maxToolCallsPerTurn) {
        return fallback('tool_call_limit')
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
      const executeOne = ({ call, allowed }: { call: FunctionToolCall; allowed: boolean }) => allowed
        ? this.registry.execute(call, executionContext, controller.signal)
        : Promise.resolve(this.registry.budgetExceeded(call))
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
          ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {})
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
    }
  }
}
