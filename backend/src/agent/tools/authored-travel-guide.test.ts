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
    await expect(test.save()).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect((await test.artifacts.listForTrip(test.trip.id)).map(record => record.type)).not.toContain('travel_guide')
  })
})
