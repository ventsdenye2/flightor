import { z, type ZodType } from 'zod'
import type { AviationProvider } from '../../aviation/providers/provider.js'
import type { FareProvider } from '../../fares/providers/provider.js'
import type { TripContextRepository } from '../../trips/repository.js'
import type { ArtifactRepository } from '../../artifacts/repository.js'
import type { UserMemoryRepository } from '../../memory/repository.js'
import type { ResearchAgent } from '../../research-agent/types.js'
import type { ConnectionSearchService, FlightRoutePlanner, RouteOptimizer } from '../../flight-routing/types.js'
import type { DestinationDiscoveryService } from '../../destinations/types.js'
import type { TripRoutePlanner } from '../../trip-planning/types.js'
import type { TravelGuideBuilder } from '../../travel-guides/artifact.js'
import type { ChatToolDefinition, FunctionToolCall } from './model.js'
import type { LocationRef } from '../../aviation/types.js'
import type { GoalRepository, GoalRunRepository } from '../goals/repository.js'
import type { GoalVerifierRegistry } from '../goals/verifier.js'
import type { GoalKind } from '../goals/types.js'
import type { RouteGenerationDependencies } from '../../route-generation/service.js'
import { isAppError } from '../../lib/errors.js'
import { emitActivity, type AgentActivityObserver } from './activity.js'
import { settleWithSignal } from './cancellation.js'
import type { SelectedFlightContext } from '../../workspaces/flight-selection.js'
import type { GuideDraft } from '../tools/guide-draft.js'

export type ToolCostClass = 'free' | 'cheap' | 'paid' | 'expensive'
export type ToolSideEffect = 'none' | 'state'

