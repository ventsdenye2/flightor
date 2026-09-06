import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { TripContextVersionConflict } from './repository.js'
import { PostgresTripRepository } from './postgres.js'

type Condition = { column: string; value: unknown }

/** Small contract-focused fake for the Kysely calls made by postgres.ts. */
class FakeDb {
  readonly trips: Array<Record<string, unknown>> = []
  readonly versions: Array<Record<string, unknown>> = []
  readonly whereColumns: string[] = []
  private nextId = 1

  transaction() {
    return { execute: async <T>(callback: (trx: this) => Promise<T>) => callback(this) }
  }

  selectFrom(table: string) { return new FakeSelect(this, table) }
  insertInto(table: string) { return new FakeInsert(this, table) }
  updateTable(table: string) { return new FakeUpdate(this, table) }
}

class FakeSelect {
  private readonly conditions: Condition[] = []
  private joined = false
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  innerJoin() { this.joined = true; return this }
  select() { return this }
  where(column: string, _operator: string, value: unknown) {
    this.conditions.push({ column, value })
    this.db.whereColumns.push(column)
    return this
  }
  forUpdate() { return this }
  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    const value = (column: string) => this.conditions.find(item => item.column === column || item.column.endsWith(`.${column}`))?.value
    if (this.table === 'trips') {
      const trip = this.db.trips.find(item =>
        (value('public_id') === undefined || item.public_id === value('public_id')) &&
        (value('user_id') === undefined || item.user_id === value('user_id')) &&
        (value('id') === undefined || item.id === value('id'))
      )
      if (!trip) return undefined
      if (!this.joined) return { id: trip.id, current_context_version: trip.current_context_version }
      const version = this.db.versions.find(item => item.trip_id === trip.id && item.version === trip.current_context_version)
      return version ? { ...trip, context_json: version.context_json } : undefined
    }
    const version = this.db.versions.find(item =>
      (value('trip_id') === undefined || item.trip_id === value('trip_id')) &&
      (value('version') === undefined || item.version === value('version'))
    )
    return version ? { context_json: version.context_json } : undefined
  }
}

class FakeInsert {
  private row: Record<string, unknown> = {}
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  values(row: Record<string, unknown>) { this.row = row; return this }
  returning() { return this }
  async executeTakeFirstOrThrow() {
    if (this.table !== 'trips') throw new Error('unexpected returning table')
    const inserted = {
      id: String(this.db['nextId']++),
      ...this.row
    }
    this.db.trips.push(inserted)
    return inserted
  }
  async execute() {
    if (this.table !== 'trip_context_versions') throw new Error('unexpected insert table')
    this.db.versions.push({ ...this.row })
    return { numInsertedOrUpdatedRows: 1n }
  }
}

class FakeUpdate {
  private values: Record<string, unknown> = {}
  private id: unknown
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  set(values: Record<string, unknown>) { this.values = values; return this }
  where(column: string, _operator: string, value: unknown) { if (column === 'id') this.id = value; return this }
  async execute() {
    if (this.table === 'trips') {
      const trip = this.db.trips.find(item => item.id === this.id)
      if (trip) Object.assign(trip, this.values)
    }
    return { numUpdatedRows: 1n }
  }
}

const asDb = (db: FakeDb) => db as unknown as Kysely<Database>

describe('PostgresTripRepository contract', () => {
  it('creates an immutable version-zero snapshot and scopes reads by owner', async () => {
    const db = new FakeDb()
    const repo = new PostgresTripRepository(asDb(db), 'user-a')
    const created = await repo.create({ title: 'Japan', initialContext: { notes: ['passport'] } })

    expect(created).toMatchObject({ id: created.context.id, title: 'Japan', currentContextVersion: 0 })
    expect(created.context).toMatchObject({ notes: ['passport'], version: 0 })
    expect(db.versions).toHaveLength(1)
    expect(await repo.getTrip(created.id)).toEqual(created)
    expect(await new PostgresTripRepository(asDb(db), 'user-b').getTrip(created.id)).toBeUndefined()
    expect(db.whereColumns).toContain('trips.user_id')
  })

  it('updates atomically and rejects stale versions', async () => {
    const db = new FakeDb()
    const repo = new PostgresTripRepository(asDb(db), 'user-a')
    const created = await repo.create()

    const updated = await repo.update(created.id, { notes: ['one'] }, 0)
    expect(updated).toMatchObject({ id: created.id, notes: ['one'], version: 1 })
    expect(db.versions).toHaveLength(2)
    await expect(repo.update(created.id, { notes: ['stale'] }, 0)).rejects.toEqual(
      expect.objectContaining({ code: 'TRIP_CONTEXT_VERSION_CONFLICT', actualVersion: 1 })
    )
    await expect(new PostgresTripRepository(asDb(db), 'user-b').update(created.id, {})).rejects.toThrow('TRIP_CONTEXT_NOT_FOUND')
  })
})
