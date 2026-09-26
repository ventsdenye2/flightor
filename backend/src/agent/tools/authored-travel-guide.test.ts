import { describe, expect, it, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import type { LocationRef } from '../../aviation/types.js'
import type { ResearchArtifact } from '../../research-agent/types.js'
import { authoredGuideInputSchema, type AuthoredGuideInput } from '../../travel-guides/authored.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { createPlannerToolRegistry } from './core.js'
import { saveTravelGuideTool } from './authored-travel-guide.js'
import { guideCandidateRef } from '../../travel-guides/candidates.js'
import type { SaveGuideInput } from './guide-draft.js'
import { readArtifactTool } from './artifact-reading.js'
import { preparePlanningContext } from '../cloud/planning-context.js'

const tokyo: LocationRef = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const osaka: LocationRef = { ...tokyo, id: 'city:OSA', name: 'Osaka', cityCode: 'OSA' }
const now = '2026-09-08T00:00:00.000Z'

async function fixture(options: { locationId?: string; maxResults?: number; researchTypes?: ResearchArtifact['brief']['researchTypes']; allowPartial?: boolean; allowRestDays?: boolean; mutateResearch?: (source: ResearchArtifact) => void } = {}) {
  const ownerId = 'guide-owner'
  const fixtureCity = { ...tokyo, id: options.locationId ?? tokyo.id }
  const trip = { ...emptyTripContext('guide-trip'), version: 1, travelDays: 5,
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
    destinationIntent: { mode: 'explicit' as const, required: [fixtureCity], preferred: [], excluded: [osaka] } }
  const trips = new InMemoryTripContextRepository([trip])
  const goals = new InMemoryGoalRepository(ownerId)
  const goal = (await goals.create({ tripId: trip.id, kind: 'travel_guide', createdContextVersion: 1, idempotencyKey: 'guide',
    parameters: { questions: ['Museums and food'], researchTypes: options.researchTypes ?? ['activity'], maxResults: options.maxResults ?? 10,
      maxCities: 1, allowPartial: options.allowPartial ?? true, allowRestDays: options.allowRestDays ?? false } })).goal
  const runs = new InMemoryGoalRunRepository(ownerId, goals)
  const run = (await runs.create({ goalId: goal.id, tripId: trip.id, generationId: 'generation', contextVersion: 1, contextSnapshot: trip, idempotencyKey: 'run' })).run
  const artifacts = new InMemoryArtifactRepository(ownerId, new Set([trip.id]))
  const verification = { status: 'partially_verified' as const, checkedAt: now, expiresAt: '2099-01-01T00:00:00.000Z', confidence: 0.5,
    sources: [{ provider: 'research-search', reference: 'https://example.com/museums' }] }
  const source: ResearchArtifact = {
    id: uuidv7(), type: 'research', schemaVersion: 2,
    brief: { destinations: [fixtureCity], interests: ['food', 'culture'], questions: ['Museums and food'], researchTypes: ['activity'],
      travelWindow: { from: '2026-10-10', to: '2026-10-14' } },
    findings: Array.from({ length: 7 }, (_, index) => ({ id: `finding-${index}`, title: `Museum ${index}`, summary: `Source description ${index}`,
      category: 'activity', destinations: [fixtureCity], verification,
      sources: [{ title: 'Museums', url: 'https://example.com/museums', domain: 'example.com', snippet: 'Source facts', authority: 'government_tourism' }], warnings: [] })),
    queryCount: 1, warnings: [], createdAt: now
  }
  options.mutateResearch?.(source)
  await artifacts.create({ id: source.id, tripId: trip.id, type: 'research', schemaVersion: 2, tripContextVersion: 1, payload: source })
  const input: AuthoredGuideInput = { researchArtifactIds: [source.id], days: [
    { day: 1, cityId: fixtureCity.id, kind: 'visit', theme: '文化与街巷', items: [6, 2, 0].map(index => ({ researchIndex: 0, findingId: `finding-${index}`, timeOfDay: 'flexible', planningNote: `根据摄影兴趣安排 ${index}` })) },
    ...[1, 3, 4, 5].map((index, offset) => ({ day: offset + 2, cityId: fixtureCity.id, kind: 'visit' as const, theme: `轻松探索 ${offset + 2}`,
      items: [{ researchIndex: 0, findingId: `finding-${index}`, timeOfDay: 'afternoon' as const, planningNote: '上午留给休息，下午慢慢逛。' }] }))
  ] }
  const context = { ownerId, tripId: trip.id, conversationId: uuidv7(), requestId: 'request', generationId: 'generation', trips, artifacts,
    activeGoalId: goal.id, activeGoalRunId: run.id, activeGoalContextVersion: 1, activeGoalKind: 'travel_guide',
    goalRepository: goals, goalRunRepository: runs, resolvedLocations: new Map([[fixtureCity.id, fixtureCity], [osaka.id, osaka]]), isGenerationCurrent: () => true } as ToolExecutionContext
  const save = async () => saveTravelGuideTool.outputSchema.parse(await saveTravelGuideTool.execute(input, context, new AbortController().signal))
  const verify = () => createDefaultGoalVerifierRegistry().verify(goal, { ownerId, tripId: trip.id, run, currentTrip: trip, artifacts, now })
  return { context, trip, input, source, artifacts, trips, save, verify }
}

describe('Agent-authored travel guide', () => {
  it('restores canonical city facts when the submitted city id is a JSON number', async () => {
    const test = await fixture({ locationId: '8' })
    for (const day of test.input.days) day.cityId = 8
    const result = await test.save()
    expect(result.status).toBe('saved')
    expect(result.days?.every(day => day.city.id === '8' && day.city.cityCode === 'TYO')).toBe(true)
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('requires an activated Goal run before a cloud save so delivery lineage cannot be lost', async () => {
    const test = await fixture()
    delete test.context.activeGoalId
    delete test.context.activeGoalRunId
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: ['active_travel_guide_goal_required'] })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })

  it('identifies every duplicate selection in one repair response', async () => {
    const test = await fixture()
    test.input.days[1]!.items[0] = { ...test.input.days[0]!.items[0]! }
    test.input.days[2]!.items[0] = { ...test.input.days[0]!.items[0]! }
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: ['guide_duplicate_evidence'], details: [
      { code: 'guide_duplicate_evidence', day: 2, sourceFindingId: 'finding-6' },
      { code: 'guide_duplicate_evidence', day: 3, sourceFindingId: 'finding-6' }
    ] })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })

  it('persists the Planner order, uneven day allocation and personal notes and satisfies the real delivery verifier', async () => {
    const test = await fixture()
    const result = await test.save()
    expect(result.status).toBe('saved')
    expect(result.days?.map(day => day.items.length)).toEqual([3, 1, 1, 1, 1])
    expect(result.days?.[0]?.items.map(item => item.sourceFindingId)).toEqual(['finding-6', 'finding-2', 'finding-0'])
    expect(result.days?.[1]?.items[0]).toMatchObject({ title: 'Museum 1', description: 'Source description 1', timeOfDay: 'afternoon', planningNote: '上午留给休息，下午慢慢逛。' })
    const stored = await test.artifacts.get(result.artifact!.id)
    expect(travelGuideArtifactPayloadSchema.parse(stored?.payload).days).toEqual(result.days)
    expect(await test.verify()).toMatchObject({ status: 'satisfied', artifactIds: [result.artifact!.id] })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).not.toContain('destination_set')
    const names = createPlannerToolRegistry().definitions().map(tool => tool.function.name)
    expect(names).toContain('save_travel_guide')
    expect(names).not.toContain('build_travel_guide')
  })

  it('does not consume an unselected, undated old research artifact', async () => {
    const test = await fixture()
    const old = await test.artifacts.create({ tripId: test.trip.id, type: 'research', schemaVersion: 2, tripContextVersion: 0, payload: {} })
    test.input.researchArtifactIds.push(old.id)
    const result = await test.save()
    expect(result.status).toBe('saved')
    expect((await test.artifacts.get(result.artifact!.id))?.sourceArtifactIds).not.toContain(old.id)
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('returns the accepted missing category without weakening the Goal or writing a guide', async () => {
    const test = await fixture({ researchTypes: ['activity', 'practical'] })
    expect(await test.save()).toMatchObject({
      status: 'needs_revision', issues: ['guide_research_type:practical'],
      requirements: { researchTypes: ['activity', 'practical'] }
    })
    expect((await test.context.goalRepository!.get(test.context.activeGoalId!))?.parameters).toMatchObject({ researchTypes: ['activity', 'practical'] })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })

  it.each([
    ['item limit', { maxResults: 5 }, 'guide_result_limit'],
    ['unverified findings', { mutateResearch: (source: ResearchArtifact) => { source.findings[0]!.verification = { ...source.findings[0]!.verification, status: 'unverified' } } }, 'eligible_research_evidence'],
    ['expired findings', { mutateResearch: (source: ResearchArtifact) => { source.findings[0]!.verification = { ...source.findings[0]!.verification, expiresAt: '2000-01-01T00:00:00.000Z' } } }, 'eligible_research_evidence'],
    ['undated research', { mutateResearch: (source: ResearchArtifact) => { delete source.brief.travelWindow } }, 'research_travel_window'],
    ['strict evidence', { allowPartial: false }, 'verified_evidence']
  ] as const)('returns repair feedback without route/guide writes for %s', async (_label, options, code) => {
    const test = await fixture(options)
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining([code]) })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })

  it('rejects wrong cities, unknown source choices and missing days', async () => {
    const test = await fixture()
    test.input.days[0]!.cityId = osaka.id
    expect(await test.save()).toMatchObject({ status: 'needs_revision' })
    test.input.days[0]!.cityId = tokyo.id
    test.input.days[0]!.items[0]!.findingId = 'invented'
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: ['guide_unknown_finding:day_1:invented'] })
    test.input.days.shift()
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_day_coverage']) })
  })

  it('allows an intentional rest day only under the accepted Goal policy', async () => {
    for (const allowRestDays of [false, true]) {
      const test = await fixture({ allowRestDays })
      test.input.days[2] = { day: 3, cityId: tokyo.id, theme: '休息与自由探索', kind: 'rest', notes: '留在住宿地附近休息，保留整天自由时间。', items: [] }
      const result = await test.save()
      expect(result.status).toBe(allowRestDays ? 'saved' : 'needs_revision')
      if (allowRestDays) expect(await test.verify()).toMatchObject({ status: 'satisfied' })
    }
  })

  it('rejects model-authored source facts at the input boundary', async () => {
    const test = await fixture()
    const altered = structuredClone(test.input) as any
    altered.days[0].items[0].verification = { status: 'verified' }
    altered.days[0].items[0].description = 'Open 24 hours'
    expect(authoredGuideInputSchema.safeParse(altered).success).toBe(false)
  })

  it('enforces owner scope and cancellation before writing', async () => {
    const test = await fixture()
    test.input.researchArtifactIds[0] = uuidv7()
    await expect(test.save()).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    test.input.researchArtifactIds[0] = test.source.id
    test.context.isGenerationCurrent = () => false
    await expect(test.save()).rejects.toMatchObject({ code: 'WORKFLOW_CANCELLED' })
  })

  it('rechecks Trip version between the outline projection and the final guide write', async () => {
    const test = await fixture()
    const create = test.artifacts.create.bind(test.artifacts)
    vi.spyOn(test.artifacts, 'create').mockImplementation(async value => {
      const record = await create(value)
      if (value.type === 'route') await test.trips.update(test.trip.id, { travelDays: 10 }, 1)
      return record
    })
    expect(await test.save()).toMatchObject({ status: 'needs_revision', repair: { issues: [{ code: 'TRIP_CONTEXT_VERSION_CONFLICT', classification: 'context_conflict' }] } })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).not.toContain('travel_guide')
  })

  it('binds the guide to the confirmed flight and rejects activity before its real arrival', async () => {
    const test = await fixture({ allowRestDays: true })
    const flightArtifactId = uuidv7()
    await test.artifacts.create({
      id: flightArtifactId, tripId: test.trip.id, tripContextVersion: 1,
      type: 'flight_search', schemaVersion: 1, payload: {}
    })
    test.context.selectedFlight = {
      selection: {
        kind: 'offer', artifactId: flightArtifactId, offerId: 'offer-1', contextVersion: 1,
        revision: 3, selectedAt: '2026-09-14T00:00:00.000Z', layoverPreference: 'airport_only'
      },
      query: { origin: 'PEK', destination: 'NRT', departureDate: '2026-10-10', currency: 'CNY', travelClass: 1 },
      segments: [{
        flightNumber: 'QA1', airline: 'QA Air', origin: 'PEK', destination: 'NRT',
        departsAt: '2026-10-10T20:00:00+08:00', arrivesAt: '2026-10-11T16:00:00+09:00', durationMinutes: 1140
      }],
      layoverWindows: []
    }
    expect(await test.save()).toMatchObject({
      status: 'needs_revision',
      issues: expect.arrayContaining(['guide_before_flight_arrival', 'guide_arrival_day_time_conflict'])
    })

    test.input.days[0] = { day: 1, cityId: tokyo.id, kind: 'travel', theme: '飞行与抵达', notes: '当天在飞行途中，不安排游玩。', items: [] }
    test.input.days[1]!.items[0]!.timeOfDay = 'evening'
    const result = await test.save()
    expect(result).toMatchObject({ status: 'saved' })
    const stored = travelGuideArtifactPayloadSchema.parse((await test.artifacts.get(result.artifact!.id))?.payload)
    expect(stored.flightSelection).toMatchObject({ artifactId: flightArtifactId, choiceId: 'offer-1', revision: 3, destinationArrivalAt: '2026-10-11T16:00:00+09:00' })
    expect(stored.sourceArtifactIds).toContain(flightArtifactId)
  })
})

