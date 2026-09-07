import { sql, type Kysely } from 'kysely'
import { v7 as uuidv7 } from 'uuid'
import type { Database, JsonValue } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import { emptyTripContext, tripContextSchema } from '../trips/types.js'
import { tripTemplateSchema } from './types.js'

export class ExploreRepository {
  constructor(private readonly db: Kysely<Database>) {}
  private visible(db = this.db) {
    const now = new Date()
    return db.selectFrom('discovery_candidates as c').innerJoin('trip_template_versions as v', join => join.onRef('v.candidate_id', '=', 'c.public_id').onRef('v.version', '=', 'c.published_version'))
      .where('c.status', '=', 'published').where('c.valid_from', '<=', now).where('c.expires_at', '>', now).where('c.verified_until', '>', now)
      .select(['c.public_id as id', 'v.version', 'v.payload_json'])
  }
  async list(input: { category?: string | undefined; before?: string | undefined; limit: number }) {
    let query = this.visible()
    if (input.category) query = query.where('c.category', '=', input.category)
    if (input.before) query = query.where('c.public_id', '<', input.before)
    const rows = await query.orderBy('c.public_id', 'desc').limit(input.limit + 1).execute()
    return { templates: rows.slice(0, input.limit).map(row => ({ id: row.id, version: row.version, template: tripTemplateSchema.parse(row.payload_json) })), nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null }
  }
  async get(id: string) {
    const row = await this.visible().where('c.public_id', '=', id).executeTakeFirst()
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', 'This inspiration is no longer available', 404)
    return { id: row.id, version: row.version, template: tripTemplateSchema.parse(row.payload_json) }
  }
  async seed(userId: string, id: string, version: number, key: string) {
    return this.db.transaction().execute(async trx => {
      // Serialize retries for one account/key without locking unrelated users.
      await sql`select pg_advisory_xact_lock(hashtextextended(${userId + ':' + key}, 0))`.execute(trx)
      const prior = await trx.selectFrom('explore_seeds as s').innerJoin('trips as t', 't.id', 's.trip_id').innerJoin('conversations as c', 'c.id', 's.conversation_id').select(['s.candidate_id', 's.template_version', 't.public_id as tripId', 'c.public_id as conversationId']).where('s.user_id', '=', userId).where('s.idempotency_key', '=', key).executeTakeFirst()
      if (prior) {
        if (prior.candidate_id !== id || prior.template_version !== version) throw new AppError('IDEMPOTENCY_CONFLICT', 'This request key belongs to another inspiration', 409)
        return { tripId: prior.tripId, conversationId: prior.conversationId }
      }
      // The share lock keeps withdrawal and adoption ordered atomically.
      const candidate = await trx.selectFrom('discovery_candidates').selectAll().where('public_id', '=', id).forShare().executeTakeFirst()
      const now = new Date()
      if (!candidate || candidate.status !== 'published' || candidate.published_version !== version || new Date(candidate.valid_from) > now || new Date(candidate.expires_at) <= now || !candidate.verified_until || new Date(candidate.verified_until) <= now) throw new AppError('TEMPLATE_UNAVAILABLE', 'Reload this inspiration before starting a trip', 409)
      const row = await trx.selectFrom('trip_template_versions').select('payload_json').where('candidate_id', '=', id).where('version', '=', version).executeTakeFirstOrThrow()
      const template = tripTemplateSchema.parse(row.payload_json), tripId = uuidv7(), conversationId = uuidv7()
      const context = tripContextSchema.parse({ ...emptyTripContext(tripId), travelDays: template.suggestedDays, interests: template.interests, destinationIntent: { mode: 'mixed', required: [], preferred: template.anchorDestinations, excluded: [] }, notes: [`Explore inspiration ${id} v${version}; suggestions require adaptation to the user's dates and budget.`, template.routeConcept.slice(0, 500), ...template.experienceGoals] })
      const trip = await trx.insertInto('trips').values({ public_id: tripId, user_id: userId, title: template.title, status: 'planning', current_context_version: 0 }).returning('id').executeTakeFirstOrThrow()
      await trx.insertInto('trip_context_versions').values({ trip_id: trip.id, version: 0, context_json: context as unknown as JsonValue }).execute()
      const conversation = await trx.insertInto('conversations').values({ public_id: conversationId, user_id: userId, trip_id: trip.id, title: template.title, status: 'active' }).returning('id').executeTakeFirstOrThrow()
      await trx.insertInto('conversation_messages').values({ public_id: uuidv7(), conversation_id: conversation.id, role: 'assistant', content: `已将「${template.title}」作为旅行灵感加入规划。目的地和天数都可以调整。你从哪里出发，计划什么时候旅行，预算大约多少？`, metadata_json: {} }).execute()
      await trx.insertInto('explore_seeds').values({ user_id: userId, idempotency_key: key, candidate_id: id, template_version: version, trip_id: trip.id, conversation_id: conversation.id }).execute()
      return { tripId, conversationId }
    })
  }
}
