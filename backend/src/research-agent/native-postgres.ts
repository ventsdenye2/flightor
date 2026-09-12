import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import { checkedUsdMicros, type NativeResearchAuditFinish, type NativeResearchAuditStart, type NativeResearchLedger } from './native-infrastructure.js'

type UntypedDb = Kysely<any>
const untyped = (db: Kysely<Database> | any): UntypedDb => db as UntypedDb
const missing = (message: string) => new AppError('RESOURCE_NOT_FOUND', message, 404)

/** PostgreSQL money/audit implementation. A configured budget must be provisioned explicitly; this class never creates or resets one. */
export class PostgresNativeResearchLedger implements NativeResearchLedger {
  constructor(private readonly db: Kysely<Database>, private readonly userId: string) {}

  async reserve(input: NativeResearchAuditStart): Promise<{ auditId: string }> {
    if (input.ownerId !== this.userId || !input.tripId || !input.conversationId || input.tripContextVersion === undefined) {
      throw new AppError('INVALID_RESEARCH_AUDIT_SCOPE', 'Native research audit requires the trusted owner and workspace scope', 400)
    }
    checkedUsdMicros(input.reservedUsdMicros, 'reservedUsdMicros')
    if (!input.reservedUsdMicros || !input.budgetId.trim()) throw new AppError('NATIVE_RESEARCH_BUDGET_UNAVAILABLE', 'Native research budget is not configured', 503)
    return untyped(this.db).transaction().execute(async trx => {
      const budget = await trx.selectFrom('research_budgets').select(['id', 'currency', 'limit_usd_micros', 'reserved_usd_micros', 'settled_usd_micros'])
        .where('id', '=', input.budgetId).forUpdate().executeTakeFirst()
      if (!budget || budget.currency !== 'USD') throw new AppError('NATIVE_RESEARCH_BUDGET_UNAVAILABLE', 'Native research budget is unavailable', 503)
      const remaining = Number(budget.limit_usd_micros) - Number(budget.reserved_usd_micros) - Number(budget.settled_usd_micros)
      if (!Number.isSafeInteger(remaining) || remaining < input.reservedUsdMicros) throw new AppError('NATIVE_RESEARCH_BUDGET_EXCEEDED', 'Native research shared budget would be exceeded', 429)
      const trip = await trx.selectFrom('trips').select(['id', 'current_context_version']).where('public_id', '=', input.tripId).where('user_id', '=', this.userId).forShare().executeTakeFirst()
      if (!trip) throw missing('Trip was not found')
      if (trip.current_context_version !== input.tripContextVersion) throw new AppError('TRIP_CONTEXT_VERSION_CONFLICT', 'Research audit does not match the current Trip Context version', 409)
      const conversation = await trx.selectFrom('conversations').select('id').where('public_id', '=', input.conversationId).where('user_id', '=', this.userId).where('trip_id', '=', trip.id).executeTakeFirst()
      if (!conversation) throw missing('Conversation was not found')
      let goalId: string | null = null
      if (input.goalId) {
        const goal = await trx.selectFrom('planning_goals').select('id').where('public_id', '=', input.goalId).where('user_id', '=', this.userId).where('trip_id', '=', trip.id).executeTakeFirst()
        if (!goal) throw missing('Goal was not found')
        goalId = goal.id
      }
      let runId: string | null = null
      if (input.runId) {
        const run = await trx.selectFrom('planning_goal_runs').select(['id', 'goal_id', 'context_version', 'status']).where('public_id', '=', input.runId).where('user_id', '=', this.userId).where('trip_id', '=', trip.id).executeTakeFirst()
        if (!run || (goalId !== null && run.goal_id !== goalId) || run.context_version !== input.tripContextVersion || run.status !== 'running') throw new AppError('GOAL_RUN_NOT_ACTIVE', 'Goal run cannot accept research', 409)
        runId = run.id
      }
      const auditId = randomUUID()
      await trx.updateTable('research_budgets').set({ reserved_usd_micros: sql`reserved_usd_micros + ${input.reservedUsdMicros}`, updated_at: new Date() }).where('id', '=', input.budgetId).executeTakeFirst()
      await trx.insertInto('research_generation_audits').values({ public_id: auditId, budget_id: input.budgetId, user_id: this.userId, request_id: input.requestId, generation_id: input.generationId,
        trip_id: trip.id, conversation_id: conversation.id, goal_id: goalId, goal_run_id: runId, trip_context_version: input.tripContextVersion, provider: input.provider, model: input.model,
        status: 'running', reserved_usd_micros: String(input.reservedUsdMicros), request_json: JSON.stringify(input.request) }).executeTakeFirst()
      return { auditId }
    })
  }

  async finish(auditId: string, input: NativeResearchAuditFinish): Promise<void> {
    const settled = input.settledUsdMicros === undefined ? undefined : checkedUsdMicros(input.settledUsdMicros, 'settledUsdMicros')
    const exceedsReservation = await untyped(this.db).transaction().execute(async trx => {
      const audit = await trx.selectFrom('research_generation_audits').selectAll().where('public_id', '=', auditId).where('user_id', '=', this.userId).forUpdate().executeTakeFirst()
      if (!audit) throw missing('Research audit was not found')
      if (audit.status !== 'running') throw new AppError('RESEARCH_AUDIT_FINALIZED', 'Research audit has already been finalized', 409)
      const exceeded = settled !== undefined && settled > Number(audit.reserved_usd_micros)
      if (settled !== undefined && !exceeded) {
        await trx.updateTable('research_budgets').set({ reserved_usd_micros: sql`reserved_usd_micros - ${audit.reserved_usd_micros}`, settled_usd_micros: sql`settled_usd_micros + ${settled}`, updated_at: new Date() }).where('id', '=', audit.budget_id).executeTakeFirst()
      }
      if (exceeded) {
        // The provider has already charged more than the admitted maximum.
        // Freeze the shared budget rather than allowing a second paid call.
        await trx.updateTable('research_budgets').set({ reserved_usd_micros: sql`limit_usd_micros - settled_usd_micros`, updated_at: new Date() }).where('id', '=', audit.budget_id).executeTakeFirst()
      }
      await trx.updateTable('research_generation_audits').set({ status: exceeded ? 'failed' : input.status, ...(settled === undefined || exceeded ? {} : { settled_usd_micros: String(settled) }),
        ...(input.receipt === undefined ? {} : { receipt_json: JSON.stringify(input.receipt) }), ...(input.normalization === undefined ? {} : { normalization_json: JSON.stringify(input.normalization) }),
        ...(exceeded ? { error_json: JSON.stringify({ code: 'NATIVE_RESEARCH_COST_EXCEEDS_RESERVATION', message: 'Native research cost exceeds its admitted reservation' }) } : input.error === undefined ? {} : { error_json: JSON.stringify(input.error) }), updated_at: new Date() }).where('id', '=', audit.id).executeTakeFirst()
      return exceeded
    })
    if (exceedsReservation) {
      const error = new AppError('NATIVE_RESEARCH_COST_EXCEEDS_RESERVATION', 'Native research cost exceeds its admitted reservation', 502)
      ;(error as AppError & { auditFinalized?: boolean }).auditFinalized = true
      throw error
    }
  }
}