export interface ToolExecutionContext {
  /** Authenticated owner for durable Goal records. */
  ownerId?: string
  requestId: string
  conversationId: string
  tripId: string
  generationId: string
  trips: TripContextRepository
  artifacts: ArtifactRepository
  memory: UserMemoryRepository
  aviation: AviationProvider
  fares: FareProvider
  research: ResearchAgent
  connectionSearch: ConnectionSearchService
  flightRoutePlanner: FlightRoutePlanner
  routeOptimizer: RouteOptimizer
  /** Optional during the compatibility window; production cloud composition supplies both. */
  destinationDiscovery?: DestinationDiscoveryService
  tripRoutePlanner?: TripRoutePlanner
  travelGuideBuilder?: TravelGuideBuilder
  /** Runtime-owned ledger; model arguments can never add entries directly. */
  resolvedLocationKeys?: Set<string>
  resolvedLocations?: Map<string, LocationRef>
  isGenerationCurrent?: () => boolean
  goalRepository?: GoalRepository
  goalRunRepository?: GoalRunRepository
  goalVerifiers?: GoalVerifierRegistry
  /** Explicit conversational route generation uses the same domain service as the button. */
  routeGeneration?: RouteGenerationDependencies
  selectedFlight?: SelectedFlightContext
  assertFlightSelectionCurrent?: () => Promise<void>
  activeGoalId?: string
  activeGoalKind?: GoalKind
  activeGoalRunId?: string
  activeGoalContextVersion?: number
  /** Server-owned semantic acceptance lock for the opt-in lean protocol. */
  acceptedGoalIntent?: { goalId: string; runId: string; kind: GoalKind; contextVersion: number; fingerprint: string }
  /** One bounded, same-generation invalid guide draft. Never model-authored context. */
  guideDraft?: GuideDraft
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

export type ToolErrorClassification = 'draft_invalid' | 'provider_unavailable' | 'context_conflict'

export interface ToolExecutionOutcome {
  toolCallId: string
  toolName: string
  ok: boolean
  content: string
  costUnits: number
  durationMs: number
  provider?: string
  errorCode?: ToolErrorCode
  domainErrorCode?: string
  artifactIds: string[]
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asSafeMessage(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'code' in value) {
    if (value.code === 'TRIP_CONTEXT_VERSION_CONFLICT') return 'Trip context version conflict'
    if (value.code === 'PROVIDER_RATE_LIMITED') return 'The provider is temporarily rate limited. Do not immediately repeat research through another tool. Reuse compatible saved evidence if sufficient, or explain the interruption and ask the user to retry later.'
    if (value.code === 'USER_MEMORY_VERSION_CONFLICT') return 'User Memory version conflict'
    if (value.code === 'USER_MEMORY_DISABLED') return 'User Memory is disabled'
    if (value.code === 'GOAL_INTENT_REQUIRED') return 'Pass intent or goalRef with the first durable business operation.'
    if (value.code === 'GOAL_INTENT_CONFLICT') return 'Keep the accepted Goal and its constraints. Correct the result without weakening the objective; changed requirements need a new user turn.'
    if (value.code === 'GOAL_KIND_MISMATCH') return 'The business operation does not match the accepted Goal kind.'
    if (value.code === 'GOAL_RUN_ALREADY_RUNNING') return 'Another operation owns this Goal run. Wait for it to finish; do not take it over.'
    if (value.code === 'GOAL_NOT_RUNNABLE') return 'The Goal is satisfied or cancelled, or its attempt has ended. Do not continue writing to it.'
    if (value.code === 'LOCATION_NOT_RESOLVED') return 'Use a canonical location id from resolve_location or destination discovery for this operation. Fare searches accept airport IATA codes and resolve both airports on the server.'
  }
  return 'Tool execution failed'
}

function errorContent(code: ToolErrorCode, message: string, details?: unknown, classification?: ToolErrorClassification): string {
  return JSON.stringify({
    ok: false,
    error: {
      code,
      message: message.slice(0, 240),
      ...(classification === undefined ? {} : { classification }),
      ...(details === undefined ? {} : { details })
    }
  })
}

function classifyDomainError(domainCode: string | undefined, tool: AgentTool, errorCode: ToolErrorCode): ToolErrorClassification | undefined {
  if (errorCode === 'INVALID_ARGUMENTS' || errorCode === 'MALFORMED_ARGUMENTS') return 'draft_invalid'
  if (errorCode === 'TOOL_TIMEOUT' && (tool.name === 'research_destination' || tool.name === 'web_research')) return 'provider_unavailable'
  if (domainCode === 'PROVIDER_RATE_LIMITED' || domainCode === 'PROVIDER_UNAVAILABLE' || domainCode === 'PROVIDER_TIMEOUT') return 'provider_unavailable'
  if (domainCode === 'TRIP_CONTEXT_VERSION_CONFLICT' || domainCode === 'FLIGHT_SELECTION_CHANGED' || domainCode?.startsWith('ARTIFACT_CONTEXT_VERSION_')) return 'context_conflict'
  return undefined
}

function safeProviderDetails(error: unknown, tool: AgentTool, classification: ToolErrorClassification | undefined): Record<string, unknown> | undefined {
  if (classification !== 'provider_unavailable') return undefined
  const details: Record<string, unknown> = {}
  if (tool.provider) details.provider = tool.provider
  if (isAppError(error) && isRecord(error.details)) {
    if (typeof error.details.provider === 'string' && error.details.provider.length <= 64) details.provider = error.details.provider
    if (typeof error.details.retryAfter === 'number' && Number.isFinite(error.details.retryAfter) && error.details.retryAfter >= 0) {
      details.retryAfter = error.details.retryAfter
    }
  }
  return Object.keys(details).length ? details : undefined
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
    parentSignal: AbortSignal,
    onActivity?: AgentActivityObserver
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
        content: errorContent('MALFORMED_ARGUMENTS', 'Tool arguments are not valid JSON', undefined, 'draft_invalid'),
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
        content: errorContent('INVALID_ARGUMENTS', 'Tool arguments failed validation', parsed.error.issues, 'draft_invalid'),
        costUnits: 0,
        durationMs: Date.now() - started,
        ...(tool.provider ? { provider: tool.provider } : {}),
        errorCode: 'INVALID_ARGUMENTS',
        artifactIds: [],
        warnings: []
      }
    }

    const timeout = combinedSignal(parentSignal, tool.timeoutMs)
    let toolStarted = false
    try {
      const rawResult = await settleWithSignal(() => {
        toolStarted = true
        emitActivity(onActivity, { type: 'tool_start', toolName: tool.name, toolCallId: call.id })
        return tool.execute(parsed.data, context, timeout.signal)
      }, timeout.signal)
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
      const domainErrorCode = errorCode === 'TOOL_FAILURE' && isAppError(error) && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
        ? error.code : undefined
      const classification = classifyDomainError(domainErrorCode, tool, errorCode)
      const safeDetails = safeProviderDetails(error, tool, classification)
      const errorDetails = domainErrorCode
        ? { domainCode: domainErrorCode, ...(safeDetails ?? {}) }
        : safeDetails
      return {
        toolCallId: call.id,
        toolName: tool.name,
        ok: false,
        content: errorContent(errorCode, errorCode === 'TOOL_TIMEOUT' ? 'Tool execution timed out' : asSafeMessage(error),
          errorDetails, classification),
        costUnits: toolStarted ? tool.costUnits : 0,
        durationMs: Date.now() - started,
        ...(tool.provider ? { provider: tool.provider } : {}),
        errorCode,
        ...(domainErrorCode ? { domainErrorCode } : {}),
        artifactIds: [],
        warnings: domainErrorCode === 'PROVIDER_RATE_LIMITED' && (tool.name === 'research_destination' || tool.name === 'web_research')
          ? ['research_provider_rate_limited'] : []
      }
    } finally {
      timeout.cleanup()
      if (toolStarted) emitActivity(onActivity, { type: 'tool_end', toolName: tool.name, toolCallId: call.id })
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
