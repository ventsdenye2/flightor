import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '../db/types.js'
import { up as initial } from '../db/migrations/001_initial.js'
import { up as cloud } from '../db/migrations/006_cloud_state.js'
import { up as routing } from '../db/migrations/007_route_generation_runs.js'
import { up as workspace } from '../db/migrations/008_trip_workspace.js'
import { up as discovery } from '../db/migrations/009_discovery.js'
import { up as planning } from '../db/migrations/010_planning_goals.js'
import { up as routeGoalLineage } from '../db/migrations/011_route_generation_goal_lineage.js'
import { PostgresUserIdentityRepository } from '../identity/postgres.js'
import { PostgresWorkspaceRepository } from '../workspaces/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { PostgresDiscoveryRepository } from './postgres.js'
import { ExploreRepository } from './explore.js'
import { discoveryInputSchema, tripTemplateSchema } from './types.js'
import { hashAdminPassword, issueAdminToken } from '../admin/auth.js'
import { issueAccessToken } from '../auth/tokens.js'
import { parseEnv } from '../config/env.js'
import { createProviders } from '../providers/index.js'
import { buildApp } from '../app.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresRouteGenerationRunRepository } from '../route-generation/repository.js'
import { ParetoRouteOptimizer } from '../flight-routing/optimizer.js'
import type { Redis } from 'ioredis'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
suite('Editorial publishing and cloud workspace PostgreSQL boundaries', () => {
  const schema = `phase789_${process.pid}_${Date.now()}`
  let adminPool: pg.Pool, db: Kysely<Database>, repo: PostgresDiscoveryRepository, explore: ExploreRepository
  let userId: string, otherId: string
  const adminId = uuidv7(), viewerId = uuidv7()
  const today = new Date().toISOString().slice(0, 10), until = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const verification = { status: 'unverified' as const, checkedAt: new Date().toISOString(), confidence: 0, sources: [{ provider: 'fixture' }] }
  const template = tripTemplateSchema.parse({ title: 'Fixture seasonal journey', summary: 'A sourced test journey.', category: 'seasonal', routeConcept: 'Explore a destination at your own pace.', anchorDestinations: [{ id: 'airport-nrt', type: 'airport', name: 'Tokyo Narita', countryCode: 'JP', iata: 'NRT' }], optionalDestinations: [], recommendedStopovers: [], suggestedDays: 5, interests: ['culture'], experienceGoals: ['Discover local exhibitions'], validFrom: today, validTo: until, sourceFacts: [{ id: 'fact-1', statement: 'A test source statement.', sourceUrls: ['https://example.com/fixture'], verification }], verification })
  const input = discoveryInputSchema.parse({ destinationCodes: ['NRT'], questions: ['Seasonal experiences?'], researchTypes: ['seasonal'], validFrom: today, validTo: until })
  const publication = (version: number) => ({ expectedVersion: version, acknowledgeFacts: true as const, verifiedUntil: new Date(Date.now() + 7 * 86400000).toISOString() })
  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl })
    await adminPool.query(`create schema "${schema}"`)
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 8 }) }) })
    for (const migrate of [initial, cloud, routing, workspace, discovery, planning, routeGoalLineage]) await migrate(db)
    const identities = new PostgresUserIdentityRepository(db)
    userId = (await identities.resolveWechat({ providerSubject: `${schema}-owner`, nickname: 'Owner', avatarUrl: '' })).userId
    otherId = (await identities.resolveWechat({ providerSubject: `${schema}-other`, nickname: 'Other', avatarUrl: '' })).userId
    await db.insertInto('admin_users').values([{ id: adminId, email: 'reviewer@example.test', password_hash: await hashAdminPassword('test-password-long-enough'), role: 'admin' }, { id: viewerId, email: 'viewer@example.test', password_hash: await hashAdminPassword('test-password-long-enough'), role: 'viewer' }]).execute()
    repo = new PostgresDiscoveryRepository(db); explore = new ExploreRepository(db)
  }, 30000)
  afterAll(async () => { await db?.destroy(); await adminPool?.query(`drop schema if exists "${schema}" cascade`); await adminPool?.end() })
  async function createCandidate(suffix: string) {
    const runId = await repo.enqueue(input), claim = await repo.claimRun(runId)
    await repo.finishRun(runId, claim!.attempt, [{ ...template, title: `${template.title} ${suffix}` }], input)
    return (await repo.list({ limit: 1 })).candidates[0]!
  }
  it('keeps drafts private and creates immutable approved versions; expiry is enforced without worker maintenance', async () => {
    const candidate = await createCandidate('visibility')
    await expect(explore.get(candidate.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    const published = await repo.publish(candidate.id, publication(candidate.version), adminId)
    expect((await explore.get(candidate.id)).version).toBe(published.version)
    expect(await repo.versions(candidate.id)).toHaveLength(2)
    await db.updateTable('discovery_candidates').set({ verified_until: new Date(Date.now() - 1000) }).where('public_id', '=', candidate.id).execute()
    await expect(explore.get(candidate.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect((await explore.list({ limit: 50 })).templates.some(t => t.id === candidate.id)).toBe(false)
  })
  it('serializes competing edits and removes published visibility on any content change', async () => {
    const candidate = await createCandidate('conflict'), published = await repo.publish(candidate.id, publication(candidate.version), adminId)
    const results = await Promise.allSettled([repo.save(candidate.id, published.version, { ...template, title: 'First edit' }, adminId), repo.save(candidate.id, published.version, { ...template, title: 'Second edit' }, adminId)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'TEMPLATE_VERSION_CONFLICT' } })
    await expect(explore.get(candidate.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect((await repo.get(candidate.id)).template.verification.status).toBe('unverified')
  })
  it('adopts one inspiration exactly once under concurrent retry and preserves a soft trip intent', async () => {
    const candidate = await createCandidate('seed'), published = await repo.publish(candidate.id, publication(candidate.version), adminId), key = uuidv7()
    const [a, b] = await Promise.all([explore.seed(userId, candidate.id, published.version, key), explore.seed(userId, candidate.id, published.version, key)])
    expect(a).toEqual(b)
    const data = await new PostgresWorkspaceRepository(db, userId).get(a.tripId)
    expect(data.conversationId).toBe(a.conversationId)
    expect(data.messages).toHaveLength(1)
    expect(data.tripContextSummary.destinations.required).toEqual([])
    expect(data.tripContextSummary.destinations.preferred).toHaveLength(1)
    await expect(new PostgresWorkspaceRepository(db, otherId).get(a.tripId)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(explore.seed(userId, candidate.id, published.version - 1, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await repo.transition(candidate.id, published.version, 'unpublish', adminId)
    expect(await explore.seed(userId, candidate.id, published.version, key)).toEqual(a)
    await expect(explore.seed(userId, candidate.id, published.version, uuidv7())).rejects.toMatchObject({ code: 'TEMPLATE_UNAVAILABLE' })
  })
  it('rejects stale workspace writes and hides tools/system messages when restoring a conversation', async () => {
    const trip = await new PostgresTripRepository(db, userId).create({ title: 'Versioned trip' }), r = new PostgresWorkspaceRepository(db, userId), conversations = new PostgresConversationRepository(db, userId)
    const c = await conversations.create({ tripId: trip.id })
    await conversations.appendMessage({ conversationId: c.id, role: 'user', content: 'Visible question' })
    await conversations.appendMessage({ conversationId: c.id, role: 'tool', content: 'Internal payload' })
    await conversations.appendMessage({ conversationId: c.id, role: 'assistant', content: 'Visible answer', metadata: {
      stop_reason: 'max_tool_steps', warnings: ['research_provider_rate_limited', { raw: 'private provider response' }, 'Bearer private-token'],
      tool_traces: [{ raw: 'private tool response' }]
    } })
    const results = await Promise.allSettled([r.update(trip.id, { expectedVersion: 0, title: 'First' }), r.update(trip.id, { expectedVersion: 0, title: 'Second' })])
    expect(results.filter(v => v.status === 'fulfilled')).toHaveLength(1)
    expect((await r.get(trip.id)).messages.map(m => m.content)).toEqual(['Visible question', 'Visible answer'])
    const restoredMessage = (await r.get(trip.id)).messages[1]
    expect(restoredMessage).toMatchObject({ stopReason: 'max_tool_steps', warnings: ['research_provider_rate_limited'] })
    expect(JSON.stringify(restoredMessage)).not.toContain('private')
    await expect(r.update(trip.id, { expectedVersion: 1, savedRoute: { artifactId: uuidv7(), routeId: 'bad' } })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })
  it('deduplicates repeated research and refuses stale regeneration overwrites', async () => {
    const candidate = await createCandidate('dedup'), runId = await repo.enqueue(input), claim = await repo.claimRun(runId)
    expect(await repo.finishRun(runId, claim!.attempt, [candidate.template], input)).toBe(0)
    const targeted = { ...input, candidateId: candidate.id, expectedVersion: candidate.version }
    const regenId = await repo.enqueue(targeted), regen = await repo.claimRun(regenId)
    await repo.save(candidate.id, candidate.version, { ...candidate.template, summary: 'Human edit wins' }, adminId)
    await expect(repo.finishRun(regenId, regen!.attempt, [candidate.template], targeted)).rejects.toMatchObject({ code: 'TEMPLATE_VERSION_CONFLICT' })
    expect((await repo.get(candidate.id)).template.summary).toBe('Human edit wins')
  })
  it('saves only a successful current route and restores its generation run across devices', async () => {
    const trips = new PostgresTripRepository(db, userId), trip = await trips.create({ title: 'Route selection' })
    const runs = new PostgresRouteGenerationRunRepository(db, userId), workspaces = new PostgresWorkspaceRepository(db, userId)
    const from = { id: 'PEK', type: 'airport' as const, name: 'Beijing', countryCode: 'CN', iata: 'PEK' }, to = template.anchorDestinations[0]!
    const path = { id: 'saved-route', nodes: [{ location: from, role: 'origin' as const }, { location: to, role: 'destination' as const }], edges: [{ id: 'route-edge', from, to, departureDate: today, transferType: 'direct' as const, availability: 'verified' as const, verification: { ...verification, status: 'verified' as const, confidence: 1 }, warnings: [], reasons: [], fare: { amount: 100, currency: 'CNY' } }], totalFare: { amount: 100, currency: 'CNY' }, transferCount: 0, feasibility: 'feasible' as const, warnings: [] }
    const optimized = await new ParetoRouteOptimizer().optimize({ paths: [path], weights: {}, preferredLocations: [], interestLocations: [], maxRepresentatives: 3 })
    const artifact = await new PostgresArtifactRepository(db, userId).create({ tripId: trip.id, type: 'route_set', schemaVersion: 1, tripContextVersion: 0, payload: { schemaVersion: 1, kind: 'optimized_routes', serviceVersion: 'qa', algorithmVersion: 'qa', sourceArtifactIds: [], verification, warnings: [], truncated: false, exhausted: false, representatives: optimized.representatives, paretoFrontierCount: 1, rejectedCandidateCount: 0 } })
    await expect(workspaces.update(trip.id, { expectedVersion: 0, savedRoute: { artifactId: artifact.id, routeId: path.id } })).rejects.toMatchObject({ code: 'STALE_ROUTE_SELECTION' })
    const created = await runs.createOrGet({ ownerId: userId, tripId: trip.id, idempotencyKey: 'save-route-qa', requestHash: 'a'.repeat(64), contextVersion: 0, contextSnapshot: trip.context })
    await runs.claim(created.run.id)
    await runs.update(created.run.id, { status: 'succeeded', resultArtifactId: artifact.id, progressStage: 'completed', progressPercent: 100 })
    expect((await workspaces.get(trip.id)).trip.status).toBe('generated')
    const saved = await workspaces.update(trip.id, { expectedVersion: 0, savedRoute: { artifactId: artifact.id, routeId: path.id } })
    expect(saved.status).toBe('saved'); expect(saved.savedRoute?.routeId).toBe(path.id)
    const retry = await workspaces.update(trip.id, { expectedVersion: 0, savedRoute: { artifactId: artifact.id, routeId: path.id } })
    expect(retry).toMatchObject({ version: 1, selectedFlight: { revision: 1, routeId: path.id } })
    const restored = await workspaces.get(trip.id)
    expect(restored.routeGeneration?.id).toBe(created.run.id)
    expect(restored.routeGeneration?.resultArtifactId).toBe(artifact.id)
    await trips.update(trip.id, { notes: ['Changed conditions'] }, 0)
    const edited = await workspaces.get(trip.id)
    expect(edited.routeGeneration?.stale).toBe(true)
    // Replaying an already persisted choice is a no-op, not a fresh adoption.
    for (const expectedVersion of [0, 1]) {
      const replay = await workspaces.update(trip.id, { expectedVersion, savedRoute: { artifactId: artifact.id, routeId: path.id } })
      expect(replay).toMatchObject({ version: 1, contextVersion: 1, selectedFlight: saved.selectedFlight, updatedAt: edited.trip.updatedAt })
      expect(replay.selectedFlight?.contextVersion).toBe(0)
    }
    // Changing preference or adopting again after clearing is a new write and must reject stale sources.
    await expect(workspaces.update(trip.id, { expectedVersion: 1, selectedFlight: {
      kind: 'route', artifactId: artifact.id, routeId: path.id, layoverPreference: 'consider_city'
    } })).rejects.toMatchObject({ code: 'STALE_ROUTE_SELECTION' })
    expect((await workspaces.get(trip.id)).trip.selectedFlight).toEqual(saved.selectedFlight)
    await workspaces.update(trip.id, { expectedVersion: 1, savedRoute: null })
    await expect(workspaces.update(trip.id, { expectedVersion: 2, savedRoute: { artifactId: artifact.id, routeId: path.id } })).rejects.toMatchObject({ code: 'STALE_ROUTE_SELECTION' })
    const after = await workspaces.get(trip.id)
    expect(after.trip).toMatchObject({ version: 2, selectedFlight: null })
    expect(after.routeGeneration?.stale).toBe(true)
  })
  it('persists an exact fare choice idempotently and increments its revision only when the choice changes', async () => {
    const trips = new PostgresTripRepository(db, userId), trip = await trips.create({ title: 'Fare selection' })
    const workspaces = new PostgresWorkspaceRepository(db, userId)
    const artifactId = uuidv7()
    const offer = {
      id: 'offer-live-shaped',
      segments: [
        { flightNumber: 'QA1', airline: 'QA Air', origin: 'PEK', destination: 'DOH', departsAt: '2026-10-02T08:00:00+08:00', arrivesAt: '2026-10-02T13:00:00+03:00', durationMinutes: 600 },
        { flightNumber: 'QA2', airline: 'QA Air', origin: 'DOH', destination: 'LIS', departsAt: '2026-10-02T23:00:00+03:00', arrivesAt: '2026-10-03T06:00:00+01:00', durationMinutes: 540 }
      ],
      layovers: [{ afterSegmentIndex: 0, airport: 'DOH', durationMinutes: 600 }],
      totalAmount: 4500, currency: 'CNY', totalDurationMinutes: 1740, airlines: ['QA Air'], transferType: 'airline' as const
    }
    const artifact = await new PostgresArtifactRepository(db, userId).create({
      id: artifactId, tripId: trip.id, type: 'flight_search', schemaVersion: 1, tripContextVersion: 0,
      payload: { id: artifactId, type: 'flight_search', query: { origin: 'PEK', destination: 'LIS', departureDate: '2026-10-02', currency: 'CNY', travelClass: 1 }, offers: [offer], provider: 'fixture', checkedAt: new Date().toISOString(), verification }
    })
    const choice = { kind: 'offer' as const, artifactId: artifact.id, offerId: offer.id, layoverPreference: 'airport_only' as const }
    const first = await workspaces.update(trip.id, { expectedVersion: 0, selectedFlight: choice })
    expect(first).toMatchObject({ version: 1, selectedFlight: { ...choice, revision: 1, contextVersion: 0 } })
    const retry = await workspaces.update(trip.id, { expectedVersion: 0, selectedFlight: choice })
    expect(retry).toMatchObject({ version: 1, selectedFlight: { revision: 1 } })
    const changed = await workspaces.update(trip.id, { expectedVersion: 1, selectedFlight: { ...choice, layoverPreference: 'consider_city' } })
    expect(changed).toMatchObject({ version: 2, selectedFlight: { revision: 2, layoverPreference: 'consider_city' } })
    expect((await workspaces.getSelectedFlight(trip.id))?.layoverWindows[0]).toMatchObject({ arrivalAirport: 'DOH', selectedMode: 'conditional_city' })
    await expect(new PostgresWorkspaceRepository(db, otherId).update(trip.id, { expectedVersion: 2, selectedFlight: choice })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(workspaces.update(trip.id, { expectedVersion: 2, selectedFlight: { ...choice, offerId: 'missing' } })).rejects.toMatchObject({ code: 'INVALID_FLIGHT_SELECTION' })
  })
  it('separates consumer/editorial tokens, enforces role checks, and revokes logout tokens', async () => {
    const env = parseEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://test', JWT_SECRET: 'editorial-integration-test-secret-at-least-32-characters' })
    const app = await buildApp({ db, env, redis: undefined as unknown as Redis, providers: createProviders(env) })
    try {
      const consumer = await issueAccessToken({ userId, publicId: uuidv7() }, env)
      const viewer = await issueAdminToken({ id: viewerId, email: 'viewer@example.test', role: 'viewer', tokenVersion: 0 }, env.JWT_SECRET)
      const editor = await issueAdminToken({ id: adminId, email: 'reviewer@example.test', role: 'admin', tokenVersion: 0 }, env.JWT_SECRET)
      expect((await app.inject({ url: '/v1/admin/templates', headers: { authorization: `Bearer ${consumer}` } })).statusCode).toBe(401)
      expect((await app.inject({ url: '/v1/trips', headers: { authorization: `Bearer ${editor}` } })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', url: '/v1/admin/discovery/runs', payload: input, headers: { authorization: `Bearer ${viewer}` } })).statusCode).toBe(403)
      expect((await app.inject({ url: '/v1/admin/templates', headers: { authorization: `Bearer ${viewer}` } })).statusCode).toBe(200)
      expect((await app.inject({ method: 'POST', url: '/v1/admin/auth/logout', payload: {}, headers: { authorization: `Bearer ${editor}` } })).statusCode).toBe(200)
      expect((await app.inject({ url: '/v1/admin/me', headers: { authorization: `Bearer ${editor}` } })).statusCode).toBe(401)
      const login = await app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email: 'reviewer@example.test', password: 'wrong' } })
      expect(login.statusCode).toBe(401)
    } finally { await app.close() }
  }, 15000)
})
