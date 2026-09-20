/** In-memory diagnostics only. No prompts, payloads, credentials, history writes or network calls. */
export interface PlannerTelemetryScope {
  ownerId: string
  authRevision: number
  sessionId: string
  requestId: number
  tripId: string
  conversationId: string
}
export type PlannerUiCommit = { kind: 'flight' | 'guide'; artifactId: string; verificationStatus?: string | null }
  | { kind: 'final' }
export interface PlannerRenderMeasurement {
  id: string
  flights: Array<{ id: string; verificationStatus: string | null }>
  guide?: { id: string; verificationStatus: string | null }
  finalReady: boolean
}
type Status = 'running' | 'completed' | 'failed' | 'cancelled' | 'abandoned'
type ResultCommit = { artifactId: string; committedAtMs: number | null; verificationStatus: string | null }
export interface PlannerClientMeasurement {
  id: string
  scope: Omit<PlannerTelemetryScope, 'ownerId'>
  turnId: string | null
  generationId: string | null
  clock: 'client_monotonic' | 'unavailable'
  renderEvidence: 'react_effect_commit_not_paint'
  status: Status
  deliveryStatus: string | null
  clickedAtMs: number | null
  sendStartedAtMs: number | null
  acceptedAtMs: number | null
  firstFlight: ResultCommit | null
  firstGuide: ResultCommit | null
  finalUiCommitAtMs: number | null
  finalUiCommitObserved: boolean
  terminalAtMs: number | null
  failureCode: string | null
  clickToAckMs: number | null
  firstFlightCommitMs: number | null
  firstGuideCommitMs: number | null
  finalUiCommitMs: number | null
  timeToFailureMs: number | null
}
type Entry = { ownerId: string; measurement: PlannerClientMeasurement; eligible: Map<string, string> }
const delta = (start: number | null, end: number | null) => start !== null && end !== null && end >= start ? end - start : null

export class PlannerTelemetry {
  private readonly entries = new Map<string, Entry>()
  private sequence = 0
  private lastClock: number | null = null
  constructor(private readonly readClock: () => number | null = () => {
    const clock = globalThis.performance
    return typeof clock?.now === 'function' ? clock.now() : null
  }, private readonly capacity = 32) {}

  now(): number | null {
    try {
      const value = this.readClock()
      if (value === null || !Number.isFinite(value) || value < 0 || (this.lastClock !== null && value < this.lastClock)) return null
      this.lastClock = value
      return value
    } catch { return null }
  }

  begin(scope: PlannerTelemetryScope, clickedAtMs: number | null = null): string {
    const id = `planner-client-${++this.sequence}`
    const started = this.now()
    const click = clickedAtMs !== null && Number.isFinite(clickedAtMs) && clickedAtMs >= 0 && started !== null && clickedAtMs <= started ? clickedAtMs : null
    const { ownerId, ...publicScope } = scope
    this.entries.set(id, { ownerId, eligible: new Map(), measurement: {
      id, scope: { ...publicScope }, turnId: null, generationId: null,
      clock: started === null ? 'unavailable' : 'client_monotonic', renderEvidence: 'react_effect_commit_not_paint',
      status: 'running', deliveryStatus: null, clickedAtMs: click, sendStartedAtMs: started, acceptedAtMs: null,
      firstFlight: null, firstGuide: null, finalUiCommitAtMs: null, finalUiCommitObserved: false, terminalAtMs: null, failureCode: null,
      clickToAckMs: null, firstFlightCommitMs: null, firstGuideCommitMs: null, finalUiCommitMs: null, timeToFailureMs: null
    } })
    const bound = Number.isFinite(this.capacity) ? Math.max(1, Math.min(128, Math.floor(this.capacity))) : 32
    while (this.entries.size > bound) this.entries.delete(this.entries.keys().next().value!)
    return id
  }

  /** Only the still-active sender can bind the workspace created by initial bootstrap. */
  bindWorkspace(id: string, scope: PlannerTelemetryScope): void {
    const entry = this.entries.get(id)
    if (!entry || entry.ownerId !== scope.ownerId || entry.measurement.scope.authRevision !== scope.authRevision
      || entry.measurement.scope.requestId !== scope.requestId || entry.measurement.status !== 'running' || entry.measurement.turnId) return
    const { ownerId: _ownerId, ...publicScope } = scope
    entry.measurement.scope = { ...publicScope }
  }

