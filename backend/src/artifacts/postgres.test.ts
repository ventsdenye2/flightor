import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { PostgresArtifactRepository } from './postgres.js'

type Row = Record<string, any>

class FakeDb {
  readonly trips: Row[] = []
  readonly conversations: Row[] = []
  readonly artifacts: Row[] = []
  private nextId = 1

  transaction() { return { execute: async <T>(callback: (trx: this) => Promise<T>) => callback(this) } }
  selectFrom(table: string) { return new FakeSelect(this, table) }
  insertInto(table: string) { return new FakeInsert(this, table) }
  private id() { return String(this.nextId++) }
}

class FakeSelect {
  private conditions: Array<{ column: string; value: unknown }> = []
  private joined = false
  private leftJoined = false
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  innerJoin() { this.joined = true; return this }
  leftJoin() { this.leftJoined = true; return this }
  select() { return this }
  where(column: string, _operator: string, value: unknown) { this.conditions.push({ column, value }); return this }
  private value(name: string) { return this.conditions.find(item => item.column === name || item.column.endsWith(`.${name}`))?.value }
  async executeTakeFirst(): Promise<Row | undefined> {
    const owner = this.value('user_id')
    if (this.table === 'trips') {
      const row = this.db.trips.find(item => item.public_id === this.value('public_id') && item.user_id === owner)
      return row ? { id: row.id } : undefined
    }
    if (this.table === 'conversations') {
      const row = this.db.conversations.find(item => item.public_id === this.value('public_id') && item.user_id === owner &&
        (this.value('trip_id') === undefined || item.trip_id === this.value('trip_id')))
      return row ? { id: row.id } : undefined
    }
    const row = this.db.artifacts.find(item => item.public_id === this.value('public_id') && item.user_id === owner)
    if (!row) return undefined
    const trip = this.db.trips.find(item => item.id === row.trip_id)
    const conversation = this.db.conversations.find(item => item.id === row.conversation_id)
    return {
      id: row.public_id, trip_id: row.trip_id, trip_public_id: trip?.public_id,
      conversation_id: row.conversation_id, conversation_public_id: conversation?.public_id ?? null,
      type: row.type, schema_version: row.schema_version, payload_json: row.payload_json,
      verification_json: row.verification_json, created_at: row.created_at, updated_at: row.updated_at
    }
  }
}

class FakeInsert {
  private row: Row = {}
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  values(row: Row) { this.row = row; return this }
  returning() { return this }
  async executeTakeFirstOrThrow() {
    if (this.table !== 'artifacts') throw new Error('unexpected insert')
    const now = new Date()
    const inserted = { id: this.row.public_id, ...this.row, created_at: now, updated_at: now }
    this.db.artifacts.push(inserted)
    return inserted
  }
}

const asDb = (db: FakeDb) => db as unknown as Kysely<Database>

describe('PostgresArtifactRepository', () => {
  it('persists the supplied public id and maps internal ids back to public ids', async () => {
    const db = new FakeDb()
    db.trips.push({ id: '11', public_id: 'trip-public', user_id: 'user-a' })
    db.conversations.push({ id: '21', public_id: 'conversation-public', trip_id: '11', user_id: 'user-a' })
    const repo = new PostgresArtifactRepository(asDb(db), 'user-a')

    const created = await repo.create({
      id: 'artifact-public', tripId: 'trip-public', conversationId: 'conversation-public',
      type: 'flight_search', schemaVersion: 3, payload: { offers: [1] }, verification: { checked: true }
    })

    expect(created).toMatchObject({ id: 'artifact-public', tripId: 'trip-public', conversationId: 'conversation-public', schemaVersion: 3 })
    expect(db.artifacts[0]).toMatchObject({ public_id: 'artifact-public', trip_id: '11', conversation_id: '21' })
    expect(await repo.get('artifact-public')).toEqual(created)
  })

  it('rejects missing and foreign trips/conversations identically', async () => {
    const db = new FakeDb()
    db.trips.push({ id: '11', public_id: 'trip-a', user_id: 'user-a' })
    db.trips.push({ id: '12', public_id: 'trip-b', user_id: 'user-b' })
    db.conversations.push({ id: '21', public_id: 'conversation-b', trip_id: '12', user_id: 'user-b' })
    const repo = new PostgresArtifactRepository(asDb(db), 'user-a')

    await expect(repo.create({ tripId: 'trip-b', type: 'research', schemaVersion: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(repo.create({ tripId: 'trip-a', conversationId: 'conversation-b', type: 'research', schemaVersion: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
  })
})
