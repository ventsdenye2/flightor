import { PublicResearchSourceReader } from '../research-agent/source-reader.js'
import { createDshManager, createDshService } from '../agent/dsh/composition.js'
import { presentArtifact } from '../artifacts/presentation.js'
import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { CloudPlannerService } from '../agent/cloud/service.js'
import type { PlannerServicePort, PlannerTurnResult } from '../agent/planner-service.js'
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
import { NativeResearchAgent } from '../research-agent/native.js'
import { PostgresNativeResearchLedger } from '../research-agent/native-postgres.js'
import { OpenRouterNativeResearchTransport } from '../providers/openrouter/native-research.js'
import { ARTIFACT_TYPES, type ArtifactType } from '../artifacts/repository.js'
import { locationRefSchema } from '../aviation/types.js'
import type { TripContext } from '../trips/types.js'
import { evaluateRouteGenerationEligibility } from '../route-generation/service.js'
import { createRouteGenerationDependencies } from '../route-generation/composition.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../agent/goals/default-verifiers.js'
import { goalDeliverySchema } from '../agent/goals/completion.js'
import { PostgresWorkspaceRepository } from '../workspaces/postgres.js'

export const cloudAgentRequestSchema = z.object({
  locale: z.enum(['zh', 'en']).default('zh'),
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
  notes: z.array(z.string().min(1).max(500)).max(50).optional(),
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

export type CloudAgentServiceFactory = (trustedUserId: string) => PlannerServicePort

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
    notes: context.notes,
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

function defaultFactory(context: AppContext, logger: FastifyBaseLogger, app: FastifyInstance): CloudAgentServiceFactory {
  if (context.env.FLIGHTOR_AGENT_ENGINE === 'dsh') {
    const sessions = createDshManager(context)
    app.addHook('onClose', async () => { await sessions.close() })
    return userId => createDshService(context, userId, sessions)
  }
  return userId => {
    if (!context.env.OPENROUTER_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter is not configured', 503)
    const trips = new PostgresTripRepository(context.db, userId)
    const conversations = new PostgresConversationRepository(context.db, userId)
    const artifacts = new PostgresArtifactRepository(context.db, userId)
    const memory = new PostgresUserMemoryRepository(context.db, userId)
    const goalRepository = new PostgresGoalRepository(context.db, userId)
    const goalRunRepository = new PostgresGoalRunRepository(context.db, userId)
    const runtime = new AgentRuntime(context.providers.openrouter, createPlannerToolRegistry({ leanGoalsEnabled: context.env.PLANNER_LEAN_GOALS_ENABLED }), {
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
    const flightSelections = new PostgresWorkspaceRepository(context.db, userId)
    return new CloudPlannerService({
      finalizationObservation: observation => logger.info({ finalization: observation, model: context.env.PLANNER_MODEL }, 'Guide finalization completed'),
      observation: value => logger.info({ plannerObservation: value }, 'Planner turn observation'),
      trips, conversations, artifacts, memory, runtime, flightSelections,
      leanGoalsEnabled: context.env.PLANNER_LEAN_GOALS_ENABLED,
      ownerId: userId,
      goalRepository,
      goalRunRepository,
      goalVerifiers: createDefaultGoalVerifierRegistry(),
      routeGeneration: createRouteGenerationDependencies(context, userId),
      aviation,
      fares: context.providers.fares,
      research: context.env.NATIVE_RESEARCH_PROVIDER === 'openrouter_native'
        ? new NativeResearchAgent({ model: context.env.NATIVE_RESEARCH_MODEL, transport: new OpenRouterNativeResearchTransport(context.providers.openrouter),
          ledger: new PostgresNativeResearchLedger(context.db, userId), budgetId: context.env.NATIVE_RESEARCH_BUDGET_ID,
          maxCallUsdMicros: context.env.NATIVE_RESEARCH_MAX_CALL_USD_MICROS, timeoutMs: context.env.NATIVE_RESEARCH_TIMEOUT_MS })
        : context.env.SERPAPI_KEY
          ? new ProductionResearchAgent({
            searchProvider: context.providers.researchSearch,
            sourceReader: new PublicResearchSourceReader(),
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
  serviceForUser: CloudAgentServiceFactory = defaultFactory(context, app.log, app)
): Promise<void> {
  const turns = new PlannerTurnStore<z.infer<typeof cloudAgentResponseSchema>>({
    onError: (error, turnId) => app.log.error({ err: error, turnId }, 'Planner turn failed')
  })
  app.addHook('onClose', async () => { turns.close() })

  app.post('/v1/artifacts/:id/localization', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const identity = await authenticateRequest(request, context)
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params)
    const { locale, retryRevision } = z.object({ locale: z.enum(['zh', 'en']), retryRevision: z.number().int().min(1).max(2).optional() }).strict().parse(request.body)
    const artifact = await serviceForUser(identity.userId).localizeGuide(id, locale, retryRevision)
    return reply.header('Cache-Control', 'no-store').send({ artifact: presentArtifact(artifact, locale) })
  })

  const currentSnapshot = async (ownerId: string, turnId: string) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = turns.get(ownerId, turnId)
      if (!snapshot) throw new AppError('RESOURCE_NOT_FOUND', 'Planner turn was not found', 404)
      const current = await serviceForUser(ownerId).publicationContext({ tripId: snapshot.tripId!, conversationId: snapshot.conversationId! })
      const latest = turns.get(ownerId, turnId)
      if (!latest) throw new AppError('RESOURCE_NOT_FOUND', 'Planner turn was not found', 404)
      // Domain reads await I/O. Never invalidate a newer publication or terminal
      // response with context fetched before it existed. No await separates this
      // check from reconciliation, so they observe the same in-process revision.
      if (latest.artifactRevision !== snapshot.artifactRevision || latest.status !== snapshot.status) continue
      const reconciled = turns.reconcile(ownerId, turnId, current.tripContextVersion, current.selectedFlightRevision)
      if (!reconciled) throw new AppError('RESOURCE_NOT_FOUND', 'Planner turn was not found', 404)
      if (reconciled.status === 'completed' && (reconciled.response.tripContextSummary.version !== current.tripContextVersion
        || turns.hasInvalidatedArtifacts(ownerId, turnId, reconciled.response.artifactRefs.map(ref => ref.id)))) {
        const { response: _response, ...base } = reconciled
        return { ...base, status: 'failed' as const, error: { code: 'PLANNER_CONTEXT_CHANGED', message: '行程或航班已变化，请按当前条件继续规划。' } }
      }
      return reconciled
    }
    // Leave the snapshot untouched and let the bounded client poll retry.
    throw new AppError('PLANNER_SNAPSHOT_CHANGED', 'Planner results changed while checking their context; retry shortly', 503)
  }

  app.post('/v1/agent/turns', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const identity = await authenticateRequest(request, context)
    const input = cloudAgentRequestSchema.parse(request.body)
    const service = serviceForUser(identity.userId)
    await service.validateTurn(input)
    const generationId = uuidv7()
    const accepted = turns.start(identity.userId, async (signal, onActivity) => {
      const result = await service.runTurn({ ...input, requestId: request.id, generationId, signal, onActivity })
      return buildCloudAgentResponse(input, result)
    }, { tripId: input.tripId, conversationId: input.conversationId, generationId })
    return reply.code(202).header('Cache-Control', 'no-store').send(accepted)
  })

  app.get('/v1/agent/turns/:turnId', {
    config: { rateLimit: { max: 90, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const identity = await authenticateRequest(request, context)
    const { turnId } = z.object({ turnId: z.string().uuid() }).strict().parse(request.params)
    return reply.send(await currentSnapshot(identity.userId, turnId))
  })

  app.post('/v1/agent/turns/:turnId/cancel', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const identity = await authenticateRequest(request, context)
    const { turnId } = z.object({ turnId: z.string().uuid() }).strict().parse(request.params)
    const snapshot = turns.cancel(identity.userId, turnId)
    if (!snapshot) throw new AppError('RESOURCE_NOT_FOUND', 'Planner turn was not found', 404)
    return reply.send(await currentSnapshot(identity.userId, turnId))
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
      locale: input.locale,
      generationId: uuidv7()
    })
    return reply.header('Cache-Control', 'no-store').send(buildCloudAgentResponse(input, result))
  })
}

function buildCloudAgentResponse(input: z.infer<typeof cloudAgentRequestSchema>, result: PlannerTurnResult): z.infer<typeof cloudAgentResponseSchema> {
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
