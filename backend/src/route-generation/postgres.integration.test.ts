import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { up as createInitialSchema } from '../db/migrations/001_initial.js'
import { up as createCloudStateSchema } from '../db/migrations/006_cloud_state.js'
import { up as createRouteGenerationSchema } from '../db/migrations/007_route_generation_runs.js'
import { up as createPlanningGoalsSchema } from '../db/migrations/010_planning_goals.js'
import { up as createRouteGoalLineageSchema } from '../db/migrations/011_route_generation_goal_lineage.js'
import type { Database } from '../db/types.js'
import { PostgresUserIdentityRepository } from '../identity/postgres.js'
import { claimNextJob, failJob, heartbeatJob, recoverStaleJobs } from '../jobs/repository.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import type { Trip } from '../trips/repository.js'
import type { TripContext } from '../trips/types.js'
import { PostgresRouteGenerationRunRepository } from './repository.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
const origin = { id: 'airport-pek', type: 'airport' as const, name: 'Beijing', countryCode: 'CN', iata: 'PEK' }
const destination = { id: 'airport-cdg', type: 'airport' as const, name: 'Paris', countryCode: 'FR', iata: 'CDG' }

suite('Phase 5 PostgreSQL route-generation concurrency', () => {
  const schema = `phase5_${process.pid}_${Date.now()}`
  let adminPool: pg.Pool
  let pool: pg.Pool
  let db: Kysely<Database>
  let userId = ''

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl })
    await adminPool.query(`create schema "${schema}"`)
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 8 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    await createInitialSchema(db)
    await createCloudStateSchema(db)
    await createRouteGenerationSchema(db)
    await createPlanningGoalsSchema(db)
    await createRouteGoalLineageSchema(db)
    const identity = await new PostgresUserIdentityRepository(db).resolveWechat({
      providerSubject: `phase5-${schema}`, nickname: 'Phase 5', avatarUrl: ''
    })
    userId = identity.userId
  }, 30_000)

  afterAll(async () => {
    await db?.destroy()
    await adminPool?.query(`drop schema if exists "${schema}" cascade`)
    await adminPool?.end()
  })
  beforeEach(async () => {
    // These tests claim the next job. Do not let a cancelled run's unused job
    // from an earlier test replace the run the current test intends to verify.
    await db.deleteFrom('jobs').execute()
  })

  async function createTrip(): Promise<Trip> {
    return new PostgresTripRepository(db, userId).create({ initialContext: {
      origin,
      departureWindow: { from: '2026-10-01', precision: 'approximate' },
      destinationIntent: { mode: 'explicit', required: [destination], preferred: [], excluded: [] }
    } })
  }

  async function createRun(trip: Trip, key: string) {
    return new PostgresRouteGenerationRunRepository(db, userId).createOrGet({
      ownerId: userId,
      tripId: trip.id,
      idempotencyKey: key,
      requestHash: key.padEnd(64, '0').slice(0, 64),
      contextVersion: trip.currentContextVersion,
      contextSnapshot: trip.context
    })
  }

  it('persists nonempty JSON warnings without PostgreSQL array coercion', async () => {
    const trip = await createTrip()
    const repository = new PostgresRouteGenerationRunRepository(db, userId)
    const { run } = await createRun(trip, 'json-warnings')
    await repository.claim(run.id)
    const warnings = ['No active topology snapshot is available', '报价需重新确认，含 "quoted" text']
    expect(await repository.update(run.id, { progressStage: 'persisting_artifacts', warnings })).toMatchObject({ warnings })
    expect(await repository.update(run.id, { status: 'failed', warnings, errorCode: 'NO_ROUTE_PATHS', errorMessage: 'No routes' })).toMatchObject({ status: 'failed', warnings })
  })

  it('persists the durable Goal and Goal-run lineage on the queued route run', async () => {
    const trip = await createTrip()
    const goals = new PostgresGoalRepository(db, userId)
    const goalRuns = new PostgresGoalRunRepository(db, userId)
    const { goal } = await goals.create({
      tripId: trip.id,
      kind: 'route_generation',
      parameters: { requestKey: 'postgres-lineage' },
      createdContextVersion: trip.currentContextVersion,
      authorization: { source: 'button', grantedAt: '2026-09-08T00:00:00.000Z' },
      idempotencyKey: 'postgres-lineage-goal'
    })
    const { run: goalRun } = await goalRuns.create({
      goalId: goal.id,
      tripId: trip.id,
      generationId: 'postgres-lineage-generation',
      contextVersion: trip.currentContextVersion,
      contextSnapshot: trip.context,
      idempotencyKey: 'postgres-lineage-run'
    })
    const created = await new PostgresRouteGenerationRunRepository(db, userId).createOrGet({
      ownerId: userId,
      tripId: trip.id,
      goalId: goal.id,
      goalRunId: goalRun.id,
      idempotencyKey: 'postgres-lineage-route',
      requestHash: 'f'.repeat(64),
      contextVersion: trip.currentContextVersion,
      contextSnapshot: trip.context
    })

    expect(created.run).toMatchObject({ goalId: goal.id, goalRunId: goalRun.id })
  })

  it('serializes run acceptance with a committing TripContext edit', async () => {
    const trip = await createTrip()
    const client = await pool.connect()
    try {
      await client.query('begin')
      const internal = await client.query<{ id: string }>('select id from trips where public_id = $1 for update', [trip.id])
      const next = { ...structuredClone(trip.context), notes: ['concurrent edit'], version: 1 } satisfies TripContext
      await client.query(
        'insert into trip_context_versions (trip_id, version, context_json) values ($1, $2, $3::jsonb)',
        [internal.rows[0]!.id, 1, JSON.stringify(next)]
      )
      await client.query('update trips set current_context_version = 1, updated_at = now() where id = $1', [internal.rows[0]!.id])

      const pending = createRun(trip, 'atomic-version')
      let settled = false
      void pending.then(() => { settled = true }, () => { settled = true })
      await new Promise(resolve => setTimeout(resolve, 75))
      expect(settled).toBe(false)

      await client.query('commit')
      await expect(pending).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
      const count = await db.selectFrom('route_generation_runs').where('idempotency_key', '=', 'atomic-version').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()
      expect(Number(count.count)).toBe(0)
    } finally {
      try { await client.query('rollback') } catch { /* transaction already completed */ }
      client.release()
    }
  }, 15_000)

  it('keeps cancellation terminal when a progress write was already in flight', async () => {
    const trip = await createTrip()
    const repository = new PostgresRouteGenerationRunRepository(db, userId)
    const created = await createRun(trip, 'cancel-race')
    await repository.claim(created.run.id)
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `update route_generation_runs
         set status = 'cancelled', progress_stage = 'cancelled', progress_percent = 100,
             finished_at = now(), updated_at = now()
         where public_id = $1`,
        [created.run.id]
      )

      const pending = repository.update(created.run.id, { progressStage: 'planning_paths', progressPercent: 35 })
      let settled = false
      void pending.then(() => { settled = true }, () => { settled = true })
      await new Promise(resolve => setTimeout(resolve, 75))
      expect(settled).toBe(false)

      await client.query('commit')
      await expect(pending).resolves.toMatchObject({
        status: 'cancelled', progressStage: 'cancelled', progressPercent: 100
      })
      await expect(repository.get(created.run.id)).resolves.toMatchObject({
        status: 'cancelled', progressStage: 'cancelled', progressPercent: 100
      })
    } finally {
      try { await client.query('rollback') } catch { /* transaction already completed */ }
      client.release()
    }
  }, 15_000)

  it('heartbeats active work and defers stale recovery until the run is reclaimable', async () => {
    const trip = await createTrip()
    const created = await createRun(trip, 'stale-recovery')
    const repository = new PostgresRouteGenerationRunRepository(db, userId)
    await repository.claim(created.run.id)
    const job = await claimNextJob(db, 'dead-worker')
    expect(job?.type).toBe('route_generation')
    expect(job?.payload).toEqual({ runId: created.run.id })
    expect(await heartbeatJob(db, job!.id, 'another-worker')).toBe(false)
    expect(await heartbeatJob(db, job!.id, 'dead-worker')).toBe(true)

    await db.updateTable('jobs').set({ locked_at: new Date(Date.now() - 16 * 60_000) }).where('id', '=', job!.id).execute()
    expect(await recoverStaleJobs(db)).toBe(1)
    const recovered = await db.selectFrom('jobs').select(['status', 'run_at', 'attempts']).where('id', '=', job!.id).executeTakeFirstOrThrow()
    expect(recovered.status).toBe('pending')
    expect(recovered.attempts).toBe(job!.attempts)
    expect(new Date(recovered.run_at).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)
  })

  it('terminalizes a public run when its worker job exhausts retries', async () => {
    const trip = await createTrip()
    const created = await createRun(trip, 'exhausted-worker')
    const job = await claimNextJob(db, 'failing-worker')
    expect(job?.type).toBe('route_generation')
    expect(job?.payload).toEqual({ runId: created.run.id })
    await failJob(db, { ...job!, attempts: job!.max_attempts }, new Error('private provider detail'))

    const failedJob = await db.selectFrom('jobs').select('status').where('id', '=', job!.id).executeTakeFirstOrThrow()
    expect(failedJob.status).toBe('failed')
    await expect(new PostgresRouteGenerationRunRepository(db, userId).get(created.run.id)).resolves.toMatchObject({
      status: 'failed', progressStage: 'failed', progressPercent: 100,
      errorCode: 'ROUTE_GENERATION_WORKER_EXHAUSTED',
      errorMessage: 'Route generation failed after worker retries.'
    })
  })
})
