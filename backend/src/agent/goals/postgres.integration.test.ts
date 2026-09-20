import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
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

  it('accepts Goal and Run atomically under concurrent retries and rejects competing generations', async () => {
    const trip = await createTrip()
    const runs = new PostgresGoalRunRepository(db, userId)
    const input = { tripId: trip.id, requestId: 'atomic-acceptance', generationId: 'generation-1',
      contextSnapshot: emptyTripContext(trip.id), intent: { kind: 'flight_search' as const, parameters: { requestKey: 'flights' } } }
    const [first, replay] = await Promise.all([runs.accept(input), runs.accept(input)])
    expect(replay).toEqual(first)
    expect(await new PostgresGoalRepository(db, userId).listForTrip(trip.id)).toHaveLength(1)
    expect(await runs.listForGoal(first.goal.id)).toHaveLength(1)
    await expect(runs.accept({ ...input, intent: { ...input.intent, parameters: { requestKey: 'changed' } } }))
      .rejects.toMatchObject({ code: 'GOAL_IDEMPOTENCY_CONFLICT' })
    await expect(runs.accept({ ...input, generationId: 'generation-2' }))
      .rejects.toMatchObject({ code: 'GOAL_RUN_ALREADY_RUNNING' })
    await runs.commitCompletion({ goalId: first.goal.id, runId: first.run.id, expectedGoalRevision: 0, expectedRunRevision: 0,
      goalStatus: 'partial', runStatus: 'partial' })
    await expect(runs.accept(input)).rejects.toMatchObject({ code: 'GOAL_RUN_NOT_RUNNING' })
    const second = await runs.accept({ ...input, requestId: 'continuation', generationId: 'generation-2',
      intent: undefined, goalRef: first.goal.id })
    expect(second.goal.id).toBe(first.goal.id)
    expect(second.run.id).not.toBe(first.run.id)
  })

  it('rolls back the new Goal if its Run insert fails', async () => {
    const trip = await createTrip()
    const runs = new PostgresGoalRunRepository(db, userId)
    await sql`alter table planning_goal_runs add constraint acceptance_injected_failure check (generation_id <> 'reject-this-insert')`.execute(db)
    try {
      await expect(runs.accept({ tripId: trip.id, requestId: 'rollback', generationId: 'reject-this-insert',
        contextSnapshot: emptyTripContext(trip.id), intent: { kind: 'flight_search', parameters: { requestKey: 'flights' } } })).rejects.toThrow()
      expect(await new PostgresGoalRepository(db, userId).listForTrip(trip.id)).toEqual([])
    } finally {
      await sql`alter table planning_goal_runs drop constraint acceptance_injected_failure`.execute(db)
    }
  })

  it('checks the trusted owner and current Trip version before accepting a reference', async () => {
    const trip = await createTrip()
    const runs = new PostgresGoalRunRepository(db, userId)
    const input = { tripId: trip.id, requestId: 'acceptance-owner', generationId: 'generation-1',
      contextSnapshot: emptyTripContext(trip.id), intent: { kind: 'flight_search' as const, parameters: { requestKey: 'flights' } } }
    const first = await runs.accept(input)
    await expect(new PostgresGoalRunRepository(db, '999999999').accept({ ...input, intent: undefined, goalRef: first.goal.id }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    const otherTrip = await createTrip()
    await expect(runs.accept({ ...input, tripId: otherTrip.id, contextSnapshot: emptyTripContext(otherTrip.id), intent: undefined, goalRef: first.goal.id }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(runs.accept({ ...input, contextSnapshot: { ...input.contextSnapshot, version: 1 } }))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    await db.updateTable('trips').set({ current_context_version: 1 }).where('public_id', '=', trip.id).execute()
    await expect(runs.accept({ ...input, contextSnapshot: { ...input.contextSnapshot, version: 1 }, generationId: 'generation-2' }))
      .rejects.toMatchObject({ code: 'GOAL_RUN_ALREADY_RUNNING' })
  })

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

  async function completionFixture(key: string) {
    const trip = await createTrip()
    const goals = new PostgresGoalRepository(db, userId)
    const runs = new PostgresGoalRunRepository(db, userId)
    const { goal } = await goals.create(goalInput(trip.id, key))
    const { run } = await runs.create({ goalId: goal.id, tripId: trip.id, generationId: key, contextVersion: 0,
      contextSnapshot: emptyTripContext(trip.id), idempotencyKey: key })
    const input = { goalId: goal.id, runId: run.id, expectedGoalRevision: 0, expectedRunRevision: 0,
      goalStatus: 'satisfied' as const, runStatus: 'satisfied' as const, currentTripVersion: 0 }
    return { trip, goals, runs, goal, run, input }
  }

  it('atomically completes both aggregates and idempotently replays a successful commit', async () => {
    const test = await completionFixture('atomic-success')
    const first = await test.runs.commitCompletion(test.input)
    expect(first).toMatchObject({ goal: { status: 'satisfied', revision: 1 }, run: { status: 'satisfied', revision: 1 } })
    expect(await test.runs.commitCompletion(test.input)).toEqual(first)
  })

  it('rolls back the Goal write if the run write fails inside the transaction', async () => {
    const test = await completionFixture('atomic-failure')
    await pool.query(`CREATE FUNCTION reject_atomic_run() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.generation_id = 'atomic-failure' THEN RAISE EXCEPTION 'injected completion failure'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER reject_atomic_run BEFORE UPDATE ON planning_goal_runs FOR EACH ROW EXECUTE FUNCTION reject_atomic_run()')
    try {
      await expect(test.runs.commitCompletion(test.input)).rejects.toThrow('injected completion failure')
      expect(await test.goals.get(test.goal.id)).toMatchObject({ status: 'pending', revision: 0 })
      expect(await test.runs.get(test.run.id)).toMatchObject({ status: 'running', revision: 0 })
    } finally {
      await pool.query('DROP TRIGGER reject_atomic_run ON planning_goal_runs')
      await pool.query('DROP FUNCTION reject_atomic_run()')
    }
  })

  it('repairs a historical run-only completion without rewriting the terminal run', async () => {
    const test = await completionFixture('atomic-repair')
    const run = await test.runs.update(test.run.id, 0, { status: 'satisfied' })
    const result = await test.runs.commitCompletion({ ...test.input, expectedRunRevision: run.revision })
    expect(result.goal).toMatchObject({ status: 'satisfied', revision: 1 })
    expect(result.run).toEqual(run)
  })

  it('rejects concurrent completion/cancellation conflicts without half-written statuses', async () => {
    const test = await completionFixture('atomic-race')
    const results = await Promise.allSettled([
      test.runs.commitCompletion(test.input),
      test.runs.commitCompletion({ ...test.input, goalStatus: 'cancelled', runStatus: 'cancelled' })
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const goal = await test.goals.get(test.goal.id)
    const run = await test.runs.get(test.run.id)
    expect(goal?.status).toBe(run?.status)
    expect(['satisfied', 'cancelled']).toContain(goal?.status)
  })

  it('checks the locked current Trip version and owner before committing', async () => {
    const test = await completionFixture('atomic-context')
    await new PostgresTripRepository(db, userId).update(test.trip.id, { notes: ['changed before commit'] })
    await expect(test.runs.commitCompletion(test.input)).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    const foreign = new PostgresGoalRunRepository(db, '999999999')
    await expect(foreign.commitCompletion(test.input)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(await test.goals.get(test.goal.id)).toMatchObject({ status: 'pending', revision: 0 })
    expect(await test.runs.get(test.run.id)).toMatchObject({ status: 'running', revision: 0 })
  })
})
