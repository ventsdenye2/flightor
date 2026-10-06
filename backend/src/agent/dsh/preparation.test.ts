import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { emptyTripContext } from '../../trips/types.js'
import { InMemoryArtifactRepository, assertGuideBaseCurrent, type ArtifactRecord } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { adaptDshCommit, bindPreparedEditLimits, dshCommitInputSchema, prepareDshSnapshot } from './preparation.js'
import { workspaceScope } from '../tools/workspace-scope.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { buildGuidePublication } from '../../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { guideCandidateRef } from '../../travel-guides/candidates.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { DshEvidenceStore, InMemoryDshEvidenceRepository } from './evidence.js'
import { createCommitGuideTool } from './commit-guide.js'
import { DshReferences } from './references.js'

const trip = { ...emptyTripContext(randomUUID()), version: 1 }
const conv = randomUUID(), baseId = randomUUID(), hash = 'a'.repeat(64)
function record(id = baseId, contentHash = hash, createdAt = '2026-10-06T01:00:00.000Z'): ArtifactRecord {
  return { id, tripId: trip.id, conversationId: conv, tripContextVersion: 1, type: 'travel_guide', schemaVersion: 1,
    payload: { publication: { version: 1, artifactId: id, tripContextVersion: 1, guideContentHash: contentHash,
      contentContract: 'limited', evidenceCoverage: 'partial', legacy: false, references: {}, reply: 'Saved itinerary.',
      budgetAssessment: { status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete', notice: 'Costs unconfirmed.' },
      finalization: { version: 1, variants: { en: { status: 'accepted',
        text: { locale: 'en', ...compact.text, activities: [{ ...compact.days[0]!.items[0]!.text, activityId: 'activity', sourceRefs: ['source/finding'] }] },
        issues: [], omitted: [], observation: { durationMs: 0, calls: 0, promptTokens: null, completionTokens: null,
          knownCostUsdMicros: 0, unknownCostCalls: 0, failure: null } } } } } },
    createdAt, updatedAt: createdAt }
}
const compact = { days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'Quiet garden', items: [{ candidateRef: `gc1.${baseId}.${'a'.repeat(32)}`, timeOfDay: 'afternoon', planningNote: 'Enjoy the garden paths.',
  text: { name: 'Garden walk', introduction: 'Explore the garden paths at a relaxed pace.', recommendationReason: 'Matches your interest in quiet places.' } }] }],
  text: { reply: 'Your garden visit is ready.', overview: 'Explore a quiet garden at a relaxed pace.', days: [{ day: 1, theme: 'Quiet garden' }] } }

