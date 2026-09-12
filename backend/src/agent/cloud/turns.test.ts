import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLANNER_JOB_TIMEOUT_MS, PLANNER_TURN_TIMEOUT_MS, PlannerTurnStore } from './turns.js'
import type { AgentActivityObserver } from '../runtime/activity.js'

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('temporary Planner turn store', () => {
  afterEach(() => { vi.useRealTimers() })

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
