import { describe, expect, it } from 'vitest'
import {
  intervalUnion,
  observeModelCall,
  observePlannerTurn,
  observeSpan,
  recordGuideRepair,
  recordMilestone,
  recordProviderSearches,
  recordTurnOutcome
} from './planner-observation.js'

const scope = { requestId: 'request-1', tripId: 'trip-1', conversationId: 'conversation-1', generationId: 'generation-1' }

describe('planner observation', () => {
  it('computes exclusive time as the interval union for nested and parallel work', async () => {
    expect(intervalUnion([[0, 10], [2, 8], [5, 14]])).toBe(14)
    let now = 0
    let snapshot: any
    await observePlannerTurn(scope, async () => {
      await observeSpan('phase', 'turn', async () => {
        let releaseA!: () => void
        let releaseB!: () => void
        const childA = new Promise<void>(resolve => { releaseA = resolve })
        const childB = new Promise<void>(resolve => { releaseB = resolve })
        now = 10
        const first = observeSpan('tool', 'parallel-a', async () => { await childA; now = 30 })
        now = 20
        const second = observeSpan('tool', 'parallel-b', async () => { await childB; now = 40 })
        releaseA()
        await Promise.resolve()
        releaseB()
        await Promise.all([first, second])
        now = 50
      })
    }, value => { snapshot = value }, () => now)
    const parent = snapshot.spans.find((span: any) => span.name === 'turn')
    expect(parent).toMatchObject({ durationMs: 50, exclusiveMs: 20 })
    expect(snapshot.spans.find((span: any) => span.name === 'parallel-a')).toMatchObject({ parentId: parent.id, startMs: 10, endMs: 30 })
    expect(snapshot.spans.find((span: any) => span.name === 'parallel-b')).toMatchObject({ parentId: parent.id, startMs: 20, endMs: 40 })
  })

  it('counts a nested model wrapper once and keeps HTTP attempts independent', async () => {
    let snapshot: any
    await observePlannerTurn(scope, async () => {
      await observeModelCall('planner', async () => {
        await observeModelCall('provider-wrapper', async () => {})
        await observeSpan('http', 'openrouter', async () => {})
        await observeSpan('http', 'openrouter', async () => {})
      })
    }, value => { snapshot = value })
    expect(snapshot.counts).toMatchObject({ modelCalls: 1, httpAttempts: 2 })
    expect(snapshot.spans.filter((span: any) => span.kind === 'model')).toHaveLength(1)
    expect(snapshot.spans.filter((span: any) => span.kind === 'http')).toHaveLength(2)
  })

  it('does not let sink failures change a successful or failed business outcome', async () => {
    await expect(observePlannerTurn(scope, async () => 'ok', () => { throw new Error('sink unavailable') })).resolves.toBe('ok')
    await expect(observePlannerTurn(scope, async () => { throw Object.assign(new Error('cancelled'), { code: 'PROVIDER_CANCELLED' }) }, () => { throw new Error('sink unavailable') }))
      .rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
  })

  it('closes the recorder before late events and bounds stored spans at 512', async () => {
    let snapshot: any
    let releaseLate!: () => void
    let lateChild!: Promise<void>
    await observePlannerTurn(scope, async () => {
      lateChild = observeSpan('tool', 'late-child', async () => {
        await new Promise<void>(resolve => { releaseLate = resolve })
        recordMilestone('firstGuideSavedMs')
        recordTurnOutcome('late')
      })
      for (let i = 0; i < 520; i += 1) await observeSpan('tool', `tool-${i}`, async () => {})
    }, value => { snapshot = value })
    const before = JSON.stringify(snapshot)
    releaseLate()
    await lateChild
    expect(snapshot.spans).toHaveLength(512)
    expect(snapshot.spansTruncated).toBe(true)
    expect(JSON.stringify(snapshot)).toBe(before)
    expect(snapshot.spans.find((span: any) => span.name === 'late-child')).toMatchObject({ status: 'interrupted' })
  })

  it('records first milestones, bounded repair classes, and unknown values as null', async () => {
    let snapshot: any
    await observePlannerTurn({ ...scope, ownerId: 'should-not-escape' } as any, async () => {
      recordMilestone('firstFlightSavedMs')
      recordMilestone('firstFlightSavedMs')
      recordGuideRepair(['draft_invalid', 'draft_invalid', 'unsafe-secret', 'context_conflict'])
      recordProviderSearches(-1)
    }, value => { snapshot = value })
    expect(snapshot).not.toHaveProperty('ownerId')
    expect(snapshot.milestones.firstFlightSavedMs).toEqual(expect.any(Number))
    expect(snapshot.milestones.firstGuideSavedMs).toBeNull()
    expect(snapshot.milestones.firstVerifiedMs).toBeNull()
    expect(snapshot.repairClasses).toEqual({ draft_invalid: 1, context_conflict: 1 })
    expect(snapshot.providerReportedSearches).toBeNull()
    expect(snapshot.spans).toEqual([])
  })

  it('sanitizes span names and never stores sensitive model metadata through public helpers', async () => {
    let snapshot: any
    await observePlannerTurn(scope, async () => {
      await observeSpan('model', 'Bearer secret-token-and-user-prompt', async () => {})
    }, value => { snapshot = value })
    expect(snapshot.spans[0].name).toBe('unknown')
    expect(JSON.stringify(snapshot)).not.toContain('secret-token')
    expect(JSON.stringify(snapshot)).not.toContain('user-prompt')
  })
})
