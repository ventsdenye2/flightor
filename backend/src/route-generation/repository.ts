import { v7 as uuidv7 } from 'uuid'
import type { Kysely, Transaction } from 'kysely'
import type { Database, JsonValue } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import {
  type CreateRouteGenerationRunInput,
  type RouteGenerationRunMutation,
  type RouteGenerationRunRecord,
  type RouteGenerationRunRepository,
  routeGenerationProgressStageSchema,
  routeGenerationStatusSchema
} from './contracts.js'
import { tripContextSchema } from '../trips/types.js'

type Db = Kysely<Database> | Transaction<Database>
type RunRow = {
  public_id: string
  user_id: string
  trip_public_id: string
  conversation_public_id: string | null
  idempotency_key: string
  request_hash: string
  context_json: unknown
  context_version: number
  status: string
  progress_stage: string
  progress_percent: number
  result_artifact_public_id: string | null
  error_code: string | null
  error_message: string | null
  warnings_json: unknown
  created_at: Date | string
  updated_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function warnings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, 40)
}

function toRecord(row: RunRow): RouteGenerationRunRecord {
  const status = routeGenerationStatusSchema.parse(row.status)
  const progressStage = routeGenerationProgressStageSchema.parse(row.progress_stage)
  return {
    id: row.public_id,
    ownerId: row.user_id,
    tripId: row.trip_public_id,
    ...(row.conversation_public_id === null ? {} : { conversationId: row.conversation_public_id }),
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    contextSnapshot: tripContextSchema.parse(typeof row.context_json === 'string' ? JSON.parse(row.context_json) : row.context_json),
    contextVersion: row.context_version,
    status,
    progressStage,
    progressPercent: row.progress_percent,
    ...(row.result_artifact_public_id === null ? {} : { resultArtifactId: row.result_artifact_public_id }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    warnings: warnings(row.warnings_json),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.started_at === null ? {} : { startedAt: iso(row.started_at) }),
    ...(row.finished_at === null ? {} : { finishedAt: iso(row.finished_at) })
  }
}

function notFound(message: string): AppError {
  return new AppError('RESOURCE_NOT_FOUND', message, 404)
}

function versionConflict(expected: number, actual: number): AppError {
  return new AppError('TRIP_CONTEXT_VERSION_CONFLICT', `Trip context version conflict: expected ${expected}, got ${actual}`, 409, {
    expectedVersion: expected, actualVersion: actual
  })
}

const selectRun = (db: Db) => db
  .selectFrom('route_generation_runs')
  .innerJoin('trips', 'trips.id', 'route_generation_runs.trip_id')
  .leftJoin('conversations', 'conversations.id', 'route_generation_runs.conversation_id')
  .leftJoin('artifacts', 'artifacts.id', 'route_generation_runs.result_artifact_id')
  .select([
    'route_generation_runs.public_id', 'route_generation_runs.user_id',
    'trips.public_id as trip_public_id', 'conversations.public_id as conversation_public_id',
    'route_generation_runs.idempotency_key', 'route_generation_runs.request_hash',
    'route_generation_runs.context_json', 'route_generation_runs.context_version',
    'route_generation_runs.status', 'route_generation_runs.progress_stage',
    'route_generation_runs.progress_percent', 'artifacts.public_id as result_artifact_public_id',
    'route_generation_runs.error_code', 'route_generation_runs.error_message',
    'route_generation_runs.warnings_json', 'route_generation_runs.created_at',
    'route_generation_runs.updated_at', 'route_generation_runs.started_at',
    'route_generation_runs.finished_at'
  ])

/** PostgreSQL repository. The repository is constructed with a trusted internal user id. */
export class PostgresRouteGenerationRunRepository implements RouteGenerationRunRepository {
  /** Omit ownerId only for the trusted worker, which resolves ownership from the run row before constructing scoped trip/artifact repositories. */
  constructor(private readonly db: Kysely<Database>, private readonly ownerId?: string) {}