  private matching(id: string, scope: PlannerTelemetryScope): Entry | undefined {
    const entry = this.entries.get(id), saved = entry?.measurement.scope
    return entry && saved && entry.ownerId === scope.ownerId && saved.authRevision === scope.authRevision
      && saved.requestId === scope.requestId && saved.sessionId === scope.sessionId && saved.tripId === scope.tripId
      && saved.conversationId === scope.conversationId ? entry : undefined
  }

  accepted(id: string, scope: PlannerTelemetryScope, turnId: string, generationId?: string): void {
    const entry = this.matching(id, scope), value = entry?.measurement
    if (!value || value.status !== 'running' || value.turnId) return
    value.turnId = turnId
    value.generationId = generationId ?? null
    value.acceptedAtMs = this.now()
    value.clickToAckMs = delta(value.clickedAtMs, value.acceptedAtMs)
  }

  published(id: string, scope: PlannerTelemetryScope, turnId: string, generationId: string, refs: readonly { id: string; type: string }[]): void {
    const entry = this.matching(id, scope)
    if (!entry || entry.measurement.turnId !== turnId || entry.measurement.generationId !== generationId || entry.measurement.status !== 'running') return
    entry.eligible = new Map(refs.filter(ref => ref.type === 'flight_search' || ref.type === 'travel_guide').slice(-24).map(ref => [ref.id, ref.type]))
  }

  terminal(id: string, scope: PlannerTelemetryScope, status: Exclude<Status, 'running'>, details: { code?: string; deliveryStatus?: string } = {}): void {
    const value = this.matching(id, scope)?.measurement
    if (!value || value.status !== 'running') return
    value.status = status
    value.terminalAtMs = this.now()
    value.deliveryStatus = details.deliveryStatus && ['not_requested', 'pending', 'satisfied', 'partial', 'failed', 'cancelled'].includes(details.deliveryStatus) ? details.deliveryStatus : null
    value.failureCode = details.code && /^[A-Z_]{1,80}$/.test(details.code) ? details.code : null
    if (status !== 'completed') value.timeToFailureMs = delta(value.sendStartedAtMs, value.terminalAtMs)
  }

  commit(id: string, scope: PlannerTelemetryScope, event: PlannerUiCommit): void {
    const entry = this.matching(id, scope), value = entry?.measurement
    if (!entry || !value || !value.turnId || value.status === 'abandoned') return
    if (event.kind === 'final') {
      if (value.status !== 'completed' || value.finalUiCommitObserved) return
      value.finalUiCommitObserved = true
      value.finalUiCommitAtMs = this.now()
      value.finalUiCommitMs = delta(value.clickedAtMs, value.finalUiCommitAtMs)
      return
    }
    const type = event.kind === 'flight' ? 'flight_search' : 'travel_guide'
    if (entry.eligible.get(event.artifactId) !== type || (event.kind === 'flight' ? value.firstFlight : value.firstGuide)) return
    const at = this.now()
    const result = { artifactId: event.artifactId, committedAtMs: at,
      verificationStatus: event.verificationStatus && ['verified', 'partial', 'unverified', 'stale'].includes(event.verificationStatus) ? event.verificationStatus : null }
    if (event.kind === 'flight') { value.firstFlight = result; value.firstFlightCommitMs = delta(value.clickedAtMs, at) }
    else { value.firstGuide = result; value.firstGuideCommitMs = delta(value.clickedAtMs, at) }
  }

  snapshot(): PlannerClientMeasurement[] {
    return [...this.entries.values()].map(({ measurement: value }) => ({ ...value, scope: { ...value.scope },
      firstFlight: value.firstFlight ? { ...value.firstFlight } : null, firstGuide: value.firstGuide ? { ...value.firstGuide } : null }))
  }
}

export const plannerTelemetry = new PlannerTelemetry()
export const getPlannerTelemetrySnapshot = () => plannerTelemetry.snapshot()
