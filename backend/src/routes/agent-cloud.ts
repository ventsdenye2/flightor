import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { CloudPlannerService, type CloudPlannerTurnResult } from '../agent/cloud/service.js'
import { PLANNER_TURN_TIMEOUT_MS, PlannerTurnStore } from '../agent/cloud/turns.js'
import { AgentRuntime } from '../agent/runtime/runtime.js'
import { createPlannerToolRegistry } from '../agent/tools/core.js'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresLocationResolver } from '../aviation/location-resolver.js'
import { CompositeAviationProvider } from '../aviation/providers/composite.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { PostgresUserMemoryRepository } from '../memory/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { UnavailableResearchAgent } from '../research-agent/unavailable.js'
import {
  DeterministicFlightRoutePlanner,
  ParetoRouteOptimizer,
  ProductionConnectionSearchService
} from '../flight-routing/services.js'
import { PostgresTopologyRepository } from '../topology/postgres.js'
import { CatalogDestinationDiscoveryService } from '../destinations/discovery.js'
import { DeterministicTripRoutePlanner } from '../trip-planning/planner.js'
import { DeterministicTravelGuideBuilder } from '../travel-guides/artifact-builder.js'
import { ProductionResearchAgent } from '../research-agent/production.js'
import { OpenRouterResearchSynthesisModel } from '../providers/openrouter/research.js'
import { ARTIFACT_TYPES, type ArtifactType } from '../artifacts/repository.js'
import { locationRefSchema } from '../aviation/types.js'
import type { TripContext } from '../trips/types.js'
import { evaluateRouteGenerationEligibility } from '../route-generation/service.js'
import { createRouteGenerationDependencies } from '../route-generation/composition.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../agent/goals/default-verifiers.js'
import { goalDeliverySchema } from '../agent/goals/completion.js'

export const cloudAgentRequestSchema = z.object({
  tripId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(2_000)
}).strict()

const artifactPresentationHintSchema = z.enum([
  'flight_cards', 'research_cards', 'activity_cards', 'destination_cards',
  'route_preview', 'itinerary_outline', 'travel_guide'
])

const tripContextSummarySchema = z.object({
  version: z.number().int().nonnegative(),
  origin: locationRefSchema.optional(),
  departureWindow: z.object({
    from: z.iso.date().optional(), to: z.iso.date().optional(), precision: z.enum(['exact', 'approximate'])
  }).strict().optional(),
  returnWindow: z.object({
    from: z.iso.date().optional(), to: z.iso.date().optional(), precision: z.enum(['exact', 'approximate'])
  }).strict().optional(),
  travelDays: z.number().int().min(1).max(60).optional(),
  budget: z.object({ amount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/), scope: z.enum(['airfare', 'transport', 'trip']) }).strict().optional(),
  destinations: z.object({
    mode: z.enum(['explicit', 'open', 'mixed']),
    required: z.array(locationRefSchema).max(24),
    preferred: z.array(locationRefSchema).max(24),
    excluded: z.array(locationRefSchema).max(24)
  }).strict(),
  interests: z.array(z.string().min(1).max(80)).max(32),
  readyForRouteGeneration: z.boolean()
}).strict()

const suggestedActionSchema = z.object({
  id: z.enum(['continue_planning', 'generate_route']),
  label: z.string().min(1).max(80),
  kind: z.enum(['message', 'route_generation']),
  href: z.string().min(1).max(240).optional()
}).strict()

export const cloudAgentResponseSchema = z.object({
  conversationId: z.string().uuid(),
  tripId: z.string().uuid(),
  reply: z.string().min(1),
  tripContextSummary: tripContextSummarySchema,
  artifactRefs: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(ARTIFACT_TYPES),
    schemaVersion: z.number().int().positive(),
    presentationHint: artifactPresentationHintSchema
  }).strict()).max(100),
  suggestedActions: z.array(suggestedActionSchema).max(5),
  memoryChanged: z.boolean().optional(),
  warnings: z.array(z.string().min(1).max(240)).max(40),
  stopReason: z.string().min(1).max(80),
  delivery: goalDeliverySchema
}).strict()

export type CloudAgentServiceFactory = (trustedUserId: string) => CloudPlannerService

function routeGenerationReady(context: TripContext): boolean {
  return evaluateRouteGenerationEligibility(context).eligible
}

export function summarizeTrip(context: TripContext) {
  return {
    version: context.version,
    ...(context.origin ? { origin: context.origin } : {}),
    ...(context.departureWindow ? { departureWindow: context.departureWindow } : {}),
    ...(context.returnWindow ? { returnWindow: context.returnWindow } : {}),
    ...(context.travelDays ? { travelDays: context.travelDays } : {}),
    ...(context.budget ? { budget: context.budget } : {}),
    destinations: context.destinationIntent,
    interests: context.interests,
    readyForRouteGeneration: routeGenerationReady(context)
  }
}

export function presentationHint(type: ArtifactType): z.infer<typeof artifactPresentationHintSchema> {
  if (type === 'flight_search') return 'flight_cards'
  if (type === 'research') return 'research_cards'
  if (type === 'activity') return 'activity_cards'
  if (type === 'destination_set') return 'destination_cards'
  if (type === 'route_set') return 'route_preview'
  if (type === 'route') return 'itinerary_outline'
  return 'travel_guide'
}

