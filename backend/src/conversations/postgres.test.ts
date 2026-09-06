import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { PostgresConversationRepository } from './postgres.js'

type Row = Record<string, any>

class FakeDb {
  readonly trips: Row[] = []
  readonly conversations: Row[] = []
  readonly messages: Row[] = []
  private nextId = 1

  transaction() { return { execute: async <T>(callback: (trx: this) => Promise<T>) => callback(this) } }
  selectFrom(table: string) { return new FakeSelect(this, table) }
  insertInto(table: string) { return new FakeInsert(this, table) }
  updateTable() { return { set: () => ({ where: () => ({ execute: async () => ({}) }) }) } }
  id() { return String(this.nextId++) }
}

class FakeSelect {
  private conditions: Array<{ column: string; value: unknown }> = []
  private publicProjection = false
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  innerJoin() { return this }
  select(fields?: unknown) {
    this.publicProjection = JSON.stringify(fields).includes('public_id as id')
    return this
  }
  where(column: string, _operator: string, value: unknown) { this.conditions.push({ column, value }); return this }
  orderBy() { return this }
  limit() { return this }
  private value(name: string) { return this.conditions.find(item => item.column === name || item.column.endsWith(`.${name}`))?.value }
  async executeTakeFirst(): Promise<Row | undefined> {
    if (this.table === 'trips') {
      const row = this.db.trips.find(item => item.public_id === this.value('public_id') && item.user_id === this.value('user_id'))
      return row ? { id: row.id } : undefined
    }
    const row = this.db.conversations.find(item => item.public_id === this.value('public_id') && item.user_id === this.value('user_id'))
    return row ? {
      id: this.publicProjection ? row.public_id : row.internal_id,
      trip_id: row.trip_id, title: row.title, status: row.status,
      created_at: row.created_at, updated_at: row.updated_at,
      trip_public_id: this.db.trips.find(trip => trip.id === row.trip_id)?.public_id
    } : undefined
  }
  async execute(): Promise<Row[]> {
    return this.db.messages.filter(item => item.conversation_id === this.value('conversation_id'))
      // Production query requests newest first and repository reverses it.
      .sort((a, b) => Number(b.internal_id) - Number(a.internal_id))
      .map(item => ({ id: item.public_id, conversation_id: item.conversation_id, role: item.role, content: item.content, metadata_json: item.metadata_json, created_at: item.created_at }))
  }
}

class FakeInsert {
  private row: Row = {}
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  values(row: Row) { this.row = row; return this }
  returning() { return this }
  async executeTakeFirstOrThrow() {
    const now = new Date()
    if (this.table === 'conversations') {
      const inserted = { id: this.row.public_id, internal_id: this.db.id(), ...this.row, created_at: now, updated_at: now }
      this.db.conversations.push(inserted)
      return inserted
    }
    const inserted = { id: this.row.public_id, internal_id: this.db.id(), ...this.row, created_at: now }
    this.db.messages.push(inserted)
    return inserted
  }
}

const asDb = (db: FakeDb) => db as unknown as Kysely<Database>

describe('PostgresConversationRepository', () => {
  it('persists conversation/message mappings and preserves ordered JSON metadata', async () => {
    const db = new FakeDb()
    db.trips.push({ id: '11', public_id: 'trip-public', user_id: 'user-a' })
    const repo = new PostgresConversationRepository(asDb(db), 'user-a')
    const conversation = await repo.create({ tripId: 'trip-public', title: 'Planning' })
    const first = await repo.appendMessage({ conversationId: conversation.id, role: 'user', content: 'One', metadata: { index: 1 } })
    const second = await repo.appendMessage({ conversationId: conversation.id, role: 'assistant', content: 'Two', metadata: { index: 2 } })

    expect(conversation).toMatchObject({ tripId: 'trip-public', title: 'Planning', status: 'active' })
    expect(first).toMatchObject({ conversationId: conversation.id, metadata: { index: 1 } })
    expect(await repo.listMessages(conversation.id)).toEqual([first, second])
    expect((await repo.get(conversation.id))?.tripId).toBe('trip-public')
  })

  it('rejects foreign trip and conversation using RESOURCE_NOT_FOUND', async () => {
    const db = new FakeDb()
    db.trips.push({ id: '11', public_id: 'trip-a', user_id: 'user-a' })
    db.trips.push({ id: '12', public_id: 'trip-b', user_id: 'user-b' })
    const repo = new PostgresConversationRepository(asDb(db), 'user-a')
    await expect(repo.create({ tripId: 'trip-b' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(repo.appendMessage({ conversationId: 'missing', role: 'user', content: 'x' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(repo.listMessages('missing')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
  })
})
