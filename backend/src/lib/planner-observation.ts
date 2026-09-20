import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import type { ChatCompletionObservation } from '../agent/runtime/model.js'

export type SpanKind = 'model' | 'tool' | 'http' | 'phase'
type SpanStatus = 'ok' | 'error' | 'interrupted'
export interface PlannerSpan {
  id: number
  parentId: number | null
  kind: SpanKind
  name: string
  startMs: number
  endMs: number
  durationMs: number
  exclusiveMs: number
  status: SpanStatus
  errorCode: string | null
  httpStatus?: number
  search?: { requestedLimit: number; reportedCount: number | null; exceedsLimit: boolean | null }
  model?: ChatCompletionObservation
}
export interface PlannerObservation {
  version: 1
  requestId: string
  tripId: string
  conversationId: string
  generationId: string
  startedAt: string
  clock: 'server_monotonic'
  durationMs: number
  outcome: string
  spans: PlannerSpan[]
  spansTruncated: boolean
  counts: { modelCalls: number; toolCalls: number; httpAttempts: number; guideSaveAttempts: number; guideRevisionAttempts: number; guideRepairResponses: number }
  milestones: { firstFlightSavedMs: number | null; firstGuideSavedMs: number | null; firstVerifiedMs: number | null }
  repairClasses: Record<string, number>
  /** Only provider-reported native web-search counts. Null means no valid receipt. */
  providerReportedSearches: number | null
  modelUsage: ChatCompletionObservation['usage']
  modelCostUsdMicros: number | null
  knownModelCostUsdMicros: number
  unknownModelCostCalls: number
}
type Scope = Pick<PlannerObservation, 'requestId' | 'tripId' | 'conversationId' | 'generationId'>
type OpenSpan = Omit<PlannerSpan, 'endMs' | 'durationMs' | 'exclusiveMs' | 'status'> & { endMs?: number; status?: SpanStatus }
interface Recorder {
  scope: Scope; startedAt: string; origin: number; now: () => number; last: number
  spans: OpenSpan[]; truncated: boolean; closed: boolean; outcome: string
  counts: PlannerObservation['counts']; milestones: PlannerObservation['milestones']; repairs: Record<string, number>
  searchCount: number | null
}
const context = new AsyncLocalStorage<{ recorder: Recorder; span?: OpenSpan }>()
const safeCode = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,100}$/.test(value) ? value : 'unknown'
function elapsed(r: Recorder): number {
  const next = r.now() - r.origin
  if (Number.isFinite(next)) r.last = Math.max(r.last, next, 0)
  return r.last
}
function recorder() { const r = context.getStore()?.recorder; return r && !r.closed ? r : undefined }
export function hasPlannerObservation() { return Boolean(recorder()) }

/** Union of intervals, not their sum: concurrent and nested waits must not inflate wall time. */
export function intervalUnion(intervals: Array<[number, number]>): number {
  const ordered = intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  let total = 0, from = 0, to = 0
  for (const [a, b] of ordered) {
    if (a > to) { total += to - from; from = a; to = b } else to = Math.max(to, b)
  }
  return total + to - from
}

/** A bounded diagnostic record, outside model context and public turn responses. */
export async function observePlannerTurn<T>(scope: Scope, task: () => Promise<T>, sink?: (value: PlannerObservation) => void,
  clock: () => number = () => performance.now()): Promise<T> {
  const r: Recorder = { scope: { requestId: scope.requestId, tripId: scope.tripId, conversationId: scope.conversationId, generationId: scope.generationId },
    startedAt: new Date().toISOString(), origin: clock(), now: clock, last: 0,
    spans: [], truncated: false, closed: false, outcome: 'completed',
    counts: { modelCalls: 0, toolCalls: 0, httpAttempts: 0, guideSaveAttempts: 0, guideRevisionAttempts: 0, guideRepairResponses: 0 },
    milestones: { firstFlightSavedMs: null, firstGuideSavedMs: null, firstVerifiedMs: null }, repairs: {}, searchCount: null }
  return context.run({ recorder: r }, async () => {
    try { return await task() }
    catch (error) { r.outcome = safeCode((error as { code?: unknown })?.code); throw error }
    finally {
      const durationMs = elapsed(r)
      r.closed = true
      const spans: PlannerSpan[] = r.spans.map(span => {
        const endMs = span.endMs ?? durationMs
        const duration = Math.max(0, endMs - span.startMs)
        const children = r.spans.filter(child => child.parentId === span.id)
          .map(child => [Math.max(span.startMs, child.startMs), Math.min(endMs, child.endMs ?? durationMs)] as [number, number])
        return { ...span, endMs, durationMs: duration, exclusiveMs: Math.max(0, duration - intervalUnion(children)), status: span.status ?? 'interrupted' }
      })
      const models = spans.filter(span => span.kind === 'model')
      const knownCosts = models.flatMap(span => span.model?.costUsdMicros == null ? [] : [span.model.costUsdMicros])
      const knownModelCostUsdMicros = knownCosts.reduce((sum, value) => sum + value, 0)
      const unknownModelCostCalls = r.counts.modelCalls - knownCosts.length
      const sumUsage = (key: keyof ChatCompletionObservation['usage']): number | null => {
        const values = models.map(span => span.model?.usage[key])
        if (models.length !== r.counts.modelCalls || values.some(value => value == null)) return null
        const sum = values.reduce<number>((total, value) => total + value!, 0)
        return Number.isSafeInteger(sum) ? sum : null
      }
      try { sink?.({ version: 1, ...r.scope, startedAt: r.startedAt, clock: 'server_monotonic', durationMs,
        outcome: r.outcome, spans, spansTruncated: r.truncated, counts: { ...r.counts }, milestones: { ...r.milestones },
        repairClasses: { ...r.repairs }, providerReportedSearches: r.searchCount,
        modelUsage: { promptTokens: sumUsage('promptTokens'), completionTokens: sumUsage('completionTokens'), totalTokens: sumUsage('totalTokens'),
          reasoningTokens: sumUsage('reasoningTokens'), cachedTokens: sumUsage('cachedTokens') },
        modelCostUsdMicros: unknownModelCostCalls === 0 && Number.isSafeInteger(knownModelCostUsdMicros) ? knownModelCostUsdMicros : null,
        knownModelCostUsdMicros, unknownModelCostCalls }) } catch { /* Diagnostics cannot change business outcomes. */ }
    }
  })
}

