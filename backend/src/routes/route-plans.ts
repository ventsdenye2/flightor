import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../app/context.js'
import {
  confirmRoutePicks,
  planRoute,
  routePlanConfirmRequestSchema,
  routePlanRequestSchema,
  utcToday
} from '../route-plans/index.js'

export async function registerRoutePlanRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/route-plans', async (request, reply) => {
    const input = routePlanRequestSchema.parse(request.body)
    const result = await planRoute(
      input.text,
      input.today ?? utcToday(),
      context.env.OPENROUTER_API_KEY ? context.providers.openrouter : undefined
    )
    return reply.header('Cache-Control', 'no-store').send(result)
  })

  app.post('/v1/route-plans/confirm', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const input = routePlanConfirmRequestSchema.parse(request.body)
    const confirmed = await confirmRoutePicks(input.picks, context.providers.serpapi, {
      hasKey: Boolean(context.env.SERPAPI_KEY)
    })
    return reply.header('Cache-Control', 'no-store').send({ confirmed })
  })
}
