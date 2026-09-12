import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../db/types.js'
import { up as initial } from '../db/migrations/001_initial.js'
import { up as cloudState } from '../db/migrations/006_cloud_state.js'
import { up as goals } from '../db/migrations/010_planning_goals.js'
import { up as nativeResearch } from '../db/migrations/012_native_research_audit_budget.js'
import { PostgresUserIdentityRepository } from '../identity/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'
import { PostgresNativeResearchLedger } from './native-postgres.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('PostgreSQL native research budget and audit', () => {
  const schema = `native_research_${process.pid}_${Date.now()}`
  let admin: pg.Pool
  let pool: pg.Pool
  let db: Kysely<Database>
  let ownerId = ''

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl })
    await admin.query(`create schema "${schema}"`)
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4 })
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    await initial(db)
    await cloudState(db)
    await goals(db)
    await nativeResearch(db)
    ownerId = (await new PostgresUserIdentityRepository(db).resolveWechat({ providerSubject: schema, nickname: 'Native audit', avatarUrl: '' })).userId
  }, 30_000)

  afterAll(async () => {
    await db?.destroy()
    await admin?.query(`drop schema if exists "${schema}" cascade`)
    await admin?.end()
  })

  async function budget(id: string, limit = 100) {
    await db.insertInto('research_budgets').values({ id, currency: 'USD', limit_usd_micros: String(limit), reserved_usd_micros: '0', settled_usd_micros: '0' }).execute()
  }

  async function scope() {
    const trips = new PostgresTripRepository(db, ownerId)
    const trip = await trips.create()
    const conversation = await new PostgresConversationRepository(db, ownerId).create({ tripId: trip.id })
    return { trip, conversation }
  }

  it('reserves the shared budget once, settles a proven charge, and links the final Artifact in the same write transaction', async () => {
    await budget('native-success')
    const { trip, conversation } = await scope()
    const ledger = new PostgresNativeResearchLedger(db, ownerId)
    const audit = await ledger.reserve({ budgetId: 'native-success', requestId: 'same-request', generationId: '9e1cc955-807d-47ba-a14e-31a53173f561', ownerId, tripId: trip.id, conversationId: conversation.id,
      tripContextVersion: trip.context.version, provider: 'openrouter', model: 'qwen/qwen3.8-flash', reservedUsdMicros: 40, request: { model: 'qwen/qwen3.8-flash' } })
    await ledger.finish(audit.auditId, { status: 'succeeded', receipt: { usage: { server_tool_use: { web_search_requests: 1 } } }, normalization: { disposition: 'recommend' }, settledUsdMicros: 17 })
    const artifact = await new PostgresArtifactRepository(db, ownerId).createWithResearchAudit({ tripId: trip.id, conversationId: conversation.id, tripContextVersion: trip.context.version,
      type: 'research', schemaVersion: 2, payload: { tripContextVersion: trip.context.version } }, audit.auditId)
    const row = await (db as any).selectFrom('research_generation_audits').selectAll().where('public_id', '=', audit.auditId).executeTakeFirstOrThrow()
    const account = await db.selectFrom('research_budgets').select(['reserved_usd_micros', 'settled_usd_micros']).where('id', '=', 'native-success').executeTakeFirstOrThrow()
    expect(row).toMatchObject({ request_id: 'same-request', generation_id: '9e1cc955-807d-47ba-a14e-31a53173f561', status: 'succeeded', artifact_id: expect.any(String) })
    expect(row.delivered_at).toBeTruthy()
    expect(artifact.tripContextVersion).toBe(trip.context.version)
    expect(account).toMatchObject({ reserved_usd_micros: '0', settled_usd_micros: '17' })
  })

  it('keeps an unknown charge reserved and does not reset it for a different request', async () => {
    await budget('native-unknown', 50)
    const first = await scope()
    const ledger = new PostgresNativeResearchLedger(db, ownerId)
    const audit = await ledger.reserve({ budgetId: 'native-unknown', requestId: 'first', generationId: '0db65583-909a-4b57-810e-f21a4df0cdd2', ownerId, tripId: first.trip.id, conversationId: first.conversation.id,
      tripContextVersion: first.trip.context.version, provider: 'openrouter', model: 'qwen/qwen3.8-flash', reservedUsdMicros: 40, request: {} })
    await ledger.finish(audit.auditId, { status: 'timed_out', error: { code: 'NATIVE_RESEARCH_TIMEOUT', message: 'timeout' } })
    const second = await scope()
    await expect(ledger.reserve({ budgetId: 'native-unknown', requestId: 'second', generationId: 'df4aef67-5c95-4998-90cd-7945ab6bfaa6', ownerId, tripId: second.trip.id, conversationId: second.conversation.id,
      tripContextVersion: second.trip.context.version, provider: 'openrouter', model: 'qwen/qwen3.8-flash', reservedUsdMicros: 20, request: {} })).rejects.toMatchObject({ code: 'NATIVE_RESEARCH_BUDGET_EXCEEDED' })
    expect(await db.selectFrom('research_budgets').select('reserved_usd_micros').where('id', '=', 'native-unknown').executeTakeFirstOrThrow()).toMatchObject({ reserved_usd_micros: '40' })
  })

  it('records an over-cap receipt, preserves it, and exhausts the shared budget before another paid call', async () => {
    await budget('native-over-cap', 100)
    const first = await scope()
    const ledger = new PostgresNativeResearchLedger(db, ownerId)
    const audit = await ledger.reserve({ budgetId: 'native-over-cap', requestId: 'first', generationId: '9020a762-a37b-4f22-aa3f-b18d9025d749', ownerId, tripId: first.trip.id, conversationId: first.conversation.id,
      tripContextVersion: first.trip.context.version, provider: 'openrouter', model: 'qwen/qwen3.8-flash', reservedUsdMicros: 40, request: {} })
    await expect(ledger.finish(audit.auditId, { status: 'succeeded', receipt: { usage: { cost: 0.000041 } }, settledUsdMicros: 41 }))
      .rejects.toMatchObject({ code: 'NATIVE_RESEARCH_COST_EXCEEDS_RESERVATION' })
    const auditRow = await (db as any).selectFrom('research_generation_audits').select(['status', 'receipt_json', 'error_json']).where('public_id', '=', audit.auditId).executeTakeFirstOrThrow()
    const account = await db.selectFrom('research_budgets').select(['reserved_usd_micros', 'settled_usd_micros']).where('id', '=', 'native-over-cap').executeTakeFirstOrThrow()
    expect(auditRow).toMatchObject({ status: 'failed' })
    expect(auditRow.receipt_json).toMatchObject({ usage: { cost: 0.000041 } })
    expect(auditRow.error_json).toMatchObject({ code: 'NATIVE_RESEARCH_COST_EXCEEDS_RESERVATION' })
    expect(account).toMatchObject({ reserved_usd_micros: '100', settled_usd_micros: '0' })
    const second = await scope()
    await expect(ledger.reserve({ budgetId: 'native-over-cap', requestId: 'second', generationId: 'b6323571-5897-49af-81a2-5fbfdbf0dc2a', ownerId, tripId: second.trip.id, conversationId: second.conversation.id,
      tripContextVersion: second.trip.context.version, provider: 'openrouter', model: 'qwen/qwen3.8-flash', reservedUsdMicros: 1, request: {} })).rejects.toMatchObject({ code: 'NATIVE_RESEARCH_BUDGET_EXCEEDED' })
  })

  it('does not mark a native audit delivered when a later Trip version or Goal-run cancellation blocks the Artifact write', async () => {
    await budget('native-late', 100)
    const { trip, conversation } = await scope()
    const goalRepository = new PostgresGoalRepository(db, ownerId)
    const runRepository = new PostgresGoalRunRepository(db, ownerId)
    const { goal } = await goalRepository.create({ tripId: trip.id, kind: 'flight_search', parameters: { requestKey: 'native-late' }, createdContextVersion: trip.context.version, idempotencyKey: 'native-late' })
    const { run } = await runRepository.create({ goalId: goal.id, tripId: trip.id, generationId: 'native-late', contextVersion: trip.context.version, contextSnapshot: trip.context, idempotencyKey: 'native-late' })
    const ledger = new PostgresNativeResearchLedger(db, ownerId)
    const audit = await ledger.reserve({ budgetId: 'native-late', requestId: 'late', generationId: 'f3ee0e7a-dd11-4d9c-91da-0d700a1adad9', ownerId, tripId: trip.id, conversationId: conversation.id, goalId: goal.id, runId: run.id,
      tripContextVersion: trip.context.version, provider: 'openrouter', model: 'z-ai/glm-5.3-flash', reservedUsdMicros: 20, request: {} })
    await ledger.finish(audit.auditId, { status: 'succeeded' })
    await runRepository.update(run.id, run.revision, { status: 'cancelled' })
    await expect(new PostgresArtifactRepository(db, ownerId).createWithResearchAudit({ tripId: trip.id, conversationId: conversation.id, goalId: goal.id, runId: run.id,
      tripContextVersion: trip.context.version, type: 'research', schemaVersion: 2, payload: { tripContextVersion: trip.context.version } }, audit.auditId)).rejects.toMatchObject({ code: 'GOAL_RUN_NOT_ACTIVE' })
    const row = await (db as any).selectFrom('research_generation_audits').select(['artifact_id', 'delivered_at']).where('public_id', '=', audit.auditId).executeTakeFirstOrThrow()
    expect(row).toEqual({ artifact_id: null, delivered_at: null })
  })
})
