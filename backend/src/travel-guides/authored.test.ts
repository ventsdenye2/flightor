import { describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { createArtifactWorkspace } from '../artifacts/workspace.js'
import type { LocationRef } from '../aviation/types.js'
import type { ResearchArtifact } from '../research-agent/types.js'
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

async function fixture(mutate?: (source: ResearchArtifact) => void) {
  const ownerId = 'owner'
  const trip = { ...emptyTripContext('trip'), version: 1, travelDays: 1,
    budget: { amount: 600, currency: 'CNY', scope: 'trip' as const },
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
    destinationIntent: { mode: 'explicit' as const, required: [city], preferred: [], excluded: [] } }
  const artifacts = new InMemoryArtifactRepository(ownerId, new Set([trip.id]))
  const trips = new InMemoryTripContextRepository([trip])
  const goals = new InMemoryGoalRepository(ownerId)
  const goal = (await goals.create({ tripId: trip.id, kind: 'travel_guide', createdContextVersion: 1, idempotencyKey: 'goal',
    parameters: { questions: ['Museums and transportation'], ...constraints } })).goal
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
  const save = () => saveAuthoredTravelGuide(input, constraints, scope)
  const verify = () => createDefaultGoalVerifierRegistry().verify(goal, { ownerId, tripId: trip.id, run, currentTrip: trip, artifacts })
  return { input, save, verify, scope, source, artifacts, trip }
}

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