  async createOrGet(input: CreateRouteGenerationRunInput): Promise<{ run: RouteGenerationRunRecord; created: boolean }> {
    if (this.ownerId !== undefined && this.ownerId !== input.ownerId) throw notFound('Trip was not found')
    return this.db.transaction().execute(async trx => {
      const trip = await trx.selectFrom('trips')
        .select(['id', 'public_id', 'current_context_version'])
        .where('public_id', '=', input.tripId)
        .where('user_id', '=', input.ownerId)
        // Serialize run acceptance with TripContext writes. The frozen snapshot
        // and job are accepted only while this version remains current.
        .forUpdate()
        .executeTakeFirst()
      if (!trip) throw notFound('Trip was not found')

      const existing = await selectRun(trx)
        .where('route_generation_runs.user_id', '=', input.ownerId)
        .where('route_generation_runs.trip_id', '=', trip.id)
        .where('route_generation_runs.idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst() as RunRow | undefined
      if (existing) {
        const current = toRecord(existing)
        if (current.requestHash !== input.requestHash || current.contextVersion !== input.contextVersion || current.conversationId !== input.conversationId) {
          throw new AppError('IDEMPOTENCY_KEY_REUSE', 'Idempotency-Key was already used for a different request', 409)
        }
        return { run: current, created: false }
      }

      if (trip.current_context_version !== input.contextVersion) {
        throw versionConflict(input.contextVersion, trip.current_context_version)
      }

      if (input.conversationId !== undefined) {
        const conversation = await trx.selectFrom('conversations')
          .select('id')
          .where('public_id', '=', input.conversationId)
          .where('user_id', '=', input.ownerId)
          .where('trip_id', '=', trip.id)
          .executeTakeFirst()
        if (!conversation) throw notFound('Conversation was not found')
      }

      const conversationRow = input.conversationId === undefined
        ? undefined
        : await trx.selectFrom('conversations').select('id')
          .where('public_id', '=', input.conversationId)
          .where('user_id', '=', input.ownerId)
          .where('trip_id', '=', trip.id)
          .executeTakeFirstOrThrow()

      const publicId = uuidv7()
      const inserted = await trx.insertInto('route_generation_runs').values({
        public_id: publicId,
        user_id: input.ownerId,
        trip_id: trip.id,
        conversation_id: conversationRow?.id ?? null,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        context_version: input.contextVersion,
        context_json: input.contextSnapshot as unknown as JsonValue,
        status: 'queued',
        progress_stage: 'queued',
        progress_percent: 0,
        result_artifact_id: null,
        error_code: null,
        error_message: null,
        warnings_json: [] as unknown as JsonValue,
        started_at: null,
        finished_at: null,
        created_at: new Date(),
        updated_at: new Date()
      }).onConflict(oc => oc.columns(['user_id', 'trip_id', 'idempotency_key']).doNothing()).returning('id').executeTakeFirst()

      if (!inserted) {
        const raced = await selectRun(trx)
          .where('route_generation_runs.user_id', '=', input.ownerId)
          .where('route_generation_runs.trip_id', '=', trip.id)
          .where('route_generation_runs.idempotency_key', '=', input.idempotencyKey)
          .executeTakeFirst() as RunRow | undefined
        if (!raced) throw new AppError('ROUTE_GENERATION_CREATE_FAILED', 'Route generation run could not be created', 500)
        const current = toRecord(raced)
        if (current.requestHash !== input.requestHash || current.contextVersion !== input.contextVersion || current.conversationId !== input.conversationId) {
          throw new AppError('IDEMPOTENCY_KEY_REUSE', 'Idempotency-Key was already used for a different request', 409)
        }
        return { run: current, created: false }
      }

      await trx.insertInto('jobs').values({
        type: 'route_generation',
        payload: { runId: publicId } as unknown as JsonValue,
        run_at: new Date(),
        max_attempts: 3,
        locked_by: null,
        locked_at: null,
        last_error: null,
        completed_at: null
      }).execute()

      const created = await selectRun(trx)
        .where('route_generation_runs.public_id', '=', publicId)
        .executeTakeFirstOrThrow() as RunRow
      return { run: toRecord(created), created: true }
    })
  }

  async get(runId: string): Promise<RouteGenerationRunRecord | undefined> {
    let query = selectRun(this.db).where('route_generation_runs.public_id', '=', runId)
    if (this.ownerId !== undefined) query = query.where('route_generation_runs.user_id', '=', this.ownerId)
    const row = await query.executeTakeFirst() as RunRow | undefined
    return row ? toRecord(row) : undefined
  }

  async claim(runId: string): Promise<RouteGenerationRunRecord | undefined> {
    const now = new Date()
    let query = this.db.updateTable('route_generation_runs')
      .set({ status: 'running', progress_stage: 'searching_connections', progress_percent: 10, started_at: now, updated_at: now })
      .where('public_id', '=', runId)
      .where(eb => eb.or([
        eb('status', '=', 'queued'),
        eb.and([
          eb('status', '=', 'running'),
          eb('updated_at', '<', new Date(Date.now() - 15 * 60_000))
        ])
      ]))
    if (this.ownerId !== undefined) query = query.where('user_id', '=', this.ownerId)
    const updated = await query
      .returning('public_id')
      .executeTakeFirst()
    if (!updated) return undefined
    return this.get(runId)
  }

  async update(runId: string, mutation: RouteGenerationRunMutation): Promise<RouteGenerationRunRecord | undefined> {
    return this.db.transaction().execute(async trx => {
      let runQuery = trx.selectFrom('route_generation_runs')
        .select(['id', 'trip_id', 'user_id', 'status', 'context_version'])
        .where('public_id', '=', runId)
      if (this.ownerId !== undefined) runQuery = runQuery.where('user_id', '=', this.ownerId)
      const run = await runQuery.executeTakeFirst()
      if (!run) return undefined
      if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') return this.getFrom(trx, runId)

      let resultArtifactId: string | null | undefined
      if (mutation.resultArtifactId !== undefined) {
        if (mutation.resultArtifactId === null) resultArtifactId = null
        else {
          const artifact = await trx.selectFrom('artifacts')
            .select('id')
            .where('public_id', '=', mutation.resultArtifactId)
          .where('user_id', '=', this.ownerId ?? run.user_id)
            .where('trip_id', '=', run.trip_id)
            .executeTakeFirst()
          if (!artifact) throw notFound('Result artifact was not found')
          resultArtifactId = artifact.id
        }
      }

      const values: Record<string, unknown> = { updated_at: new Date() }
      if (mutation.status !== undefined) values.status = mutation.status
      if (mutation.progressStage !== undefined) values.progress_stage = mutation.progressStage
      if (mutation.progressPercent !== undefined) values.progress_percent = mutation.progressPercent
      if (resultArtifactId !== undefined) values.result_artifact_id = resultArtifactId
      if (mutation.errorCode !== undefined) values.error_code = mutation.errorCode
      if (mutation.errorMessage !== undefined) values.error_message = mutation.errorMessage
      if (mutation.warnings !== undefined) values.warnings_json = mutation.warnings as unknown as JsonValue
      if (mutation.startedAt !== undefined) values.started_at = mutation.startedAt
      if (mutation.finishedAt !== undefined) values.finished_at = mutation.finishedAt
      let updateQuery = trx.updateTable('route_generation_runs').set(values as never)
        .where('public_id', '=', runId)
      if (this.ownerId !== undefined) updateQuery = updateQuery.where('user_id', '=', this.ownerId)
      // Every worker mutation belongs to a claimed run. This predicate makes
      // cancellation and all terminal states win even if they commit after the
      // status read above but before this write.
      updateQuery = updateQuery.where('status', '=', 'running')
      const updated = await updateQuery.executeTakeFirst()
      if (mutation.status === 'succeeded' && updated.numUpdatedRows > 0n) {
        await trx.updateTable('trips').set({ status: 'generated', updated_at: new Date() })
          .where('id', '=', run.trip_id).where('status', '=', 'planning')
          .where('current_context_version', '=', run.context_version).execute()
      }
      return this.getFrom(trx, runId)
    })
  }

  async cancel(runId: string): Promise<RouteGenerationRunRecord | undefined> {
    let query = this.db.updateTable('route_generation_runs').set({
      status: 'cancelled', progress_stage: 'cancelled', progress_percent: 100,
      error_code: null, error_message: null, finished_at: new Date(), updated_at: new Date()
    }).where('public_id', '=', runId)
    if (this.ownerId !== undefined) query = query.where('user_id', '=', this.ownerId)
    await query.where('status', 'in', ['queued', 'running']).execute()
    return this.get(runId)
  }

  private async getFrom(db: Db, runId: string): Promise<RouteGenerationRunRecord | undefined> {
    let query = selectRun(db).where('route_generation_runs.public_id', '=', runId)
    if (this.ownerId !== undefined) query = query.where('route_generation_runs.user_id', '=', this.ownerId)
    const row = await query.executeTakeFirst() as RunRow | undefined
    return row ? toRecord(row) : undefined
  }
}

/** Deterministic repository used by unit tests and local service composition. */
export class InMemoryRouteGenerationRunRepository implements RouteGenerationRunRepository {
  private readonly records = new Map<string, RouteGenerationRunRecord>()
  private readonly jobs: string[] = []

