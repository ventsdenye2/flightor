import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../app/context.js'
import { converse, converseRequestSchema } from '../conversation-agent/index.js'

/** Register the unified, client-state round-trip conversation endpoint. */
export async function registerAgentConverseRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/agent/converse', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: request => request.ip
      }
    }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const input = converseRequestSchema.parse(request.body)
    const client = context.env.OPENROUTER_API_KEY ? context.providers.openrouter : undefined
    const result = await converse(input, client, {
      travelGuide: {
        ...(context.env.SERPAPI_KEY ? { research: context.providers.serpapi } : {}),
        redis: context.redis,
        ...(client ? { llm: client } : {})
      }
    })
    return reply.send(result)
  })
}
