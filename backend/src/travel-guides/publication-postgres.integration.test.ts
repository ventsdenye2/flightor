import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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
import { createArtifactWorkspace, saveWorkspaceArtifact } from '../artifacts/workspace.js'
import { presentArtifact } from '../artifacts/presentation.js'
import { publicationFor, projectGuideRecord } from './publication.js'
import { PostgresWorkspaceRepository } from '../workspaces/postgres.js'
import { validateGuideContent } from './validation.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { tripRoutePlanPayloadSchema } from '../trip-planning/types.js'
import { researchArtifactSchema } from '../research-agent/types.js'
import { GuideFinalizer, sourceRef } from './finalization.js'

type Sample = {
  id: string
  goalParameters: { maxResults: number; maxCities: number; researchTypes: any[]; requiredEvidenceTypes?: any[]; allowPartial: boolean }
  legacy: {
    artifact: any
    researchArtifacts: Array<{ id: string; schemaVersion: number; payload: any; tripContextVersion: number }>
    routeArtifact: { id: string; schemaVersion: number; payload: any; verification?: any }
    selectedFlightArtifact?: { id: string; schemaVersion: number; payload: any; tripContextVersion: number }
  }
}

const samples = JSON.parse(readFileSync(new URL('../../test/fixtures/g1-publication-v1-original-samples.json', import.meta.url), 'utf8')) as { cases: Sample[] }
const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
const origin = { id: 'airport:PEK', type: 'airport' as const, name: 'Beijing Capital International Airport', countryCode: 'CN', iata: 'PEK', cityCode: 'BJS' }

