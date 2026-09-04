import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { routePickSchema } from '../route-plans/schema.js'
import { buildTravelGuide } from '../travel-guides/service.js'

const interestsSchema = z.array(z.enum(['culture', 'food', 'nature', 'shopping', 'nightlife'])).max(5).default([])

export const travelGuideRequestSchema = z.object({
  /** A route previously returned by `/v1/agent/converse` or `/v1/route-plans`. */
  route: routePickSchema,
  travel_days: z.number().int().min(1).max(60).optional(),
  interests: interestsSchema
}).strict()

function routeDays(route: z.infer<typeof routePickSchema>): number {
  const first = route.route.legs[0]?.date
  const last = route.route.legs.at(-1)?.date
  if (!first || !last) return 1
  const delta = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000)
  return Math.max(1, Math.min(60, delta + 1))
}

/** Optional direct route endpoint; the converse route is the primary entry. */
export async function registerTravelGuideRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/travel-guides', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
        keyGenerator: request => request.ip
      }
    }
  }, async (request, reply) => {
    const input = travelGuideRequestSchema.parse(request.body)
    const guide = await buildTravelGuide({
      route: input.route,
      travelDays: input.travel_days ?? routeDays(input.route),
      interests: input.interests
    }, {
      ...(context.env.SERPAPI_KEY ? { research: context.providers.serpapi } : {}),
      redis: context.redis,
      ...(context.env.OPENROUTER_API_KEY ? { llm: context.providers.openrouter } : {})
    })
    return reply.header('Cache-Control', 'no-store').send({ travelGuide: guide })
  })
}
