import { v7 as uuidv7 } from 'uuid'
import type { Kysely, Transaction } from 'kysely'
import type { Database, JsonValue } from '../../db/types.js'
import { AppError } from '../../lib/errors.js'
import { tripContextSchema } from '../../trips/types.js'
import {
  createGoalInputSchema,
  createGoalRunInputSchema,
  emptyGoalWorkingSet,
  goalRecordSchema,
  goalRunRecordSchema,
  goalRunStatusUpdateSchema,
  goalStatusUpdateSchema,
  type CreateGoalInput,
  type CreateGoalRunInput,
  type GoalRecord,
  type GoalRunRecord,
  type GoalRunStatusUpdate,
  type GoalStatusUpdate
} from './types.js'
import {
  canonicalFingerprint,
  canGoalTransition,
  canRunTransition,
  goalCompletionInputSchema,
  planGoalCompletion,
  GoalIdempotencyConflict,
  GoalRevisionConflict,
  GoalRunIdempotencyConflict,
  GoalRunRevisionConflict,
  GoalRunStatusConflict,
  GoalStatusConflict,
  type GoalRepository,
  type GoalRunCompatibilityQuery,
  type GoalRunRepository,
  type GoalCompletionInput,
  type GoalCompletionResult
} from './repository.js'

type Db = Kysely<Database> | Transaction<Database>

type GoalRow = {
  id: string
  public_id: string
  user_id: string
  trip_id: string
  trip_public_id: string
  conversation_public_id: string | null
  idempotency_key: string
  request_hash: string
  kind: string
  parameters_json: unknown
  created_context_version: number
  authorization_source: string | null
  authorization_granted_at: Date | string | null
  status: string
  revision: number
  created_at: Date | string
  updated_at: Date | string
}

