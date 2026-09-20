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
      departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' }, travelDays: 1
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
      .mockImplementationOnce(async messages => {
        const response = JSON.parse(messages.at(-1)?.content ?? '{}')
        expect(response.data.completion.status).toBe('satisfied')
        return { message: { role: 'assistant', content: '已保存攻略。' } }
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
    expect(model.complete).toHaveBeenCalledTimes(2)
    expect(result.artifactRefs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'travel_guide' })]))
    const guideId = result.artifactRefs.find(ref => ref.type === 'travel_guide')!.id
    const guide = await artifacts.get(guideId)
    expect(guide?.type).toBe('travel_guide')
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
})
