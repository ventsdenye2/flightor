import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { v7 as uuidv7 } from 'uuid'
import { up as createInitialSchema } from '../db/migrations/001_initial.js'
import { up as createCloudStateSchema } from '../db/migrations/006_cloud_state.js'
import { up as createRouteGenerationSchema } from '../db/migrations/007_route_generation_runs.js'
import { up as createWorkspaceSchema } from '../db/migrations/008_trip_workspace.js'
import { up as createPlanningGoalsSchema } from '../db/migrations/010_planning_goals.js'
import type { Database } from '../db/types.js'
import { PostgresUserIdentityRepository } from '../identity/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { PostgresUserMemoryRepository } from '../memory/postgres.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../agent/goals/default-verifiers.js'
import { createPlannerToolRegistry } from '../agent/tools/core.js'
import type { AgentModelClient } from '../agent/runtime/model.js'
import { AgentRuntime } from '../agent/runtime/runtime.js'
import { CloudPlannerService } from '../agent/cloud/service.js'
import { UnavailableResearchAgent } from '../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../flight-routing/unavailable.js'
import { MockAviationProvider } from '../aviation/providers/mock.js'
import { MockFareProvider } from '../fares/providers/mock.js'
import { PostgresWorkspaceRepository } from './postgres.js'
import { travelGuideArtifactPayloadSchema } from '../travel-guides/artifact.js'
import { publicationFor } from '../travel-guides/publication.js'
import { sourceRef } from '../travel-guides/finalization.js'
import { carryForwardBudgetGuide } from '../agent/dsh/budget-guide.js'
import type { ToolExecutionContext } from '../agent/runtime/registry.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

const city = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const origin = { id: 'airport:PEK', type: 'airport' as const, name: 'Beijing Capital', countryCode: 'CN', iata: 'PEK' }
const checkedAt = '2026-09-20T00:00:00.000Z'

