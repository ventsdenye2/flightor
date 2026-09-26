import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext, type TripContext } from '../../trips/types.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { DshEvidenceStore } from './evidence.js'
import { createCommitGuideTool } from './commit-guide.js'
import { budgetNotesEquivalent, carryForwardBudgetGuide, isBudgetOnlyGuideChange } from './budget-guide.js'

const city = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const oldNotes = ['机票自备，不查航班。两天合计预算。']
const newNotes = ['机票自备，不查航班。', '两天合计预算（非每日）。', '不得承诺总支出一定在预算内。']
async function fixture() {
  const ownerId = 'budget-owner', tripId = randomUUID(), conversationId = randomUUID(), generationId = randomUUID()
  const trip: TripContext = { ...emptyTripContext(tripId), version: 1, travelDays: 1, notes: oldNotes,
    budget: { amount: 1500, currency: 'CNY', scope: 'trip' },
    departureWindow: { from: '2026-10-24', to: '2026-10-24', precision: 'exact' },
    destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] } }
  const trips = new InMemoryTripContextRepository([trip]), artifacts = new InMemoryArtifactRepository(ownerId, new Set([tripId]))
  const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
  const context = { ownerId, tripId, conversationId, generationId, requestId: randomUUID(), trips, artifacts,
    resolvedLocations: new Map(), goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
    isGenerationCurrent: () => true, research: { research: vi.fn(() => { throw new Error('Research forbidden') }) } } as unknown as ToolExecutionContext
  const store = new DshEvidenceStore({ ownerId, tripId, conversationId, generationId, tripContextVersion: 1 })
  const evidence = await store.recordSearch({ sources: [{ url: 'https://example.test/culture', title: 'Culture museum', snippet: 'Visit cultural exhibitions inside the museum.' }] }, 'fixture', 'search')
  const tool = createCommitGuideTool({ evidenceStore: store, locale: 'en' })
  const result = await tool.execute(tool.inputSchema.parse({
    intent: { kind: 'travel_guide', parameters: { questions: ['Culture'], researchTypes: ['activity'], requiredEvidenceTypes: ['activity'], maxResults: 4, maxCities: 1, allowPartial: true } },
    candidates: [{ key: 'museum', evidenceRefs: evidence.evidenceRefs, title: 'Cultural museum', summary: 'Visit cultural exhibitions inside the museum.', category: 'activity', locationId: city.id }],
    days: [{ day: 1, cityId: city.id, kind: 'visit', theme: 'Museum culture', items: [{ activityKey: 'museum', candidateKey: 'museum', timeOfDay: 'afternoon', planningNote: 'Enjoy the cultural exhibitions at a relaxed pace.' }] }],
    text: { reply: 'Your cultural itinerary is saved.', overview: 'Enjoy a relaxed cultural visit with time to appreciate the exhibitions.', days: [{ day: 1, theme: 'Museum culture' }],
      activities: [{ activityKey: 'museum', name: 'Cultural museum', introduction: 'Visit the museum to explore its cultural exhibitions.', recommendationReason: 'The indoor visit fits your interest in culture and a relaxed pace.' }] }
  }), context, new AbortController().signal) as any
  const base = (await artifacts.get(result.artifact.id))!
  const nextContext = { ...context, requestId: randomUUID(), generationId: randomUUID(), onArtifactCommitted: vi.fn() }
  delete nextContext.activeGoalId; delete nextContext.activeGoalRunId; delete nextContext.activeGoalKind
  delete nextContext.activeGoalContextVersion; delete nextContext.acceptedGoalIntent
  return { trip, trips, artifacts, goals, runs, base, context: nextContext }
}

