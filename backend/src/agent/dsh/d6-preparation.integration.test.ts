import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { up as initial } from '../../db/migrations/001_initial.js'
import { up as cloud } from '../../db/migrations/006_cloud_state.js'
import { up as routeRuns } from '../../db/migrations/007_route_generation_runs.js'
import { up as workspaceSchema } from '../../db/migrations/008_trip_workspace.js'
import { up as goalsSchema } from '../../db/migrations/010_planning_goals.js'
import type { Database } from '../../db/types.js'
import { PostgresArtifactRepository } from '../../artifacts/postgres.js'
import { createArtifactWorkspace, saveWorkspaceArtifact } from '../../artifacts/workspace.js'
import { PostgresConversationRepository } from '../../conversations/postgres.js'
import { PostgresUserIdentityRepository } from '../../identity/postgres.js'
import { PostgresTripRepository } from '../../trips/postgres.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { GuideFinalizer, sourceRef } from '../../travel-guides/finalization.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { prepareDshSnapshot } from './preparation.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
const city = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }

suite('D6 DSH preparation and PostgreSQL publication CAS', () => {
  const schema = `d6_preparation_${randomUUID().replaceAll('-', '')}`
  let admin: pg.Pool
  let pool: pg.Pool
  let recoveryPool: pg.Pool
  let db: Kysely<Database>
  let recoveryDb: Kysely<Database>
  let ownerId = ''

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl })
    await admin.query(`create schema "${schema}"`)
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 8 })
    recoveryPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: `${schema}_recovery`, max: 2 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    recoveryDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: recoveryPool }) })
    for (const migrate of [initial, cloud, routeRuns, workspaceSchema, goalsSchema]) await migrate(db)
    ownerId = (await new PostgresUserIdentityRepository(db).resolveWechat({
      providerSubject: `${schema}-owner`, nickname: 'D6 preparation test', avatarUrl: ''
    })).userId
  }, 30_000)

  afterAll(async () => {
    await recoveryDb?.destroy()
    await db?.destroy()
    await admin?.query(`drop schema if exists "${schema}" cascade`)
    await admin?.end()
  })

  async function waitForTripLockWait() {
    await expect.poll(async () => {
      const result = await admin.query<{ blocked: boolean }>(
        'select exists (select 1 from pg_stat_activity where application_name = $1 and wait_event_type = $2) as blocked',
        [schema, 'Lock']
      )
      return result.rows[0]?.blocked
    }, { timeout: 3_000, interval: 10 }).toBe(true)
  }

  async function createTrip() {
    const trip = await new PostgresTripRepository(db, ownerId).create({
      initialContext: { travelDays: 1, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] } }
    })
    const conversation = await new PostgresConversationRepository(db, ownerId).create({ tripId: trip.id, title: 'D6 preparation test' })
    return { trip, conversation }
  }

  async function createGuide(tripId: string, conversationId: string, suffix: string,
    selection?: { artifactId: string; offerId: string; revision: number; selectedAt: string }) {
    const trips = new PostgresTripRepository(db, ownerId)
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const sourceId = randomUUID()
    await artifacts.create({ id: sourceId, tripId, conversationId, tripContextVersion: 0,
      type: 'research', schemaVersion: 2, payload: { fixture: 'source' } })
    const payload = travelGuideArtifactPayloadSchema.parse({
      kind: 'trip_travel_guide', schemaVersion: 1, builderVersion: 'd6-integration',
      sourceArtifactIds: [sourceId], routeArtifactId: randomUUID(),
      ...(selection ? { flightSelection: { kind: 'offer', artifactId: selection.artifactId,
        choiceId: selection.offerId, revision: selection.revision, selectedAt: selection.selectedAt } } : {}),
      days: [{ day: 1, city, kind: 'visit', theme: 'Tokyo culture', items: [{
        id: `activity-${suffix}`, city, title: `Tokyo cultural walk ${suffix}`, description: 'Visit a cultural area at a relaxed pace.',
        reason: 'interest_match', category: 'activity', sourceArtifactId: sourceId, sourceFindingId: `finding-${suffix}`,
        timeOfDay: 'morning', verification: { status: 'unverified', confidence: 0, checkedAt: new Date().toISOString(), sources: [] }
      }] }],
      unassignedActivityRefs: [],
      verification: { status: 'unverified', confidence: 0, checkedAt: new Date().toISOString(), sources: [] },
      warnings: [], createdAt: new Date().toISOString()
    })
    const scope = await createArtifactWorkspace({ ownerId, trips, artifacts, tripId, conversationId, requireGuideFinalization: true })
    const record = await saveWorkspaceArtifact(scope, { type: 'travel_guide', schemaVersion: 1, payload, sourceArtifactIds: [sourceId] })
    const guide = travelGuideArtifactPayloadSchema.parse(record.payload)
    const publication = publicationFor(record)!
    const text = {
      locale: 'en' as const,
      reply: 'Your Tokyo cultural itinerary is ready to explore.',
      overview: 'Explore Tokyo cultural areas at a relaxed pace.',
      days: guide.days.map(day => ({ day: day.day, theme: 'Cultural walk' })),
      activities: guide.days.flatMap(day => day.items).map(item => ({
        activityId: item.id, name: item.title,
        introduction: 'Walk through the area and explore its cultural setting at a relaxed pace.',
        recommendationReason: 'This visit matches the requested cultural interests and relaxed pace.',
        sourceRefs: [sourceRef(item)]
      }))
    }
    const variant = await new GuideFinalizer({ complete: async () => ({
      message: { role: 'assistant', content: JSON.stringify({ text, issues: [] }) }
    }) }).generate({ locale: 'en', guide, accepted: text, research: [], requirements: null })
    expect(variant.status).toBe('accepted')
    return { record, publication, variant, artifacts }
  }

  async function makeAccepted(tripId: string, conversationId: string, suffix: string,
    selection?: { artifactId: string; offerId: string; revision: number; selectedAt: string }) {
    const guide = await createGuide(tripId, conversationId, suffix, selection)
    const saved = await guide.artifacts.saveFinalVariant(guide.record.id, guide.publication.guideContentHash,
      'en', guide.variant)
    return { ...guide, record: saved, base: { id: saved.id, contentHash: guide.publication.guideContentHash, locale: 'en' as const } }
  }

  it('captures the exact accepted guide from preparation and rejects a waiting edit after a concurrent winner publishes', async () => {
    const { trip, conversation } = await createTrip()
    const first = await makeAccepted(trip.id, conversation.id, 'first')
    const prepared = prepareDshSnapshot({ trip: trip.context, records: await first.artifacts.listForTrip(trip.id),
      conversationId: conversation.id, selectedFlight: null, locale: 'en' })
    expect(prepared.baseGuide).toEqual(first.base)

    const staleDraft = await createGuide(trip.id, conversation.id, 'stale-edit')
    const winner = await createGuide(trip.id, conversation.id, 'winner')
    const blocker = await pool.connect()
    let committed = false
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('begin')
      await blocker.query('select id from trips where public_id = $1 for update', [trip.id])
      pending = staleDraft.artifacts.saveFinalVariant(staleDraft.record.id, staleDraft.publication.guideContentHash,
        'en', staleDraft.variant, undefined, first.base).then(value => ({ value }), error => ({ error }))
      await waitForTripLockWait()

      const winnerPayload = winner.record.payload as Record<string, unknown>
      const publication = winnerPayload.publication as Record<string, unknown>
      const persisted = { ...winnerPayload, publication: { ...publication,
        finalization: { version: 1, variants: { en: winner.variant } } } }
      await blocker.query('update artifacts set payload_json = $1::jsonb, created_at = clock_timestamp() where public_id = $2',
        [JSON.stringify(persisted), winner.record.id])
      await blocker.query('commit')
      committed = true
      await expect(pending).resolves.toMatchObject({ error: { code: 'PUBLICATION_CONTENT_CHANGED' } })
      const recovery = new PostgresArtifactRepository(recoveryDb, ownerId)
      expect(publicationFor((await recovery.get(winner.record.id))!)?.finalization?.variants.en?.status).toBe('accepted')
      expect(publicationFor((await recovery.get(staleDraft.record.id))!)?.finalization?.variants.en).toBeUndefined()
    } finally {
      if (!committed) await blocker.query('rollback')
      blocker.release()
      await pending
    }
  }, 30_000)

  it('rechecks Trip context and selected-flight revisions after waiting for the locked Trip row', async () => {
    const { trip, conversation } = await createTrip()
    const accepted = await makeAccepted(trip.id, conversation.id, 'base')
    const staleTripDraft = await createGuide(trip.id, conversation.id, 'trip-stale')
    const blocker = await pool.connect()
    let committed = false
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('begin')
      await blocker.query('select id from trips where public_id = $1 for update', [trip.id])
      const changedContext = { ...trip.context, version: trip.context.version + 1, interests: ['updated during generation'] }
      await blocker.query('insert into trip_context_versions (trip_id, version, context_json) select id, $2, $3::jsonb from trips where public_id = $1',
        [trip.id, changedContext.version, JSON.stringify(changedContext)])
      await blocker.query('update trips set current_context_version = $2 where public_id = $1', [trip.id, changedContext.version])
      pending = staleTripDraft.artifacts.saveFinalVariant(staleTripDraft.record.id, staleTripDraft.publication.guideContentHash,
        'en', staleTripDraft.variant, undefined, accepted.base).then(value => ({ value }), error => ({ error }))
      await waitForTripLockWait()
      await blocker.query('commit')
      committed = true
      await expect(pending).resolves.toMatchObject({ error: { code: 'PUBLICATION_CONTENT_CHANGED' } })
    } finally {
      if (!committed) await blocker.query('rollback')
      blocker.release()
      await pending
    }

    const { trip: flightTrip, conversation: flightConversation } = await createTrip()
    const flightId = randomUUID()
    const selection = { kind: 'offer', artifactId: flightId, offerId: 'offer-one', layoverPreference: 'airport_only',
      contextVersion: 0, revision: 1, selectedAt: new Date().toISOString() }
    await db.updateTable('trips').set({ saved_route_json: JSON.stringify(selection) })
      .where('public_id', '=', flightTrip.id).execute()
    const flightBase = await makeAccepted(flightTrip.id, flightConversation.id, 'flight-base', selection)
    const flightDraft = await createGuide(flightTrip.id, flightConversation.id, 'flight-stale', selection)
    const flightBlocker = await pool.connect()
    let flightCommitted = false
    let flightPending: Promise<unknown> | undefined
    try {
      await flightBlocker.query('begin')
      await flightBlocker.query('select id from trips where public_id = $1 for update', [flightTrip.id])
      flightPending = flightDraft.artifacts.saveFinalVariant(flightDraft.record.id, flightDraft.publication.guideContentHash,
        'en', flightDraft.variant, undefined, flightBase.base).then(value => ({ value }), error => ({ error }))
      await waitForTripLockWait()
      await flightBlocker.query('update trips set saved_route_json = $2::jsonb where public_id = $1', [flightTrip.id,
        JSON.stringify({ ...selection, artifactId: randomUUID(), offerId: 'offer-two', revision: 2 })])
      await flightBlocker.query('commit')
      flightCommitted = true
      await expect(flightPending).resolves.toMatchObject({ error: { code: 'PUBLICATION_CONTENT_CHANGED' } })

      const recovery = await new PostgresArtifactRepository(recoveryDb, ownerId).get(flightBase.record.id)
      expect(publicationFor(recovery!)?.finalization?.variants.en?.status).toBe('accepted')
      await expect(new PostgresArtifactRepository(recoveryDb, ownerId).saveFinalVariant(flightBase.record.id,
        flightBase.publication.guideContentHash, 'en', flightBase.variant)).rejects.toMatchObject({ code: 'PUBLICATION_ATTEMPT_CHANGED' })
      expect((await new PostgresArtifactRepository(recoveryDb, ownerId).get(flightBase.record.id))?.updatedAt).toBe(flightBase.record.updatedAt)
    } finally {
      if (!flightCommitted) await flightBlocker.query('rollback')
      flightBlocker.release()
      await flightPending
    }
  }, 30_000)
})
