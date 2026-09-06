import { v7 as uuidv7 } from 'uuid'
import type { Kysely } from 'kysely'
import type { ArtifactRecord, ArtifactRepository, CreateArtifactInput } from './repository.js'
import { AppError } from '../lib/errors.js'
import type { Database, JsonValue } from '../db/types.js'

type ArtifactRow = {
  id: string
  trip_id: string
  trip_public_id?: string
  conversation_id: string | null
  conversation_public_id?: string | null
  type: string
  schema_version: number
  payload_json: unknown
  verification_json: unknown
  created_at: Date | string
  updated_at: Date | string
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    tripId: row.trip_public_id ?? row.trip_id,
    ...(row.conversation_public_id === null || row.conversation_public_id === undefined
      ? (row.conversation_id === null ? {} : { conversationId: row.conversation_id })
      : { conversationId: row.conversation_public_id }),
    type: row.type as ArtifactRecord['type'],
    schemaVersion: row.schema_version,
    payload: row.payload_json,
    ...(row.verification_json === null ? {} : { verification: row.verification_json }),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

function resourceNotFound(message: string): AppError {
  return new AppError('RESOURCE_NOT_FOUND', message, 404)
}

/** PostgreSQL implementation scoped to one trusted internal user id. */
export class PostgresArtifactRepository implements ArtifactRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly userId: string
  ) {}

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact schema version must be positive')
    }

    return this.db.transaction().execute(async trx => {
      const trip = await trx
        .selectFrom('trips')
        .select('id')
        .where('public_id', '=', input.tripId)
        .where('user_id', '=', this.userId)
        .executeTakeFirst()
      if (!trip) throw resourceNotFound('Trip was not found')

      let conversationId: string | null = null
      if (input.conversationId !== undefined) {
        const conversation = await trx
          .selectFrom('conversations')
          .select('id')
          .where('public_id', '=', input.conversationId)
          .where('user_id', '=', this.userId)
          .where('trip_id', '=', trip.id)
          .executeTakeFirst()
        if (!conversation) throw resourceNotFound('Conversation was not found')
        conversationId = conversation.id
      }

      const row = await trx
        .insertInto('artifacts')
        .values({
          public_id: input.id ?? uuidv7(),
          user_id: this.userId,
          trip_id: trip.id,
          conversation_id: conversationId,
          type: input.type,
          schema_version: input.schemaVersion,
          payload_json: input.payload as JsonValue,
          verification_json: input.verification === undefined ? null : input.verification as JsonValue
        })
        .returning([
          'public_id as id', 'trip_id', 'conversation_id', 'type', 'schema_version',
          'payload_json', 'verification_json', 'created_at', 'updated_at'
        ])
        .executeTakeFirstOrThrow()

      const artifact = toArtifact(row)
      return {
        ...artifact,
        tripId: input.tripId,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId })
      }
    })
  }

  async get(artifactId: string): Promise<ArtifactRecord | undefined> {
    const row = await this.db
      .selectFrom('artifacts')
      .innerJoin('trips', 'trips.id', 'artifacts.trip_id')
      .leftJoin('conversations', 'conversations.id', 'artifacts.conversation_id')
      .select([
        'artifacts.public_id as id', 'artifacts.trip_id', 'trips.public_id as trip_public_id',
        'artifacts.conversation_id', 'conversations.public_id as conversation_public_id',
        'artifacts.type', 'artifacts.schema_version', 'artifacts.payload_json',
        'artifacts.verification_json', 'artifacts.created_at', 'artifacts.updated_at'
      ])
      .where('artifacts.public_id', '=', artifactId)
      .where('artifacts.user_id', '=', this.userId)
      .executeTakeFirst()
    return row ? toArtifact(row) : undefined
  }
}
