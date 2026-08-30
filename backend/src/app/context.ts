import type { Kysely } from 'kysely'
import type { Redis } from 'ioredis'
import type { AppEnv } from '../config/env.js'
import type { Database } from '../db/types.js'
import type { Providers } from '../providers/index.js'

export interface AppContext {
  db: Kysely<Database>
  redis: Redis
  env: AppEnv
  providers: Providers
}
