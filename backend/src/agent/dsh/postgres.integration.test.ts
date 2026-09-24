import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import Fastify from 'fastify'
import type { AppContext } from '../../app/context.js'
import { parseEnv } from '../../config/env.js'
import { issueAccessToken } from '../../auth/tokens.js'
import { registerCloudStateRoutes } from '../../routes/cloud-state.js'
import { createArtifactWorkspace, loadWorkspaceArtifact } from '../../artifacts/workspace.js'
import { finalPendingReply } from '../../travel-guides/finalization-schema.js'
import { up as initial } from '../../db/migrations/001_initial.js'
import { up as cloud } from '../../db/migrations/006_cloud_state.js'
import { up as routeRuns } from '../../db/migrations/007_route_generation_runs.js'
import { up as workspaceSchema } from '../../db/migrations/008_trip_workspace.js'
import { up as goalsSchema } from '../../db/migrations/010_planning_goals.js'
import type { Database } from '../../db/types.js'
import { PostgresUserIdentityRepository } from '../../identity/postgres.js'
import { PostgresTripRepository } from '../../trips/postgres.js'
import { PostgresArtifactRepository } from '../../artifacts/postgres.js'
import { PostgresConversationRepository } from '../../conversations/postgres.js'
import { PostgresUserMemoryRepository } from '../../memory/postgres.js'
import { PostgresWorkspaceRepository } from '../../workspaces/postgres.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../goals/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { guideCandidateRef } from '../../travel-guides/candidates.js'
import type { ResearchArtifact } from '../../research-agent/types.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { CloudPlannerService } from '../cloud/service.js'
import { DshPlannerService } from './service.js'
import { DshSessionManager } from './session-manager.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
const city = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const intent = { kind: 'travel_guide', parameters: { questions: ['Traditional culture'], researchTypes: ['activity'],
  requiredEvidenceTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: true } }

