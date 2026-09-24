import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { DshEvidenceStore } from './evidence.js'
import { createCommitGuideTool, type CommitGuideInput } from './commit-guide.js'

const city = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const intent = { kind: 'travel_guide', parameters: { questions: ['Traditional culture'], researchTypes: ['activity'],
  requiredEvidenceTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: true } }
async function fixture() {
  const ownerId = 'commit-owner', tripId = randomUUID(), conversationId = randomUUID(), generationId = randomUUID()
  const trip = { ...emptyTripContext(tripId), version: 1, travelDays: 2,
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
    destinationIntent: { mode: 'explicit' as const, required: [city], preferred: [], excluded: [] } }
  const trips = new InMemoryTripContextRepository([trip])
  const artifacts = new InMemoryArtifactRepository(ownerId, new Set([tripId]))
  const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
  const context = { ownerId, tripId, conversationId, generationId, requestId: randomUUID(), trips, artifacts,
    resolvedLocations: new Map(), goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
    isGenerationCurrent: () => true, research: { research: vi.fn(() => { throw new Error('Independent ResearchAgent forbidden') }) } } as unknown as ToolExecutionContext
  const store = new DshEvidenceStore({ ownerId, tripId, conversationId, generationId, tripContextVersion: 1 })
  const evidence = await store.recordSearch({ sources: [{ url: 'https://www.gotokyo.org/en/spot/15/index.html', title: 'Tokyo temples',
    snippet: 'Visit the temple grounds and appreciate traditional architecture and neighborhood culture.' }] }, 'fixture-raw-search', 'search-1')
  const tool = createCommitGuideTool({ evidenceStore: store, locale: 'en', memoryEnabled: true })
  const input: CommitGuideInput = {
    candidates: ['temple', 'museum', 'garden'].map(key => ({ key, evidenceRefs: evidence.evidenceRefs, title: `Tokyo ${key}`, summary: `Visit the ${key} and explore traditional local culture.`, category: 'activity', locationId: city.id })),
    days: [
      { day: 1, cityId: city.id, kind: 'visit', theme: 'Traditional culture', items: [{ activityKey: 'a', candidateKey: 'temple', timeOfDay: 'morning', planningNote: 'Enjoy traditional architecture at a relaxed pace.' }] },
      { day: 2, cityId: city.id, kind: 'visit', theme: 'Culture and gardens', items: [
        { activityKey: 'b', candidateKey: 'museum', timeOfDay: 'morning', planningNote: 'Explore cultural exhibits.' },
        { activityKey: 'c', candidateKey: 'garden', timeOfDay: 'afternoon', planningNote: 'Enjoy a relaxed garden walk.' }] }
    ],
    text: { reply: 'Your Tokyo cultural itinerary is ready to explore.', overview: 'Explore traditional culture and enjoy a relaxed pace across the Tokyo neighborhoods.',
      days: [{ day: 1, theme: 'Traditional culture' }, { day: 2, theme: 'Culture and gardens' }],
      activities: ['a', 'b', 'c'].map(activityKey => ({ activityKey, name: `Tokyo cultural visit ${activityKey}`,
        introduction: 'Explore the temple grounds and appreciate the traditional architecture.', recommendationReason: 'This visit responds to your cultural interests at a relaxed pace.' })) }
  }
  const execute = (value: CommitGuideInput = input, ctx = context) => tool.execute(tool.inputSchema.parse({ ...value, intent }), ctx, new AbortController().signal) as Promise<any>
  return { trip, trips, context, store, tool, input, artifacts, goals, runs, execute, evidence }
}

