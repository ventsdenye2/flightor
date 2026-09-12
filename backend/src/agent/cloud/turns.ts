import { v7 as uuidv7 } from 'uuid'
import { AppError } from '../../lib/errors.js'
import type { AgentActivity, AgentActivityObserver } from '../runtime/activity.js'

export const PLANNER_TURN_TIMEOUT_MS = 300_000
/** Leave time for the runtime's timeout fallback and conversation persistence. */
export const PLANNER_JOB_TIMEOUT_MS = PLANNER_TURN_TIMEOUT_MS + 15_000
export const PLANNER_STAGES = ['thinking', 'updating_trip', 'searching_flights', 'researching', 'building_itinerary', 'finalizing'] as const
export type PlannerStage = typeof PLANNER_STAGES[number]
export type PlannerTurnError = { code: string; message: string }
type TurnBase = { turnId: string; stage: PlannerStage; startedAt: string; updatedAt: string }
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
  expiresAt?: number
}

export interface PlannerTurnStoreOptions {
  maxEntries?: number
  retentionMs?: number
  /** Test override; production uses 315s including 15s of finalization headroom. */
  deadlineMs?: number
  onError?: (error: unknown, turnId: string) => void
}

function stageForTool(tool: string): PlannerStage {
  if (tool === 'update_trip_context') return 'updating_trip'
  if (['search_flights', 'search_flexible_flights', 'search_connection_flights', 'confirm_flight_price', 'confirm_route_price', 'plan_flight_route', 'optimize_route'].includes(tool)) return 'searching_flights'
  if (['web_research', 'research_destination', 'search_destinations', 'recommend_destinations'].includes(tool)) return 'researching'
  if (['save_travel_guide', 'build_travel_guide', 'plan_trip_route'].includes(tool)) return 'building_itinerary'
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

  start(ownerId: string, execute: (signal: AbortSignal, onActivity: AgentActivityObserver) => Promise<Response>): { turnId: string; status: 'running'; startedAt: string } {
    if (this.closed) throw new AppError('AGENT_UNAVAILABLE', 'Planner is shutting down', 503)
    this.prune()
    // Completed results may be replaced. In-flight work is never displaced.
    while (this.entries.size >= this.maxEntries) {
      const terminal = [...this.entries].find(([, entry]) => entry.snapshot.status !== 'running')
      if (!terminal) throw new AppError('AGENT_BUSY', 'Planner is busy; try again later', 503)
      this.entries.delete(terminal[0])
    }
    const turnId = uuidv7()
    const startedAt = new Date().toISOString()
    const controller = new AbortController()
    const entry: TurnEntry<Response> = {
      ownerId, controller, activeTools: new Map(),
      snapshot: { turnId, status: 'running', stage: 'thinking', startedAt, updatedAt: startedAt },
      timer: setTimeout(() => {
        this.fail(entry, { code: 'AGENT_TURN_TIMEOUT', message: '本轮处理已超时，已保存的结果会保留。请重新打开行程查看。' })
        controller.abort(new Error('Planner job deadline exceeded'))
      }, this.deadlineMs)
    }
    entry.timer.unref?.()
    this.entries.set(turnId, entry)
    // Attach both settlement handlers before starting any model/provider work.
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return execute(controller.signal, activity => this.observe(entry, activity))
    }).then(response => {
      if (entry.snapshot.status !== 'running' || controller.signal.aborted) return
      entry.snapshot = { ...entry.snapshot, status: 'completed', stage: 'finalizing', updatedAt: new Date().toISOString(), response }
      this.finish(entry)
    }, error => {
      if (entry.snapshot.status !== 'running') return
      this.fail(entry, publicError(error))
      try { this.options.onError?.(error, turnId) } catch { /* logging is best effort */ }
    })
    return { turnId, status: 'running', startedAt }
  }

  get(ownerId: string, turnId: string): PlannerTurnSnapshot<Response> | undefined {
    this.prune()
    const entry = this.entries.get(turnId)
    return entry?.ownerId === ownerId ? structuredClone(entry.snapshot) : undefined
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
      if (entry.snapshot.status !== 'running' && entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) this.entries.delete(id)
    }
  }
}
