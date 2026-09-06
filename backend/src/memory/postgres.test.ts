import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { UserMemoryVersionConflict } from './repository.js'
import { PostgresUserMemoryRepository } from './postgres.js'

type Row = {
  user_id: string
  enabled: boolean
  markdown: string
  version: number
  parse_version: number
  created_at: Date
  updated_at: Date
}

class SafeMemoryDb {
  readonly rows = new Map<string, Row>()
  readonly whereValues: string[] = []
  readonly lockedUsers: string[] = []

  selectFrom(): SafeSelect { return new SafeSelect(this) }
  insertInto(): SafeInsert { return new SafeInsert(this) }
  updateTable(): SafeUpdate { return new SafeUpdate(this) }
  transaction(): { execute: <T>(callback: (trx: Kysely<Database>) => Promise<T>) => Promise<T> } {
    return { execute: callback => callback(this as unknown as Kysely<Database>) }
  }
}

class SafeSelect {
  private userId = ''
  private lock = false
  constructor(private readonly db: SafeMemoryDb) {}
  select(): this { return this }
  where(_column: string, _operator: string, value: string): this { this.userId = value; this.db.whereValues.push(value); return this }
  forUpdate(): this { this.lock = true; return this }
  async executeTakeFirst(): Promise<Row | undefined> {
    if (this.lock) this.db.lockedUsers.push(this.userId)
    return this.db.rows.get(this.userId)
  }
}

class SafeInsert {
  private valuesInput: { user_id: string; parse_version?: number } = { user_id: '' }
  constructor(private readonly db: SafeMemoryDb) {}
  values(values: { user_id: string; parse_version?: number }): this { this.valuesInput = values; return this }
  onConflict(callback: (builder: { column: () => { doNothing: () => void } }) => unknown): this {
    callback({ column: () => ({ doNothing: () => undefined }) })
    return this
  }
  async execute(): Promise<void> {
    if (this.db.rows.has(this.valuesInput.user_id)) return
    const now = new Date()
    this.db.rows.set(this.valuesInput.user_id, {
      user_id: this.valuesInput.user_id,
      enabled: true,
      markdown: '',
      version: 0,
      parse_version: this.valuesInput.parse_version ?? 1,
      created_at: now,
      updated_at: now
    })
  }
}

class SafeUpdate {
  private valuesInput: Partial<Row> = {}
  private userId = ''
  constructor(private readonly db: SafeMemoryDb) {}
  set(values: Partial<Row>): this { this.valuesInput = values; return this }
  where(_column: string, _operator: string, value: string): this { this.userId = value; return this }
  returning(): this { return this }
  async executeTakeFirstOrThrow(): Promise<Row> {
    const row = this.db.rows.get(this.userId)
    if (!row) throw new Error('missing test row')
    Object.assign(row, this.valuesInput)
    return row
  }
}

describe('PostgresUserMemoryRepository', () => {
  it('always scopes reads and writes to the constructor user id', async () => {
    const db = new SafeMemoryDb()
    const first = new PostgresUserMemoryRepository(db as unknown as Kysely<Database>, 'user-a')
    const second = new PostgresUserMemoryRepository(db as unknown as Kysely<Database>, 'user-b')
    expect(await first.get()).toMatchObject({ enabled: true, version: 0 })
    expect(await second.get()).toMatchObject({ enabled: true, version: 0 })
    expect(db.whereValues).toEqual(['user-a', 'user-a', 'user-b', 'user-b'])
    await first.updateMarkdown('private to A', 0)
    expect((await second.get()).markdown).toBe('')
    expect(db.rows.get('user-a')?.markdown).toBe('private to A')
  })

  it('locks rows and applies one optimistic version increment per write', async () => {
    const db = new SafeMemoryDb()
    const repository = new PostgresUserMemoryRepository(db as unknown as Kysely<Database>, 'user-a')
    await expect(repository.setEnabled(false, 0)).resolves.toMatchObject({ enabled: false, version: 1 })
    expect(db.lockedUsers).toContain('user-a')
    await expect(repository.updateMarkdown('owner edit while disabled', 1)).resolves.toMatchObject({ enabled: false, version: 2 })
    await expect(repository.getForAgent()).resolves.toBeUndefined()
    await expect(repository.setEnabled(true, 2)).resolves.toMatchObject({ enabled: true, version: 3 })
    await expect(repository.updateMarkdown('saved', 3)).resolves.toMatchObject({ markdown: 'saved', version: 4 })
    await expect(repository.setEnabled(false, 3)).rejects.toBeInstanceOf(UserMemoryVersionConflict)
  })

  it('validates rejected input before issuing a write', async () => {
    const db = new SafeMemoryDb()
    const repository = new PostgresUserMemoryRepository(db as unknown as Kysely<Database>, 'user-a')
    await expect(repository.updateMarkdown('x'.repeat(8193), 0)).rejects.toEqual(expect.objectContaining({ code: 'USER_MEMORY_TOO_LARGE' }))
    expect(db.rows.size).toBe(0)
    await expect(repository.updateMarkdown(null as unknown as string, 0)).rejects.toEqual(expect.objectContaining({ code: 'INVALID_USER_MEMORY' }))
    expect(db.rows.size).toBe(0)
  })
})