describe('DSH model preparation and deterministic input adaptation', () => {
  it('keeps explicit first-guide limits and rejects missing or illegal limits without deriving them from the selection', () => {
    const parameters = { questions: ['Initial itinerary'], researchTypes: ['activity' as const],
      requiredEvidenceTypes: ['activity' as const], maxResults: 8, maxCities: 1, allowPartial: true }
    const first = { ...compact, intent: { kind: 'travel_guide', parameters } }
    expect(adaptDshCommit(first, { trip }).intent).toEqual(first.intent)
    const { maxResults: _limit, ...withoutLimit } = parameters
    expect(() => adaptDshCommit({ ...first, intent: { ...first.intent, parameters: withoutLimit } }, { trip })).toThrow()
    expect(() => adaptDshCommit({ ...first, intent: { ...first.intent, parameters: { ...parameters, maxResults: 21 } } }, { trip })).toThrow()
    expect(first.intent.parameters.maxResults).toBe(8)
  })
  it('inherits mechanical edit limits only from the prepared guide authoritative Goal', async () => {
    const ownerId = 'prepared-owner', goals = new InMemoryGoalRepository(ownerId)
    const parameters = { questions: ['Initial itinerary'], researchTypes: ['activity' as const],
      requiredEvidenceTypes: ['activity' as const], maxResults: 12, maxCities: 1, allowPartial: true }
    const { goal } = await goals.create({ tripId: trip.id, conversationId: conv, kind: 'travel_guide',
      parameters, createdContextVersion: 1, idempotencyKey: randomUUID() })
    const base = { ...record(), goalId: goal.id }
    const payload = travelGuideArtifactPayloadSchema.parse({ kind: 'trip_travel_guide', schemaVersion: 1, builderVersion: 'fixture',
      sourceArtifactIds: ['source'], routeArtifactId: 'route', days: [{ day: 1,
        city: { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP' }, items: [] }],
      unassignedActivityRefs: [], verification: { status: 'unverified', checkedAt: base.createdAt, sources: [], confidence: 0 }, warnings: [], createdAt: base.createdAt })
    const publication = buildGuidePublication(base, payload)
    publication.finalization = (base.payload as any).publication.finalization
    base.payload = { ...payload, publication }
    const prepared = await bindPreparedEditLimits({ trip, baseGuide: { id: baseId, contentHash: publication.guideContentHash, locale: 'en' } },
      [base], goals, ownerId, new AbortController().signal)
    const { maxResults: _cap, maxCities: _cities, ...semanticParameters } = parameters
    const edit = { ...compact, replaceSlots: [{ day: 1, slot: 'afternoon' }],
      intent: { kind: 'travel_guide', parameters: { ...semanticParameters, questions: ['Make the afternoon quieter'] } } }
    expect(adaptDshCommit(edit, prepared).intent).toEqual({ kind: 'travel_guide',
      parameters: { ...parameters, questions: ['Make the afternoon quieter'] } })
    expect(() => adaptDshCommit({ ...edit, intent: { ...edit.intent, parameters: { ...edit.intent.parameters, maxResults: 6 } } }, prepared))
      .toThrowError(expect.objectContaining({ code: 'DSH_GUIDE_NEEDS_REVISION', details: expect.objectContaining({ code: 'guide_edit_limit_conflict' }) }))
    expect(await goals.get(goal.id)).toEqual(goal)
    const missing = await bindPreparedEditLimits({ trip, baseGuide: prepared.baseGuide }, [{ ...base, goalId: randomUUID() }], goals, ownerId, new AbortController().signal)
    expect(() => adaptDshCommit(edit, missing)).toThrowError(expect.objectContaining({ code: 'DSH_GUIDE_NEEDS_REVISION' }))
    const foreign = await bindPreparedEditLimits({ trip, baseGuide: prepared.baseGuide }, [base], goals, 'foreign-owner', new AbortController().signal)
    expect(foreign).not.toHaveProperty('editLimits')
    expect(() => adaptDshCommit({ ...edit, replaceSlots: undefined }, prepared)).toThrow()
    expect(() => adaptDshCommit({ ...compact, replaceSlots: edit.replaceSlots }, prepared)).not.toThrow()
    expect(adaptDshCommit({ ...compact, replaceSlots: edit.replaceSlots }, prepared)).not.toHaveProperty('intent')
  })
  it('states that candidate keys require explicit source registration in the current preparation', () => {
    const itemSchema = dshCommitInputSchema.shape.days.element.shape.items.element
    expect(itemSchema.shape.candidateKey.description).toContain('candidates[].key')
    expect(itemSchema.shape.candidateKey.description).toContain('web_search/web_fetch receipts do not register candidates')
    expect(dshCommitInputSchema.shape.candidates.description).toContain('Define every new key')
    expect(dshCommitInputSchema.shape.candidates.description).toContain('same prepared attempt and scope')
  })

  it('accepts sourceRef-bound temporal evidence and rejects candidate-supplied URLs', () => {
    const candidate = { key: 'event', sourceRefs: ['s1.0123456789.abcdef0123.1'], title: 'Event', summary: 'A seasonal display.',
      category: 'event' as const, temporalEvidence: { from: '2026-11-01', to: '2026-11-15',
        sourceRef: 's1.0123456789.abcdef0123.1', quote: '2026年11月1日(日)～11月15日(日)' } }
    expect(dshCommitInputSchema.safeParse({ ...compact, candidates: [candidate] }).success).toBe(true)
    expect(dshCommitInputSchema.safeParse({ ...compact, candidates: [{ ...candidate,
      temporalEvidence: { ...candidate.temporalEvidence, sourceUrl: 'https://example.com/event' } }] }).success).toBe(false)
    expect(dshCommitInputSchema.shape.candidates.unwrap().element.shape.temporalEvidence.description).toContain('one current sourceRef')
  })

  it('accepts a compact first submission and a prepared local edit through the commit tool', async () => {
    const ownerId = 'prepared-commit-owner', tripId = randomUUID(), conversationId = randomUUID()
    const preparedTrip = { ...emptyTripContext(tripId), version: 1, travelDays: 2,
      departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
      destinationIntent: { mode: 'explicit' as const, required: [{ id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }], preferred: [], excluded: [] } }
    const trips = new InMemoryTripContextRepository([preparedTrip])
    const artifacts = new InMemoryArtifactRepository(ownerId, new Set([tripId]))
    const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
    const evidenceRepository = new InMemoryDshEvidenceRepository()
    const firstGeneration = randomUUID()
    const firstEvidence = new DshEvidenceStore({ ownerId, tripId, conversationId, generationId: firstGeneration, tripContextVersion: 1 }, { repository: evidenceRepository })
    const source = await firstEvidence.recordSearch({ sources: [{ url: 'https://www.gotokyo.org/en/spot/15/index.html', title: 'Tokyo culture',
      snippet: 'Explore traditional architecture, museum exhibits and quiet garden paths in Tokyo.' }] }, 'fixture-search', 'search-1')
    const context = { ownerId, tripId, conversationId, generationId: firstGeneration, requestId: randomUUID(), trips, artifacts,
      tripContextSnapshot: structuredClone(preparedTrip), resolvedLocations: new Map(), goalRepository: goals, goalRunRepository: runs,
      goalVerifiers: createDefaultGoalVerifierRegistry(), isGenerationCurrent: () => true,
      research: { research: () => { throw new Error('Independent ResearchAgent forbidden') } } } as unknown as ToolExecutionContext
    const commit = createCommitGuideTool({ evidenceStore: firstEvidence, locale: 'en', memoryEnabled: true })
    const intent = { kind: 'travel_guide' as const, parameters: { questions: ['Traditional culture'], researchTypes: ['activity' as const],
      requiredEvidenceTypes: ['activity' as const], maxResults: 10, maxCities: 1, allowPartial: true } }
    const compactInput = {
      intent,
      candidates: ['temple', 'museum', 'garden'].map(key => ({ key, sourceRefs: source.sourceRefs, title: `Tokyo ${key}`,
        summary: `Explore the ${key} and local culture at a relaxed pace.`, category: 'activity' as const })),
      days: [
        { day: 1, kind: 'visit' as const, theme: 'Traditional culture', items: [{ candidateKey: 'temple', timeOfDay: 'morning' as const,
          planningNote: 'Explore the temple at a relaxed pace.', text: { name: 'Temple visit', introduction: 'Explore traditional architecture.', recommendationReason: 'Matches your cultural interests.' } }] },
        { day: 2, kind: 'visit' as const, theme: 'Museums and gardens', items: [
          { candidateKey: 'museum', timeOfDay: 'morning' as const, planningNote: 'Explore the museum exhibits.',
            text: { name: 'Museum visit', introduction: 'Explore cultural exhibits.', recommendationReason: 'Matches your interest in local culture.' } },
          { candidateKey: 'garden', timeOfDay: 'afternoon' as const, planningNote: 'Enjoy a quiet garden walk.',
            text: { name: 'Garden walk', introduction: 'Walk along the garden paths.', recommendationReason: 'Adds a quieter visit to the itinerary.' } }
        ] }
      ],
      text: { reply: 'Your Tokyo cultural itinerary is ready.', overview: 'Explore traditional culture and quiet garden paths in Tokyo.',
        days: [{ day: 1, theme: 'Traditional culture' }, { day: 2, theme: 'Museums and gardens' }] }
    }
    const { intent: _semanticIntent, ...modelInput } = compactInput
    const compactParse = dshCommitInputSchema.safeParse(modelInput)
    expect(compactParse.success, compactParse.success ? undefined : JSON.stringify(compactParse.error.issues)).toBe(true)
    expect(compactInput.days.every(day => !('cityId' in day))).toBe(true)
    expect(compactInput.candidates.every(candidate => !('locationId' in candidate))).toBe(true)
    expect(compactInput.candidates[0]!.sourceRefs[0]).toMatch(/^s1\./)
    const firstPrepared = prepareDshSnapshot({ trip: preparedTrip, records: [], conversationId, selectedFlight: null, locale: 'en' })
    const firstDomainInput = adaptDshCommit(compactInput, firstPrepared)
    expect(firstDomainInput).not.toHaveProperty('baseGuideId')
    expect(firstDomainInput).not.toHaveProperty('expectedContentHash')
    expect(firstDomainInput.intent).toEqual(intent)
    const firstResult = await commit.execute(commit.inputSchema.parse(firstDomainInput), context, new AbortController().signal) as any
    expect(firstResult).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const firstRecord = (await artifacts.get(firstResult.artifact.id))!
    const before = travelGuideArtifactPayloadSchema.parse(firstRecord.payload)
    const beforeText = publicationFor(firstRecord)!.finalization!.variants.en!.text!
    const researchRecord = (await artifacts.listForTrip(tripId)).find(record => record.type === 'research')!
    const persistedCandidate = guideCandidateRef({ ownerId, tripId, tripContextVersion: 1 }, researchRecord.payload as any, 'garden')

    const editGeneration = randomUUID()
    const editPrepared = await bindPreparedEditLimits(prepareDshSnapshot({ trip: preparedTrip, records: [firstRecord], conversationId, selectedFlight: null, locale: 'en' }),
      [firstRecord], goals, ownerId, new AbortController().signal)
    expect(editPrepared.baseGuide).toEqual({ id: firstRecord.id, contentHash: firstResult.guideContentHash, locale: 'en' })
    const editReferences = new DshReferences({ ownerId, tripId, conversationId, generationId: editGeneration, tripContextVersion: 1 })
    const shortCandidate = editReferences.registerCandidate(persistedCandidate)!
    const editEvidence = new DshEvidenceStore({ ownerId, tripId, conversationId, generationId: editGeneration, tripContextVersion: 1 }, { repository: evidenceRepository })
    const editCommit = createCommitGuideTool({ evidenceStore: editEvidence, locale: 'en', memoryEnabled: true })
    const editContext = { ...context, generationId: editGeneration, requestId: randomUUID(), tripContextSnapshot: structuredClone(preparedTrip),
      activeGoalId: undefined, activeGoalRunId: undefined, activeGoalKind: undefined, activeGoalContextVersion: undefined, acceptedGoalIntent: undefined } as unknown as ToolExecutionContext
    const compactEdit = {
      intent,
      replaceSlots: [{ day: 2, slot: 'afternoon' as const }],
      days: [{ day: 2, kind: 'visit' as const, theme: 'A relaxed afternoon', items: [{ candidateRef: shortCandidate,
        timeOfDay: 'afternoon' as const, planningNote: 'Take a relaxed walk through the garden.',
        text: { name: 'Relaxed garden walk', introduction: 'Walk through the quiet garden paths.', recommendationReason: 'A slower visit matches your request.' } }] }],
      text: { reply: 'The second afternoon now has a relaxed garden visit.', overview: 'Keep the cultural itinerary and add a quieter afternoon.',
        days: [{ day: 2, theme: 'A relaxed afternoon' }] }
    }
    const resolvedEdit = structuredClone(compactEdit)
    resolvedEdit.days[0]!.items[0]!.candidateRef = editReferences.resolveCandidate(shortCandidate)!
    const editDomainInput = adaptDshCommit(resolvedEdit, editPrepared)
    expect(editDomainInput).toMatchObject({ baseGuideId: firstRecord.id, expectedContentHash: firstResult.guideContentHash,
      replaceSlots: [{ day: 2, slot: 'afternoon' }] })
    const editResult = await editCommit.execute(editCommit.inputSchema.parse(editDomainInput), editContext, new AbortController().signal) as any
    expect(editResult).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const afterRecord = (await artifacts.get(editResult.artifact.id))!
    const after = travelGuideArtifactPayloadSchema.parse(afterRecord.payload)
    const afterText = publicationFor(afterRecord)!.finalization!.variants.en!.text!
    expect(after.days[0]).toEqual(before.days[0])
    expect(after.days[1]!.items[0]).toEqual(before.days[1]!.items[0])
    expect(after.days[1]!.items[1]!.planningNote).toContain('relaxed walk')
    expect(afterText.activities.filter(item => item.activityId !== after.days[1]!.items[1]!.id)).toEqual(
      beforeText.activities.filter(item => item.activityId !== before.days[1]!.items[1]!.id))
  })
  it('binds the accepted current-conversation guide before generation and clones the Trip', () => {
    const inputTrip = structuredClone(trip)
    const base = record()
    const guide = travelGuideArtifactPayloadSchema.parse({ kind: 'trip_travel_guide', schemaVersion: 1, builderVersion: 'fixture',
      sourceArtifactIds: ['source'], routeArtifactId: 'route', days: [{ day: 1, city: { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP' }, items: [] }],
      unassignedActivityRefs: [], verification: { status: 'unverified', checkedAt: base.createdAt, sources: [], confidence: 0 }, warnings: [], createdAt: base.createdAt })
    const publication = buildGuidePublication(base, guide)
    publication.finalization = (base.payload as any).publication.finalization
    base.payload = { ...guide, publication }
    const prepared = prepareDshSnapshot({ trip: inputTrip, records: [{ ...base, conversationId: randomUUID() }, base],
      conversationId: conv, selectedFlight: null, locale: 'en' })
    expect(prepared.baseGuide).toEqual({ id: baseId, contentHash: publication.guideContentHash, locale: 'en' })
    inputTrip.version = 2
    expect(prepared.trip.version).toBe(1)
  })
  it('does not fall back to an older locale base behind a newer accepted guide', () => {
    const withLocales = (source: ArtifactRecord, locales: Array<'zh' | 'en'>): ArtifactRecord => {
      const payload = structuredClone(source.payload) as any
      const english = payload.publication.finalization.variants.en
      const chinese = { ...english, text: { ...english.text, locale: 'zh' } }
      const guide = travelGuideArtifactPayloadSchema.parse({ kind: 'trip_travel_guide', schemaVersion: 1, builderVersion: 'fixture',
        sourceArtifactIds: ['source'], routeArtifactId: 'route', days: [{ day: 1,
          city: { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP' }, items: [] }], unassignedActivityRefs: [],
        verification: { status: 'unverified', checkedAt: source.createdAt, sources: [], confidence: 0 }, warnings: [], createdAt: source.createdAt })
      const publication = buildGuidePublication(source, guide)
      publication.finalization = { version: 1, variants: Object.fromEntries(locales.map(locale => [locale, locale === 'zh' ? chinese : english])) as any }
      return { ...source, payload: { ...guide, publication } }
    }
    const olderChinese = withLocales(record(baseId, hash, '2026-10-06T01:00:00.000Z'), ['zh'])
    const newerEnglish = withLocales(record(randomUUID(), 'b'.repeat(64), '2026-10-06T02:00:00.000Z'), ['en'])
    const input = { trip: structuredClone(trip), records: [olderChinese, newerEnglish], conversationId: conv,
      selectedFlight: null, locale: 'zh' as const }
    expect(prepareDshSnapshot(input).baseGuide).toBeUndefined()
    const newerBilingual = withLocales(newerEnglish, ['zh', 'en'])
    const newerHash = publicationFor(newerBilingual)!.guideContentHash
    expect(prepareDshSnapshot({ ...input, records: [olderChinese, newerBilingual] }).baseGuide)
      .toEqual({ id: newerBilingual.id, contentHash: newerHash, locale: 'zh' })
  })
  it('combines each visit and its text without model activity identity, hash or version fields', () => {
    const schema = dshCommitInputSchema
    expect(schema.safeParse(compact).success).toBe(true)
    const prepared = { trip, baseGuide: { id: baseId, contentHash: hash, locale: 'en' as const } }
    const result = adaptDshCommit({ ...compact, replaceSlots: [{ day: 1, slot: 'afternoon' }] }, prepared)
    expect(result).toMatchObject({ baseGuideId: baseId, expectedContentHash: hash })
    expect(result.text.activities[0]!.activityKey).toBe(result.days[0]!.items[0]!.activityKey)
    expect(result).not.toHaveProperty('intent') // the domain must require first real intent
    expect(schema.shape).not.toHaveProperty('baseGuideId')
    expect(schema.shape).not.toHaveProperty('expectedContentHash')
  })
  it('requires a confirmed Trip city when compact candidates omit canonical locations', () => {
    const openTrip = structuredClone(trip)
    const input = { ...compact, candidates: Array.from({ length: 6 }, (_, index) => ({ key: `place-${index}`,
      sourceRefs: ['s1.fixture'], title: `Place ${index}`, summary: 'A source-backed place.', category: 'activity' as const })),
      days: compact.days }
    try {
      adaptDshCommit(input, { trip: openTrip })
      throw new Error('expected a controlled location prerequisite')
    } catch (error) {
      expect(error).toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', details: {
        code: 'candidate_location_unresolved', destinationMode: 'open', selectedCityCount: 0,
        fieldPaths: ['candidates.0.locationId', 'candidates.1.locationId', 'candidates.2.locationId',
          'candidates.3.locationId', 'candidates.4.locationId', 'candidates.5.locationId']
      } })
      expect(JSON.stringify((error as any).details)).not.toContain('Place 0')
    }
  })
  it('reports every omitted location field allowed by the compact schema', () => {
    const openTrip = structuredClone(trip)
    const input = { ...compact,
      candidates: Array.from({ length: 50 }, (_, index) => ({ key: `place-${index}`,
        sourceRefs: ['s1.fixture'], title: `Place ${index}`, summary: 'A source-backed place.', category: 'activity' as const })),
      days: Array.from({ length: 60 }, (_, index) => ({ day: index + 1, kind: 'visit' as const,
        theme: `Day ${index + 1}`, items: [] })),
      text: { ...compact.text, days: Array.from({ length: 60 }, (_, index) => ({ day: index + 1, theme: `Day ${index + 1}` })) } }
    let failure: any
    try { adaptDshCommit(input, { trip: openTrip }) } catch (error) { failure = error }
    expect(failure?.details?.fieldPaths).toEqual([
      ...Array.from({ length: 50 }, (_, index) => `candidates.${index}.locationId`),
      ...Array.from({ length: 60 }, (_, index) => `days.${index}.cityId`)
    ])
  })
  it('does not infer a candidate location from a day cityId', () => {
    const input = { ...compact, candidates: [{ key: 'place', sourceRefs: ['s1.fixture'], title: 'Place',
      summary: 'A source-backed place.', category: 'activity' as const }], days: [{ ...compact.days[0]!, cityId: 'city:TYO',
        items: [{ candidateKey: 'place', timeOfDay: 'afternoon' as const, planningNote: 'Visit the place.',
          text: { name: 'Visit', introduction: 'Visit the place.', recommendationReason: 'It matches the trip.' } }] }] }
    expect(() => adaptDshCommit(input, { trip })).toThrowError(expect.objectContaining({ code: 'DSH_GUIDE_NEEDS_REVISION',
      details: expect.objectContaining({ code: 'candidate_location_unresolved', fieldPaths: ['candidates.0.locationId'] }) }))
  })
  it('rejects source URLs in supporting candidate references without silently dropping them', () => {
    const malformed = { ...compact, supportingRefs: ['https://example.test/tokyo-transit'], supportingCandidateKeys: ['transit'] }
    const parsed = dshCommitInputSchema.safeParse(malformed)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.map(issue => issue.path.join('.'))).toContain('supportingRefs.0')
    expect(() => adaptDshCommit(malformed, { trip })).toThrow()
    expect(dshCommitInputSchema.shape.supportingRefs.description).toContain('not source URLs')
    expect(dshCommitInputSchema.shape.candidates.unwrap().element.shape.sourceRefs.description).toContain('sourceRefs returned')
  })
  it('rejects source URLs in new candidate sourceRefs before accepting a Goal', () => {
    const malformed = { ...compact, candidates: [{ key: 'transit', sourceRefs: ['https://example.test/tokyo-transit'],
      title: 'Tokyo transit', summary: 'Tokyo transit guidance.', category: 'practical' }] }
    const parsed = dshCommitInputSchema.safeParse(malformed)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.map(issue => issue.path.join('.'))).toContain('candidates.0.sourceRefs.0')
  })
  it('does not fabricate an accepted base and rejects a conflicting legacy base hash', () => {
    expect(() => adaptDshCommit({ ...compact, replaceSlots: [{ day: 1, slot: 'afternoon' }] }, { trip }))
      .toThrowError(expect.objectContaining({ code: 'DSH_GUIDE_BASE_UNAVAILABLE' }))
    const expanded = adaptDshCommit(compact, { trip })
    expect(() => adaptDshCommit({ ...expanded, baseGuideId: baseId, expectedContentHash: 'b'.repeat(64),
      replaceSlots: [{ day: 1, slot: 'afternoon' }] }, { trip, baseGuide: { id: baseId, contentHash: hash, locale: 'en' } }))
      .toThrowError(expect.objectContaining({ code: 'PUBLICATION_CONTENT_CHANGED' }))
  })
  it('a later Trip read cannot upgrade the model snapshot into a current write', async () => {
    const trips = new InMemoryTripContextRepository([trip])
    const artifacts = new InMemoryArtifactRepository('owner', new Set([trip.id]))
    const context = { trips, artifacts, tripId: trip.id, conversationId: conv, requestId: 'request', tripContextSnapshot: structuredClone(trip) } as ToolExecutionContext
    await trips.update(trip.id, { notes: ['Changed during generation'] }, 1)
    await expect(workspaceScope(context, new AbortController().signal)).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(await artifacts.listForTrip(trip.id)).toEqual([])
  })
  it('rejects superseded, changed-hash and foreign-scope bases while ignoring blocked drafts', () => {
    const current = record(randomUUID()), condition = { id: baseId, contentHash: hash, locale: 'en' as const }
    expect(() => assertGuideBaseCurrent([record(), { ...record(randomUUID()), payload: {} }], current, condition)).not.toThrow()
    for (const records of [[record(baseId, 'b'.repeat(64))], [{ ...record(), conversationId: 'foreign' }],
      [record(), record(randomUUID(), hash, '2026-10-06T02:00:00.000Z')]]) {
      expect(() => assertGuideBaseCurrent(records, current, condition)).toThrowError(expect.objectContaining({ code: 'PUBLICATION_CONTENT_CHANGED' }))
    }
    const withLocales = (source: ArtifactRecord, locales: Array<'zh' | 'en'>): ArtifactRecord => {
      const payload = structuredClone(source.payload) as any
      const english = payload.publication.finalization.variants.en
      const chinese = { ...english, text: { ...english.text, locale: 'zh' } }
      const guide = travelGuideArtifactPayloadSchema.parse({ kind: 'trip_travel_guide', schemaVersion: 1, builderVersion: 'fixture',
        sourceArtifactIds: ['source'], routeArtifactId: 'route', days: [{ day: 1,
          city: { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP' }, items: [] }], unassignedActivityRefs: [],
        verification: { status: 'unverified', checkedAt: source.createdAt, sources: [], confidence: 0 }, warnings: [], createdAt: source.createdAt })
      const publication = buildGuidePublication(source, guide)
      publication.finalization = { version: 1, variants: Object.fromEntries(locales.map(locale => [locale, locale === 'zh' ? chinese : english])) as any }
      return { ...source, payload: { ...guide, publication } }
    }
    const olderChinese = withLocales(record(baseId, hash, '2026-10-06T01:00:00.000Z'), ['zh'])
    const newerEnglish = withLocales(record(randomUUID(), 'b'.repeat(64), '2026-10-06T02:00:00.000Z'), ['en'])
    expect(() => assertGuideBaseCurrent([olderChinese, newerEnglish], current, { id: baseId, contentHash: hash, locale: 'zh' }))
      .toThrowError(expect.objectContaining({ code: 'PUBLICATION_CONTENT_CHANGED' }))
  })
})
