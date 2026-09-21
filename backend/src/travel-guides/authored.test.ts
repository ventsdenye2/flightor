import { createHash } from 'node:crypto'
import { artifactReadingContent } from '../artifacts/presentation.js'
import { presentArtifact } from '../artifacts/presentation.js'
import { buildGuidePublication, projectGuideRecord, publicationFor, guidePublicationReply } from './publication.js'
import { sourceApplicability } from './source-applicability.js'
import { describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { createArtifactWorkspace } from '../artifacts/workspace.js'
import type { LocationRef } from '../aviation/types.js'
import { researchArtifactSchema, type ResearchArtifact } from '../research-agent/types.js'
import { tripRoutePlanPayloadSchema } from '../trip-planning/types.js'
import { InMemoryTripContextRepository } from '../trips/repository.js'
import { emptyTripContext } from '../trips/types.js'
import { createDefaultGoalVerifierRegistry } from '../agent/goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../agent/goals/repository.js'
import { authoredGuideInputSchema, saveAuthoredTravelGuide, type AuthoredGuideInput } from './authored.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { validateGuideContent, type TravelGuideConstraints } from './validation.js'

const city: LocationRef = { id: 'city:TYO', type: 'city', name: 'Tokyo', cityCode: 'TYO', countryCode: 'JP' }
const constraints: TravelGuideConstraints = { maxResults: 10, maxCities: 1, researchTypes: ['activity', 'practical'], allowPartial: true }

async function fixture(mutate?: (source: ResearchArtifact) => void, requirements = constraints) {
  const ownerId = 'owner'
  const trip = { ...emptyTripContext('trip'), version: 1, travelDays: 1,
    budget: { amount: 600, currency: 'CNY', scope: 'trip' as const },
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
    destinationIntent: { mode: 'explicit' as const, required: [city], preferred: [], excluded: [] } }
  const artifacts = new InMemoryArtifactRepository(ownerId, new Set([trip.id]))
  const trips = new InMemoryTripContextRepository([trip])
  const goals = new InMemoryGoalRepository(ownerId)
  const goal = (await goals.create({ tripId: trip.id, kind: 'travel_guide', createdContextVersion: 1, idempotencyKey: 'goal',
    parameters: { questions: ['Museums and transportation'], ...requirements } })).goal
  const runs = new InMemoryGoalRunRepository(ownerId, goals)
  const run = (await runs.create({ goalId: goal.id, tripId: trip.id, generationId: 'generation', contextVersion: 1,
    contextSnapshot: trip, idempotencyKey: 'run' })).run
  const verification = { status: 'verified' as const, checkedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
    confidence: 0.9, sources: [{ provider: 'research', reference: 'https://example.com/source' }] }
  const source: ResearchArtifact = { id: uuidv7(), type: 'research', schemaVersion: 2,
    brief: { destinations: [city], interests: [], questions: ['Museums and transportation'], researchTypes: ['activity', 'practical'],
      travelWindow: { from: '2026-10-10', to: '2026-10-10' } },
    findings: (['activity', 'practical'] as const).map(category => ({ id: category, category, destinations: [city],
      title: category === 'activity' ? 'Museum' : 'Transit advice', summary: `${category} facts`, verification,
      sources: [{ title: 'Source', url: 'https://example.com/source', domain: 'example.com', snippet: 'Facts', authority: 'government_tourism' }], warnings: [] })),
    queryCount: 1, warnings: [], createdAt: '2026-09-01T00:00:00.000Z' }
  mutate?.(source)
  await artifacts.create({ id: source.id, tripId: trip.id, tripContextVersion: 1, type: 'research', schemaVersion: 2, payload: source })
  const scope = await createArtifactWorkspace({ artifacts, trips, ownerId, tripId: trip.id, goalId: goal.id, runId: run.id })
  const input: AuthoredGuideInput = { researchArtifactIds: [source.id],
    supportingRefs: [{ researchArtifactId: source.id, findingId: 'practical' }],
    days: [{ day: 1, cityId: city.id, kind: 'visit', theme: 'Museum day',
      items: [{ researchIndex: 0, findingId: 'activity', timeOfDay: 'afternoon', planningNote: 'Enjoy a relaxed visit' }] }] }
  const save = () => saveAuthoredTravelGuide(input, requirements, scope)
  const verify = () => createDefaultGoalVerifierRegistry().verify(goal, { ownerId, tripId: trip.id, run, currentTrip: trip, artifacts })
  return { input, save, verify, scope, source, artifacts, trip }
}

describe('guide public contract', () => {
  it.each([undefined, []])('omitted or empty claims cannot publish prose through any guide field: %j', async claims => {
    const injection = '门票999元且免费，无需预约，全年开放，保证不超预算'
    const test = await fixture(source => {
      for (const finding of source.findings) {
        finding.title = injection; finding.summary = injection
        if (claims) finding.claimEvidence = claims
        finding.sources[0]!.title = 'Museum visitor information'
      }
    })
    test.input.days[0]!.theme = injection; test.input.days[0]!.notes = injection
    test.input.days[0]!.items[0]!.planningNote = injection
    const saved = await test.save()
    expect(saved.status).toBe('saved')
    if (saved.status !== 'saved') throw new Error('expected save')
    const stored = await test.artifacts.get(saved.record.id)
    expect(JSON.stringify(stored?.payload)).toContain(injection)
    const publicRecord = presentArtifact(stored!)
    expect(JSON.stringify(publicRecord)).not.toContain(injection)
    expect(publicRecord.payload).toMatchObject({ publication: { version: 1, legacy: false,
      budgetAssessment: { status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete' } },
      days: [{ items: [{ title: '资料标题：Museum visitor information', timeOfDay: 'afternoon' }] }] })
    expect(guidePublicationReply(stored!)).toContain('不能确认')
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
    expect(JSON.stringify((await test.artifacts.get(saved.record.id))?.payload)).toContain(injection)
  })

  it('old or mismatched publication falls back without mutating audit data', async () => {
    const test = await fixture()
    const saved = await test.save()
    if (saved.status !== 'saved') throw new Error('expected save')
    const raw = travelGuideArtifactPayloadSchema.parse(saved.record.payload)
    for (const publication of [undefined, { ...raw.publication!, artifactId: 'other' },
      { ...raw.publication!, tripContextVersion: 77 }, { ...raw.publication!, flightSelectionRevision: 999 }]) {
      const record = { ...saved.record, payload: { ...raw, publication } }
      expect(publicationFor(record)?.legacy).toBe(true)
      expect(JSON.stringify(projectGuideRecord(record))).not.toContain('activity facts')
      expect((record.payload.days[0]!.items[0]!).description).toBe('activity facts')
    }
    const changed = structuredClone(saved.record)
    ;(changed.payload as typeof raw).days[0]!.items[0]!.title = 'Different saved item'
    expect(publicationFor(changed)?.legacy).toBe(true)
  })

  it('retains source-bound item excerpts without publishing unbound title suffixes', async () => {
    const test = await fixture(source => {
      source.findings[0]!.title = 'Example Museum free all year'
      source.findings[0]!.sources[0]!.snippet = 'Visit Example Museum. Check its operator for opening details.'
    })
    const saved = await test.save()
    if (saved.status !== 'saved') throw new Error('expected save')
    const output = projectGuideRecord(saved.record)
    expect(JSON.stringify(output)).toContain('来源条目摘录：Example Museum')
    expect(JSON.stringify(output)).toContain('搜索摘要')
    expect(JSON.stringify(output)).not.toContain('free all year')
  })

  it('publishes only bound source excerpts, never a semantic or future-validity claim', async () => {
    const test = await fixture()
    const saved = await test.save()
    if (saved.status !== 'saved') throw new Error('expected save')
    const guide = travelGuideArtifactPayloadSchema.parse(saved.record.payload)
    const source = structuredClone(test.source)
    const finding = source.findings[0]!
    const text = 'Adult admission 100 JPY.'
    const page = { text, retrievedAt: '2026-09-21T00:00:00.000Z', contentHash: createHash('sha256').update(text).digest('hex') }
    finding.sources[0]!.page = page
    finding.claimEvidence = [{ kind: 'price', subject: 'adult', value: '100 JPY', quote: text,
      sourceUrl: finding.sources[0]!.url, retrievedAt: page.retrievedAt, contentHash: page.contentHash, status: 'source_observed' }]
    const publish = () => projectGuideRecord({ ...saved.record, payload: { ...guide,
      publication: buildGuidePublication(saved.record, guide, [source]) } })
    expect(JSON.stringify(publish())).toContain('主体、条件及出行日适用性未审查')
    finding.claimEvidence[0]!.quote = 'Invented 100 JPY'
    expect(JSON.stringify(publish())).not.toContain('Invented')
    expect(JSON.stringify(publish())).not.toContain('100 JPY')
    delete finding.sources[0]!.page
    expect(JSON.stringify(publish())).not.toContain('100 JPY')
  })

  it('preserves unspaced source names and practical search references without publishing model prose', async () => {
    const test = await fixture(source => {
      source.findings[0]!.title = '示例寺与商店街全年免费'
      source.findings[0]!.sources[0]!.snippet = '参观示例寺后可沿河散步。'
      source.findings[1]!.summary = 'Model says transport is free'
      source.findings[1]!.sources[0]!.snippet = 'Use an IC card or individual tickets for subway and bus travel.'
    })
    const saved = await test.save()
    if (saved.status !== 'saved') throw new Error('expected save')
    const output = projectGuideRecord(saved.record)
    const text = JSON.stringify(output)
    expect(text).toContain('来源条目摘录：示例寺')
    expect(text).toContain('Use an IC card or individual tickets')
    expect(text).toContain('搜索摘要参考（非网页正文）')
    expect(text).not.toContain('Model says transport is free')
    expect(text).not.toContain('全年免费')
    const guide = travelGuideArtifactPayloadSchema.parse(saved.record.payload)
    const refs = Object.values(guide.publication!.references)
    refs[1]![0]!.excerpts[0]!.quote = 'Forged free transport'
    const corrupted = projectGuideRecord({ ...saved.record, payload: guide })
    expect(JSON.stringify((corrupted.payload as typeof guide).supportingEvidence)).not.toContain('Forged')
  })

  it('does not use a corrupted page snapshot to locate a publication name', async () => {
    const test = await fixture()
    const saved = await test.save()
    if (saved.status !== 'saved') throw new Error('expected save')
    const source = structuredClone(test.source)
    source.findings[0]!.title = 'Example Museum'
    source.findings[0]!.sources[0]!.page = { text: 'Example Museum', contentHash: '0'.repeat(64), retrievedAt: source.createdAt }
    const guide = travelGuideArtifactPayloadSchema.parse(saved.record.payload)
    const output = projectGuideRecord({ ...saved.record, payload: { ...guide,
      publication: buildGuidePublication(saved.record, guide, [source]) } })
    expect(JSON.stringify(output)).not.toContain('Example Museum')
  })
})

describe('exploration scope and required evidence', () => {
  it('saves and durably verifies without an optional exploratory event', async () => {
    const test = await fixture(undefined, { ...constraints, researchTypes: ['activity', 'practical', 'event'], requiredEvidenceTypes: ['activity', 'practical'] })
    expect(await test.save()).toMatchObject({ status: 'saved' })
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it.each([undefined, ['activity', 'practical', 'event'] as const])('keeps legacy and explicit event requirements mandatory: %j', async required => {
    const test = await fixture(undefined, { ...constraints, researchTypes: ['activity', 'practical', 'event'],
      ...(required ? { requiredEvidenceTypes: [...required] } : {}) })
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_research_type:event']) })
  })

  it('does not allow an empty itinerary when no category is mandatory', async () => {
    const test = await fixture(undefined, { ...constraints, requiredEvidenceTypes: [] })
    test.input.days[0]!.items = []
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_no_selected_findings']) })
  })
})

describe('event occurrence evidence', () => {
  const requirements: TravelGuideConstraints = { ...constraints, researchTypes: ['event', 'practical'] }
  const event = (source: ResearchArtifact, from?: string, to = from) => {
    source.brief.researchTypes = ['event', 'practical']
    const finding = source.findings[0]!
    finding.category = 'event'
    finding.title = 'Festival'
    finding.summary = 'A late October festival; its query window is not an occurrence date.'
    finding.sources[0]!.snippet = from ? `Festival: ${from} to ${to}.` : 'Festival takes place in late October.'
    if (from && to) finding.temporalEvidence = { from, to, sourceUrl: finding.sources[0]!.url, quote: finding.sources[0]!.snippet }
  }

  it('keeps old research readable but refuses a dated guide without source date evidence', async () => {
    const test = await fixture(source => event(source), requirements)
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_event_date_evidence_missing']) })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })

  it('rejects an event outside the scheduled date even when the research query covers the trip', async () => {
    const test = await fixture(source => event(source, '2026-10-26', '2026-11-04'), requirements)
    expect(await test.save()).toMatchObject({ status: 'needs_revision', details: expect.arrayContaining([
      expect.objectContaining({ code: 'guide_event_date_mismatch', day: 1, date: '2026-10-10' })
    ]) })
  })

  it('uses the same source date check for save and durable verification', async () => {
    const test = await fixture(source => event(source, '2026-10-10'), requirements)
    expect(await test.save()).toMatchObject({ status: 'saved' })
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('does not accept model date claims with a fabricated quote', async () => {
    const test = await fixture(source => {
      event(source, '2026-10-10')
      source.findings[0]!.sources[0]!.snippet = 'Festival takes place in late October.'
    }, requirements)
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_event_date_evidence_missing']) })
  })

  it('does not bypass the event date gate through supporting evidence', async () => {
    const test = await fixture(source => event(source), requirements)
    test.input.days[0]!.items = [{ ...test.input.days[0]!.items[0]!, findingId: 'practical' }]
    test.input.supportingRefs = [{ researchArtifactId: test.source.id, findingId: 'activity' }]
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_event_date_evidence_missing']) })
  })

  it('still validates dates of an optional event when it is selected', async () => {
    const test = await fixture(source => event(source), { ...requirements, requiredEvidenceTypes: ['practical'] })
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_event_date_evidence_missing']) })
  })
})

describe('authored guide supporting evidence and budget', () => {
  it('satisfies practical coverage separately from itinerary items and preserves the total budget', async () => {
    const test = await fixture()
    const result = await test.save()
    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved guide')
    expect(result.payload.days[0]!.items.map(item => item.category)).toEqual(['activity'])
    expect(result.payload.supportingEvidence).toMatchObject([{ title: 'Transit advice', category: 'practical', sourceFindingId: 'practical' }])
    expect(result.payload.budget).toEqual({ amount: 600, currency: 'CNY', scope: 'trip', partyBasis: 'unspecified', period: 'trip_total' })
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
    delete test.input.supportingRefs
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: ['guide_research_type:practical'] })
  })

  it.each([
    ['stale', (source: ResearchArtifact) => { source.findings[1]!.verification = { ...source.findings[1]!.verification, expiresAt: '2000-01-01T00:00:00.000Z' } }, 'eligible_research_evidence'],
    ['source mismatch', (source: ResearchArtifact) => { source.findings[1]!.sources[0]!.url = 'https://example.com/other' }, 'guide_evidence_source_mismatch'],
    ['unrelated destination', (source: ResearchArtifact) => { source.findings[1]!.destinations = [{ ...city, id: 'city:OSA', cityCode: 'OSA' }] }, 'guide_item_evidence_mismatch'],
    ['date mismatch', (source: ResearchArtifact) => { source.brief.travelWindow = { from: '2026-10-11', to: '2026-10-11' } }, 'research_travel_window']
  ] as const)('does not save supporting evidence with %s', async (_label, mutate, issue) => {
    const test = await fixture(mutate)
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining([issue]) })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })

  it('checks independent supporting sources against workspace ownership and context version', async () => {
    const test = await fixture()
    test.input.supportingRefs![0]!.researchArtifactId = uuidv7()
    await expect(test.save()).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    const old = await test.artifacts.create({ tripId: test.trip.id, type: 'research', schemaVersion: 2, tripContextVersion: 0, payload: test.source })
    test.input.supportingRefs![0]!.researchArtifactId = old.id
    await expect(test.save()).rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
  })

  it('validates supporting source lineage in the delivery verifier even when no day item uses that source', async () => {
    const test = await fixture()
    const support = structuredClone(test.source)
    support.id = uuidv7()
    support.findings = [support.findings[1]!]
    await test.artifacts.create({ id: support.id, tripId: test.trip.id, type: 'research', schemaVersion: 2, tripContextVersion: 1, payload: support })
    test.input.supportingRefs![0]!.researchArtifactId = support.id
    const result = await test.save()
    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved guide')
    expect(result.payload.sourceArtifactIds).toContain(support.id)
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('collects independent budget/evidence failures and marks checks blocked by unavailable source', async () => {
    const test = await fixture()
    const result = await test.save()
    if (result.status !== 'saved') throw new Error('Expected saved guide')
    const route = tripRoutePlanPayloadSchema.parse((await test.artifacts.get(result.payload.routeArtifactId))!.payload)
    const guide = structuredClone(result.payload)
    guide.budget!.amount = 1200
    guide.supportingEvidence![0]!.description = 'Invented advice'
    const validate = (research = new Map([[test.source.id, test.source]])) => validateGuideContent({ guide, route, research, trip: test.trip, constraints })
    expect(validate()).toMatchObject({ status: 'failed', missing: expect.arrayContaining(['guide_budget_mismatch', 'guide_item_evidence_mismatch']) })
    expect(validate(new Map())).toMatchObject({ details: expect.arrayContaining([
      expect.objectContaining({ code: 'guide_research_payload', blockedChecks: expect.arrayContaining(['eligible_research_evidence']) })
    ]) })
    delete guide.budget
    expect(validate().missing).toContain('guide_budget_mismatch')
    guide.builderVersion = 'agent-authored-guide-v1'
    expect(validate().missing).not.toContain('guide_budget_mismatch')
    expect(travelGuideArtifactPayloadSchema.safeParse(guide).success).toBe(true)
  })

  it('does not accept model-authored budget or supporting source facts', async () => {
    const test = await fixture()
    expect(authoredGuideInputSchema.safeParse({ ...test.input, budget: { amount: 5 } }).success).toBe(false)
    expect(authoredGuideInputSchema.safeParse({ ...test.input, supportingRefs: [{ ...test.input.supportingRefs![0], title: 'Claim' }] }).success).toBe(false)
  })

  it('reports all reference problems together and marks dependent checks as blocked', async () => {
    const test = await fixture()
    test.input.days[0]!.cityId = 'city:unknown'
    test.input.days[0]!.items[0]!.researchIndex = 12
    test.input.days[0]!.items.push({ researchIndex: 0, findingId: 'unknown', timeOfDay: 'evening', planningNote: 'Plan', requestedActivityIds: ['missing'] })
    test.input.supportingRefs![0]!.findingId = 'missing-support'
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining([
      'guide_unknown_city:day_1', 'guide_research_index', 'guide_unknown_finding:day_1:unknown',
      'guide_unknown_requested_activity:missing', 'guide_unknown_supporting_finding:missing-support'
    ]), details: expect.arrayContaining([expect.objectContaining({ fieldPath: 'days.0.items.0.researchIndex', blockedChecks: expect.arrayContaining(['eligible_research_evidence']) })]) })
  })

  it.each(['activity', 'practical'])('rejects ambiguous selected %s finding ids before writing', async category => {
    const test = await fixture(source => {
      source.findings.push({ ...source.findings.find(finding => finding.id === category)!, title: 'Conflicting title' })
    })
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: ['guide_ambiguous_finding'] })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).toEqual(['research'])
  })
})


describe('source reference applicability', () => {
  it('keeps even verified recent price/hour references explicitly unconfirmed for this trip', async () => {
    const test = await fixture(source => {
      source.findings[0]!.summary = 'Museum is always open; admission 20 EUR.'
      source.findings[1]!.summary = 'One day pass costs 900 yen; express train about 60 minutes.'
      for (const finding of source.findings) finding.verification.checkedAt = new Date().toISOString()
    })
    const result = await test.save()
    if (result.status !== 'saved') throw new Error('Expected saved guide')
    for (const item of [...result.payload.days[0]!.items, ...result.payload.supportingEvidence!]) {
      expect(item.sourceApplicability).toEqual(sourceApplicability())
      expect(item.verification.status).toBe('verified')
      expect(item.description).toBe(test.source.findings.find(f => f.id === item.sourceFindingId)!.summary)
    }
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it.each(['visit', 'support'] as const)('rejects removal of the %s reference qualification on durable revalidation', async location => {
    const test = await fixture()
    const result = await test.save()
    if (result.status !== 'saved') throw new Error('Expected saved guide')
    const guide = structuredClone(result.payload)
    const item = location === 'visit' ? guide.days[0]!.items[0]! : guide.supportingEvidence![0]!
    delete item.sourceApplicability
    const route = tripRoutePlanPayloadSchema.parse((await test.artifacts.get(guide.routeArtifactId))!.payload)
    expect(validateGuideContent({ guide, route, research: new Map([[test.source.id, researchArtifactSchema.parse(test.source)]]), trip: test.trip, constraints }))
      .toMatchObject({ status: 'failed', missing: expect.arrayContaining(['guide_source_applicability_missing']) })
    expect(travelGuideArtifactPayloadSchema.safeParse({ ...guide, builderVersion: 'agent-authored-guide-v2' }).success).toBe(true)
    guide.builderVersion = 'agent-authored-guide-v2'
    expect(validateGuideContent({ guide, route, research: new Map([[test.source.id, researchArtifactSchema.parse(test.source)]]), trip: test.trip, constraints }).status).toBe('satisfied')
    const readable = JSON.parse(artifactReadingContent({ ...result.record, payload: guide }))
    const readItem = location === 'visit' ? readable.payload.days[0].items[0] : readable.payload.supportingEvidence[0]
    expect(readItem.sourceApplicability).toEqual(sourceApplicability())
    expect(item.sourceApplicability).toBeUndefined()
  })

  it('does not allow model input or serialized evidence to promote reference applicability', async () => {
    const test = await fixture()
    const result = await test.save()
    if (result.status !== 'saved') throw new Error('Expected saved guide')
    expect(authoredGuideInputSchema.safeParse({ ...test.input, sourceApplicability: { status: 'verified' } }).success).toBe(false)
    const guide = structuredClone(result.payload)
    Object.assign(guide.supportingEvidence![0]!.sourceApplicability!, { status: 'verified' })
    expect(travelGuideArtifactPayloadSchema.safeParse(guide).success).toBe(false)
  })
})


describe('source-observed claims', () => {
  const attach = (source: ResearchArtifact, conflict = false) => {
    const finding = source.findings[1]!
    const text = 'Adult one-day pass: 900 yen. Adult one-day pass: 1100 yen.'
    const page = { text, retrievedAt: '2026-09-21T00:00:00.000Z', contentHash: createHash('sha256').update(text).digest('hex') }
    finding.sources[0]!.page = page
    const base = { kind: 'price' as const, subject: 'Adult one-day pass', sourceUrl: finding.sources[0]!.url,
      status: 'source_observed' as const, retrievedAt: page.retrievedAt, contentHash: page.contentHash }
    finding.claimEvidence = [{ ...base, value: '900 yen', quote: 'Adult one-day pass: 900 yen.' },
      ...(conflict ? [{ ...base, value: '1100 yen', quote: 'Adult one-day pass: 1100 yen.' }] : [])]
  }
  it('persists source-bound claims without upgrading applicability and revalidates on completion', async () => {
    const test = await fixture(source => attach(source))
    const result = await test.save()
    if (result.status !== 'saved') throw new Error('Expected saved guide')
    expect(result.payload.supportingEvidence![0]!.claimEvidence).toEqual(test.source.findings[1]!.claimEvidence)
    expect(result.payload.supportingEvidence![0]!.sourceApplicability).toEqual(sourceApplicability())
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
    const guide = structuredClone(result.payload)
    guide.supportingEvidence![0]!.claimEvidence![0]!.value = '100 yen'
    const route = tripRoutePlanPayloadSchema.parse((await test.artifacts.get(guide.routeArtifactId))!.payload)
    expect(validateGuideContent({ guide, route, research: new Map([[test.source.id, researchArtifactSchema.parse(test.source)]]), trip: test.trip, constraints }).missing)
      .toContain('guide_claim_evidence_mismatch')
  })
  it('blocks unresolved conflicting values even when partial evidence is allowed', async () => {
    const test = await fixture(source => attach(source, true))
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_claim_evidence_conflict']) })
  })
  it('blocks claims rejected by source binding instead of trusting their prose', async () => {
    const test = await fixture(source => { attach(source); source.findings[1]!.warnings.push('claim_evidence_rejected') })
    expect(await test.save()).toMatchObject({ status: 'needs_revision', issues: expect.arrayContaining(['guide_claim_evidence_mismatch']) })
  })
})
