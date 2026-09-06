import type { Kysely, Transaction } from 'kysely'
import type { Database } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import {
  USER_MEMORY_PARSE_VERSION,
  UserMemoryVersionConflict,
  validateMemoryMarkdown,
  type UserMemory,
  type UserMemoryRepository
} from './repository.js'

type Db = Kysely<Database> | Transaction<Database>

type UserMemoryRow = {
  user_id: string
  enabled: boolean
  markdown: string
  version: number
  parse_version: number
  created_at: Date | string
  updated_at: Date | string
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function fromRow(row: UserMemoryRow): UserMemory {
  return {
    enabled: row.enabled,
    markdown: row.markdown,
    version: row.version,
    parseVersion: row.parse_version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}

const columns = [
  'user_id',
  'enabled',
  'markdown',
  'version',
  'parse_version',
  'created_at',
  'updated_at'
] as const

/** PostgreSQL implementation of the user-scoped memory repository. */
export class PostgresUserMemoryRepository implements UserMemoryRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly userId: string
  ) {}

  async get(): Promise<UserMemory> {
    const row = await this.ensureRow(this.db)
    return fromRow(row)
  }

  async getForAgent(): Promise<UserMemory | undefined> {
    const memory = await this.get()
    return memory.enabled ? memory : undefined
  }

  async updateMarkdown(markdown: string, expectedVersion: number): Promise<UserMemory> {
    if (typeof markdown !== 'string') {
      throw new AppError('INVALID_USER_MEMORY', 'User Memory markdown must be a string')
    }
    // Validate before opening the transaction so rejected input has no database side effect.
    validateMemoryMarkdown(markdown)
    return this.db.transaction().execute(async trx => {
      const current = await this.ensureRowForUpdate(trx)
      assertVersion(expectedVersion, current.version)
      const next = await trx.updateTable('user_memories')
        .set({
          markdown,
          version: current.version + 1,
          updated_at: new Date()
        })
        .where('user_id', '=', this.userId)
        .returning(columns)
        .executeTakeFirstOrThrow()
      return fromRow(next as UserMemoryRow)
    })
  }

  async setEnabled(enabled: boolean, expectedVersion: number): Promise<UserMemory> {
    return this.db.transaction().execute(async trx => {
      const current = await this.ensureRowForUpdate(trx)
      assertVersion(expectedVersion, current.version)
      const next = await trx.updateTable('user_memories')
        .set({
          enabled,
          version: current.version + 1,
          updated_at: new Date()
        })
        .where('user_id', '=', this.userId)
        .returning(columns)
        .executeTakeFirstOrThrow()
      return fromRow(next as UserMemoryRow)
    })
  }

  private async ensureRow(db: Db): Promise<UserMemoryRow> {
    const existing = await db.selectFrom('user_memories')
      .select(columns)
      .where('user_id', '=', this.userId)
      .executeTakeFirst()
    if (existing) return existing as UserMemoryRow

    await db.insertInto('user_memories')
      .values({ user_id: this.userId, parse_version: USER_MEMORY_PARSE_VERSION })
      .onConflict(oc => oc.column('user_id').doNothing())
      .execute()
    const row = await db.selectFrom('user_memories')
      .select(columns)
      .where('user_id', '=', this.userId)
      .executeTakeFirst()
    if (!row) throw new AppError('USER_MEMORY_NOT_FOUND', 'User Memory owner was not found', 404)
    return row as UserMemoryRow
  }

  private async ensureRowForUpdate(db: Transaction<Database>): Promise<UserMemoryRow> {
    const existing = await db.selectFrom('user_memories')
      .select(columns)
      .where('user_id', '=', this.userId)
      .forUpdate()
      .executeTakeFirst()
    if (existing) return existing as UserMemoryRow

    await db.insertInto('user_memories')
      .values({ user_id: this.userId, parse_version: USER_MEMORY_PARSE_VERSION })
      .onConflict(oc => oc.column('user_id').doNothing())
      .execute()
    const row = await db.selectFrom('user_memories')
      .select(columns)
      .where('user_id', '=', this.userId)
      .forUpdate()
      .executeTakeFirst()
    if (!row) throw new AppError('USER_MEMORY_NOT_FOUND', 'User Memory owner was not found', 404)
    return row as UserMemoryRow
  }
}

function assertVersion(expectedVersion: number, actualVersion: number): void {
  if (expectedVersion !== actualVersion) throw new UserMemoryVersionConflict(expectedVersion, actualVersion)
}
