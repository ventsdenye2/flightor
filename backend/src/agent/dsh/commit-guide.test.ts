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
import { DshEvidenceStore, InMemoryDshEvidenceRepository } from './evidence.js'
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
  const evidenceScope = { ownerId, tripId, conversationId, generationId, tripContextVersion: 1 }
  const evidenceRepository = new InMemoryDshEvidenceRepository()
  const store = new DshEvidenceStore(evidenceScope, { repository: evidenceRepository })
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
  return { trip, trips, context, store, tool, input, artifacts, goals, runs, execute, evidence, evidenceScope, evidenceRepository }
}

describe('DSH combined guide commit', () => {
  it.each(['intent', 'goalRef', 'bound-runtime'] as const)('keeps one accepted Goal during a %s repair', async mode => {
    const f = await fixture(), accept = vi.spyOn(f.runs, 'accept')
    const invalid = structuredClone(f.input)
    invalid.text.reply = 'Your budget target is 4000元.'
    await expect(f.execute(invalid)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION' })
    const goalId = f.context.activeGoalId
    const repair = f.tool.inputSchema.parse({ ...f.input,
      ...(mode === 'intent' ? { intent } : mode === 'goalRef' ? { goalRef: goalId } : {}) })
    await expect(f.tool.execute(repair, f.context, new AbortController().signal))
      .resolves.toMatchObject({ status: 'accepted', acceptedGoal: { goalId }, completion: { status: 'satisfied' } })
    expect(accept).toHaveBeenCalledTimes(1)
    expect(await f.goals.listForTrip(f.trip.id)).toHaveLength(1)
    expect(f.tool.description).toContain('EVERY complete submission')
    expect(f.tool.description).not.toContain('later operations use the same accepted goal without repeating it')
  })

  it('omits legacy draft tokens and accepts a full same-turn repair of duplicated findings', async () => {
    const f = await fixture()
    const duplicate = structuredClone(f.input)
    duplicate.days[1]!.items.forEach(item => { item.candidateKey = 'temple' })
    let feedback: any
    try { await f.execute(duplicate) } catch (error) { feedback = (error as { details: unknown }).details }
    expect(feedback).toMatchObject({ issues: expect.arrayContaining(['guide_duplicate_evidence']),
      repairHint: expect.stringContaining('Resubmit COMPLETE corrected days and text'),
      repair: { availableCandidates: expect.arrayContaining([expect.objectContaining({ findingId: 'temple' })]) } })
    expect(feedback.repair).not.toHaveProperty('draftRef')
    expect(feedback.repair).not.toHaveProperty('revision')
    expect(feedback.repairHint).toContain('genuinely distinct places or experiences')
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'travel_guide')).toHaveLength(0)
    expect(f.input).not.toHaveProperty('baseGuideId')
    expect(f.input).not.toHaveProperty('expectedContentHash')
    const result = await f.execute()
    expect(result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const guide = travelGuideArtifactPayloadSchema.parse((await f.artifacts.get(result.artifact.id))!.payload)
    expect(guide.days.flatMap(day => day.items.map(item => item.sourceFindingId))).toEqual(['temple', 'museum', 'garden'])
    expect(new Set(f.input.candidates!.flatMap(candidate => candidate.evidenceRefs)).size).toBe(1)
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'research')).toHaveLength(1)
  })

  it('explains that budget targets are excluded from publication prose and accepts a text-only repair', async () => {
    const f = await fixture()
    f.input.text.overview = 'Your two-day budget target is 1500元 in total, with a relaxed cultural itinerary.'
    f.input.text.reply = 'Your 4000元 itinerary starts at 12:30.'
    await expect(f.execute()).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: {
      issues: expect.arrayContaining([expect.objectContaining({ code: 'format', detail: 'excluded_precise_claim' })]),
      repairHint: expect.stringContaining('including the user budget target')
    } })
    const blocked = (await f.artifacts.listForTrip(f.trip.id)).find(record => record.type === 'travel_guide')!
    expect(publicationFor(blocked)!.finalization!.variants.en).toMatchObject({ status: 'blocked', text: null })
    expect((await f.goals.get(f.context.activeGoalId!))!.status).toBe('pending')
    const acceptedGoal = f.context.activeGoalId
    const researchBefore = (await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'research')
    f.input.text.overview = 'Explore traditional culture with a relaxed two-day itinerary.'
    f.input.text.reply = 'Your Tokyo cultural itinerary is ready to explore.'
    delete f.input.candidates
    const result = await f.execute()
    expect(result).toMatchObject({ status: 'accepted', acceptedGoal: { goalId: acceptedGoal }, completion: { status: 'satisfied' } })
    const accepted = (await f.artifacts.get(result.artifact.id))!
    expect(travelGuideArtifactPayloadSchema.parse(accepted.payload).days).toEqual(travelGuideArtifactPayloadSchema.parse(blocked.payload).days)
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'research')).toHaveLength(1)
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'research')).toEqual(researchBefore)
  })

  it('reports domain and prose failures together so one same-goal repair can address both', async () => {
    const f = await fixture(), bad = structuredClone(f.input)
    bad.days[1]!.items[0]!.candidateKey = 'temple'
    bad.text.reply = 'Your 4000元 itinerary starts at 12:30.'
    await expect(f.execute(bad)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: {
      issues: expect.arrayContaining(['guide_duplicate_evidence']),
      presentationIssues: expect.arrayContaining(['excluded_precise_claim']),
      repairHint: expect.stringContaining('ALSO remove ALL monetary amounts')
    } })
    const acceptedGoal = f.context.activeGoalId
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'travel_guide')).toHaveLength(0)
    await expect(f.execute()).resolves.toMatchObject({ status: 'accepted', acceptedGoal: { goalId: acceptedGoal }, completion: { status: 'satisfied' } })
  })

  it.each(['owner', 'trip', 'conversation', 'generation', 'version', 'goal', 'run', 'flight'] as const)('does not reuse registered candidate keys after %s scope changes', async change => {
    const f = await fixture()
    const invalid = structuredClone(f.input)
    invalid.text.reply = 'The budget target is 4000元.'
    await expect(f.execute(invalid)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION' })
    const before = await f.artifacts.listForTrip(f.trip.id)
    const repair = structuredClone(f.input)
    delete repair.candidates
    const context = { ...f.context }
    if (change === 'owner') context.ownerId = 'another-owner'
    if (change === 'trip') context.tripId = randomUUID()
    if (change === 'conversation') context.conversationId = randomUUID()
    if (change === 'generation') context.generationId = randomUUID()
    if (change === 'run') { context.activeGoalRunId = randomUUID(); context.acceptedGoalIntent = { ...context.acceptedGoalIntent!, runId: context.activeGoalRunId } }
    if (change === 'flight') context.selectedFlight = { selection: { kind: 'offer', artifactId: randomUUID(), offerId: 'other', revision: 1 }, segments: [], layoverWindows: [] } as any
    if (change === 'version') await f.trips.update(f.trip.id, { notes: ['Changed context'] }, 1)
    if (change === 'goal' || change === 'version') {
      context.requestId = randomUUID()
      delete context.activeGoalId; delete context.activeGoalRunId; delete context.activeGoalKind
      delete context.activeGoalContextVersion; delete context.acceptedGoalIntent
    }
    await expect(f.execute(repair, context)).rejects.toBeDefined()
    expect(await f.artifacts.listForTrip(f.trip.id)).toEqual(before)
  })

  it('requires a supplied replacement candidate list to resolve every key without merging older registrations', async () => {
    const f = await fixture()
    const invalid = structuredClone(f.input)
    invalid.text.reply = 'The budget target is 4000元.'
    await expect(f.execute(invalid)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION' })
    const replacement = structuredClone(f.input)
    replacement.candidates = replacement.candidates!.slice(0, 1)
    await expect(f.execute(replacement)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', message: 'Candidate key is unavailable: museum' })
  })

  it('does not register keys when research persistence failed', async () => {
    const f = await fixture()
    vi.spyOn(f.artifacts, 'create').mockRejectedValueOnce(new Error('research save unavailable'))
    await expect(f.execute()).rejects.toThrow('research save unavailable')
    const repair = structuredClone(f.input)
    delete repair.candidates
    await expect(f.execute(repair)).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', message: 'Candidate key is unavailable: temple' })
    expect(await f.artifacts.listForTrip(f.trip.id)).toEqual([])
  })

  it('rejects partial raw evidence under a verified-only Goal and forbids weakening that accepted Goal', async () => {
    const f = await fixture()
    const strictIntent = { ...intent, parameters: { ...intent.parameters, allowPartial: false } }
    await expect(f.tool.execute(f.tool.inputSchema.parse({ ...f.input, intent: strictIntent }), f.context, new AbortController().signal))
      .rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: { issues: expect.arrayContaining(['verified_evidence']) } })
    expect((await f.goals.get(f.context.activeGoalId!))!).toMatchObject({ status: 'pending', parameters: { allowPartial: false } })
    await expect(f.execute()).rejects.toMatchObject({ code: 'GOAL_INTENT_CONFLICT' })
    const records = await f.artifacts.listForTrip(f.trip.id)
    expect(records.filter(record => record.type === 'travel_guide')).toHaveLength(0)
    expect(records.filter(record => record.type === 'research')).toHaveLength(1)
    expect((await f.goals.get(f.context.activeGoalId!))!).toMatchObject({ status: 'pending', parameters: { allowPartial: false } })
  })

  it.each(['accepted_rest', 'rest_not_allowed', 'missing_rest_notes'] as const)('preserves the domain contract for an empty second day: %s', async mode => {
    const f = await fixture()
    const input = structuredClone(f.input)
    input.candidates = input.candidates!.slice(0, 1)
    input.days[1] = { day: 2, cityId: city.id, kind: 'rest', theme: 'Rest at your own pace', items: [],
      ...(mode === 'missing_rest_notes' ? {} : { notes: 'Leave this day free to rest according to your energy.' }) }
    input.text.days[1] = { day: 2, theme: 'Rest at your own pace' }
    input.text.activities = input.text.activities.slice(0, 1)
    const restIntent = { ...intent, parameters: { ...intent.parameters, allowRestDays: mode !== 'rest_not_allowed' } }
    const execute = () => f.tool.execute(f.tool.inputSchema.parse({ ...input, intent: restIntent }), f.context, new AbortController().signal) as Promise<any>
    if (mode === 'accepted_rest') {
      const result = await execute()
      expect(result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
      const guide = (await f.artifacts.get(result.artifact.id))!
      expect(travelGuideArtifactPayloadSchema.parse(guide.payload).days[1]).toMatchObject({ kind: 'rest', items: [], notes: input.days[1].notes })
      expect(publicationFor(guide)!.finalization!.variants.en).toMatchObject({ status: 'accepted', text: { days: input.text.days } })
    } else {
      await expect(execute()).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: { issues: expect.arrayContaining(['guide_daily_activity_coverage']) } })
      expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'travel_guide')).toHaveLength(0)
      expect((await f.goals.get(f.context.activeGoalId!))!.status).toBe('pending')
    }
  })

  it('identifies stale raw evidence without revealing its scope and accepts a precise current-evidence repair', async () => {
    const f = await fixture()
    const priorStore = new DshEvidenceStore({ ...f.evidenceScope, generationId: randomUUID() }, { repository: f.evidenceRepository })
    const stale = await priorStore.recordSearch({ sources: [{ url: 'https://www.gotokyo.org/en/spot/15/index.html', title: 'Earlier culture evidence',
      snippet: 'The temple grounds offer traditional architecture.' }] }, 'fixture-raw-search', 'prior-search')
    f.input.candidates![0]!.evidenceRefs = [...f.evidence.evidenceRefs, ...stale.evidenceRefs]
    await expect(f.execute()).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: {
      code: 'candidate_evidence_unavailable', candidates: [{ candidateKey: 'temple', unavailableEvidenceRefs: stale.evidenceRefs }],
      repairHint: expect.stringContaining('candidateRef')
    } })
    expect(await f.store.get(stale.evidenceRefs[0]!)).toBeNull()
    expect(await f.artifacts.listForTrip(f.trip.id)).toEqual([])
    const goalId = f.context.activeGoalId!
    expect((await f.goals.get(goalId))!.status).toBe('pending')
    f.input.candidates![0]!.evidenceRefs = f.evidence.evidenceRefs
    const result = await f.execute()
    expect(result).toMatchObject({ status: 'accepted', acceptedGoal: { goalId }, completion: { status: 'satisfied' } })
    expect((await f.artifacts.listForTrip(f.trip.id)).filter(record => record.type === 'research')).toHaveLength(1)
  })

  it('returns actionable exact-cover feedback for supplemental practical text and accepts the corrected scheduled-only text', async () => {
    const f = await fixture()
    const input = structuredClone(f.input)
    for (const key of ['rail', 'lodging']) {
      input.candidates!.push({ ...input.candidates![0]!, key, category: 'practical', title: `Tokyo ${key} guidance`, summary: 'Read practical travel guidance before departure.' })
      input.text.activities.push({ ...input.text.activities[0]!, activityKey: key })
    }
    input.supportingCandidateKeys = ['rail', 'lodging']
    const practicalIntent = { ...intent, parameters: { ...intent.parameters, researchTypes: ['activity', 'practical'] } }
    const execute = () => f.tool.execute(f.tool.inputSchema.parse({ ...input, intent: practicalIntent }), f.context, new AbortController().signal) as Promise<any>
    await expect(execute()).rejects.toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: {
      code: 'activity_text_exact_cover', requiredActivityKeys: ['a', 'b', 'c'], submittedActivityKeys: ['a', 'b', 'c', 'rail', 'lodging'],
      unexpectedActivityKeys: ['rail', 'lodging'], missingActivityKeys: [], duplicateActivityKeys: [],
      repairHint: expect.stringContaining('supportingCandidateKeys')
    } })
    expect(await f.artifacts.listForTrip(f.trip.id)).toEqual([])
    expect((await f.goals.get(f.context.activeGoalId!))!.status).toBe('pending')
    input.text.activities = input.text.activities.filter(item => !['rail', 'lodging'].includes(item.activityKey))
    const result = await execute()
    expect(result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const guide = travelGuideArtifactPayloadSchema.parse((await f.artifacts.get(result.artifact.id))!.payload)
    expect(guide.days.flatMap(day => day.items)).toHaveLength(3)
    expect(guide.supportingEvidence).toHaveLength(2)
  })

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