suite('DSH official worker with PostgreSQL domain persistence', () => {
  const schema = `dsh_dialogue_${process.pid}_${Date.now()}`
  let admin: pg.Pool
  let db: Kysely<Database>
  let ownerId: string
  let otherOwnerId: string
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl })
    await admin.query(`create schema "${schema}"`)
    const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 8 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    for (const migrate of [initial, cloud, routeRuns, workspaceSchema, goalsSchema]) await migrate(db)
    const identities = new PostgresUserIdentityRepository(db)
    ownerId = (await identities.resolveWechat({ providerSubject: `${schema}-owner`, nickname: 'DSH test', avatarUrl: '' })).userId
    otherOwnerId = (await identities.resolveWechat({ providerSubject: `${schema}-other`, nickname: 'Other owner', avatarUrl: '' })).userId
  }, 30_000)
  afterAll(async () => {
    await db?.destroy()
    await admin?.query(`drop schema if exists "${schema}" cascade`)
    await admin?.end()
  })

  it('publishes, explains without writes, protects other slots, versions total budget and resumes read-only state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-pg-'))
    const legacy = vi.spyOn(CloudPlannerService.prototype, 'runTurn').mockRejectedValue(new Error('Legacy engine forbidden'))
    const runtime = vi.spyOn(AgentRuntime.prototype, 'run').mockRejectedValue(new Error('Legacy loop forbidden'))
    const finalizer = vi.fn(() => { throw new Error('Separate finalizer forbidden') })
    const researchAgent = new UnavailableResearchAgent()
    const researchCall = vi.spyOn(researchAgent, 'research')
    const trips = new PostgresTripRepository(db, ownerId)
    const conversations = new PostgresConversationRepository(db, ownerId)
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const goals = new PostgresGoalRepository(db, ownerId)
    const runs = new PostgresGoalRunRepository(db, ownerId)
    const workspace = new PostgresWorkspaceRepository(db, ownerId)
    const trip = await trips.create({ initialContext: { travelDays: 2, budget: { amount: 1500, currency: 'CNY', scope: 'trip' },
      interests: ['culture'], departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' },
      destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] } } })
    const conversation = await conversations.create({ tripId: trip.id, title: 'Two-day self-ticket DSH dialogue' })
    const research: ResearchArtifact = {
      id: randomUUID(), type: 'research', schemaVersion: 2,
      brief: { destinations: [city], interests: ['culture'], questions: ['Museums'], researchTypes: ['activity'],
        travelWindow: { from: '2026-10-10', to: '2026-10-11' } },
      findings: ['temple', 'museum', 'garden', 'indoor'].map(id => ({ id, title: `Tokyo ${id}`,
        summary: `Explore the ${id} and learn about local culture.`, category: 'activity', destinations: [city],
        verification: { status: 'partially_verified', checkedAt: '2026-09-24T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', confidence: 0.5,
          sources: [{ provider: 'fixture', reference: 'https://example.com/museums' }] },
        sources: [{ title: 'Museum fixture', url: 'https://example.com/museums', domain: 'example.com',
          snippet: 'Exhibits introduce traditional culture.', authority: 'government_tourism' }], warnings: [] })),
      queryCount: 0, warnings: [], uncertainties: [], createdAt: '2026-09-24T00:00:00.000Z'
    }
    await artifacts.create({ id: research.id, tripId: trip.id, conversationId: conversation.id, tripContextVersion: trip.context.version,
      type: 'research', schemaVersion: 2, payload: research })
    const candidate = (id: string) => guideCandidateRef({ ownerId, tripId: trip.id, tripContextVersion: trip.context.version }, research, id)
    const textItem = (activityKey: string) => ({ activityKey, name: `Tokyo cultural visit ${activityKey}`,
      introduction: 'Explore the cultural exhibits and traditional architecture at a relaxed pace.',
      recommendationReason: 'This stop reflects your interest in traditional local culture.' })
    const firstArgs = { intent, days: [
      { day: 1, cityId: city.id, kind: 'visit', theme: 'Traditional culture', items: [
        { activityKey: 'a', candidateRef: candidate('temple'), timeOfDay: 'morning', planningNote: 'Explore traditional architecture.' }] },
      { day: 2, cityId: city.id, kind: 'visit', theme: 'Culture and gardens', items: [
        { activityKey: 'b', candidateRef: candidate('museum'), timeOfDay: 'morning', planningNote: 'Explore cultural exhibits.' },
        { activityKey: 'c', candidateRef: candidate('garden'), timeOfDay: 'afternoon', planningNote: 'Enjoy a relaxed garden walk.' }] }
    ], text: { reply: 'Your Tokyo cultural itinerary is ready to explore.', overview: 'Explore traditional culture and enjoy a relaxed pace across Tokyo.',
      days: [{ day: 1, theme: 'Traditional culture' }, { day: 2, theme: 'Culture and gardens' }], activities: ['a', 'b', 'c'].map(textItem) } }
    let sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { tool: 'commit_travel_guide', args: firstArgs }, { text: 'Done.' },
      { text: 'The museum morning reflects your cultural interests and leaves the afternoon flexible.' }
    ] })
    const createService = () => new DshPlannerService({ ownerId, trips, conversations, artifacts, sessions,
      memory: new PostgresUserMemoryRepository(db, ownerId), goalRepository: goals, goalRunRepository: runs,
      goalVerifiers: createDefaultGoalVerifierRegistry(), flightSelections: workspace, aviation: new MockAviationProvider(), fares: new MockFareProvider(),
      research: researchAgent, connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
      routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: finalizer })
    let service = createService()
    const turn = (message: string) => service.runTurn({ requestId: randomUUID(), generationId: randomUUID(), tripId: trip.id,
      conversationId: conversation.id, locale: 'en', message })
    const domainState = async () => ({ trip: await trips.get(trip.id), artifacts: await artifacts.listForTrip(trip.id),
      goals: await goals.listForTrip(trip.id), runs: await Promise.all((await goals.listForTrip(trip.id)).map(goal => runs.listForGoal(goal.id))) })
    try {
      const first = await turn('I have my own tickets. Plan and save two relaxed cultural days, with a total budget of CNY 1500.')
      expect(first).toMatchObject({ stopReason: 'completed', delivery: { status: 'satisfied' } })
      expect(first.reply).toBe(firstArgs.text.reply)
      const base = (await artifacts.get(first.artifactRefs.find(ref => ref.type === 'travel_guide')!.id))!
      const before = travelGuideArtifactPayloadSchema.parse(base.payload)
      const basePublication = publicationFor(base)!
      expect(basePublication.finalization!.variants.en).toMatchObject({ status: 'accepted', observation: { calls: 0 } })
      expect(before.flightSelection).toBeUndefined()
      const savedState = await domainState()
      const explanation = await turn('Why did you put the museum on the second morning? Only explain, do not change anything.')
      expect(explanation.reply).toContain('cultural interests')
      expect(explanation.reply).not.toContain('saved')
      expect(await domainState()).toEqual(savedState)

      // A fresh process resumes the official durable session; runtime IDs are now known.
      await sessions.close()
      sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
        { tool: 'commit_travel_guide', args: { intent, baseGuideId: base.id, expectedContentHash: basePublication.guideContentHash,
          replaceSlots: [{ day: 2, slot: 'afternoon' }], days: [{ day: 2, cityId: city.id, kind: 'visit', theme: 'Indoor culture', items: [
            { activityKey: 'replacement', candidateRef: candidate('indoor'), timeOfDay: 'afternoon', planningNote: 'Explore indoor cultural exhibits.' }] }],
          text: { reply: 'The second afternoon now focuses on indoor culture.', overview: firstArgs.text.overview,
            days: [{ day: 2, theme: 'Indoor culture' }], activities: [textItem('replacement')] } } }, { text: 'Updated.' },
        { tool: 'update_trip_context', args: { expectedVersion: trip.context.version, patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } } } },
        { text: 'The total budget is now CNY 1200 for both days. Unknown costs remain unverified.' }
      ] })
      service = createService()
      const patched = await turn('Keep day one and day two morning unchanged. Replace only day two afternoon with indoor culture.')
      expect(patched).toMatchObject({ stopReason: 'completed', delivery: { status: 'satisfied' } })
      const revised = (await artifacts.get(patched.artifactRefs.find(ref => ref.type === 'travel_guide')!.id))!
      const after = travelGuideArtifactPayloadSchema.parse(revised.payload)
      expect(after.days[0]).toEqual(before.days[0])
      expect(after.days[1]!.items[0]).toEqual(before.days[1]!.items[0])
      expect(after.days[1]!.items[1]!.planningNote).toContain('indoor')
      expect(publicationFor(revised)!.finalization!.variants.en!.text!.activities.slice(0, 2))
        .toEqual(basePublication.finalization!.variants.en!.text!.activities.slice(0, 2))
      expect(await artifacts.get(base.id)).toEqual(base)
      const storedGoals = await goals.listForTrip(trip.id)
      expect(storedGoals.length).toBeGreaterThan(0)
      expect(storedGoals.every(goal => goal.status === 'satisfied')).toBe(true)
      const storedRuns = (await Promise.all(storedGoals.map(goal => runs.listForGoal(goal.id)))).flat()
      expect(storedRuns).toHaveLength(2)
      expect(storedRuns.every(run => run.status === 'satisfied')).toBe(true)
      const budget = await turn('CNY 1200 is the total for both days, not per day. Do not promise unknown prices.')
      expect(budget.tripContext.budget).toEqual({ amount: 1200, currency: 'CNY', scope: 'trip' })
      expect(budget.tripVersion).toBe(trip.context.version + 1)
      expect((await artifacts.listForTrip(trip.id)).filter(record => record.type === 'travel_guide')).toHaveLength(2)

      await sessions.close()
      sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
        { tool: 'get_trip_context' }, { text: 'Your current budget is CNY 1200 in total for two days.' }
      ] })
      service = createService()
      const resumed = await turn('Remind me of the current total budget without editing the plan.')
      expect(resumed.reply).toContain('1200')
      const messages = await conversations.listMessages(conversation.id)
      expect(messages.at(-1)?.metadata).toMatchObject({ engine: 'dsh', resumed: true })
      const runSpy = vi.spyOn(sessions, 'run')
      const stable = await domainState()
      const refreshed = await new PostgresWorkspaceRepository(db, ownerId).get(trip.id, conversation.id, 'en')
      expect(refreshed.trip.contextVersion).toBe(trip.context.version + 1)
      // Historical Goal satisfaction is retained, but stale publication prose is withheld.
      const historicalGuideMessages = refreshed.messages.filter(message => message.delivery?.kind === 'travel_guide')
      expect(historicalGuideMessages).toHaveLength(2)
      expect(historicalGuideMessages.every(message => message.content === finalPendingReply('en'))).toBe(true)
      const currentScope = await createArtifactWorkspace({ ownerId, trips, artifacts, tripId: trip.id, conversationId: conversation.id })
      await expect(loadWorkspaceArtifact(currentScope, base.id, 'travel_guide', [1]))
        .rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
      await expect(loadWorkspaceArtifact(currentScope, research.id, 'research', [2]))
        .rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
      const app = Fastify()
      const env = parseEnv({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'dsh-postgres-test-only-secret-at-least-32-characters' })
      try {
        await registerCloudStateRoutes(app, { db, env } as AppContext)
        const token = await issueAccessToken({ userId: ownerId, publicId: randomUUID() }, env)
        const headers = { authorization: `Bearer ${token}` }
        for (const id of [base.id, revised.id]) {
          const response = await app.inject({ method: 'GET', url: `/v1/artifacts/${id}?locale=en`, headers })
          expect(response.statusCode).toBe(200)
          expect(response.json().artifact.payload.publication).toMatchObject({ status: 'blocked', issues: [{ code: 'stale' }] })
        }
        expect((await app.inject({ method: 'GET', url: `/v1/trips/${trip.id}`, headers })).statusCode).toBe(200)
      } finally { await app.close() }
      await service.publicationContext({ tripId: trip.id, conversationId: conversation.id })
      await new PostgresWorkspaceRepository(db, ownerId).get(trip.id, conversation.id, 'en')
      expect(await domainState()).toEqual(stable)
      expect(runSpy).not.toHaveBeenCalled()
      expect(await new PostgresArtifactRepository(db, otherOwnerId).get(base.id)).toBeUndefined()
      await expect(new PostgresWorkspaceRepository(db, otherOwnerId).get(trip.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
      expect(legacy).not.toHaveBeenCalled(); expect(runtime).not.toHaveBeenCalled()
      expect(finalizer).not.toHaveBeenCalled(); expect(researchCall).not.toHaveBeenCalled()
    } finally {
      await sessions.close()
      legacy.mockRestore(); runtime.mockRestore(); researchCall.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  }, 90_000)
})
