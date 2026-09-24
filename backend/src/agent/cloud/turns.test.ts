import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLANNER_JOB_TIMEOUT_MS, PLANNER_TURN_TIMEOUT_MS, PlannerTurnStore } from './turns.js'
import type { AgentActivityObserver } from '../runtime/activity.js'
import { v7 as uuidv7 } from 'uuid'

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('temporary Planner turn store', () => {
  afterEach(() => { vi.useRealTimers() })

  it('keeps DSH cancellation nonterminal until writes drain, retains earlier commits and rejects a competing turn', async () => {
    const store = new PlannerTurnStore<number>({ drainCancellation: true })
    const scope = { tripId: uuidv7(), conversationId: uuidv7(), generationId: uuidv7() }
    let observe!: AgentActivityObserver, signal!: AbortSignal, release!: (value: number) => void
    const turn = store.start('owner', async (abort, observer) => { signal = abort; observe = observer; return new Promise(resolve => { release = resolve }) }, scope)
    await flush()
    const event = { type: 'artifact_committed' as const, ...scope,
      artifact: { id: uuidv7(), type: 'travel_guide' as const, schemaVersion: 1, tripContextVersion: 0, presentationHint: 'travel_guide' as const } }
    observe(event)
    expect(await store.cancelAndWait('foreign', turn.turnId)).toBeUndefined()
    expect(signal.aborted).toBe(false)
    let acknowledged = false
    const stopping = store.cancelAndWait('owner', turn.turnId).then(value => { acknowledged = true; return value })
    await flush()
    expect(signal.aborted).toBe(true)
    expect(acknowledged).toBe(false)
    expect(store.get('owner', turn.turnId)).toMatchObject({ status: 'running', artifactRefs: [event.artifact] })
    expect(() => store.start('owner', async () => 5, { ...scope, generationId: uuidv7() })).toThrow('has not finished stopping')
    observe({ ...event, artifact: { ...event.artifact, id: uuidv7() } })
    release(3)
    expect(await stopping).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_CANCELLED' }, artifactRefs: [event.artifact] })
    expect(await store.cancelAndWait('owner', turn.turnId)).toMatchObject({ status: 'failed' })
    const next = store.start('owner', async () => 7, { ...scope, generationId: uuidv7() })
    await flush()
    expect(store.get('owner', next.turnId)).toMatchObject({ status: 'completed', response: 7 })
    store.close()
  })

  it('keeps the outer timeout but never treats it as a cancellation drain acknowledgement', async () => {
    vi.useFakeTimers()
    const store = new PlannerTurnStore<number>({ drainCancellation: true, deadlineMs: 100, maxEntries: 1 })
    let release!: (value: number) => void
    const turn = store.start('owner', async () => new Promise(resolve => { release = resolve }))
    await flush()
    let acknowledged = false
    const stopping = store.cancelAndWait('owner', turn.turnId).then(value => { acknowledged = true; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(store.get('owner', turn.turnId)).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_TIMEOUT' } })
    expect(acknowledged).toBe(false)
    expect(() => store.start('owner', async () => 1)).toThrow('Planner is busy')
    release(3)
    expect(await stopping).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_TIMEOUT' } })
    store.close()
  })

  it('publishes a bounded deduplicated scoped snapshot and removes outdated Trip/flight refs', async () => {
    const store = new PlannerTurnStore<number>()
    const scope = { tripId: uuidv7(), conversationId: uuidv7(), generationId: uuidv7() }
    let observe!: AgentActivityObserver
    const turn = store.start('owner', async (_signal, observer) => { observe = observer; return new Promise(() => {}) }, scope)
    await flush()
    const event = { type: 'artifact_committed' as const, ...scope, selectedFlightRevision: 2,
      artifact: { id: uuidv7(), type: 'travel_guide' as const, schemaVersion: 1, tripContextVersion: 3, presentationHint: 'travel_guide' as const } }
    observe({ ...event, generationId: 'other' }); observe({ ...event, tripId: 'other' }); observe({ ...event, conversationId: 'other' })
    expect(store.get('owner', turn.turnId)?.artifactRevision).toBe(0)
    observe(event); observe(event)
    expect(store.get('owner', turn.turnId)).toMatchObject({ artifactRevision: 1, artifactRefs: [event.artifact] })
    expect(store.get('other', turn.turnId)).toBeUndefined()
    expect(store.reconcile('owner', turn.turnId, 3, 2)?.artifactRefs).toHaveLength(1)
    expect(store.reconcile('owner', turn.turnId, 3, 3)).toMatchObject({ artifactRevision: 2, artifactRefs: [] })
    for (let i = 0; i < 30; i++) observe({ ...event, artifact: { ...event.artifact, id: uuidv7() } })
    expect(store.get('owner', turn.turnId)?.artifactRefs).toHaveLength(24)
    expect(store.reconcile('owner', turn.turnId, 4, 2)?.artifactRefs).toEqual([])
    store.close()
  })

  it('cancels only the owned turn, retains commits and ignores late publications/settlement', async () => {
    const store = new PlannerTurnStore<number>()
    const scope = { tripId: uuidv7(), conversationId: uuidv7(), generationId: uuidv7() }
    let observe!: AgentActivityObserver, signal!: AbortSignal, finish!: (result: number) => void
    const turn = store.start('owner', async (abort, observer) => { signal = abort; observe = observer; return new Promise(resolve => { finish = resolve }) }, scope)
    await flush()
    const event = { type: 'artifact_committed' as const, ...scope,
      artifact: { id: uuidv7(), type: 'flight_search' as const, schemaVersion: 1, tripContextVersion: 0, presentationHint: 'flight_cards' as const } }
    observe(event)
    expect(store.cancel('other', turn.turnId)).toBeUndefined()
    expect(signal.aborted).toBe(false)
    expect(store.cancel('owner', turn.turnId)).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_CANCELLED' }, artifactRefs: [event.artifact] })
    expect(signal.aborted).toBe(true)
    observe({ ...event, artifact: { ...event.artifact, id: uuidv7() } }); finish(3)
    await flush()
    expect(store.get('owner', turn.turnId)).toMatchObject({ status: 'failed', artifactRevision: 1, artifactRefs: [event.artifact] })
    expect(store.cancel('owner', turn.turnId)?.status).toBe('failed')
    store.close()
  })

  it('supersedes the same owned conversation while leaving unrelated turns running', async () => {
    const store = new PlannerTurnStore<number>()
    const scope = { tripId: uuidv7(), conversationId: uuidv7(), generationId: uuidv7() }
    const first = store.start('owner', async () => new Promise(() => {}), scope)
    const other = store.start('other', async () => new Promise(() => {}), scope)
    store.start('owner', async () => new Promise(() => {}), { ...scope, generationId: uuidv7() })
    expect(store.get('owner', first.turnId)?.status).toBe('failed')
    expect(store.get('other', other.turnId)?.status).toBe('running')
    store.close()
  })

  it('reports execution activity, keeps parallel work visible, isolates owners and expires results', async () => {
    vi.useFakeTimers()
    const store = new PlannerTurnStore<{ reply: string }>({ retentionMs: 100 })
    let observe!: AgentActivityObserver
    let complete!: (response: { reply: string }) => void
    const turn = store.start('owner', async (_signal, onActivity) => {
      observe = onActivity
      return new Promise(resolve => { complete = resolve })
    })
    await flush()
    expect(store.get('stranger', turn.turnId)).toBeUndefined()
    expect(store.get('owner', turn.turnId)).toMatchObject({ ...turn, stage: 'thinking' })
    observe({ type: 'tool_start', toolName: 'search_flights', toolCallId: 'flights' })
    observe({ type: 'tool_start', toolName: 'web_research', toolCallId: 'research' })
    expect(store.get('owner', turn.turnId)?.stage).toBe('researching')
    observe({ type: 'tool_end', toolName: 'web_research', toolCallId: 'research' })
    expect(store.get('owner', turn.turnId)?.stage).toBe('searching_flights')
    complete({ reply: 'done' })
    await flush()
    expect(store.get('owner', turn.turnId)).toMatchObject({ status: 'completed', stage: 'finalizing', response: { reply: 'done' } })
    await vi.advanceTimersByTimeAsync(100)
    expect(store.get('owner', turn.turnId)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    store.close()
  })

  it('never evicts running work at capacity and can replace terminal results', async () => {
    const store = new PlannerTurnStore<number>({ maxEntries: 1 })
    let complete!: (response: number) => void
    const first = store.start('owner', async () => new Promise(resolve => { complete = resolve }))
    await flush()
    expect(() => store.start('owner', async () => 2)).toThrow('Planner is busy')
    expect(store.get('owner', first.turnId)?.status).toBe('running')
    complete(1)
    await flush()
    const second = store.start('owner', async () => 2)
    expect(store.get('owner', first.turnId)).toBeUndefined()
    await flush()
    expect(store.get('owner', second.turnId)).toMatchObject({ status: 'completed', response: 2 })
    store.close()
  })

  it('bounds ignored cancellation and owns late rejection without overwriting timeout', async () => {
    vi.useFakeTimers()
    const store = new PlannerTurnStore<number>({ deadlineMs: 100 })
    let signal!: AbortSignal
    let rejectLate!: (error: Error) => void
    const turn = store.start('owner', async value => {
      signal = value
      return new Promise((_resolve, reject) => { rejectLate = reject })
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(signal.aborted).toBe(true)
    expect(store.get('owner', turn.turnId)).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_TIMEOUT' } })
    rejectLate(new Error('late provider credentials must not leak'))
    await flush()
    expect(JSON.stringify(store.get('owner', turn.turnId))).not.toContain('credentials')
    expect(vi.getTimerCount()).toBe(0)
    store.close()
  })

  it('allows the 300s runtime timeout to finalize before the 315s outer guard', async () => {
    vi.useFakeTimers()
    expect(PLANNER_TURN_TIMEOUT_MS).toBe(300_000)
    expect(PLANNER_JOB_TIMEOUT_MS).toBe(315_000)
    const store = new PlannerTurnStore<{ stopReason: string }>()
    const turn = store.start('owner', async () => new Promise(resolve => {
      setTimeout(() => resolve({ stopReason: 'turn_timeout' }), PLANNER_TURN_TIMEOUT_MS + 3_000)
    }))
    await vi.advanceTimersByTimeAsync(PLANNER_TURN_TIMEOUT_MS)
    expect(store.get('owner', turn.turnId)?.status).toBe('running')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(store.get('owner', turn.turnId)).toMatchObject({ status: 'completed', response: { stopReason: 'turn_timeout' } })
    expect(vi.getTimerCount()).toBe(0)
    store.close()
  })

  it('sanitizes execution failure and removes all timers and state on close', async () => {
    vi.useFakeTimers()
    const store = new PlannerTurnStore<number>()
    const failed = store.start('owner', async () => { throw new Error('secret provider token') })
    await flush()
    expect(store.get('owner', failed.turnId)).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_FAILED' } })
    expect(JSON.stringify(store.get('owner', failed.turnId))).not.toContain('secret')
    let signal!: AbortSignal
    const running = store.start('owner', async value => { signal = value; return new Promise(() => {}) })
    await flush()
    store.close()
    expect(signal.aborted).toBe(true)
    expect(store.get('owner', running.turnId)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => store.start('owner', async () => 3)).toThrow('shutting down')
  })
})
