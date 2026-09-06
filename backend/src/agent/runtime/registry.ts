import { z, type ZodType } from 'zod'
import type { AviationProvider } from '../../aviation/providers/provider.js'
import type { FareProvider } from '../../fares/providers/provider.js'
import type { TripContextRepository } from '../../trips/repository.js'
import type { ChatToolDefinition, FunctionToolCall } from './model.js'

export type ToolCostClass = 'free' | 'cheap' | 'paid' | 'expensive'
export type ToolSideEffect = 'none' | 'state'

export interface ToolExecutionContext {
  requestId: string
  conversationId: string
  tripId: string
  generationId: string
  trips: TripContextRepository
  aviation: AviationProvider
  fares: FareProvider
  /** Runtime-owned ledger; model arguments can never add entries directly. */
  resolvedLocationKeys?: Set<string>
  isGenerationCurrent?: () => boolean
}

export interface AgentTool<Input = unknown, Output = unknown> {
  name: string
  description: string
  inputSchema: ZodType<Input>
  outputSchema: ZodType<Output>
  costClass: ToolCostClass
  costUnits: number
  sideEffect: ToolSideEffect
  parallelSafe: boolean
  timeoutMs: number
  provider?: string
  execute(input: Input, context: ToolExecutionContext, signal: AbortSignal): Promise<Output>
}

export type ToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'MALFORMED_ARGUMENTS'
  | 'INVALID_ARGUMENTS'
  | 'TOOL_TIMEOUT'
  | 'TOOL_CANCELLED'
  | 'TOOL_FAILURE'
  | 'TOOL_RESULT_INVALID'
  | 'COST_BUDGET_EXCEEDED'

export interface ToolExecutionOutcome {
  toolCallId: string
  toolName: string
  ok: boolean
  content: string
  costUnits: number
  durationMs: number
  provider?: string
  errorCode?: ToolErrorCode
  artifactIds: string[]
  warnings: string[]
}

function asSafeMessage(value: unknown): string {
  if (
    value !== null
    && typeof value === 'object'
    && 'code' in value
    && value.code === 'TRIP_CONTEXT_VERSION_CONFLICT'
  ) return 'Trip context version conflict'
  return 'Tool execution failed'
}

function errorContent(code: ToolErrorCode, message: string, details?: unknown): string {
  return JSON.stringify({
    ok: false,
    error: {
      code,
      message: message.slice(0, 240),
      ...(details === undefined ? {} : { details })
    }
  })
}

function resultMetadata(value: unknown): { artifactIds: string[]; warnings: string[] } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { artifactIds: [], warnings: [] }
  const record = value as Record<string, unknown>
  const artifactIds: string[] = []
  if (typeof record.id === 'string' && (typeof record.type === 'string' || record.id.startsWith('artifact_'))) {
    artifactIds.push(record.id)
  }
  if (record.artifact !== null && typeof record.artifact === 'object' && !Array.isArray(record.artifact)) {
    const id = (record.artifact as Record<string, unknown>).id
    if (typeof id === 'string') artifactIds.push(id)
  }
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((item): item is string => typeof item === 'string').slice(0, 20)
    : []
  return { artifactIds: [...new Set(artifactIds)], warnings }
}

function combinedSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController()
  let timeoutReached = false
  const onParentAbort = () => controller.abort(parent.reason)
  if (parent.aborted) controller.abort(parent.reason)
  else parent.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => {
    timeoutReached = true
    controller.abort(new Error('Tool timeout'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onParentAbort)
    },
    timedOut: () => timeoutReached
  }
}

