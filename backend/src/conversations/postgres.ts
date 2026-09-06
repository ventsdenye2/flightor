import { v7 as uuidv7 } from 'uuid'
import type { Kysely } from 'kysely'
import type {
  Conversation,
  ConversationMessage,
  ConversationRepository,
  ConversationRole,
  ConversationStatus
} from './repository.js'
import { AppError } from '../lib/errors.js'
import type { Database, JsonValue } from '../db/types.js'

type ConversationRow = {
  id: string
  trip_id: string
  trip_public_id?: string
  title: string
  status: ConversationStatus
  created_at: Date | string
  updated_at: Date | string
}

type MessageRow = {
  id: string
  conversation_id: string
  role: ConversationRole
  content: string
  metadata_json: JsonValue
  created_at: Date | string
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    tripId: row.trip_public_id ?? row.trip_id,
    title: row.title,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata_json as Record<string, unknown>,
    createdAt: toIso(row.created_at)
  }
}

function resourceNotFound(message: string): AppError {
  return new AppError('RESOURCE_NOT_FOUND', message, 404)
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100
  return Math.max(1, Math.min(500, Math.trunc(limit)))
}

/** PostgreSQL implementation scoped to one trusted internal user id. */
export class PostgresConversationRepository implements ConversationRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly userId: string
  ) {}

  async create(input: { tripId: string; title?: string }): Promise<Conversation> {
    return this.db.transaction().execute(async trx => {
      const trip = await trx
        .selectFrom('trips')
        .select('id')
        .where('public_id', '=', input.tripId)
        .where('user_id', '=', this.userId)
        .executeTakeFirst()
      if (!trip) throw resourceNotFound('Trip was not found')

      const row = await trx
        .insertInto('conversations')
        .values({
          public_id: uuidv7(),
          user_id: this.userId,
          trip_id: trip.id,
          title: input.title ?? '',
          status: 'active'
        })
        .returning(['public_id as id', 'trip_id', 'title', 'status', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow()
      return toConversation({ ...row, trip_public_id: input.tripId })
    })
  }

  async get(conversationId: string): Promise<Conversation | undefined> {
    const row = await this.db
      .selectFrom('conversations')
      .innerJoin('trips', 'trips.id', 'conversations.trip_id')
      .select([
        'conversations.public_id as id', 'conversations.trip_id',
        'trips.public_id as trip_public_id', 'conversations.title', 'conversations.status',
        'conversations.created_at', 'conversations.updated_at'
      ])
      .where('conversations.public_id', '=', conversationId)
      .where('conversations.user_id', '=', this.userId)
      .executeTakeFirst()
    return row ? toConversation(row) : undefined
  }

  async appendMessage(input: {
    conversationId: string
    role: ConversationRole
    content: string
    metadata?: Record<string, unknown>
  }): Promise<ConversationMessage> {
    return this.db.transaction().execute(async trx => {
      const conversation = await trx
        .selectFrom('conversations')
        .select('id')
        .where('public_id', '=', input.conversationId)
        .where('user_id', '=', this.userId)
        .executeTakeFirst()
      if (!conversation) throw resourceNotFound('Conversation was not found')

      const row = await trx
        .insertInto('conversation_messages')
        .values({
          public_id: uuidv7(),
          conversation_id: conversation.id,
          role: input.role,
          content: input.content,
          metadata_json: (input.metadata ?? {}) as JsonValue
        })
        .returning(['public_id as id', 'conversation_id', 'role', 'content', 'metadata_json', 'created_at'])
        .executeTakeFirstOrThrow()

      await trx.updateTable('conversations')
        .set({ updated_at: row.created_at })
        .where('id', '=', conversation.id)
        .execute()

      return toMessage({ ...row, conversation_id: input.conversationId })
    })
  }

  async listMessages(conversationId: string, limit?: number): Promise<ConversationMessage[]> {
    const conversation = await this.db
      .selectFrom('conversations')
      .select('id')
      .where('public_id', '=', conversationId)
      .where('user_id', '=', this.userId)
      .executeTakeFirst()
    if (!conversation) throw resourceNotFound('Conversation was not found')

    const rows = await this.db
      .selectFrom('conversation_messages')
      .select(['public_id as id', 'conversation_id', 'role', 'content', 'metadata_json', 'created_at'])
      .where('conversation_id', '=', conversation.id)
      // Fetch the most recent messages, then restore chronological order for
      // callers (matching the in-memory repository's slice(-limit) contract).
      .orderBy('id', 'desc')
      .limit(normalizeLimit(limit))
      .execute()
    return rows.reverse().map(row => toMessage({ ...row, conversation_id: conversationId }))
  }
}
