import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../app/context.js'
import { tripPlanRequestSchema, runTripPlanner } from '../trip-plans/planner.js'

export async function registerTripPlanRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/trip-plans', async (request, reply) => {
    const input = tripPlanRequestSchema.parse(request.body)
    const plan = await runTripPlanner(context.providers.openrouter, input)
    return reply.header('Cache-Control', 'no-store').send(plan)
  })
}
