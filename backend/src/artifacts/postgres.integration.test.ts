import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { up as createInitialSchema } from '../db/migrations/001_initial.js'
import { up as createCloudStateSchema } from '../db/migrations/006_cloud_state.js'
import { up as createPlanningGoalsSchema } from '../db/migrations/010_planning_goals.js'
import type { Database } from '../db/types.js'
import { PostgresUserIdentityRepository } from '../identity/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'
import { PostgresArtifactRepository } from './postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('PostgreSQL atomic Artifact writes', () => {
  const schema = `artifact_writes_${process.pid}_${Date.now()}`
  let adminPool: pg.Pool
  let pool: pg.Pool
  let db: Kysely<Database>
  let ownerId = ''

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl })
    await adminPool.query(`create schema "${schema}"`)
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 8 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    await createInitialSchema(db)
    await createCloudStateSchema(db)
    await createPlanningGoalsSchema(db)
    ownerId = (await new PostgresUserIdentityRepository(db).resolveWechat({ providerSubject: schema, nickname: 'Artifact consistency', avatarUrl: '' })).userId
  }, 30_000)

  afterAll(async () => {
    await db?.destroy()
    await adminPool?.query(`drop schema if exists "${schema}" cascade`)
    await adminPool?.end()
  })

  async function waitForBlockedWrite() {
    await expect.poll(async () => {
      const result = await adminPool.query<{ blocked: boolean }>(
        'select exists (select 1 from pg_stat_activity where application_name = $1 and wait_event_type = $2) as blocked',
        [schema, 'Lock']
      )
      return result.rows[0]?.blocked
    }, { timeout: 3_000, interval: 10 }).toBe(true)
  }

  it('rechecks the Trip version under a row lock after an overlapping context update commits', async () => {
    const trips = new PostgresTripRepository(db, ownerId)
    const trip = await trips.create({ initialContext: { travelDays: 5 } })
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const blocker = await pool.connect()
    let committed = false
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('begin')
      await blocker.query('insert into trip_context_versions (trip_id, version, context_json) select id, 1, $2::jsonb from trips where public_id = $1', [trip.id, JSON.stringify({ ...trip.context, version: 1, travelDays: 10 })])
      // This takes a non-key-update lock, which an ordinary SELECT would bypass.
      await blocker.query('update trips set current_context_version = 1 where public_id = $1', [trip.id])
      pending = artifacts.create({ tripId: trip.id, tripContextVersion: 0, type: 'route', schemaVersion: 1, payload: { tripContextVersion: 0 } })
        .then(value => ({ value }), error => ({ error }))
      await waitForBlockedWrite()
      await blocker.query('commit')
      committed = true
      await expect(pending).resolves.toMatchObject({ error: { code: 'TRIP_CONTEXT_VERSION_CONFLICT' } })
      expect(await artifacts.listForTrip(trip.id)).toEqual([])
    } finally {
      if (!committed) await blocker.query('rollback')
      blocker.release()
      await pending
    }
  })

  it.each(['goal', 'run'] as const)('blocks late writes when concurrent %s cancellation commits', async target => {
    const trip = await new PostgresTripRepository(db, ownerId).create()
    const goals = new PostgresGoalRepository(db, ownerId)
    const runs = new PostgresGoalRunRepository(db, ownerId)
    const { goal } = await goals.create({ tripId: trip.id, kind: 'flight_search', parameters: { requestKey: target }, createdContextVersion: 0, idempotencyKey: target })
    const { run } = await runs.create({ goalId: goal.id, tripId: trip.id, generationId: target, contextVersion: 0, contextSnapshot: trip.context, idempotencyKey: target })
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const blocker = await pool.connect()
    let committed = false
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('begin')
      const table = target === 'goal' ? 'planning_goals' : 'planning_goal_runs'
      await blocker.query(`update ${table} set status = 'cancelled' where public_id = $1`, [target === 'goal' ? goal.id : run.id])
      pending = artifacts.create({ tripId: trip.id, goalId: goal.id, runId: run.id, tripContextVersion: 0, type: 'flight_search', schemaVersion: 1, payload: {} })
        .then(value => ({ value }), error => ({ error }))
      await waitForBlockedWrite()
      await blocker.query('commit')
      committed = true
      await expect(pending).resolves.toMatchObject({ error: { code: target === 'goal' ? 'GOAL_NOT_RUNNABLE' : 'GOAL_RUN_NOT_ACTIVE' } })
      expect(await artifacts.listForTrip(trip.id)).toEqual([])
    } finally {
      if (!committed) await blocker.query('rollback')
      blocker.release()
      await pending
    }
  })

  it('rejects incompatible source versions atomically and keeps historical records readable', async () => {
    const trips = new PostgresTripRepository(db, ownerId)
    const trip = await trips.create()
    const artifacts = new PostgresArtifactRepository(db, ownerId)
    const legacy = await artifacts.create({ tripId: trip.id, type: 'research', schemaVersion: 2, payload: {} })
    const prior = await artifacts.create({ tripId: trip.id, tripContextVersion: 0, type: 'research', schemaVersion: 2, payload: {} })
    await trips.update(trip.id, { travelDays: 10 }, 0)
    const successor = { tripId: trip.id, tripContextVersion: 1, type: 'travel_guide' as const, schemaVersion: 1, payload: {} }
    await expect(artifacts.create({ ...successor, sourceArtifactIds: [legacy.id] })).rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISSING' })
    await expect(artifacts.create({ ...successor, sourceArtifactIds: [prior.id] })).rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
    expect(await artifacts.get(prior.id)).toMatchObject({ tripContextVersion: 0 })
    const current = await artifacts.create({ tripId: trip.id, tripContextVersion: 1, type: 'research', schemaVersion: 2, payload: {} })
    await expect(artifacts.create({ ...successor, sourceArtifactIds: [current.id] })).resolves.toMatchObject({ tripContextVersion: 1, sourceArtifactIds: [current.id] })
  })
})