export async function observeSpan<T>(kind: SpanKind, name: string, task: () => Promise<T>): Promise<T> {
  const parent = context.getStore(), r = recorder()
  if (!r) return task()
  if (kind === 'model') r.counts.modelCalls++
  if (kind === 'tool') r.counts.toolCalls++
  if (kind === 'http') r.counts.httpAttempts++
  if (kind === 'tool' && name === 'save_travel_guide') r.counts.guideSaveAttempts++
  if (r.spans.length >= 512) { r.truncated = true; return task() }
  const span: OpenSpan = { id: r.spans.length + 1, parentId: parent?.span?.id ?? null, kind, name: safeCode(name), startMs: elapsed(r), errorCode: null }
  r.spans.push(span)
  return context.run({ recorder: r, span }, async () => {
    try { return await task() }
    catch (error) {
      if (!r.closed) { span.status = 'error'; span.errorCode = safeCode((error as { code?: unknown })?.code) }
      throw error
    } finally {
      if (!r.closed) { span.endMs = elapsed(r); span.status ??= 'ok' }
    }
  })
}

/** Runtime wraps Planner requests; shared adapters reuse that span and create research children when needed. */
export function observeModelCall<T>(name: string, task: () => Promise<T>): Promise<T> {
  return context.getStore()?.span?.kind === 'model' ? task() : observeSpan('model', name, task)
}
export function recordModelObservation(value: ChatCompletionObservation): void {
  const state = context.getStore()
  if (state && !state.recorder.closed && state.span?.kind === 'model') state.span.model = structuredClone(value)
}
export function recordSpanError(code: string): void {
  const state = context.getStore()
  if (state && !state.recorder.closed && state.span) { state.span.status = 'error'; state.span.errorCode = safeCode(code) }
}
export function recordHttpStatus(status: number): void {
  const state = context.getStore()
  if (state && !state.recorder.closed && state.span?.kind === 'http' && Number.isInteger(status)) {
    state.span.httpStatus = status
    if (status >= 400) recordSpanError(`HTTP_${status}`)
  }
}
export function recordSearchStatistics(requestedLimit: number, reportedCount: number | null): void {
  const state = context.getStore()
  if (state && !state.recorder.closed && state.span) state.span.search = { requestedLimit, reportedCount,
    exceedsLimit: reportedCount === null ? null : reportedCount > requestedLimit }
}
export function recordTurnOutcome(value: string): void { const r = recorder(); if (r) r.outcome = safeCode(value) }
export function recordMilestone(key: keyof PlannerObservation['milestones']): void {
  const r = recorder(); if (r && r.milestones[key] === null) r.milestones[key] = elapsed(r)
}
export function recordGuideRepair(classes: string[]): void {
  const r = recorder(); if (!r) return
  r.counts.guideRepairResponses++
  for (const key of new Set(classes)) if (['draft_invalid', 'evidence_missing', 'context_conflict'].includes(key)) r.repairs[key] = (r.repairs[key] ?? 0) + 1
}
export function recordGuideRevisionAttempt(): void { const r = recorder(); if (r) r.counts.guideRevisionAttempts++ }
export function recordProviderSearches(count: number): void {
  const r = recorder()
  if (r && Number.isSafeInteger(count) && count >= 0) r.searchCount = (r.searchCount ?? 0) + count
}