function compact(test: Awaited<ReturnType<typeof fixture>>): SaveGuideInput {
  return { days: test.input.days.map(day => ({ ...day, items: day.items.map(({ researchIndex: _index, findingId, ...item }) => ({ ...item,
    candidateRef: guideCandidateRef({ ownerId: test.context.ownerId, tripId: test.trip.id, tripContextVersion: test.trip.version }, test.source, findingId) })) })) }
}

describe('stable guide decisions and local repair', () => {
  it('reconstructs the same usable refs from preloaded context and artifact reads without a candidate cache', async () => {
    const test = await fixture()
    const prepared = await preparePlanningContext({ trip: test.trip, ownerId: test.context.ownerId, artifacts: test.artifacts })
    const preloaded = JSON.parse(prepared.content).research[0].findings
    const read = await readArtifactTool.execute({ artifactId: test.source.id }, test.context, new AbortController().signal)
    expect(readArtifactTool.outputSchema.safeParse(read).success).toBe(true)
    expect(read.researchReuse).toMatchObject({ status: 'current_candidates', sourceTripContextVersion: 1, currentTripContextVersion: 1 })
    const full = compact(test)
    for (const day of full.days!) for (const item of day.items) {
      expect(preloaded.some((finding: { candidateRef: string }) => finding.candidateRef === item.candidateRef)).toBe(true)
      expect(read.candidates?.some(finding => finding.candidateRef === item.candidateRef)).toBe(true)
    }
    expect(await saveTravelGuideTool.execute(full, { ...test.context }, new AbortController().signal)).toMatchObject({ status: 'saved' })
  })

  it('keeps historical research readable but explicitly disallows its old candidate refs after a Trip version change', async () => {
    const test = await fixture()
    const signal = new AbortController().signal
    const before = await readArtifactTool.execute({ artifactId: test.source.id }, test.context, signal)
    await test.trips.update(test.trip.id, { notes: ['A changed travel requirement'] }, 1)
    const after = await readArtifactTool.execute({ artifactId: test.source.id }, test.context, signal)
    expect(readArtifactTool.outputSchema.safeParse(after).success).toBe(true)
    expect(after.content).toBe(before.content)
    expect(after.candidates).toBeUndefined()
    expect(after.researchReuse).toMatchObject({ status: 'historical_only', sourceTripContextVersion: 1, currentTripContextVersion: 2 })
    expect(after.researchReuse?.notice).toContain('no candidateRefs usable for a new guide')
    expect(after.researchReuse?.notice).toContain('Do not reuse candidateRefs from earlier messages')
    expect((await test.artifacts.get(test.source.id))?.tripContextVersion).toBe(1)
  })

  it('does not reveal historical content or reuse metadata across owner or Trip boundaries', async () => {
    const test = await fixture()
    const records = new Map()
    const owned = new InMemoryArtifactRepository(test.context.ownerId!, new Set([test.trip.id]), records)
    await owned.create({ id: test.source.id, tripId: test.trip.id, type: 'research', schemaVersion: 2, tripContextVersion: 1, payload: test.source })
    const otherOwner = new InMemoryArtifactRepository('other-owner', new Set([test.trip.id]), records)
    await expect(readArtifactTool.execute({ artifactId: test.source.id }, { ...test.context, ownerId: 'other-owner', artifacts: otherOwner }, new AbortController().signal))
      .rejects.toThrow('Artifact was not found in the current trip')
    await expect(readArtifactTool.execute({ artifactId: test.source.id }, { ...test.context, tripId: 'other-trip', artifacts: owned }, new AbortController().signal))
      .rejects.toThrow('Artifact was not found in the current trip')
  })

  it('saves a full compact draft without positional research indices and preserves authoritative days', async () => {
    const test = await fixture()
    const result = await saveTravelGuideTool.execute(compact(test), test.context, new AbortController().signal)
    expect(result).toMatchObject({ status: 'saved', days: [{ items: [{ sourceFindingId: 'finding-6' }, { sourceFindingId: 'finding-2' }, { sourceFindingId: 'finding-0' }] }, {}, {}, {}, {}] })
    expect(saveTravelGuideTool.outputSchema.safeParse(result).success).toBe(true)
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
    expect(test.context.guideDraft).toBeUndefined()
  })

  it('round-trips a maximum-length Unicode finding id through bounded candidate refs', async () => {
    const unicodeId = '研'.repeat(160)
    const test = await fixture({ mutateResearch: source => { source.findings[6]!.id = unicodeId } })
    test.input.days[0]!.items[0]!.findingId = unicodeId
    const full = compact(test)
    expect(full.days![0]!.items[0]!.candidateRef!.length).toBeLessThan(160)
    expect(saveTravelGuideTool.inputSchema.safeParse(full).success).toBe(true)
    expect(await saveTravelGuideTool.execute(full, test.context, new AbortController().signal)).toMatchObject({ status: 'saved' })
  })

  it('reports all bad refs and repairs only one day without changing other decisions', async () => {
    const test = await fixture()
    const full = compact(test)
    const goodDay = structuredClone(full.days![0]!)
    full.days![0]!.items[0]!.candidateRef = 'missing-a'
    full.days![0]!.items[1]!.candidateRef = 'missing-b'
    const failed = await saveTravelGuideTool.execute(full, test.context, new AbortController().signal)
    expect(failed.status).toBe('needs_revision')
    expect(failed.repair?.issues).toHaveLength(2)
    expect(failed.repair?.issues[0]).toMatchObject({ classification: 'draft_invalid', fieldPath: 'days[0].items[0].candidateRef', blockedChecks: expect.arrayContaining(['evidence_identity']) })
    expect(failed.repair?.availableCandidates).toHaveLength(7)
    const saved = await saveTravelGuideTool.execute({ draftRef: failed.repair!.draftRef!, expectedRevision: failed.repair!.revision!, replacementDays: [goodDay] }, test.context, new AbortController().signal)
    expect(saved.status).toBe('saved')
    expect(saved.days?.[1]?.items[0]?.planningNote).toBe(test.input.days[1]!.items[0]!.planningNote)
  })

  it('offers existing practical evidence and accepts it through supportingRefs without another scheduled item', async () => {
    const test = await fixture({ researchTypes: ['activity', 'practical'], mutateResearch: source => {
      source.brief.researchTypes.push('practical')
      source.findings.push({ ...source.findings[0]!, id: 'transport-info', category: 'practical', title: 'Public transport', summary: 'Use local transit.' })
    } })
    const failed = await saveTravelGuideTool.execute(compact(test), test.context, new AbortController().signal)
    expect(failed.repair?.issues).toContainEqual({ code: 'guide_research_type:practical', classification: 'evidence_missing' })
    const support = failed.repair!.availableCandidates.find(value => value.findingId === 'transport-info')!
    const saved = await saveTravelGuideTool.execute({ draftRef: failed.repair!.draftRef!, expectedRevision: failed.repair!.revision!, supportingRefs: [support.candidateRef] }, test.context, new AbortController().signal)
    expect(saved).toMatchObject({ status: 'saved', summary: { itemCount: 7 }, supportingEvidence: [{ sourceFindingId: 'transport-info' }] })
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('rejects stale revisions and cross-generation patches without replacing the stored draft', async () => {
    const test = await fixture()
    const full = compact(test)
    full.days![0]!.items[0]!.candidateRef = 'missing'
    const failed = await saveTravelGuideTool.execute(full, test.context, new AbortController().signal)
    const patch = { draftRef: failed.repair!.draftRef!, expectedRevision: failed.repair!.revision! + 1, supportingRefs: [] }
    expect(await saveTravelGuideTool.execute(patch, test.context, new AbortController().signal)).toMatchObject({ status: 'needs_revision', issues: ['guide_draft_conflict'] })
    test.context.generationId = 'other-generation'
    expect(await saveTravelGuideTool.execute({ ...patch, expectedRevision: 1 }, test.context, new AbortController().signal)).toMatchObject({ issues: ['guide_draft_conflict'] })
    expect(test.context.guideDraft?.revision).toBe(1)
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })

  it('binds candidate refs to owner, context and evidence content while surviving source object key order', async () => {
    const test = await fixture()
    const scope = { ownerId: test.context.ownerId, tripId: test.trip.id, tripContextVersion: test.trip.version }
    const ref = guideCandidateRef(scope, test.source, 'finding-0')
    const reordered = Object.fromEntries(Object.entries(test.source).reverse()) as ResearchArtifact
    expect(guideCandidateRef(scope, reordered, 'finding-0')).toBe(ref)
    expect(guideCandidateRef({ ...scope, ownerId: 'another-owner' }, test.source, 'finding-0')).not.toBe(ref)
    expect(guideCandidateRef({ ...scope, tripContextVersion: 2 }, test.source, 'finding-0')).not.toBe(ref)
    const changed = structuredClone(test.source); changed.findings[0]!.summary = 'Changed source facts'
    expect(guideCandidateRef(scope, changed, 'finding-0')).not.toBe(ref)
    const full = compact(test); full.days![0]!.items[0]!.candidateRef = guideCandidateRef({ ...scope, ownerId: 'another-owner' }, test.source, 'finding-6')
    expect(await saveTravelGuideTool.execute(full, test.context, new AbortController().signal)).toMatchObject({ status: 'needs_revision', issues: ['guide_candidate_invalid'] })
  })

  it('does not accept invented source fields or a patch that creates an extra day', async () => {
    const test = await fixture()
    const full = compact(test)
    expect(saveTravelGuideTool.inputSchema.safeParse({ ...full, budget: { amount: 100 } }).success).toBe(false)
    full.days![0]!.items[0]!.candidateRef = 'missing'
    const failed = await saveTravelGuideTool.execute(full, test.context, new AbortController().signal)
    expect(await saveTravelGuideTool.execute({ draftRef: failed.repair!.draftRef!, expectedRevision: 1, replacementDays: [{ ...full.days![0]!, day: 6 }] }, test.context, new AbortController().signal)).toMatchObject({ issues: ['guide_patch_unknown_or_duplicate_day'] })
  })

  it('keeps feedback valid for long IDs and maximum-sized invalid drafts', async () => {
    const test = await fixture()
    const unknown = 'x'.repeat(160)
    test.input.days[0]!.items[0]!.findingId = unknown
    const long = await test.save()
    expect(long).toMatchObject({ status: 'needs_revision', details: expect.arrayContaining([expect.objectContaining({ sourceFindingId: unknown })]) })
    const days = Array.from({ length: 60 }, (_, index) => ({ ...test.input.days[0]!, day: index + 1, cityId: 'unknown-city',
      items: Array.from({ length: 6 }, () => ({ ...test.input.days[0]!.items[0]!, findingId: unknown })) }))
    const many = await saveTravelGuideTool.execute({ researchArtifactIds: test.input.researchArtifactIds, days }, test.context, new AbortController().signal)
    expect(many).toMatchObject({ status: 'needs_revision', feedbackTruncated: true })
    expect(many.details).toHaveLength(400)
    expect(saveTravelGuideTool.outputSchema.safeParse(many).success).toBe(true)
    const badCompact = { days: days.map(day => ({ ...day, items: day.items.map(({ researchIndex: _index, findingId: _id, ...item }) => ({ ...item, candidateRef: 'bad-ref' })) })), supportingRefs: Array.from({ length: 50 }, () => 'bad-ref') }
    const compactFeedback = await saveTravelGuideTool.execute(badCompact, test.context, new AbortController().signal)
    expect(compactFeedback.feedbackTruncated).toBe(true)
    expect(compactFeedback.repair?.issues).toHaveLength(400)
    expect(saveTravelGuideTool.outputSchema.safeParse(compactFeedback).success).toBe(true)
  })

  it('keeps historical date conflicts as structured repair feedback', async () => {
    const test = await fixture()
    vi.spyOn(test.trips, 'get').mockResolvedValue({ ...test.trip, returnWindow: { from: '2026-10-20', to: '2026-10-20', precision: 'exact' } })
    const result = await test.save()
    expect(result).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['trip_dates_inconsistent']), repair: { availableCandidates: [] } })
    expect(result.details).toContainEqual(expect.objectContaining({ code: 'trip_dates_inconsistent', blockedChecks: expect.arrayContaining(['research_travel_window']) }))
  })

  it('reports an empty compact itinerary as a draft error without throwing a schema exception', async () => {
    const test = await fixture()
    const full = compact(test); full.days!.forEach(day => { day.items = [] })
    expect(await saveTravelGuideTool.execute(full, test.context, new AbortController().signal)).toMatchObject({ status: 'needs_revision', issues: ['guide_no_selected_findings'] })
  })
})
