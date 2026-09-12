import { v7 as uuidv7 } from 'uuid'
import type { Kysely } from 'kysely'
import { assertArtifactContextVersion, assertArtifactGoalWritable, assertArtifactRunWritable, normalizeSourceArtifactIds, type ArtifactRecord, type ArtifactRepository, type ArtifactScope, type CreateArtifactInput } from './repository.js'
import { AppError } from '../lib/errors.js'
import type { Database, JsonValue } from '../db/types.js'
import { TripContextVersionConflict } from '../trips/repository.js'

type ArtifactRow = {
  internal_id?: string
  id: string
  trip_id: string
  trip_public_id?: string
  conversation_id: string | null
  conversation_public_id?: string | null
  goal_public_id?: string | null
  run_public_id?: string | null
  goal_id?: string | null
  goal_run_id?: string | null
  trip_context_version?: number | null
  source_artifact_ids_json?: unknown
  type: string
  schema_version: number
  payload_json: unknown
  verification_json: unknown
  created_at: Date | string
  updated_at: Date | string
}

type UntypedDb = Kysely<any>

function untyped(db: Kysely<Database> | any): UntypedDb {
  return db as UntypedDb
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toArtifact(row: ArtifactRow): ArtifactRecord {
  const sourceArtifactIds = Array.isArray(row.source_artifact_ids_json)
    ? row.source_artifact_ids_json.filter((value): value is string => typeof value === 'string').slice(0, 50)
    : typeof row.source_artifact_ids_json === 'string'
      ? parseSourceArtifactIds(row.source_artifact_ids_json)
      : []
  return {
    id: row.id,
    tripId: row.trip_public_id ?? row.trip_id,
    ...(row.conversation_public_id === null || row.conversation_public_id === undefined
      ? (row.conversation_id === null ? {} : { conversationId: row.conversation_id })
      : { conversationId: row.conversation_public_id }),
    ...(row.goal_public_id === null || row.goal_public_id === undefined ? {} : { goalId: row.goal_public_id }),
    ...(row.run_public_id === null || row.run_public_id === undefined ? {} : { runId: row.run_public_id }),
    ...(row.trip_context_version === null || row.trip_context_version === undefined ? {} : { tripContextVersion: row.trip_context_version }),
    sourceArtifactIds,
    type: row.type as ArtifactRecord['type'],
    schemaVersion: row.schema_version,
    payload: row.payload_json,
    ...(row.verification_json === null ? {} : { verification: row.verification_json }),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  }
}

function parseSourceArtifactIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}

function scopeMatches(record: ArtifactRecord, scope: ArtifactScope): boolean {
  return (scope.tripId === undefined || record.tripId === scope.tripId)
    && (scope.goalId === undefined || record.goalId === scope.goalId)
    && (scope.runId === undefined || record.runId === scope.runId)
    && (scope.tripContextVersion === undefined || record.tripContextVersion === scope.tripContextVersion)
}

