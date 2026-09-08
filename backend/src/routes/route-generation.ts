import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import {
  routeGenerationIdempotencyKeySchema,
  routeGenerationPathParamsSchema,
  routeGenerationRequestSchema,
  routeGenerationRunParamsSchema,
  toRouteGenerationRunView,
  type RouteGenerationRequest
} from '../route-generation/contracts.js'
import {
  routeGenerationDependenciesFactory,
  type RouteGenerationDependenciesFactory
} from '../route-generation/composition.js'
import {
  cancelRouteGenerationRun,
  startRouteGenerationRun,
  type StartRouteGenerationInput
} from '../route-generation/service.js'

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string') throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400)
  return routeGenerationIdempotencyKeySchema.parse(value)
}

export async function registerRouteGenerationRoutes(
  app: FastifyInstance,
  context: AppContext,
  dependenciesForUser: RouteGenerationDependenciesFactory = routeGenerationDependenciesFactory(context)
): Promise<void> {
  app.post('/v1/trips/:tripId/route-generation-runs', {
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const identity = await authenticateRequest(request, context)
    const { tripId } = routeGenerationPathParamsSchema.parse(request.params)
    const body = routeGenerationRequestSchema.parse(request.body) as RouteGenerationRequest
    const dependencies = dependenciesForUser(identity.userId)
    const input: StartRouteGenerationInput = {
      ownerId: identity.userId,
      tripId,
      idempotencyKey: requiredIdempotencyKey(request.headers['idempotency-key']),
      authorizationSource: 'button',
      ...(body.conversationId === undefined ? {} : { conversationId: body.conversationId }),
      ...(body.expectedTripVersion === undefined ? {} : { expectedTripVersion: body.expectedTripVersion })
    }
    const result = await startRouteGenerationRun(dependencies, input)
    const currentTrip = await dependencies.trips.getTrip(result.run.tripId)
    return reply.code(202).header('Cache-Control', 'no-store').send({
      run: toRouteGenerationRunView(result.run, { stale: currentTrip?.currentContextVersion !== result.run.contextVersion }),
      created: result.created
    })
  })

  app.get('/v1/route-generation-runs/:id', async (request, reply) => {
    const { id } = routeGenerationRunParamsSchema.parse(request.params)
    const identity = await authenticateRequest(request, context)
    const dependencies = dependenciesForUser(identity.userId)
    const run = await dependencies.runs.get(id)
    if (!run) return reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Route generation run was not found' } })
    const currentTrip = await dependencies.trips.getTrip(run.tripId)
    return reply.header('Cache-Control', 'no-store').send({ run: toRouteGenerationRunView(run, { stale: currentTrip?.currentContextVersion !== run.contextVersion }) })
  })

  app.delete('/v1/route-generation-runs/:id', async (request, reply) => {
    const { id } = routeGenerationRunParamsSchema.parse(request.params)
    const identity = await authenticateRequest(request, context)
    const dependencies = dependenciesForUser(identity.userId)
    const run = await cancelRouteGenerationRun(dependencies, id)
    if (!run) return reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Route generation run was not found' } })
    const currentTrip = await dependencies.trips.getTrip(run.tripId)
    return reply.header('Cache-Control', 'no-store').send({ run: toRouteGenerationRunView(run, { stale: currentTrip?.currentContextVersion !== run.contextVersion }) })
  })
}

export const routeGenerationRouteContract = {
  postStatus: 202,
  idempotencyHeader: 'Idempotency-Key',
  requestSchema: routeGenerationRequestSchema
} as const