function defaultFactory(context: AppContext, logger: FastifyBaseLogger): CloudAgentServiceFactory {
  return userId => {
    if (!context.env.OPENROUTER_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter is not configured', 503)
    const trips = new PostgresTripRepository(context.db, userId)
    const conversations = new PostgresConversationRepository(context.db, userId)
    const artifacts = new PostgresArtifactRepository(context.db, userId)
    const memory = new PostgresUserMemoryRepository(context.db, userId)
    const goalRepository = new PostgresGoalRepository(context.db, userId)
    const goalRunRepository = new PostgresGoalRunRepository(context.db, userId)
    const runtime = new AgentRuntime(context.providers.openrouter, createPlannerToolRegistry(), {
      model: context.env.PLANNER_MODEL,
      turnTimeoutMs: PLANNER_TURN_TIMEOUT_MS,
      maxToolSteps: 10,
      // Product decision: do not let the cost ledger block valid planning in
      // the current function-first milestone. Other execution guards remain.
      maxCostUnits: 100,
      modelOptions: { maxTokens: 4096, timeoutMs: 60_000, reasoning: { enabled: false, exclude: true } },
      modelTrace: trace => logger.info({ modelTrace: trace, model: context.env.PLANNER_MODEL }, 'Planner model completed'),
      trace: trace => logger.info({ toolTrace: trace }, 'Planner tool completed')
    })
    const topology = new PostgresTopologyRepository(context.db)
    const aviation = new CompositeAviationProvider(context.providers.aviation, new PostgresLocationResolver(context.db))
    return new CloudPlannerService({
      trips, conversations, artifacts, memory, runtime,
      ownerId: userId,
      goalRepository,
      goalRunRepository,
      goalVerifiers: createDefaultGoalVerifierRegistry(),
      routeGeneration: createRouteGenerationDependencies(context, userId),
      aviation,
      fares: context.providers.fares,
      research: context.env.SERPAPI_KEY
        ? new ProductionResearchAgent({
          searchProvider: context.providers.researchSearch,
          synthesisModel: new OpenRouterResearchSynthesisModel(context.providers.openrouter, context.env.RESEARCH_MODEL)
        })
        : new UnavailableResearchAgent(),
      connectionSearch: new ProductionConnectionSearchService(topology, context.providers.fares),
      flightRoutePlanner: new DeterministicFlightRoutePlanner(),
      routeOptimizer: new ParetoRouteOptimizer(),
      destinationDiscovery: new CatalogDestinationDiscoveryService({ aviation }),
      tripRoutePlanner: new DeterministicTripRoutePlanner(),
      travelGuideBuilder: new DeterministicTravelGuideBuilder()
    })
  }
}

export async function registerCloudAgentRoutes(
  app: FastifyInstance,
  context: AppContext,
  serviceForUser: CloudAgentServiceFactory = defaultFactory(context, app.log)
): Promise<void> {
  const turns = new PlannerTurnStore<z.infer<typeof cloudAgentResponseSchema>>({
    onError: (error, turnId) => app.log.error({ err: error, turnId }, 'Planner turn failed')
  })
  app.addHook('onClose', async () => { turns.close() })

  app.post('/v1/agent/turns', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const identity = await authenticateRequest(request, context)
    const input = cloudAgentRequestSchema.parse(request.body)
    const service = serviceForUser(identity.userId)
    await service.validateTurn(input)
    const accepted = turns.start(identity.userId, async (signal, onActivity) => {
      const result = await service.runTurn({ ...input, requestId: request.id, generationId: uuidv7(), signal, onActivity })
      return buildCloudAgentResponse(input, result)
    })
    return reply.code(202).header('Cache-Control', 'no-store').send(accepted)
  })

  app.get('/v1/agent/turns/:turnId', {
    config: { rateLimit: { max: 90, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const identity = await authenticateRequest(request, context)
    const { turnId } = z.object({ turnId: z.string().uuid() }).strict().parse(request.params)
    const snapshot = turns.get(identity.userId, turnId)
    if (!snapshot) throw new AppError('RESOURCE_NOT_FOUND', 'Planner turn was not found', 404)
    return reply.send(snapshot)
  })

  app.post('/v1/agent/converse', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const identity = await authenticateRequest(request, context)
    const input = cloudAgentRequestSchema.parse(request.body)
    const service = serviceForUser(identity.userId)
    const result = await service.runTurn({
      requestId: request.id,
      tripId: input.tripId,
      conversationId: input.conversationId,
      message: input.message,
      generationId: uuidv7()
    })
    return reply.header('Cache-Control', 'no-store').send(buildCloudAgentResponse(input, result))
  })
}

function buildCloudAgentResponse(input: z.infer<typeof cloudAgentRequestSchema>, result: CloudPlannerTurnResult): z.infer<typeof cloudAgentResponseSchema> {
    const ready = routeGenerationReady(result.tripContext)
    return cloudAgentResponseSchema.parse({
      conversationId: input.conversationId,
      tripId: input.tripId,
      reply: result.reply,
      tripContextSummary: summarizeTrip(result.tripContext),
      artifactRefs: result.artifactRefs.map(artifact => ({
        ...artifact,
        presentationHint: presentationHint(artifact.type)
      })),
      suggestedActions: ready
        ? [{
          id: 'generate_route', label: 'Generate route', kind: 'route_generation',
          href: `/v1/trips/${input.tripId}/route-generation-runs`
        }]
        : [{ id: 'continue_planning', label: 'Continue planning', kind: 'message' }],
      ...(result.memoryChanged ? { memoryChanged: true } : {}),
      warnings: result.warnings,
      stopReason: result.stopReason,
      delivery: result.delivery
    })
}