  constructor(private readonly ownerId: string, private readonly ownedTripIds: ReadonlySet<string>) {}

  get enqueuedJobRunIds(): readonly string[] { return [...this.jobs] }

  async createOrGet(input: CreateRouteGenerationRunInput): Promise<{ run: RouteGenerationRunRecord; created: boolean }> {
    if (input.ownerId !== this.ownerId || !this.ownedTripIds.has(input.tripId)) throw notFound('Trip was not found')
    const existing = [...this.records.values()].find(run => run.tripId === input.tripId && run.idempotencyKey === input.idempotencyKey)
    if (existing) {
      if (existing.requestHash !== input.requestHash || existing.contextVersion !== input.contextVersion || existing.conversationId !== input.conversationId) {
        throw new AppError('IDEMPOTENCY_KEY_REUSE', 'Idempotency-Key was already used for a different request', 409)
      }
      return { run: structuredClone(existing), created: false }
    }
    const now = new Date().toISOString()
    const run: RouteGenerationRunRecord = {
      id: uuidv7(), ownerId: this.ownerId, tripId: input.tripId,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
      contextSnapshot: structuredClone(input.contextSnapshot), contextVersion: input.contextVersion,
      status: 'queued', progressStage: 'queued', progressPercent: 0,
      warnings: [], createdAt: now, updatedAt: now
    }
    this.records.set(run.id, run)
    this.jobs.push(run.id)
    return { run: structuredClone(run), created: true }
  }