type GoalRunRow = {
  id: string
  public_id: string
  goal_id: string
  goal_public_id: string
  user_id: string
  trip_id: string
  trip_public_id: string
  generation_id: string
  idempotency_key: string
  request_hash: string
  context_version: number
  context_json: unknown
  status: string
  working_set_json: unknown
  revision: number
  created_at: Date | string
  updated_at: Date | string
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function notFound(message: string): AppError {
  return new AppError('RESOURCE_NOT_FOUND', message, 404)
}

function versionConflict(expected: number, actual: number): AppError {
  return new AppError('TRIP_CONTEXT_VERSION_CONFLICT', `Trip context version conflict: expected ${expected}, got ${actual}`, 409, {
    expectedVersion: expected, actualVersion: actual
  })
}

function toGoal(row: GoalRow): GoalRecord {
  const authorization = row.authorization_source === null || row.authorization_granted_at === null
    ? undefined
    : { source: row.authorization_source, grantedAt: iso(row.authorization_granted_at) }
  return goalRecordSchema.parse({
    id: row.public_id,
    ownerId: row.user_id,
    tripId: row.trip_public_id,
    ...(row.conversation_public_id === null ? {} : { conversationId: row.conversation_public_id }),
    kind: row.kind,
    status: row.status,
    parameters: json(row.parameters_json),
    createdContextVersion: row.created_context_version,
    ...(authorization === undefined ? {} : { authorization }),
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  })
}

function toRun(row: GoalRunRow): GoalRunRecord {
  return goalRunRecordSchema.parse({
    id: row.public_id,
    ownerId: row.user_id,
    goalId: row.goal_public_id,
    tripId: row.trip_public_id,
    generationId: row.generation_id,
    contextVersion: row.context_version,
    contextSnapshot: tripContextSchema.parse(json(row.context_json)),
    status: row.status,
    workingSet: json(row.working_set_json),
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  })
}

const selectGoal = (db: Db) => db
  .selectFrom('planning_goals')
  .innerJoin('trips', 'trips.id', 'planning_goals.trip_id')
  .leftJoin('conversations', 'conversations.id', 'planning_goals.conversation_id')
  .select([
    'planning_goals.id', 'planning_goals.public_id', 'planning_goals.user_id', 'planning_goals.trip_id',
    'trips.public_id as trip_public_id', 'conversations.public_id as conversation_public_id',
    'planning_goals.idempotency_key', 'planning_goals.request_hash', 'planning_goals.kind',
    'planning_goals.parameters_json', 'planning_goals.created_context_version',
    'planning_goals.authorization_source', 'planning_goals.authorization_granted_at',
    'planning_goals.status', 'planning_goals.revision', 'planning_goals.created_at', 'planning_goals.updated_at'
  ])

const selectRun = (db: Db) => db
  .selectFrom('planning_goal_runs')
  .innerJoin('planning_goals', 'planning_goals.id', 'planning_goal_runs.goal_id')
  .innerJoin('trips', 'trips.id', 'planning_goal_runs.trip_id')
  .select([
    'planning_goal_runs.id', 'planning_goal_runs.public_id', 'planning_goal_runs.goal_id',
    'planning_goals.public_id as goal_public_id', 'planning_goal_runs.user_id', 'planning_goal_runs.trip_id',
    'trips.public_id as trip_public_id', 'planning_goal_runs.generation_id',
    'planning_goal_runs.idempotency_key', 'planning_goal_runs.request_hash',
    'planning_goal_runs.context_version', 'planning_goal_runs.context_json', 'planning_goal_runs.status',
    'planning_goal_runs.working_set_json', 'planning_goal_runs.revision',
    'planning_goal_runs.created_at', 'planning_goal_runs.updated_at'
  ])

function goalFingerprint(input: CreateGoalInput): string {
  return canonicalFingerprint({
    tripId: input.tripId,
    conversationId: input.conversationId,
    kind: input.kind,
    parameters: input.parameters,
    // grantedAt is server-observed metadata and changes on a transport retry.
    // The authorization source is the idempotent request fact.
    authorizationSource: input.authorization?.source
  })
}

function runFingerprint(input: CreateGoalRunInput): string {
  return canonicalFingerprint({
    goalId: input.goalId,
    tripId: input.tripId,
    contextVersion: input.contextVersion,
    contextSnapshot: input.contextSnapshot
  })
}

function isTerminal(status: string): boolean {
  return status === 'satisfied' || status === 'partial' || status === 'failed' || status === 'cancelled'
}

/** PostgreSQL implementation scoped to one trusted internal user id. */
export class PostgresGoalRepository implements GoalRepository {
  constructor(private readonly db: Kysely<Database>, private readonly ownerId: string) {}

  async create(rawInput: CreateGoalInput): Promise<{ goal: GoalRecord; created: boolean }> {
    const input = createGoalInputSchema.parse(rawInput)
    const requestHash = goalFingerprint(input)
    return this.db.transaction().execute(async trx => {
      const trip = await trx.selectFrom('trips').select(['id', 'current_context_version'])
        .where('public_id', '=', input.tripId).where('user_id', '=', this.ownerId).forUpdate().executeTakeFirst()
      if (!trip) throw notFound('Trip was not found')

      const existing = await selectGoal(trx)
        .where('planning_goals.user_id', '=', this.ownerId)
        .where('planning_goals.trip_id', '=', trip.id)
        .where('planning_goals.idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst() as GoalRow | undefined
      if (existing) {
        if (existing.request_hash !== requestHash) throw new GoalIdempotencyConflict()
        return { goal: toGoal(existing), created: false }
      }
      if (trip.current_context_version !== input.createdContextVersion) {
        throw versionConflict(input.createdContextVersion, trip.current_context_version)
      }

      let conversationId: string | null = null
      if (input.conversationId !== undefined) {
        const conversation = await trx.selectFrom('conversations').select('id')
          .where('public_id', '=', input.conversationId).where('user_id', '=', this.ownerId)
          .where('trip_id', '=', trip.id).executeTakeFirst()
        if (!conversation) throw notFound('Conversation was not found')
        conversationId = conversation.id
      }

      const publicId = input.id ?? uuidv7()
      const now = new Date()
      const inserted = await trx.insertInto('planning_goals').values({
        public_id: publicId,
        user_id: this.ownerId,
        trip_id: trip.id,
        conversation_id: conversationId,
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
        kind: input.kind,
        parameters_json: input.parameters as JsonValue,
        created_context_version: input.createdContextVersion,
        authorization_source: input.authorization?.source ?? null,
        authorization_granted_at: input.authorization?.grantedAt ?? null,
        status: 'pending',
        revision: 0,
        created_at: now,
        updated_at: now,
        completed_at: null
      }).onConflict(oc => oc.columns(['user_id', 'trip_id', 'idempotency_key']).doNothing()).returning('id').executeTakeFirst()

      if (!inserted) {
        const raced = await selectGoal(trx)
          .where('planning_goals.user_id', '=', this.ownerId).where('planning_goals.trip_id', '=', trip.id)
          .where('planning_goals.idempotency_key', '=', input.idempotencyKey).executeTakeFirst() as GoalRow | undefined
        if (!raced) throw new AppError('GOAL_CREATE_FAILED', 'Goal could not be created', 500)
        if (raced.request_hash !== requestHash) throw new GoalIdempotencyConflict()
        return { goal: toGoal(raced), created: false }
      }

      const created = await selectGoal(trx).where('planning_goals.public_id', '=', publicId)
        .where('planning_goals.user_id', '=', this.ownerId).executeTakeFirstOrThrow() as GoalRow
      return { goal: toGoal(created), created: true }
    })
  }

  async get(goalId: string): Promise<GoalRecord | undefined> {
    const row = await selectGoal(this.db).where('planning_goals.public_id', '=', goalId)
      .where('planning_goals.user_id', '=', this.ownerId).executeTakeFirst() as GoalRow | undefined
    return row ? toGoal(row) : undefined
  }

  async listForTrip(tripId: string): Promise<GoalRecord[]> {
    const rows = await selectGoal(this.db)
      .where('planning_goals.user_id', '=', this.ownerId)
      .where('trips.public_id', '=', tripId)
      .orderBy('planning_goals.updated_at', 'desc')
      .orderBy('planning_goals.public_id', 'desc')
      .execute() as GoalRow[]
    return rows.map(toGoal)
  }

  async update(goalId: string, expectedRevision: number, rawPatch: GoalStatusUpdate): Promise<GoalRecord> {
    const patch = goalStatusUpdateSchema.parse(rawPatch)
    return this.db.transaction().execute(async trx => {
      // Lock only the aggregate row. PostgreSQL cannot apply FOR UPDATE to the
      // nullable side of selectGoal's Conversation LEFT JOIN.
      const row = await trx.selectFrom('planning_goals')
        .select(['id', 'revision', 'status'])
        .where('public_id', '=', goalId)
        .where('user_id', '=', this.ownerId)
        .forUpdate()
        .executeTakeFirst()
      if (!row) throw notFound('Goal was not found')
      if (row.revision !== expectedRevision) throw new GoalRevisionConflict(expectedRevision, row.revision)
      const current = goalRecordSchema.shape.status.parse(row.status)
      if (!canGoalTransition(current, patch.status)) throw new GoalStatusConflict(current, patch.status)
      const now = new Date()
      await trx.updateTable('planning_goals').set({
        status: patch.status,
        revision: row.revision + 1,
        updated_at: now,
        completed_at: isTerminal(patch.status) ? now : null
      }).where('id', '=', row.id).where('revision', '=', expectedRevision).execute()
      const updated = await selectGoal(trx).where('planning_goals.public_id', '=', goalId)
        .where('planning_goals.user_id', '=', this.ownerId).executeTakeFirstOrThrow() as GoalRow
      return toGoal(updated)
    })
  }
}

export class PostgresGoalRunRepository implements GoalRunRepository {
  constructor(private readonly db: Kysely<Database>, private readonly ownerId: string) {}

  async create(rawInput: CreateGoalRunInput): Promise<{ run: GoalRunRecord; created: boolean }> {
    const input = createGoalRunInputSchema.parse(rawInput)
    const requestHash = runFingerprint(input)
    return this.db.transaction().execute(async trx => {
      const trip = await trx.selectFrom('trips').select(['id', 'current_context_version'])
        .where('public_id', '=', input.tripId).where('user_id', '=', this.ownerId).forUpdate().executeTakeFirst()
      if (!trip) throw notFound('Trip was not found')
      const goal = await trx.selectFrom('planning_goals').select(['id', 'status', 'trip_id', 'conversation_id'])
        .where('public_id', '=', input.goalId).where('user_id', '=', this.ownerId)
        .where('trip_id', '=', trip.id).forUpdate().executeTakeFirst()
      if (!goal) throw notFound('Goal was not found')

      const existing = await selectRun(trx).where('planning_goal_runs.goal_id', '=', goal.id)
        .where('planning_goal_runs.idempotency_key', '=', input.idempotencyKey).executeTakeFirst() as GoalRunRow | undefined
      if (existing) {
        if (existing.request_hash !== requestHash) throw new GoalRunIdempotencyConflict()
        return { run: toRun(existing), created: false }
      }
      if (goal.status === 'cancelled' || goal.status === 'satisfied') {
        throw new AppError('GOAL_NOT_RUNNABLE', 'Goal is not runnable', 409)
      }
      if (trip.current_context_version !== input.contextVersion) {
        throw versionConflict(input.contextVersion, trip.current_context_version)
      }
      const running = await trx.selectFrom('planning_goal_runs').select('public_id')
        .where('goal_id', '=', goal.id).where('status', '=', 'running').executeTakeFirst()
      if (running) throw new AppError('GOAL_RUN_ALREADY_RUNNING', 'Goal already has a running execution', 409)

      const publicId = input.id ?? uuidv7()
      const now = new Date()
      const inserted = await trx.insertInto('planning_goal_runs').values({
        public_id: publicId,
        goal_id: goal.id,
        user_id: this.ownerId,
        trip_id: trip.id,
        conversation_id: goal.conversation_id,
        generation_id: input.generationId,
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
        context_version: input.contextVersion,
        context_json: input.contextSnapshot as unknown as JsonValue,
        status: 'running',
        working_set_json: emptyGoalWorkingSet() as unknown as JsonValue,
        revision: 0,
        created_at: now,
        updated_at: now,
        completed_at: null
      }).onConflict(oc => oc.columns(['goal_id', 'idempotency_key']).doNothing()).returning('id').executeTakeFirst()

      if (!inserted) {
        const raced = await selectRun(trx).where('planning_goal_runs.goal_id', '=', goal.id)
          .where('planning_goal_runs.idempotency_key', '=', input.idempotencyKey).executeTakeFirst() as GoalRunRow | undefined
        if (!raced) throw new AppError('GOAL_RUN_CREATE_FAILED', 'Goal run could not be created', 500)
        if (raced.request_hash !== requestHash) throw new GoalRunIdempotencyConflict()
        return { run: toRun(raced), created: false }
      }

      const created = await selectRun(trx).where('planning_goal_runs.public_id', '=', publicId)
        .where('planning_goal_runs.user_id', '=', this.ownerId).executeTakeFirstOrThrow() as GoalRunRow
      return { run: toRun(created), created: true }
    })
  }

  async get(runId: string): Promise<GoalRunRecord | undefined> {
    const row = await selectRun(this.db).where('planning_goal_runs.public_id', '=', runId)
      .where('planning_goal_runs.user_id', '=', this.ownerId).executeTakeFirst() as GoalRunRow | undefined
    return row ? toRun(row) : undefined
  }

  async listForGoal(goalId: string): Promise<GoalRunRecord[]> {
    const rows = await selectRun(this.db).where('planning_goal_runs.user_id', '=', this.ownerId)
      .where('planning_goals.public_id', '=', goalId)
      .orderBy('planning_goal_runs.updated_at', 'desc').orderBy('planning_goal_runs.public_id', 'desc')
      .execute() as GoalRunRow[]
    return rows.map(toRun)
  }

  async latestCompatible(query: GoalRunCompatibilityQuery): Promise<GoalRunRecord | undefined> {
    const statuses = query.statuses ?? ['running', 'satisfied', 'partial']
    const row = await selectRun(this.db).where('planning_goal_runs.user_id', '=', this.ownerId)
      .where('planning_goals.public_id', '=', query.goalId).where('trips.public_id', '=', query.tripId)
      .where('planning_goal_runs.context_version', '=', query.contextVersion)
      .where('planning_goal_runs.status', 'in', [...statuses])
      .orderBy('planning_goal_runs.updated_at', 'desc').orderBy('planning_goal_runs.public_id', 'desc')
      .executeTakeFirst() as GoalRunRow | undefined
    return row ? toRun(row) : undefined
  }

  async update(runId: string, expectedRevision: number, rawPatch: GoalRunStatusUpdate): Promise<GoalRunRecord> {
    const patch = goalRunStatusUpdateSchema.parse(rawPatch)
    return this.db.transaction().execute(async trx => {
      const row = await selectRun(trx).where('planning_goal_runs.public_id', '=', runId)
        .where('planning_goal_runs.user_id', '=', this.ownerId).forUpdate('planning_goal_runs').executeTakeFirst() as GoalRunRow | undefined
      if (!row) throw notFound('Goal run was not found')
      if (row.revision !== expectedRevision) throw new GoalRunRevisionConflict(expectedRevision, row.revision)
      const current = goalRunRecordSchema.shape.status.parse(row.status)
      if (!canRunTransition(current, patch.status)) throw new GoalRunStatusConflict(current, patch.status)
      if (current !== 'running' && patch.workingSet !== undefined) throw new GoalRunStatusConflict(current, patch.status)
      const now = new Date()
      await trx.updateTable('planning_goal_runs').set({
        status: patch.status,
        ...(patch.workingSet === undefined ? {} : { working_set_json: patch.workingSet as unknown as JsonValue }),
        revision: row.revision + 1,
        updated_at: now,
        completed_at: isTerminal(patch.status) ? now : null
      }).where('id', '=', row.id).where('revision', '=', expectedRevision).execute()
      const updated = await selectRun(trx).where('planning_goal_runs.public_id', '=', runId)
        .where('planning_goal_runs.user_id', '=', this.ownerId).executeTakeFirstOrThrow() as GoalRunRow
      return toRun(updated)
    })
  }

  async commitCompletion(rawInput: GoalCompletionInput): Promise<GoalCompletionResult> {
    const input = goalCompletionInputSchema.parse(rawInput)
    return this.db.transaction().execute(async trx => {
      // Match artifact/run creation lock order so completion and new writes cannot deadlock each other.
      const trip = await trx.selectFrom('trips').innerJoin('planning_goals', 'planning_goals.trip_id', 'trips.id')
        .select(['trips.id', 'trips.current_context_version'])
        .where('planning_goals.public_id', '=', input.goalId).where('planning_goals.user_id', '=', this.ownerId)
        .where('trips.user_id', '=', this.ownerId).forUpdate('trips').executeTakeFirst()
      if (!trip) throw notFound('Trip was not found')
      const goalRow = await selectGoal(trx).where('planning_goals.public_id', '=', input.goalId)
        .where('planning_goals.user_id', '=', this.ownerId).where('planning_goals.trip_id', '=', trip.id)
        .forUpdate('planning_goals').executeTakeFirst() as GoalRow | undefined
      const runRow = await selectRun(trx).where('planning_goal_runs.public_id', '=', input.runId)
        .where('planning_goal_runs.user_id', '=', this.ownerId).where('planning_goal_runs.trip_id', '=', trip.id)
        .forUpdate('planning_goal_runs').executeTakeFirst() as GoalRunRow | undefined
      if (!goalRow || !runRow) throw notFound('Goal run was not found')
      const now = new Date()
      const result = planGoalCompletion(toGoal(goalRow), toRun(runRow), input, now.toISOString(), trip.current_context_version)
      if (result.goal.revision !== goalRow.revision) {
        await trx.updateTable('planning_goals').set({ status: result.goal.status, revision: result.goal.revision,
          updated_at: now, completed_at: isTerminal(result.goal.status) ? now : null }).where('id', '=', goalRow.id).execute()
      }
      if (result.run.revision !== runRow.revision) {
        await trx.updateTable('planning_goal_runs').set({ status: result.run.status, revision: result.run.revision,
          updated_at: now, completed_at: isTerminal(result.run.status) ? now : null }).where('id', '=', runRow.id).execute()
      }
      return result
    })
  }
}