describe('DSH budget-only accepted guide carry-forward', () => {
  it('revalidates copied provenance and accepted text under a new Goal without research, and is idempotent', async () => {
    const f = await fixture(), before = await f.artifacts.listForTrip(f.trip.id)
    const oldGuide = travelGuideArtifactPayloadSchema.parse(f.base.payload)
    const updated = await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, notes: newNotes }, 1)
    expect(await f.trips.getAtVersion(f.trip.id, 1)).toEqual(f.trip)
    const result = await carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: new AbortController().signal }) as any
    expect(result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const record = (await f.artifacts.get(result.artifact.id))!, next = travelGuideArtifactPayloadSchema.parse(record.payload)
    expect(record.tripContextVersion).toBe(2)
    expect(next.budget).toEqual({ ...updated.budget, partyBasis: 'unspecified', period: 'trip_total' })
    const omitSource = (days: typeof next.days) => days.map(day => ({ ...day, items: day.items.map(({ sourceArtifactId: _source, ...item }) => item) }))
    expect(omitSource(next.days)).toEqual(omitSource(oldGuide.days))
    expect(publicationFor(record)!.finalization!.variants.en).toMatchObject({ status: 'accepted', observation: { calls: 0 } })
    const oldSource = before.find(item => item.type === 'research')!
    const source = (await f.artifacts.get(next.days[0]!.items[0]!.sourceArtifactId))!
    expect(source.sourceArtifactIds).toEqual([oldSource.id])
    expect(source.payload).toEqual({ ...(oldSource.payload as object), id: source.id })
    expect((await f.goals.get(record.goalId!))!.parameters).toEqual((await f.goals.get(f.base.goalId!))!.parameters)
    expect(f.context.research.research).not.toHaveBeenCalled()
    expect(f.context.onArtifactCommitted).toHaveBeenCalledTimes(1)
    expect(await f.artifacts.get(f.base.id)).toEqual(f.base)
    expect(f.context.activeGoalId).toBeUndefined()
    const count = (await f.artifacts.listForTrip(f.trip.id)).length
    expect(await carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: new AbortController().signal })).toBeNull()
    expect(await f.artifacts.listForTrip(f.trip.id)).toHaveLength(count)
  })

  it('uses the authoritative base snapshot when a previous budget update already advanced the Trip twice', async () => {
    const f = await fixture()
    await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, notes: newNotes }, 1)
    await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }, 2)
    const result = await carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: new AbortController().signal }) as any
    expect(result.completion.status).toBe('satisfied')
    expect((await f.artifacts.get(result.artifact.id))!.tripContextVersion).toBe(3)
    expect(await f.trips.getAtVersion(f.trip.id, 1)).toEqual(f.trip)
  })

  it('revalidates a repeated identical budget write that still advances the Trip version', async () => {
    const f = await fixture()
    await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }, 1)
    const first = await carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: new AbortController().signal }) as any
    await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }, 2)
    const second = await carryForwardBudgetGuide({ context: { ...f.context, requestId: randomUUID(), generationId: randomUUID() },
      baseGuideId: first.artifact.id, locale: 'en', signal: new AbortController().signal }) as any
    expect(second).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    expect((await f.artifacts.get(second.artifact.id))!.tripContextVersion).toBe(3)
  })

  it.each(['date', 'interest', 'nonbudget_note', 'wrong_scope', 'foreign_trip'] as const)('rejects %s without derivative writes', async failure => {
    const f = await fixture()
    await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: failure === 'wrong_scope' ? 'airfare' : 'trip' },
      ...(failure === 'date' ? { departureWindow: { from: '2026-10-25', to: '2026-10-25', precision: 'exact' as const } } : {}),
      ...(failure === 'interest' ? { interests: ['nightlife'] } : {}),
      ...(failure === 'nonbudget_note' ? { notes: [...oldNotes, '第一天改去另一个博物馆。'] } : {}) }, 1)
    const before = await f.artifacts.listForTrip(f.trip.id)
    if (failure === 'foreign_trip') f.context.tripId = randomUUID()
    expect(await carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: new AbortController().signal })).toBeNull()
    expect(await f.artifacts.listForTrip(f.trip.id)).toEqual(before)
  })

  it('closes the derivative run on cancellation after copying research without publishing a guide', async () => {
    const f = await fixture(), controller = new AbortController()
    await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }, 1)
    const create = f.artifacts.create.bind(f.artifacts)
    let copied: Awaited<ReturnType<typeof create>> | undefined
    vi.spyOn(f.artifacts, 'create').mockImplementation(async input => {
      const record = await create(input)
      if (record.type === 'research') { copied = record; controller.abort() }
      return record
    })
    await expect(carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: controller.signal })).rejects.toBeDefined()
    expect(copied).toBeDefined()
    expect((await f.runs.get(copied!.runId!))?.status).toBe('cancelled')
    expect(f.context.onArtifactCommitted).not.toHaveBeenCalled()
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'travel_guide')).toEqual([f.base])
  })

  it('respects cancellation and a changed flight selection guard', async () => {
    const f = await fixture()
    await f.trips.update(f.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }, 1)
    const before = await f.artifacts.listForTrip(f.trip.id), cancelled = new AbortController(); cancelled.abort()
    await expect(carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: cancelled.signal })).rejects.toBeDefined()
    f.context.assertFlightSelectionCurrent = async () => { throw new Error('flight changed') }
    await expect(carryForwardBudgetGuide({ context: f.context, baseGuideId: f.base.id, locale: 'en', signal: new AbortController().signal })).rejects.toThrow('flight changed')
    expect(await f.artifacts.listForTrip(f.trip.id)).toEqual(before)
  })
})

describe('budget notes compatibility', () => {
  it('admits sentence splitting and explicit budget uncertainty, preserving non-budget notes', () => {
    expect(budgetNotesEquivalent(oldNotes, newNotes)).toBe(true)
    expect(budgetNotesEquivalent(['Flights are arranged. Total budget target 1500 CNY.'], ['Flights are arranged.', 'Total budget target 1200 CNY for both days.', 'Do not guarantee costs within budget.'])).toBe(true)
  })
  it.each(['预算允许第一天去迪士尼。', '预算调整后改乘夜班火车。', '预算日期改到10月25日。', '保证预算一定够用。', 'Budget allows changing the museum.'])('rejects a non-budget or positive guarantee clause: %s', note => {
    expect(budgetNotesEquivalent(oldNotes, [...oldNotes, note])).toBe(false)
  })
  it('rejects a same-version snapshot even with changed budget', async () => {
    const f = await fixture()
    expect(isBudgetOnlyGuideChange(f.trip, { ...f.trip, budget: { amount: 1200, currency: 'CNY', scope: 'trip' } })).toBe(false)
  })
})