  async get(runId: string): Promise<RouteGenerationRunRecord | undefined> {
    const run = this.records.get(runId)
    return run?.ownerId === this.ownerId ? structuredClone(run) : undefined
  }

  async claim(runId: string): Promise<RouteGenerationRunRecord | undefined> {
    const run = this.records.get(runId)
    if (!run || run.ownerId !== this.ownerId || run.status !== 'queued') return undefined
    const now = new Date().toISOString()
    run.status = 'running'; run.progressStage = 'searching_connections'; run.progressPercent = 10
    run.startedAt = now; run.updatedAt = now
    return structuredClone(run)
  }

  async update(runId: string, mutation: RouteGenerationRunMutation): Promise<RouteGenerationRunRecord | undefined> {
    const run = this.records.get(runId)
    if (!run || run.ownerId !== this.ownerId) return undefined
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') return structuredClone(run)
    if ((mutation.status === 'succeeded' || mutation.status === 'failed') && run.status !== 'running') return structuredClone(run)
    if (mutation.status !== undefined) run.status = mutation.status
    if (mutation.progressStage !== undefined) run.progressStage = mutation.progressStage
    if (mutation.progressPercent !== undefined) run.progressPercent = mutation.progressPercent
    if (mutation.resultArtifactId !== undefined) {
      if (mutation.resultArtifactId === null) delete run.resultArtifactId
      else run.resultArtifactId = mutation.resultArtifactId
    }
    if (mutation.errorCode !== undefined) {
      if (mutation.errorCode === null) delete run.errorCode
      else run.errorCode = mutation.errorCode
    }
    if (mutation.errorMessage !== undefined) {
      if (mutation.errorMessage === null) delete run.errorMessage
      else run.errorMessage = mutation.errorMessage
    }
    if (mutation.warnings !== undefined) run.warnings = [...mutation.warnings].slice(0, 40)
    if (mutation.startedAt !== undefined) {
      if (mutation.startedAt === null) delete run.startedAt
      else run.startedAt = mutation.startedAt
    }
    if (mutation.finishedAt !== undefined) {
      if (mutation.finishedAt === null) delete run.finishedAt
      else run.finishedAt = mutation.finishedAt
    }
    run.updatedAt = new Date().toISOString()
    return structuredClone(run)
  }

  async cancel(runId: string): Promise<RouteGenerationRunRecord | undefined> {
    const run = this.records.get(runId)
    if (!run || run.ownerId !== this.ownerId) return undefined
    if (run.status === 'queued' || run.status === 'running') {
      const now = new Date().toISOString()
      run.status = 'cancelled'; run.progressStage = 'cancelled'; run.progressPercent = 100
      run.finishedAt = now; run.updatedAt = now
    }
    return structuredClone(run)
  }
}
