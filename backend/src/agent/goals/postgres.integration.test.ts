import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { up as createInitialSchema } from '../../db/migrations/001_initial.js'
import { up as createCloudStateSchema } from '../../db/migrations/006_cloud_state.js'
import { up as createPlanningGoalsSchema } from '../../db/migrations/010_planning_goals.js'
import type { Database } from '../../db/types.js'
import { PostgresUserIdentityRepository } from '../../identity/postgres.js'
import { PostgresTripRepository } from '../../trips/postgres.js'
import { emptyTripContext } from '../../trips/types.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from './postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('PostgreSQL durable planning goals', () => {
  const schema = `goals_${process.pid}_${Date.now()}`
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
    await createPlanningGoalsSchema(db)
    userId = (await new PostgresUserIdentityRepository(db).resolveWechat({
      providerSubject: `goals-${schema}`, nickname: 'Goals', avatarUrl: ''
    })).userId
  }, 30_000)

  afterAll(async () => {
    await db?.destroy()
    await adminPool?.query(`drop schema if exists "${schema}" cascade`)
    await adminPool?.end()
  })

  async function createTrip(owner = userId) {
    return new PostgresTripRepository(db, owner).create()
  }

  function goalInput(tripId: string, key: string) {
    return {
      tripId,
      kind: 'travel_guide' as const,
      parameters: { questions: ['What should I do?'], researchTypes: ['activity' as const], maxResults: 3, maxCities: 2, allowPartial: true },
      createdContextVersion: 0,
      idempotencyKey: key
    }
  }

  it('replays the same goal idempotently and rejects key reuse', async () => {
    const trip = await createTrip()
    const repository = new PostgresGoalRepository(db, userId)
    const first = await repository.create(goalInput(trip.id, 'goal-idempotency'))
    const replay = await repository.create(goalInput(trip.id, 'goal-idempotency'))
    expect(first.created).toBe(true)
    expect(replay).toMatchObject({ created: false, goal: { id: first.goal.id } })
    await expect(repository.create({ ...goalInput(trip.id, 'goal-idempotency'), parameters: { ...goalInput(trip.id, 'goal-idempotency').parameters, maxCities: 3 } }))
      .rejects.toMatchObject({ code: 'GOAL_IDEMPOTENCY_CONFLICT' })
  })

  it('freezes a compatible context and permits only one running run', async () => {
    const trip = await createTrip()
    const goals = new PostgresGoalRepository(db, userId)
    const runs = new PostgresGoalRunRepository(db, userId)
    const { goal } = await goals.create(goalInput(trip.id, 'goal-run'))
    const context = emptyTripContext(trip.id)
    const first = await runs.create({ goalId: goal.id, tripId: trip.id, generationId: 'generation-1', contextVersion: 0, contextSnapshot: context, idempotencyKey: 'run-1' })
    expect(first.run.status).toBe('running')
    await expect(runs.create({ goalId: goal.id, tripId: trip.id, generationId: 'generation-2', contextVersion: 0, contextSnapshot: context, idempotencyKey: 'run-2' }))
      .rejects.toMatchObject({ code: 'GOAL_RUN_ALREADY_RUNNING' })
    const partial = await runs.update(first.run.id, 0, { status: 'partial' })
    expect(partial.revision).toBe(1)
    const second = await runs.create({ goalId: goal.id, tripId: trip.id, generationId: 'generation-2', contextVersion: 0, contextSnapshot: context, idempotencyKey: 'run-2' })
    await expect(runs.latestCompatible({ goalId: goal.id, tripId: trip.id, contextVersion: 0 })).resolves.toMatchObject({ id: second.run.id })
  })

  it('enforces owner scoping, context version checks, and optimistic revisions', async () => {
    const trip = await createTrip()
    const goals = new PostgresGoalRepository(db, userId)
    await expect(goals.create({ ...goalInput(trip.id, 'stale-goal'), createdContextVersion: 1 }))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    const { goal } = await goals.create(goalInput(trip.id, 'revision-goal'))
    await expect(goals.update(goal.id, 1, { status: 'satisfied' })).rejects.toMatchObject({ code: 'GOAL_REVISION_CONFLICT' })
    await expect(goals.update(goal.id, 0, { status: 'satisfied' })).resolves.toMatchObject({ status: 'satisfied', revision: 1 })

    const foreign = new PostgresGoalRepository(db, '999999999')
    await expect(foreign.get(goal.id)).resolves.toBeUndefined()
  })
})
