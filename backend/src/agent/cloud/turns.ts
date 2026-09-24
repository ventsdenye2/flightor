import { v7 as uuidv7 } from 'uuid'
import { AppError } from '../../lib/errors.js'
import type { AgentActivity, AgentActivityObserver, CommittedArtifactRef } from '../runtime/activity.js'

export const PLANNER_TURN_TIMEOUT_MS = 300_000
/** Leave time for the runtime's timeout fallback and conversation persistence. */
export const PLANNER_JOB_TIMEOUT_MS = PLANNER_TURN_TIMEOUT_MS + 15_000
export const PLANNER_STAGES = ['thinking', 'updating_trip', 'searching_flights', 'researching', 'building_itinerary', 'finalizing'] as const
export type PlannerStage = typeof PLANNER_STAGES[number]
export type PlannerTurnError = { code: string; message: string }
export interface PlannerTurnScope { tripId: string; conversationId: string; generationId: string }
type TurnBase = Partial<PlannerTurnScope> & { turnId: string; stage: PlannerStage; startedAt: string; updatedAt: string;
  artifactRevision: number; artifactRefs: CommittedArtifactRef[] }
export type PlannerTurnSnapshot<Response> = TurnBase & (
  | { status: 'running' }
  | { status: 'completed'; response: Response }
  | { status: 'failed'; error: PlannerTurnError }
)

interface TurnEntry<Response> {
  ownerId: string
  snapshot: PlannerTurnSnapshot<Response>
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  activeTools: Map<string, PlannerStage>
  artifactSelections: Map<string, number | undefined>
  invalidatedArtifactIds: Set<string>
  expiresAt?: number
  settled: Promise<void>
  executionSettled: boolean
}

export interface PlannerTurnStoreOptions {
  maxEntries?: number
  retentionMs?: number
  /** Test override; production uses 315s including 15s of finalization headroom. */
  deadlineMs?: number
  onError?: (error: unknown, turnId: string) => void
  /** DSH must keep cancellation nonterminal until parent domain writes drain. */
  drainCancellation?: boolean
}

function stageForTool(tool: string): PlannerStage {
  if (tool === 'update_trip_context') return 'updating_trip'
  if (['search_flights', 'search_flexible_flights', 'search_connection_flights', 'confirm_flight_price', 'confirm_route_price', 'plan_flight_route', 'optimize_route'].includes(tool)) return 'searching_flights'
  if (['web_search', 'web_fetch', 'web_research', 'research_destination', 'search_destinations', 'recommend_destinations'].includes(tool)) return 'researching'
  if (['commit_travel_guide', 'save_travel_guide', 'build_travel_guide', 'plan_trip_route'].includes(tool)) return 'building_itinerary'
  if (['finish_goal', 'start_route_generation'].includes(tool)) return 'finalizing'
  return 'thinking'
}

function publicError(error: unknown): PlannerTurnError {
  if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') {
    return { code: error.code, message: '行程或对话已不可用，请重新打开行程。' }
  }
  return { code: 'AGENT_TURN_FAILED', message: '本轮处理未能结束，已保存的结果会保留。请重新打开行程查看。' }
}

/** Temporary single-process transport state. It never writes to domain repositories. */
export class PlannerTurnStore<Response> {
  private readonly entries = new Map<string, TurnEntry<Response>>()
  private readonly maxEntries: number
  private readonly retentionMs: number
  private readonly deadlineMs: number
  private closed = false

  constructor(private readonly options: PlannerTurnStoreOptions = {}) {
    this.maxEntries = Math.max(1, Math.min(1_024, options.maxEntries ?? 128))
    this.retentionMs = Math.max(1, options.retentionMs ?? 10 * 60_000)
    this.deadlineMs = Math.max(1, Math.min(PLANNER_JOB_TIMEOUT_MS, options.deadlineMs ?? PLANNER_JOB_TIMEOUT_MS))
  }