suite('PostgreSQL workspace guide persistence and refresh', () => {
  const schema = `workspace_guides_${process.pid}_${Date.now()}`
  let adminPool: pg.Pool
  let pool: pg.Pool
  let db: Kysely<Database>
  let ownerId = ''
  let otherOwnerId = ''

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl })
    await adminPool.query(`create schema "${schema}"`)
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 8 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    await createInitialSchema(db)
    await createCloudStateSchema(db)
    await createRouteGenerationSchema(db)
    await createWorkspaceSchema(db)
    await createPlanningGoalsSchema(db)
    const identities = new PostgresUserIdentityRepository(db)
    ownerId = (await identities.resolveWechat({ providerSubject: `${schema}-owner`, nickname: 'G1 owner', avatarUrl: '' })).userId
    otherOwnerId = (await identities.resolveWechat({ providerSubject: `${schema}-other`, nickname: 'G1 other', avatarUrl: '' })).userId
  }, 30_000)

  afterAll(async () => {
    await db?.destroy()
    await adminPool?.query(`drop schema if exists "${schema}" cascade`)
    await adminPool?.end()
  })

  function researchPayload(id: string) {
    return {
      id, type: 'research', schemaVersion: 2,
      brief: { destinations: [city], interests: ['culture'], questions: ['Museums'], researchTypes: ['activity'],
        travelWindow: { from: '2026-10-10', to: '2026-10-10' } },
      findings: [{ id: 'finding-0', title: 'Tokyo museum', summary: 'A source-backed museum.', category: 'activity', destinations: [city],
        verification: { status: 'verified', checkedAt, expiresAt: '2099-01-01T00:00:00.000Z', confidence: 1,
          sources: [{ provider: 'fixture', reference: 'https://example.test/museum' }] },
        sources: [{ title: 'Museum', url: 'https://example.test/museum', domain: 'example.test', snippet: 'Source facts', authority: 'government_tourism' }], warnings: [] }],
      queryCount: 1, warnings: [], uncertainties: [], createdAt: checkedAt
    }
  }

  async function fixture(withFlight: boolean) {
    const trips = new PostgresTripRepository(db, ownerId)
    const trip = await trips.create({ initialContext: {
      origin, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] },
      departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' }, travelDays: 1,
      budget: { amount: 1500, currency: 'CNY', scope: 'trip' }, notes: ['Flights are arranged. Total budget target 1500 CNY.']
    } })
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const researchId = uuidv7()
    const research = await artifacts.create({ id: researchId, tripId: trip.id, tripContextVersion: trip.context.version, type: 'research', schemaVersion: 2,
      payload: researchPayload(researchId) })
    const workspace = new PostgresWorkspaceRepository(db, ownerId)
    let selectedFlight: Awaited<ReturnType<PostgresWorkspaceRepository['getSelectedFlight']>> = null
    let selectedFlightArtifactId: string | undefined
    if (withFlight) {
      const flightId = uuidv7()
      const flight = await artifacts.create({ id: flightId, tripId: trip.id, tripContextVersion: trip.context.version, type: 'flight_search', schemaVersion: 1,
        payload: { id: flightId, type: 'flight_search', query: { origin: 'PEK', destination: 'NRT', departureDate: '2026-10-10', currency: 'CNY', travelClass: 1 },
          offers: [{ id: 'offer-g1', segments: [{ flightNumber: 'G1', airline: 'Fixture Air', origin: 'PEK', destination: 'NRT',
            departsAt: '2026-10-10T08:00:00+08:00', arrivesAt: '2026-10-10T12:00:00+09:00', durationMinutes: 180 }], layovers: [], totalAmount: 1200,
            currency: 'CNY', totalDurationMinutes: 180, airlines: ['Fixture Air'], transferType: 'airline' }], provider: 'fixture', checkedAt,
          verification: { status: 'verified', checkedAt, confidence: 1, sources: [{ provider: 'fixture' }] } } })
      selectedFlightArtifactId = flight.id
      const adopted = await workspace.update(trip.id, { expectedVersion: (await workspace.get(trip.id)).trip.version, selectedFlight: { kind: 'offer', artifactId: flight.id,
        offerId: 'offer-g1', layoverPreference: 'airport_only' } })
      expect(adopted.selectedFlight).not.toBeNull()
      selectedFlight = adopted.selectedFlight ? await workspace.getSelectedFlight(trip.id) : null
    }
    const conversations = new PostgresConversationRepository(db, ownerId)
    const conversation = await conversations.create({ tripId: trip.id, title: withFlight ? 'selected flight guide' : 'self ticket guide' })
    const goals = new PostgresGoalRepository(db, ownerId)
    const runs = new PostgresGoalRunRepository(db, ownerId)
    const call = { id: 'save-guide', type: 'function' as const, function: { name: 'save_travel_guide', arguments: JSON.stringify({
      intent: { kind: 'travel_guide', parameters: { questions: ['Museums'], researchTypes: ['activity', 'event'], requiredEvidenceTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: false } },
      researchArtifactIds: [research.id], days: [{ day: 1, cityId: city.id, kind: 'visit', theme: '文化与街巷',
        items: [{ researchIndex: 0, findingId: 'finding-0', timeOfDay: 'flexible', planningNote: '安排参观博物馆。' }] }]
    }) } }
    const model: AgentModelClient = { complete: vi.fn()
      .mockImplementationOnce(async () => ({ message: { role: 'assistant', content: null, tool_calls: [call] } }))
      .mockImplementationOnce(async (messages, _model, options) => {
        // This is the bounded publication editor, never a second runtime recap.
        expect(options.tools).toEqual([])
        expect(options.toolChoice).toBe('none')
        expect(options.responseFormat.type).toBe('json_schema')
        expect(messages.some((message: { role: string }) => message.role === 'tool')).toBe(false)
        const input = JSON.parse(messages.at(-1)?.content ?? '{}')
        expect(input.locale).toBe('zh')
        const guide = travelGuideArtifactPayloadSchema.parse(input.guide)
        return { message: { role: 'assistant', content: JSON.stringify({ issues: [], text: {
          locale: 'zh', reply: '文化漫游安排已准备好，可以按每日主题查看。',
          overview: '以博物馆文化参观为主，保留轻松游览的节奏，了解东京的文化氛围。',
          days: guide.days.map(day => ({ day: day.day, theme: '博物馆文化漫游' })),
          activities: guide.days.flatMap(day => day.items).map(item => ({ activityId: item.id,
            name: '东京博物馆', introduction: '走进博物馆参观展陈，在馆内慢慢了解文化主题。',
            recommendationReason: '呼应你的文化兴趣，同时为轻松参观留出空间。', sourceRefs: [sourceRef(item)] }))
        } }) } }
      }) }
    const memory = new PostgresUserMemoryRepository(db, ownerId)
    const service = new CloudPlannerService({ ownerId, leanGoalsEnabled: true, trips, conversations, artifacts, memory,
      goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
      flightSelections: workspace, runtime: new AgentRuntime(model, createPlannerToolRegistry({ leanGoalsEnabled: true })),
      aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
      connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer() })
    const result = await service.runTurn({ requestId: `request-${withFlight ? 'flight' : 'self'}`, tripId: trip.id, conversationId: conversation.id,
      generationId: `generation-${withFlight ? 'flight' : 'self'}`, message: '请保存这份每日攻略' })
    expect(result).toMatchObject({ stopReason: 'completed', delivery: { status: 'satisfied', kind: 'travel_guide' } })
    // One Planner tool decision plus one bounded editor; no runtime prose recap.
    expect(model.complete).toHaveBeenCalledTimes(2)
    expect(result.artifactRefs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'travel_guide' })]))
    const guideId = result.artifactRefs.find(ref => ref.type === 'travel_guide')!.id
    const guide = await artifacts.get(guideId)
    expect(guide?.type).toBe('travel_guide')
    expect(publicationFor(guide!)?.finalization?.variants.zh).toMatchObject({ status: 'accepted', observation: { calls: 1 } })
    expect(result.reply).toBe('文化漫游安排已准备好，可以按每日主题查看。')
    const goal = (await goals.listForTrip(trip.id))[0]!
    expect(goal.parameters).toMatchObject({ researchTypes: ['activity', 'event'], requiredEvidenceTypes: ['activity'] })
    const run = (await runs.listForGoal(goal.id))[0]!
    expect({ goal: goal.status, run: run.status }).toEqual({ goal: 'satisfied', run: 'satisfied' })
    return { trip, guideId, guide, workspace, conversation, artifacts, selectedFlightArtifactId, result }
  }

  it.each([['self-ticket', false], ['selected-flight', true]] as const)('persists and refreshes the %s guide', async (_label, withFlight) => {
    const test = await fixture(withFlight)
    const refreshed = await new PostgresWorkspaceRepository(db, ownerId).get(test.trip.id, test.conversation.id)
    expect(refreshed.artifactRefs.find(ref => ref.id === test.guideId)).toMatchObject({ type: 'travel_guide' })
    const message = refreshed.messages.find(value => value.role === 'assistant')!
    expect(message.artifactRefs.map(ref => ref.id)).toContain(test.guideId)
    expect(message.delivery).toMatchObject({ status: 'satisfied', artifactIds: [test.guideId] })
    const restored = await new PostgresArtifactRepository(db, ownerId).get(test.guideId)
    expect(restored?.id).toBe(test.guideId)
    const payload = restored?.payload as { flightSelection?: unknown; sourceArtifactIds: string[] }
    if (withFlight) {
      expect(payload.flightSelection).toMatchObject({ kind: 'offer', artifactId: test.selectedFlightArtifactId, choiceId: 'offer-g1', revision: 1,
        originDepartureAt: '2026-10-10T08:00:00+08:00', destinationArrivalAt: '2026-10-10T12:00:00+09:00' })
      expect(refreshed.trip.selectedFlight).toMatchObject({ artifactId: test.selectedFlightArtifactId, offerId: 'offer-g1', revision: 1 })
      expect(payload.sourceArtifactIds).toContain(test.selectedFlightArtifactId)
    } else {
      expect(payload.flightSelection).toBeUndefined()
      expect(refreshed.trip.selectedFlight).toBeNull()
    }
    expect(await new PostgresArtifactRepository(db, otherOwnerId).get(test.guideId)).toBeUndefined()
    await expect(new PostgresWorkspaceRepository(db, otherOwnerId).get(test.trip.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })

  it('restores guides chronologically without promoting unannounced initial drafts and preserves localization/legacy retry access', async () => {
    const test = await fixture(false)
    const source = travelGuideArtifactPayloadSchema.parse(test.guide!.payload)
    const accepted = publicationFor(test.guide!)!.finalization!.variants.zh!
    const blocked = { ...accepted, status: 'blocked' as const, text: null,
      issues: [{ code: 'format' as const, activityId: null, detail: 'excluded_precise_claim' }] }
    const copyGuide = async (variants: { zh?: typeof accepted; en?: typeof accepted } | undefined) => {
      const id = uuidv7()
      const publication = { ...source.publication!, artifactId: id,
        ...(variants ? { finalization: { version: 1, variants } } : {}) }
      if (!variants) delete publication.finalization
      return test.artifacts.create({ id, tripId: test.trip.id, conversationId: test.conversation.id,
        tripContextVersion: test.trip.context.version, type: 'travel_guide', schemaVersion: 1,
        payload: { ...source, publication } })
    }
    const unannouncedDraft = await copyGuide({ zh: blocked })
    const legacy = await copyGuide(undefined)
    const announcedFailure = await copyGuide({ zh: blocked })
    await new PostgresConversationRepository(db, ownerId).appendMessage({ conversationId: test.conversation.id, role: 'assistant',
      content: 'The final text is pending.', metadata: { artifact_refs: [announcedFailure.id] } })
    const latestAccepted = await copyGuide({ zh: accepted, en: blocked })
    const laterUnannouncedDraft = await copyGuide({})
    for (const locale of ['zh', 'en'] as const) {
      const view = await test.workspace.get(test.trip.id, test.conversation.id, locale)
      const guides = view.artifactRefs.filter(ref => ref.type === 'travel_guide').map(ref => ref.id)
      expect(guides).toEqual([test.guideId, legacy.id, announcedFailure.id, latestAccepted.id])
      expect([...view.artifactRefs].reverse().find(ref => ref.type === 'travel_guide')!.id).toBe(latestAccepted.id)
      expect(view.messages.at(-1)!.artifactRefs.map(ref => ref.id)).toEqual([announcedFailure.id])
    }
    // Hidden here means no result promotion, not deletion or bypassing owner reads.
    expect(await test.artifacts.get(unannouncedDraft.id)).toBeDefined()
    expect(await test.artifacts.get(laterUnannouncedDraft.id)).toBeDefined()
    expect(publicationFor((await test.artifacts.get(latestAccepted.id))!)!.finalization!.variants.en!.status).toBe('blocked')
  })

  it('carries an accepted guide through a budget-only version with real provenance, completion and scoped history', async () => {
    const test = await fixture(false), trips = new PostgresTripRepository(db, ownerId)
    const original = await trips.get(test.trip.id)
    const updated = await trips.update(test.trip.id, { budget: { amount: 1200, currency: 'CNY', scope: 'trip' },
      notes: ['Flights are arranged.', 'Total budget target 1200 CNY.', 'Do not guarantee costs within budget.'] }, original!.version)
    expect(await trips.getAtVersion(test.trip.id, original!.version)).toEqual(original)
    expect(await new PostgresTripRepository(db, otherOwnerId).getAtVersion(test.trip.id, original!.version)).toBeUndefined()
    const goals = new PostgresGoalRepository(db, ownerId), runs = new PostgresGoalRunRepository(db, ownerId)
    const context = { ownerId, tripId: test.trip.id, conversationId: test.conversation.id, generationId: uuidv7(), requestId: uuidv7(),
      trips, artifacts: test.artifacts, goalRepository: goals, goalRunRepository: runs,
      goalVerifiers: createDefaultGoalVerifierRegistry(), isGenerationCurrent: () => true, resolvedLocations: new Map() } as unknown as ToolExecutionContext
    const result = await carryForwardBudgetGuide({ context, baseGuideId: test.guideId, locale: 'zh', signal: new AbortController().signal }) as any
    expect(result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
    const current = (await test.artifacts.get(result.artifact.id))!
    expect(current.tripContextVersion).toBe(updated.version)
    expect(publicationFor(current)!.finalization!.variants.zh).toMatchObject({ status: 'accepted', observation: { calls: 0 } })
    expect((await test.workspace.get(test.trip.id, test.conversation.id)).artifactRefs.at(-1)!.id).toBe(current.id)
    expect(await test.artifacts.get(test.guideId)).toEqual(test.guide)
    const cloned = travelGuideArtifactPayloadSchema.parse(current.payload)
    const source = (await test.artifacts.get(cloned.days[0]!.items[0]!.sourceArtifactId))!
    expect(source.tripContextVersion).toBe(updated.version)
    expect(source.sourceArtifactIds).toHaveLength(1)
    expect((await test.artifacts.get(source.sourceArtifactIds![0]!))!.tripContextVersion).toBe(original!.version)
    const conversations = new PostgresConversationRepository(db, ownerId)
    const content = '预算目标已改为两天合计1200元，不是每天1200元。'
    const metadata = { engine: 'dsh', stop_reason: 'completed', artifact_refs: [current.id],
      delivery: { kind: 'trip_context_update', status: 'satisfied', artifactIds: [current.id], missing: [], warnings: [], goals: [] } }
    const budgetMessage = await conversations.appendMessage({ conversationId: test.conversation.id, role: 'assistant', content, metadata })
    const unsafeMessage = await conversations.appendMessage({ conversationId: test.conversation.id, role: 'assistant',
      content: '预算目标两天合计1200元，一定够用。', metadata })
    const restored = await new PostgresWorkspaceRepository(db, ownerId).get(test.trip.id, test.conversation.id, 'zh')
    expect(restored.messages.find(message => message.id === budgetMessage.id)).toMatchObject({ content,
      artifactRefs: [expect.objectContaining({ id: current.id })], delivery: { kind: 'trip_context_update', status: 'satisfied' } })
    expect(restored.messages.find(message => message.id === unsafeMessage.id)!.content).not.toContain('一定够用')
    const english = await new PostgresWorkspaceRepository(db, ownerId).get(test.trip.id, test.conversation.id, 'en')
    expect(english.messages.find(message => message.id === budgetMessage.id)!.content).not.toBe(content)
    expect((await conversations.listMessages(test.conversation.id)).find(message => message.id === budgetMessage.id)!.content).toBe(content)
  })
})