describe('DSH combined guide commit', () => {
  it('saves one research artifact and publishes before completing the accepted Goal, without independent research', async () => {
    const f = await fixture()
    const result = await f.execute()
    expect(result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    expect(f.tool.outputSchema.safeParse(result).success).toBe(true)
    expect(f.context.research.research).not.toHaveBeenCalled()
    const records = await f.artifacts.listForTrip(f.trip.id)
    expect(records.filter(record => record.type === 'research')).toHaveLength(1)
    const guide = records.find(record => record.id === result.artifact.id)!
    expect(publicationFor(guide)!.finalization!.variants.en).toMatchObject({ status: 'accepted', observation: { calls: 0 } })
    expect(result.activityBindings.map((value: any) => value.activityKey)).toEqual(['a', 'b', 'c'])
    expect(result.activityBindings.every((value: any) => !['a', 'b', 'c'].includes(value.activityId) && value.sourceRefs[0].includes('/'))).toBe(true)
    expect((await f.goals.get(result.acceptedGoal.goalId))!.status).toBe('satisfied')
  })
  it('does not complete a Goal when domain validation or publication fails; retry reuses the original research', async () => {
    const f = await fixture()
    const invalid = structuredClone(f.input)
    invalid.days = invalid.days.slice(0, 1)
    invalid.text.activities = invalid.text.activities.slice(0, 1)
    await expect(f.execute(invalid)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION' })
    expect((await f.goals.get(f.context.activeGoalId!))!.status).toBe('pending')
    const badText = structuredClone(f.input); badText.text.overview = 'Admission is $200 for the visit.'
    await expect(f.execute(badText)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION' })
    expect((await f.goals.get(f.context.activeGoalId!))!.status).toBe('pending')
    const result = await f.execute()
    expect(result.completion.status).toBe('satisfied')
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'research')).toHaveLength(1)
  })
  it('replaces only day two afternoon and preserves all other items and their accepted text', async () => {
    const f = await fixture(), first = await f.execute()
    const base = (await f.artifacts.get(first.artifact.id))!
    const before = travelGuideArtifactPayloadSchema.parse(base.payload)
    const textBefore = publicationFor(base)!.finalization!.variants.en!.text!
    const ctx = { ...f.context, requestId: randomUUID(), generationId: randomUUID() }
    delete ctx.activeGoalId; delete ctx.activeGoalRunId; delete ctx.activeGoalKind; delete ctx.activeGoalContextVersion; delete ctx.acceptedGoalIntent
    const patch: CommitGuideInput = { baseGuideId: base.id, expectedContentHash: first.guideContentHash,
      replaceSlots: [{ day: 2, slot: 'afternoon' }],
      // Even metadata supplied for the changed day cannot overwrite protected metadata.
      days: [{ day: 2, cityId: 'malicious-other-city', kind: 'travel', theme: 'Overwritten theme', items: [
        { activityKey: 'replacement', candidateRef: '', timeOfDay: 'afternoon', planningNote: 'Enjoy this garden at a slower pace.' }] }],
      text: { reply: 'The afternoon now leaves more room for a relaxed visit.', overview: 'Explore the cultural stops and finish with a relaxed garden visit.',
        days: [{ day: 2, theme: 'Do not replace the existing theme' }], activities: [{ activityKey: 'replacement', name: 'Relaxed garden visit',
          introduction: 'Walk around the garden and enjoy its paths at a relaxed pace.', recommendationReason: 'The slower afternoon pace responds to your request.' }] } }
    // Reuse the saved garden candidate without new search or research.
    const source = (await f.artifacts.listForTrip(f.trip.id)).find(record => record.type === 'research')!
    const { guideCandidateRef } = await import('../../travel-guides/candidates.js')
    patch.days[0]!.items[0]!.candidateRef = guideCandidateRef({ ownerId: ctx.ownerId, tripId: ctx.tripId, tripContextVersion: 1 }, source.payload as any, 'garden')
    const result = await f.execute(patch, ctx)
    expect(result.status).toBe('accepted')
    const afterRecord = (await f.artifacts.get(result.artifact.id))!
    const after = travelGuideArtifactPayloadSchema.parse(afterRecord.payload)
    const textAfter = publicationFor(afterRecord)!.finalization!.variants.en!.text!
    expect(after.days[0]).toEqual(before.days[0])
    expect(after.days[1]!.items[0]).toEqual(before.days[1]!.items[0])
    expect(after.days[1]!.theme).toBe(before.days[1]!.theme)
    expect(after.days[1]!.city).toEqual(before.days[1]!.city)
    expect(after.days[1]!.kind).toBe(before.days[1]!.kind)
    expect(textAfter.activities.slice(0, 2)).toEqual(textBefore.activities.slice(0, 2))
    expect(textAfter.days).toEqual(textBefore.days)
    expect(after.days[1]!.items[1]!.planningNote).toContain('slower')
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'research')).toHaveLength(1)
  })
  it.each(['foreign_evidence', 'unknown_location', 'cancelled', 'stale_trip', 'flight_changed'] as const)('rejects %s before committing a guide', async failure => {
    const f = await fixture(), controller = new AbortController()
    if (failure === 'foreign_evidence') f.input.candidates![0]!.evidenceRefs = [randomUUID()]
    if (failure === 'unknown_location') f.input.candidates![0]!.locationId = 'invented-location'
    if (failure === 'cancelled') controller.abort(new Error('cancelled'))
    if (failure === 'stale_trip') f.context.isGenerationCurrent = () => false
    if (failure === 'flight_changed') f.context.assertFlightSelectionCurrent = async () => { throw new Error('flight changed') }
    await expect(f.tool.execute(f.tool.inputSchema.parse({ ...f.input, intent }), f.context, controller.signal)).rejects.toBeDefined()
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'travel_guide')).toHaveLength(0)
  })
  it.each(['hash_changed', 'protected_slot', 'protected_text'] as const)('blocks a local edit with %s and preserves the base publication', async failure => {
    const f = await fixture(), first = await f.execute()
    const base = (await f.artifacts.get(first.artifact.id))!
    const ctx = { ...f.context, requestId: randomUUID(), generationId: randomUUID() }
    delete ctx.activeGoalId; delete ctx.activeGoalRunId; delete ctx.activeGoalKind; delete ctx.activeGoalContextVersion; delete ctx.acceptedGoalIntent
    const input = structuredClone(f.input)
    input.baseGuideId = base.id; input.expectedContentHash = first.guideContentHash
    input.replaceSlots = [{ day: 2, slot: 'afternoon' }]
    input.days = [input.days[1]!]
    input.days[0]!.items = [input.days[0]!.items[1]!]
    input.text.activities = [input.text.activities[2]!]
    if (failure === 'hash_changed') input.expectedContentHash = '0'.repeat(64)
    if (failure === 'protected_slot') input.days[0]!.items[0]!.timeOfDay = 'morning'
    if (failure === 'protected_text') input.text.activities.push({ ...f.input.text.activities[0]!, activityKey: `keep:${first.activityBindings[0].activityId}` })
    await expect(f.execute(input, ctx)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION' })
    expect(await f.artifacts.get(base.id)).toEqual(base)
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'travel_guide')).toHaveLength(1)
    expect((await f.goals.get(ctx.activeGoalId!))!.status).toBe('pending')
  })
  it('rejects an actual Trip version change after Goal acceptance', async () => {
    const f = await fixture(), invalid = structuredClone(f.input)
    invalid.days = invalid.days.slice(0, 1); invalid.text.activities = invalid.text.activities.slice(0, 1)
    await expect(f.execute(invalid)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION' })
    await f.trips.update(f.trip.id, { interests: ['art'] }, 1)
    await expect(f.execute()).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'travel_guide')).toHaveLength(0)
  })
})
