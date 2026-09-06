import type { Kysely, Transaction } from 'kysely'
import { v7 as uuidv7 } from 'uuid'
import type { Database, JsonValue } from '../db/types.js'
import {
  applyTripContextPatch,
  TripContextVersionConflict,
  type CreateTripInput,
  type Trip,
  type TripContextRepository,
  type TripRepository,
  type TripStatus
} from './repository.js'
import { emptyTripContext, tripContextSchema, type TripContext, type TripContextPatch } from './types.js'

type Db = Kysely<Database> | Transaction<Database>

interface TripRow {
  id: string
  public_id: string
  title: string
  status: TripStatus
  current_context_version: number
  created_at: Date | string
  updated_at: Date | string
}

interface TripContextRow {
  context_json: JsonValue | string
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function contextFromRow(value: JsonValue | string): TripContext {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return tripContextSchema.parse(parsed)
}

function cancelled(guard?: { signal?: AbortSignal; isCurrent?: () => boolean }): boolean {
  return Boolean(guard?.signal?.aborted || guard?.isCurrent?.() === false)
}

function updateCancelled(): Error {
  return new Error('TRIP_CONTEXT_UPDATE_CANCELLED')
}

/** PostgreSQL implementation of the user-scoped trip context repository. */
export class PostgresTripContextRepository implements TripContextRepository {
  protected readonly db: Kysely<Database>
  protected readonly userId: string

  constructor(db: Kysely<Database>, userId: string) {
    this.db = db
    this.userId = userId
  }

  async get(tripId: string): Promise<TripContext | undefined> {
    const row = await this.db
      .selectFrom('trips')
      .innerJoin('trip_context_versions', join => join
        .onRef('trip_context_versions.trip_id', '=', 'trips.id')
        .onRef('trip_context_versions.version', '=', 'trips.current_context_version'))
      .select('trip_context_versions.context_json')
      .where('trips.public_id', '=', tripId)
      .where('trips.user_id', '=', this.userId)
      .executeTakeFirst()
    return row ? contextFromRow(row.context_json) : undefined
  }

  async update(
    tripId: string,
    patch: TripContextPatch,
    expectedVersion?: number,
    guard?: { signal?: AbortSignal; isCurrent?: () => boolean }
  ): Promise<TripContext> {
    if (cancelled(guard)) throw updateCancelled()

    return this.db.transaction().execute(async trx => {
      // Lock the aggregate row before reading the snapshot. This serializes all
      // context writes for an owned trip and makes the pointer/version check atomic.
      const trip = await trx
        .selectFrom('trips')
        .select(['id', 'current_context_version'])
        .where('public_id', '=', tripId)
        .where('user_id', '=', this.userId)
        .forUpdate()
        .executeTakeFirst()
      if (!trip) throw new Error('TRIP_CONTEXT_NOT_FOUND')

      const actualVersion = trip.current_context_version
      if (expectedVersion !== undefined && expectedVersion !== actualVersion) {
        throw new TripContextVersionConflict(expectedVersion, actualVersion)
      }

      const currentRow = await trx
        .selectFrom('trip_context_versions')
        .select('context_json')
        .where('trip_id', '=', trip.id)
        .where('version', '=', actualVersion)
        .executeTakeFirst()
      if (!currentRow) throw new Error('TRIP_CONTEXT_NOT_FOUND')

      const current = contextFromRow(currentRow.context_json)
      const next = tripContextSchema.parse(applyTripContextPatch(current, patch))
      if (cancelled(guard)) throw updateCancelled()

      await trx.insertInto('trip_context_versions').values({
        trip_id: trip.id,
        version: next.version,
        context_json: next as unknown as JsonValue
      }).execute()
      await trx.updateTable('trips').set({
        current_context_version: next.version,
        updated_at: new Date()
      }).where('id', '=', trip.id).execute()

      if (cancelled(guard)) throw updateCancelled()
      return structuredClone(next)
    })
  }
}

/** PostgreSQL implementation of a user-scoped trip aggregate repository. */
export class PostgresTripRepository extends PostgresTripContextRepository implements TripRepository {
  async create(input: CreateTripInput = {}): Promise<Trip> {
    const publicId = uuidv7()
    const now = new Date()
    const base = emptyTripContext(publicId)
    // Initial input is part of version zero, matching InMemoryTripRepository.
    const context = tripContextSchema.parse(
      input.initialContext && Object.keys(input.initialContext).length > 0
        ? applyTripContextPatch({ ...base, version: -1 }, input.initialContext)
        : base
    )

    return this.db.transaction().execute(async trx => {
      const trip = await trx.insertInto('trips').values({
        public_id: publicId,
        user_id: this.userId,
        title: input.title ?? '',
        status: 'planning',
        current_context_version: 0,
        created_at: now,
        updated_at: now
      }).returning([
        'id',
        'public_id',
        'title',
        'status',
        'current_context_version',
        'created_at',
        'updated_at'
      ]).executeTakeFirstOrThrow() as TripRow

      await trx.insertInto('trip_context_versions').values({
        trip_id: trip.id,
        version: context.version,
        context_json: context as unknown as JsonValue,
        created_at: now
      }).execute()

      return {
        id: trip.public_id,
        title: trip.title,
        status: trip.status,
        currentContextVersion: trip.current_context_version,
        context: structuredClone(context),
        createdAt: iso(trip.created_at),
        updatedAt: iso(trip.updated_at)
      }
    })
  }

  async getTrip(tripId: string): Promise<Trip | undefined> {
    const row = await this.db
      .selectFrom('trips')
      .innerJoin('trip_context_versions', join => join
        .onRef('trip_context_versions.trip_id', '=', 'trips.id')
        .onRef('trip_context_versions.version', '=', 'trips.current_context_version'))
      .select([
        'trips.id',
        'trips.public_id',
        'trips.title',
        'trips.status',
        'trips.current_context_version',
        'trips.created_at',
        'trips.updated_at',
        'trip_context_versions.context_json'
      ])
      .where('trips.public_id', '=', tripId)
      .where('trips.user_id', '=', this.userId)
      .executeTakeFirst() as (TripRow & TripContextRow) | undefined
    if (!row) return undefined
    return {
      id: row.public_id,
      title: row.title,
      status: row.status,
      currentContextVersion: row.current_context_version,
      context: contextFromRow(row.context_json),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    }
  }
}
