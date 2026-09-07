import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import type { Kysely } from 'kysely'
import { buildApp } from './app.js'
import { parseEnv } from './config/env.js'
import type { Database } from './db/types.js'
import { createProviders } from './providers/index.js'

const env = parseEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test',
  REDIS_URL: 'redis://test',
  JWT_SECRET: 'app-route-contract-secret-at-least-32-characters'
})

describe('Fastify product route composition', () => {
  it('registers one public Planner endpoint and the explicit route-generation resource', async () => {
    const app = await buildApp({
      env,
      db: {} as Kysely<Database>,
      // Rate-limit uses its in-process store when no Redis client is supplied.
      redis: undefined as unknown as Redis,
      providers: createProviders(env)
    })

    const routes = app.printRoutes({ commonPrefix: false })
    expect(routes.match(/agent\/converse/g)).toHaveLength(1)
    expect(routes).not.toContain('agent/chat')
    expect(routes).toContain('route-generation-runs')
    expect(routes).not.toContain('agent-v2')
    await app.close()
  })
})