suite('PostgreSQL G1 publication v1 original sample copies', () => {
  const schema = `publication_samples_${process.pid}_${Date.now()}`
  let adminPool: pg.Pool
  let pool: pg.Pool
  let recoveryPool: pg.Pool
  let recoveryDb: Kysely<Database>
  let db: Kysely<Database>
  let ownerId = ''

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl })
    await adminPool.query(`create schema "${schema}"`)
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 8 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    recoveryPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: `${schema}-recovery`, max: 2 })
    recoveryDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: recoveryPool }) })
    await createInitialSchema(db)
    await createCloudStateSchema(db)
    await createRouteGenerationSchema(db)
    await createWorkspaceSchema(db)
    await createPlanningGoalsSchema(db)
    ownerId = (await new PostgresUserIdentityRepository(db).resolveWechat({ providerSubject: `${schema}-owner`, nickname: 'Publication fixture', avatarUrl: '' })).userId
  }, 30_000)

  afterAll(async () => {
    await recoveryDb?.destroy()
    await db?.destroy()
    await adminPool?.query(`drop schema if exists "${schema}" cascade`)
    await adminPool?.end()
  })

  async function copySample(sample: Sample) {
    const startedAt = performance.now()
    const legacy = sample.legacy.artifact
    const payload = legacy.payload
    const city = payload.days[0].city
    const trips = new PostgresTripRepository(db, ownerId)
    const trip = await trips.create({ initialContext: {
      origin, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] },
      departureWindow: { from: '2026-10-20', to: '2026-10-20', precision: 'exact' }, travelDays: 2,
      budget: payload.budget ? { amount: payload.budget.amount, currency: payload.budget.currency, scope: payload.budget.scope } : undefined,
      interests: ['文化', '小吃']
    } })
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    for (const research of sample.legacy.researchArtifacts) {
      await artifacts.create({ id: research.id, tripId: trip.id, tripContextVersion: trip.context.version, type: 'research', schemaVersion: research.schemaVersion, payload: research.payload })
    }
    const routeId = payload.routeArtifactId as string
    await artifacts.create({ id: routeId, tripId: trip.id, tripContextVersion: trip.context.version, type: 'route', schemaVersion: sample.legacy.routeArtifact.schemaVersion,
      payload: sample.legacy.routeArtifact.payload, verification: sample.legacy.routeArtifact.verification })
    const workspace = new PostgresWorkspaceRepository(db, ownerId)
    let selectedFlight: Awaited<ReturnType<PostgresWorkspaceRepository['getSelectedFlight']>> = null
    if (sample.legacy.selectedFlightArtifact) {
      const flight = sample.legacy.selectedFlightArtifact
      await artifacts.create({ id: flight.id, tripId: trip.id, tripContextVersion: trip.context.version, type: 'flight_search', schemaVersion: flight.schemaVersion, payload: flight.payload })
      const offerId = flight.payload.offers?.[0]?.id
      const updated = await workspace.update(trip.id, { expectedVersion: (await workspace.get(trip.id)).trip.version,
        selectedFlight: { kind: 'offer', artifactId: flight.id, offerId, layoverPreference: 'airport_only' } })
      selectedFlight = updated.selectedFlight ? await workspace.getSelectedFlight(trip.id) : null
    }
    const conversation = await new PostgresConversationRepository(db, ownerId).create({ tripId: trip.id, title: `${sample.id} publication copy` })
    const scope = await createArtifactWorkspace({ artifacts, trips, ownerId, tripId: trip.id, conversationId: conversation.id, ...(selectedFlight ? { selectedFlight } : {}) })
    const saveStartedAt = performance.now()
    const saved = await saveWorkspaceArtifact(scope, { id: uuidv7(), type: 'travel_guide', schemaVersion: 1, payload, verification: payload.verification, sourceArtifactIds: payload.sourceArtifactIds })
    const saveMs = performance.now() - saveStartedAt
    const validationStartedAt = performance.now()
    const guide = travelGuideArtifactPayloadSchema.parse(saved.payload)
    const route = tripRoutePlanPayloadSchema.parse(sample.legacy.routeArtifact.payload)
    const research = new Map(sample.legacy.researchArtifacts.map(value => [value.id, researchArtifactSchema.parse(value.payload)]))
    const domainValidation = validateGuideContent({ guide, route, research, trip: trip.context, constraints: sample.goalParameters })
    expect(domainValidation.status).toBe('satisfied')
    console.log(JSON.stringify({ fixture: sample.id, domainValidation: { status: domainValidation.status, missing: domainValidation.missing } }))
    return { legacy, saved, artifacts, trip, conversation, workspace,
      timing: { setupMs: saveStartedAt - startedAt, saveMs, domainValidationMs: performance.now() - validationStartedAt } }
  }

  it.each(samples.cases)('keeps $id legacy data separate from a current publication copy', async sample => {
    const legacyRecord = { ...sample.legacy.artifact, payload: sample.legacy.artifact.payload }
    expect(publicationFor(legacyRecord)?.legacy).toBe(true)
    expect(projectGuideRecord(legacyRecord).payload.publication.legacy).toBe(true)
    const test = await copySample(sample)
    expect(test.saved.id).not.toBe(legacyRecord.id)
    const restored = await test.artifacts.get(test.saved.id)
    expect(restored).toBeDefined()
    const beforeRecovery = presentArtifact(test.saved)
    const rereadStartedAt = performance.now()
    const rereadFromIndependentConnection = await new PostgresArtifactRepository(recoveryDb, ownerId).get(test.saved.id)
    expect(rereadFromIndependentConnection).toBeDefined()
    const publicRecord = presentArtifact(rereadFromIndependentConnection!)
    expect(publicRecord).toEqual(beforeRecovery)
    const independentRereadProjectionMs = performance.now() - rereadStartedAt
    const workspaceStartedAt = performance.now()
    const publicPayload = publicRecord.payload as any
    expect(publicPayload.publication).toMatchObject({ version: 1, legacy: false, contentContract: 'limited', evidenceCoverage: 'partial' })
    expect(publicPayload.publication.budgetAssessment).toMatchObject({ status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete' })
    expect(publicPayload.budget).toEqual(legacyRecord.payload.budget)
    expect(publicPayload.publication.guideContentHash).toMatch(/^[a-f0-9]{64}$/)
    if (sample.legacy.selectedFlightArtifact) {
      expect(publicPayload.flightSelection).toMatchObject({ revision: 1, artifactId: sample.legacy.selectedFlightArtifact.id })
      expect(publicPayload.publication.flightSelectionRevision).toBe(1)
      expect((await test.workspace.get(test.trip.id, test.conversation.id)).trip.selectedFlight).toMatchObject({ revision: 1 })
    } else {
      expect(publicPayload.flightSelection).toBeUndefined()
      expect(publicPayload.publication.flightSelectionRevision).toBeUndefined()
    }
    const recoveredWorkspace = await new PostgresWorkspaceRepository(recoveryDb, ownerId).get(test.trip.id, test.conversation.id)
    expect(recoveredWorkspace.trip.id).toBe(test.trip.id)
    expect(recoveredWorkspace.artifactRefs.some(ref => ref.id === test.saved.id)).toBe(true)
    if (sample.legacy.selectedFlightArtifact) expect(recoveredWorkspace.trip.selectedFlight).toMatchObject({ revision: 1 })
    const workspaceRecoveryMs = performance.now() - workspaceStartedAt
    console.log(JSON.stringify({ fixture: sample.id, timingMs: { ...test.timing, independentRereadProjectionMs, workspaceRecoveryMs } }))
    expect(JSON.stringify(test.legacy.payload)).toContain('planningNote')
    // Publication-only persistence after completion, independent connection and language.
    const guide = travelGuideArtifactPayloadSchema.parse(test.saved.payload)
    // Bind the new draft id using the normal workspace save boundary.
    const trips = new PostgresTripRepository(db, ownerId)
    const selectedFlight = await test.workspace.getSelectedFlight(test.trip.id)
    const scope = await createArtifactWorkspace({ artifacts: test.artifacts, trips, tripId: test.trip.id,
      requireGuideFinalization: true, ...(selectedFlight ? { selectedFlight } : {}) })
    const saved = await saveWorkspaceArtifact(scope, { type: 'travel_guide', schemaVersion: 1, payload: guide, sourceArtifactIds: guide.sourceArtifactIds })
    expect((presentArtifact(saved).payload as any).days).toEqual([])
    const publication = publicationFor(saved)!
    const variants = await Promise.all((['zh', 'en'] as const).map(async locale => {
      const text = { locale,
        reply: locale === 'zh' ? '东京文化行程终稿已准备好，可以按每日主题查看安排。' : 'Your Tokyo cultural itinerary is ready to explore by daily theme.',
        overview: locale === 'zh' ? '按照既定节奏游览，感受传统文化与街区氛围。' : 'Explore traditional culture and the neighborhood atmosphere at the planned pace.',
        days: guide.days.map(day => ({ day: day.day, theme: locale === 'zh' ? '文化漫游' : 'Cultural walk' })),
        activities: guide.days.flatMap(day => day.items).map(item => ({ activityId: item.id, name: item.title,
          introduction: locale === 'zh' ? '沿着原定路线漫步，感受这片街区的文化氛围。' : 'Walk the planned route and appreciate the cultural atmosphere of the neighborhood.',
          recommendationReason: locale === 'zh' ? '这段游览回应文化兴趣，并保留轻松的旅行节奏。' : 'This visit responds to your cultural interests at a relaxed pace.', sourceRefs: [sourceRef(item)] })) }
      const variant = await new GuideFinalizer({ complete: async () => ({ message: { role: 'assistant', content: JSON.stringify({ text, issues: [] }) } }) })
        .generate({ locale, guide, accepted: text, research: [], requirements: null })
      expect(variant.status).toBe('accepted')
      return { locale, variant }
    }))
    const english = variants.find(value => value.locale === 'en')!.variant
    const failure = { ...english, status: 'blocked' as const, text: null,
      issues: [{ activityId: null, code: 'timeout' as const, detail: 'Initial localization timed out.' }],
      observation: { ...english.observation, knownCostUsdMicros: 17, failure: 'timeout' } }
    await Promise.all(variants.map(({ locale, variant }) => test.artifacts.saveFinalVariant(saved.id, publication.guideContentHash, locale, locale === 'en' ? failure : variant)))
    const recoveryArtifacts = new PostgresArtifactRepository(recoveryDb, ownerId)
    const retries = await Promise.allSettled([
      test.artifacts.saveFinalVariant(saved.id, publication.guideContentHash, 'en', { ...english, revision: 2 }),
      recoveryArtifacts.saveFinalVariant(saved.id, publication.guideContentHash, 'en', { ...english, revision: 2 })
    ])
    expect(retries.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(retries.filter(value => value.status === 'rejected')).toHaveLength(1)
    await expect(recoveryArtifacts.saveFinalVariant(saved.id, publication.guideContentHash, 'en', failure)).rejects.toThrow('attempt changed')
    const fresh = (await new PostgresArtifactRepository(recoveryDb, ownerId).get(saved.id))!
    expect(publicationFor(fresh)?.finalization?.variants.zh?.status).toBe('accepted')
    expect(publicationFor(fresh)?.finalization?.variants.en?.status).toBe('accepted')
    expect(publicationFor(fresh)?.finalization?.variants.en?.history?.[0]?.observation.knownCostUsdMicros).toBe(17)
    expect(publicationFor(fresh)?.finalization?.variants.en?.revision).toBe(2)
    expect((fresh.payload as any).days).toEqual(guide.days)
    expect((await trips.get(test.trip.id))?.version).toBe(test.trip.context.version)
    expect(await new PostgresArtifactRepository(recoveryDb, '0').get(saved.id)).toBeUndefined()
    await expect(test.artifacts.saveFinalVariant(saved.id, '0'.repeat(64), 'zh', variants[0]!.variant)).rejects.toThrow('Guide content changed')
    await trips.update(test.trip.id, { interests: ['updated'] }, test.trip.context.version)
    await expect(test.artifacts.saveFinalVariant(saved.id, publication.guideContentHash, 'zh', variants[0]!.variant)).rejects.toThrow('Trip changed')
  })
})