  start(ownerId: string, execute: (signal: AbortSignal, onActivity: AgentActivityObserver) => Promise<Response>, scope?: PlannerTurnScope): Partial<PlannerTurnScope> & { turnId: string; status: 'running'; startedAt: string } {
    if (this.closed) throw new AppError('AGENT_UNAVAILABLE', 'Planner is shutting down', 503)
    this.prune()
    if (scope) for (const entry of this.entries.values()) {
      if (this.options.drainCancellation && !entry.executionSettled && entry.ownerId === ownerId
        && entry.snapshot.tripId === scope.tripId && entry.snapshot.conversationId === scope.conversationId) {
        throw new AppError('AGENT_BUSY', 'The prior conversation turn has not finished stopping', 409)
      }
      if (entry.ownerId === ownerId && entry.snapshot.status === 'running'
        && entry.snapshot.tripId === scope.tripId && entry.snapshot.conversationId === scope.conversationId) {
        this.cancel(ownerId, entry.snapshot.turnId)
      }
    }
    // Completed results may be replaced. In-flight work is never displaced.
    while (this.entries.size >= this.maxEntries) {
      const terminal = [...this.entries].find(([, entry]) => entry.snapshot.status !== 'running' && entry.executionSettled)
      if (!terminal) throw new AppError('AGENT_BUSY', 'Planner is busy; try again later', 503)
      this.entries.delete(terminal[0])
    }
    const turnId = uuidv7()
    const startedAt = new Date().toISOString()
    const controller = new AbortController()
    const entry: TurnEntry<Response> = {
      ownerId, controller, activeTools: new Map(), artifactSelections: new Map(), invalidatedArtifactIds: new Set(),
      settled: Promise.resolve(), executionSettled: false,
      snapshot: { ...scope, turnId, status: 'running', stage: 'thinking', startedAt, updatedAt: startedAt, artifactRevision: 0, artifactRefs: [] },
      timer: setTimeout(() => {
        this.fail(entry, { code: 'AGENT_TURN_TIMEOUT', message: '本轮处理已超时，已保存的结果会保留。请重新打开行程查看。' })
        controller.abort(new Error('Planner job deadline exceeded'))
      }, this.deadlineMs)
    }
    entry.timer.unref?.()
    this.entries.set(turnId, entry)
    // Attach both settlement handlers before starting any model/provider work.
    entry.settled = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return execute(controller.signal, activity => this.observe(entry, activity))
    }).then(response => {
      entry.executionSettled = true
      if (entry.snapshot.status !== 'running') return
      if (controller.signal.aborted) { this.fail(entry, this.cancelledError()); return }
      entry.snapshot = { ...entry.snapshot, status: 'completed', stage: 'finalizing', updatedAt: new Date().toISOString(), response }
      this.finish(entry)
    }, error => {
      entry.executionSettled = true
      if (entry.snapshot.status !== 'running') return
      if (controller.signal.aborted) { this.fail(entry, this.cancelledError()); return }
      this.fail(entry, publicError(error))
      try { this.options.onError?.(error, turnId) } catch { /* logging is best effort */ }
    })
    return { ...scope, turnId, status: 'running', startedAt }
  }

  get(ownerId: string, turnId: string): PlannerTurnSnapshot<Response> | undefined {
    this.prune()
    const entry = this.entries.get(turnId)
    return entry?.ownerId === ownerId ? structuredClone(entry.snapshot) : undefined
  }

  cancel(ownerId: string, turnId: string): PlannerTurnSnapshot<Response> | undefined {
    this.prune()
    const entry = this.entries.get(turnId)
    if (!entry || entry.ownerId !== ownerId) return undefined
    if (entry.snapshot.status === 'running') {
      if (!this.options.drainCancellation) this.fail(entry, this.cancelledError())
      entry.controller.abort(new Error('Planner turn cancelled'))
    }
    return structuredClone(entry.snapshot)
  }

  /** Public cancellation acknowledgement waits for the actual service execution. */
  async cancelAndWait(ownerId: string, turnId: string): Promise<PlannerTurnSnapshot<Response> | undefined> {
    const snapshot = this.cancel(ownerId, turnId)
    if (!snapshot) return undefined
    const entry = this.entries.get(turnId)!
    await entry.settled
    return structuredClone(entry.snapshot)
  }

  private cancelledError(): PlannerTurnError {
    return { code: 'AGENT_TURN_CANCELLED', message: '已停止本轮处理，已保存的结果仍可查看。' }
  }

  /** Called by the authenticated route after re-reading current domain versions. */
  reconcile(ownerId: string, turnId: string, version: number, selectedFlightRevision?: number): PlannerTurnSnapshot<Response> | undefined {
    const entry = this.entries.get(turnId)
    if (!entry || entry.ownerId !== ownerId) return undefined
    const current = entry.snapshot.artifactRefs.filter(ref => ref.tripContextVersion === version
      && (ref.type !== 'travel_guide' || entry.artifactSelections.get(ref.id) === selectedFlightRevision))
    if (current.length !== entry.snapshot.artifactRefs.length) {
      const retained = new Set(current.map(ref => ref.id))
      for (const id of entry.artifactSelections.keys()) if (!retained.has(id)) {
        entry.artifactSelections.delete(id)
        // Runtime is capped at 100 calls; keep the transport guard bounded independently.
        if (entry.invalidatedArtifactIds.size < 128) entry.invalidatedArtifactIds.add(id)
      }
      entry.snapshot = { ...entry.snapshot, artifactRefs: current, artifactRevision: entry.snapshot.artifactRevision + 1,
        updatedAt: new Date().toISOString() }
    }
    return structuredClone(entry.snapshot)
  }

  hasInvalidatedArtifacts(ownerId: string, turnId: string, ids: readonly string[]): boolean {
    const entry = this.entries.get(turnId)
    return entry?.ownerId === ownerId && ids.some(id => entry.invalidatedArtifactIds.has(id))
  }

  close(): void {
    this.closed = true
    for (const entry of this.entries.values()) {
      if (entry.snapshot.status === 'running') {
        this.fail(entry, { code: 'AGENT_TURN_CANCELLED', message: '服务已停止本轮处理，请重新打开行程查看已保存的结果。' })
        entry.controller.abort(new Error('Planner server shutdown'))
      }
      clearTimeout(entry.timer)
    }
    this.entries.clear()
  }

  private observe(entry: TurnEntry<Response>, activity: AgentActivity): void {
    if (entry.snapshot.status !== 'running' || entry.controller.signal.aborted) return
    if (activity.type === 'artifact_committed') {
      if (!entry.snapshot.generationId || activity.generationId !== entry.snapshot.generationId
        || activity.tripId !== entry.snapshot.tripId || activity.conversationId !== entry.snapshot.conversationId) return
      const ref = activity.artifact
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.id)
        || !['flight_search', 'travel_guide'].includes(ref.type) || !Number.isInteger(ref.schemaVersion) || ref.schemaVersion < 1
        || !Number.isInteger(ref.tripContextVersion) || ref.tripContextVersion < 0
        || ref.presentationHint !== (ref.type === 'flight_search' ? 'flight_cards' : 'travel_guide')
        || entry.invalidatedArtifactIds.has(ref.id) || entry.snapshot.artifactRefs.some(value => value.id === ref.id)) return
      const refs = [...entry.snapshot.artifactRefs, { id: ref.id, type: ref.type, schemaVersion: ref.schemaVersion,
        tripContextVersion: ref.tripContextVersion, presentationHint: ref.presentationHint }].slice(-24)
      entry.artifactSelections.set(ref.id, activity.selectedFlightRevision)
      const retained = new Set(refs.map(value => value.id))
      for (const id of entry.artifactSelections.keys()) if (!retained.has(id)) entry.artifactSelections.delete(id)
      entry.snapshot = { ...entry.snapshot, artifactRefs: refs, artifactRevision: entry.snapshot.artifactRevision + 1,
        updatedAt: new Date().toISOString() }
      return
    }
    let stage = entry.snapshot.stage
    if (activity.type === 'tool_start') {
      stage = stageForTool(activity.toolName)
      entry.activeTools.set(activity.toolCallId, stage)
    } else if (activity.type === 'tool_end') {
      entry.activeTools.delete(activity.toolCallId)
      stage = [...entry.activeTools.values()].at(-1) ?? 'thinking'
    } else if (activity.type === 'model_start') stage = 'thinking'
    else if (activity.type === 'finalizing') stage = 'finalizing'
    entry.snapshot = { ...entry.snapshot, stage, updatedAt: new Date().toISOString() }
  }

  private fail(entry: TurnEntry<Response>, error: PlannerTurnError): void {
    if (entry.snapshot.status !== 'running') return
    entry.snapshot = { ...entry.snapshot, status: 'failed', updatedAt: new Date().toISOString(), error }
    this.finish(entry)
  }

  private finish(entry: TurnEntry<Response>): void {
    clearTimeout(entry.timer)
    entry.activeTools.clear()
    entry.expiresAt = Date.now() + this.retentionMs
  }

  private prune(): void {
    for (const [id, entry] of this.entries) {
      if (entry.executionSettled && entry.snapshot.status !== 'running' && entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) this.entries.delete(id)
    }
  }
}
