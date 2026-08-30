import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { env, type AppEnv } from '../config/env.js'
import type { Database } from './types.js'

const { Pool } = pg

export function createDatabase(config: AppEnv = env): Kysely<Database> {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'flightor-backend'
  })

  pool.on('error', error => {
    console.error(JSON.stringify({ level: 'error', event: 'postgres_pool_error', message: error.message }))
  })

  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}

export const db = createDatabase()