function selectArtifacts(db: UntypedDb) {
  return db.selectFrom('artifacts')
    .innerJoin('trips', 'trips.id', 'artifacts.trip_id')
    .leftJoin('conversations', 'conversations.id', 'artifacts.conversation_id')
    .leftJoin('planning_goals', 'planning_goals.id', 'artifacts.goal_id')
    .leftJoin('planning_goal_runs', 'planning_goal_runs.id', 'artifacts.goal_run_id')
    .select([
      'artifacts.public_id as id', 'artifacts.trip_id', 'trips.public_id as trip_public_id',
      'artifacts.conversation_id', 'conversations.public_id as conversation_public_id',
      'planning_goals.public_id as goal_public_id', 'planning_goal_runs.public_id as run_public_id',
      'artifacts.trip_context_version', 'artifacts.source_artifact_ids_json', 'artifacts.type',
      'artifacts.schema_version', 'artifacts.payload_json', 'artifacts.verification_json',
      'artifacts.created_at', 'artifacts.updated_at'
    ])
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
    return this.createInternal(input)
  }

  async createWithResearchAudit(input: CreateArtifactInput, auditId: string): Promise<ArtifactRecord> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(auditId)) {
      throw new AppError('INVALID_RESEARCH_AUDIT', 'Research audit id is invalid', 400)
    }
    return this.createInternal(input, auditId)
  }

  private async createInternal(input: CreateArtifactInput, researchAuditId?: string): Promise<ArtifactRecord> {
    if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact schema version must be positive')
    }
    if (input.tripContextVersion !== undefined && (!Number.isInteger(input.tripContextVersion) || input.tripContextVersion < 0)) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact Trip Context version must be non-negative')
    }
    if (input.runId !== undefined && input.goalId === undefined) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact goalId is required when runId is provided')
    }
    const sourceArtifactIds = normalizeSourceArtifactIds(input.sourceArtifactIds)
    if (input.id !== undefined && sourceArtifactIds.includes(input.id)) {
      throw new AppError('INVALID_ARTIFACT', 'Artifact cannot reference itself')
    }

    return this.db.transaction().execute(async trx => {
      const trip = await trx
        .selectFrom('trips')
        .select(['id', 'current_context_version'])
        .where('public_id', '=', input.tripId)
        .where('user_id', '=', this.userId)
        .forShare()
        .executeTakeFirst()
      if (!trip) throw resourceNotFound('Trip was not found')
      if (input.tripContextVersion !== undefined && input.tripContextVersion !== trip.current_context_version) {
        throw new TripContextVersionConflict(input.tripContextVersion, trip.current_context_version)
      }

      let goalId: string | null = null
      if (input.goalId !== undefined) {
        const goal = await untyped(trx).selectFrom('planning_goals')
          .select(['id', 'status'])
          .where('public_id', '=', input.goalId)
          .where('user_id', '=', this.userId)
          .where('trip_id', '=', trip.id)
          .forShare()
          .executeTakeFirst()
        if (!goal) throw resourceNotFound('Goal was not found')
        assertArtifactGoalWritable(goal.status)
        goalId = goal.id
      }

      let goalRunId: string | null = null
      if (input.runId !== undefined) {
        const run = await untyped(trx).selectFrom('planning_goal_runs')
          .select(['id', 'goal_id', 'context_version', 'status'])
          .where('public_id', '=', input.runId)
          .where('user_id', '=', this.userId)
          .where('trip_id', '=', trip.id)
          .forShare()
          .executeTakeFirst()
        if (!run || (goalId !== null && run.goal_id !== goalId)) throw resourceNotFound('Goal run was not found')
        if (input.tripContextVersion !== undefined && input.tripContextVersion !== run.context_version) {
          throw new AppError('TRIP_CONTEXT_VERSION_CONFLICT', 'Artifact Trip Context version does not match goal run', 409)
        }
        assertArtifactRunWritable(run.status)
        goalRunId = run.id
      }

      for (const sourceId of sourceArtifactIds) {
        const source = await untyped(trx).selectFrom('artifacts')
          .select(['id', 'trip_context_version', 'payload_json'])
          .where('public_id', '=', sourceId)
          .where('user_id', '=', this.userId)
          .where('trip_id', '=', trip.id)
          .executeTakeFirst()
        if (!source) throw resourceNotFound('Source artifact was not found')
        if (input.tripContextVersion !== undefined) {
          assertArtifactContextVersion({
            ...(source.trip_context_version === null ? {} : { tripContextVersion: source.trip_context_version }),
            payload: source.payload_json
          }, input.tripContextVersion)
        }
      }

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

      const row = await untyped(trx)
        .insertInto('artifacts')
        .values({
          public_id: input.id ?? uuidv7(),
          user_id: this.userId,
          trip_id: trip.id,
          conversation_id: conversationId,
          goal_id: goalId,
          goal_run_id: goalRunId,
          trip_context_version: input.tripContextVersion ?? null,
          source_artifact_ids_json: JSON.stringify(sourceArtifactIds),
          type: input.type,
          schema_version: input.schemaVersion,
          payload_json: JSON.stringify(input.payload),
          verification_json: input.verification === undefined ? null : JSON.stringify(input.verification)
        })
        .returning([
          'id as internal_id', 'public_id as id', 'trip_id', 'conversation_id', 'type', 'schema_version',
          'payload_json', 'verification_json', 'trip_context_version', 'source_artifact_ids_json', 'created_at', 'updated_at'
        ])
        .executeTakeFirstOrThrow()

      if (researchAuditId) {
        let link = untyped(trx).updateTable('research_generation_audits')
          .set({ artifact_id: row.internal_id, delivered_at: new Date(), updated_at: new Date() })
          .where('public_id', '=', researchAuditId).where('user_id', '=', this.userId)
          .where('trip_id', '=', trip.id)
          .where('trip_context_version', '=', input.tripContextVersion ?? null)
          .where('status', '=', 'succeeded').where('artifact_id', 'is', null)
        link = conversationId === null ? link.where('conversation_id', 'is', null) : link.where('conversation_id', '=', conversationId)
        link = goalId === null ? link.where('goal_id', 'is', null) : link.where('goal_id', '=', goalId)
        link = goalRunId === null ? link.where('goal_run_id', 'is', null) : link.where('goal_run_id', '=', goalRunId)
        const linked = await link.returning('id').executeTakeFirst()
        if (!linked) throw new AppError('RESEARCH_AUDIT_LINK_FAILED', 'Research audit could not be linked to the final artifact', 409)
      }

      const artifact = toArtifact(row)
      return {
        ...artifact,
        tripId: input.tripId,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
        ...(input.goalId === undefined ? {} : { goalId: input.goalId }),
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.tripContextVersion === undefined ? {} : { tripContextVersion: input.tripContextVersion }),
        sourceArtifactIds
      }
    })
  }

  async get(artifactId: string): Promise<ArtifactRecord | undefined> {
    const row = await selectArtifacts(untyped(this.db))
      .where('artifacts.public_id', '=', artifactId)
      .where('artifacts.user_id', '=', this.userId)
      .executeTakeFirst()
    return row ? toArtifact(row) : undefined
  }

  async getForScope(artifactId: string, scope: ArtifactScope): Promise<ArtifactRecord | undefined> {
    const record = await this.get(artifactId)
    return record && scopeMatches(record, scope) ? record : undefined
  }

  async listForTrip(tripId: string, limit = 10): Promise<ArtifactRecord[]> {
    const rows = await selectArtifacts(untyped(this.db))
      .where('artifacts.user_id', '=', this.userId).where('trips.user_id', '=', this.userId).where('trips.public_id', '=', tripId)
      .orderBy('artifacts.created_at', 'desc').orderBy('artifacts.public_id', 'desc').limit(boundedLimit(limit)).execute()
    return rows.map(toArtifact)
  }

  async listForGoal(goalId: string, limit = 10): Promise<ArtifactRecord[]> {
    const rows = await selectArtifacts(untyped(this.db))
      .where('artifacts.user_id', '=', this.userId).where('planning_goals.user_id', '=', this.userId)
      .where('planning_goals.public_id', '=', goalId)
      .orderBy('artifacts.created_at', 'desc').orderBy('artifacts.public_id', 'desc').limit(boundedLimit(limit)).execute()
    return rows.map(toArtifact)
  }

  async listForRun(runId: string, limit = 10): Promise<ArtifactRecord[]> {
    const rows = await selectArtifacts(untyped(this.db))
      .where('artifacts.user_id', '=', this.userId).where('planning_goal_runs.user_id', '=', this.userId)
      .where('planning_goal_runs.public_id', '=', runId)
      .orderBy('artifacts.created_at', 'desc').orderBy('artifacts.public_id', 'desc').limit(boundedLimit(limit)).execute()
    return rows.map(toArtifact)
  }
}

function boundedLimit(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value))) : 10
}
