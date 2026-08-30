import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import type { AppContext } from '../app/context.js'

export async function registerHealthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', service: 'flightor-api' }))

  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, string> = {}
    try {
      await sql`select 1`.execute(context.db)
      checks.postgres = 'ok'
    } catch {
      checks.postgres = 'failed'
    }
    try {
      checks.redis = await context.redis.ping() === 'PONG' ? 'ok' : 'failed'
    } catch {
      checks.redis = 'failed'
    }
    const ready = Object.values(checks).every(value => value === 'ok')
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks })
  })

  app.get('/health/providers', async () => ({
    oag: {
      schedules: Boolean(context.env.OAG_SCHEDULES_KEY),
      connections: Boolean(context.env.OAG_CONNECTIONS_KEY || context.env.OAG_FLIGHT_INFO_KEY),
      masterData: Boolean(context.env.OAG_MASTER_DATA_KEY),
      flightInfo: Boolean(context.env.OAG_FLIGHT_INFO_KEY)
    },
    serpapi: Boolean(context.env.SERPAPI_KEY),
    openrouter: Boolean(context.env.OPENROUTER_API_KEY),
    wechat: Boolean(context.env.WX_APPID && context.env.WX_SECRET)
  }))
}