async function settleWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Aborted')
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>()

  register<Input, Output>(tool: AgentTool<Input, Output>): this {
    if (this.tools.has(tool.name)) throw new Error(`Duplicate Agent tool: ${tool.name}`)
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) throw new Error(`Invalid Agent tool name: ${tool.name}`)
    if (!Number.isFinite(tool.costUnits) || tool.costUnits < 0) throw new Error(`Invalid cost for Agent tool: ${tool.name}`)
    if (!Number.isInteger(tool.timeoutMs) || tool.timeoutMs < 1 || tool.timeoutMs > 120_000) {
      throw new Error(`Invalid timeout for Agent tool: ${tool.name}`)
    }
    this.tools.set(tool.name, tool as AgentTool)
    return this
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  definitions(): ChatToolDefinition[] {
    return [...this.tools.values()].map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>
      }
    }))
  }

  async execute(
    call: FunctionToolCall,
    context: ToolExecutionContext,
    parentSignal: AbortSignal
  ): Promise<ToolExecutionOutcome> {
    const started = Date.now()
    const tool = this.tools.get(call.function.name)
    if (!tool) {
      return {
        toolCallId: call.id,
        toolName: call.function.name,
        ok: false,
        content: errorContent('UNKNOWN_TOOL', `Unknown tool: ${call.function.name}`),
        costUnits: 0,
        durationMs: Date.now() - started,
        errorCode: 'UNKNOWN_TOOL',
        artifactIds: [],
        warnings: []
      }
    }

    let rawArguments: unknown
    try {
      rawArguments = JSON.parse(call.function.arguments || '{}')
    } catch {
      return {
        toolCallId: call.id,
        toolName: tool.name,
        ok: false,
        content: errorContent('MALFORMED_ARGUMENTS', 'Tool arguments are not valid JSON'),
        costUnits: 0,
        durationMs: Date.now() - started,
        ...(tool.provider ? { provider: tool.provider } : {}),
        errorCode: 'MALFORMED_ARGUMENTS',
        artifactIds: [],
        warnings: []
      }
    }
    const parsed = tool.inputSchema.safeParse(rawArguments)
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        toolName: tool.name,
        ok: false,
        content: errorContent('INVALID_ARGUMENTS', 'Tool arguments failed validation', parsed.error.issues),
        costUnits: 0,
        durationMs: Date.now() - started,
        ...(tool.provider ? { provider: tool.provider } : {}),
        errorCode: 'INVALID_ARGUMENTS',
        artifactIds: [],
        warnings: []
      }
    }

    const timeout = combinedSignal(parentSignal, tool.timeoutMs)
    try {
      const rawResult = await settleWithSignal(tool.execute(parsed.data, context, timeout.signal), timeout.signal)
      const result = tool.outputSchema.safeParse(rawResult)
      if (!result.success) {
        return {
          toolCallId: call.id,
          toolName: tool.name,
          ok: false,
          content: errorContent('TOOL_RESULT_INVALID', 'Tool result failed validation'),
          costUnits: tool.costUnits,
          durationMs: Date.now() - started,
          ...(tool.provider ? { provider: tool.provider } : {}),
          errorCode: 'TOOL_RESULT_INVALID',
          artifactIds: [],
          warnings: []
        }
      }
      const metadata = resultMetadata(result.data)
      return {
        toolCallId: call.id,
        toolName: tool.name,
        ok: true,
        content: JSON.stringify({ ok: true, data: result.data }),
        costUnits: tool.costUnits,
        durationMs: Date.now() - started,
        ...(tool.provider ? { provider: tool.provider } : {}),
        artifactIds: metadata.artifactIds,
        warnings: metadata.warnings
      }
    } catch (error) {
      const errorCode: ToolErrorCode = timeout.timedOut()
        ? 'TOOL_TIMEOUT'
        : parentSignal.aborted
          ? 'TOOL_CANCELLED'
          : 'TOOL_FAILURE'
      return {
        toolCallId: call.id,
        toolName: tool.name,
        ok: false,
        content: errorContent(errorCode, errorCode === 'TOOL_TIMEOUT' ? 'Tool execution timed out' : asSafeMessage(error)),
        costUnits: tool.costUnits,
        durationMs: Date.now() - started,
        ...(tool.provider ? { provider: tool.provider } : {}),
        errorCode,
        artifactIds: [],
        warnings: []
      }
    } finally {
      timeout.cleanup()
    }
  }

  budgetExceeded(call: FunctionToolCall): ToolExecutionOutcome {
    const tool = this.tools.get(call.function.name)
    return {
      toolCallId: call.id,
      toolName: call.function.name,
      ok: false,
      content: errorContent('COST_BUDGET_EXCEEDED', 'Per-turn tool cost budget exceeded'),
      costUnits: 0,
      durationMs: 0,
      ...(tool?.provider ? { provider: tool.provider } : {}),
      errorCode: 'COST_BUDGET_EXCEEDED',
      artifactIds: [],
      warnings: []
    }
  }
}
