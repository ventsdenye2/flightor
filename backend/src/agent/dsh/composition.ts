import { resolve } from 'node:path'
import type { AppContext } from '../../app/context.js'
import { AppError } from '../../lib/errors.js'
import { PostgresTripRepository } from '../../trips/postgres.js'
import { PostgresConversationRepository } from '../../conversations/postgres.js'
import { PostgresArtifactRepository } from '../../artifacts/postgres.js'
import { PostgresUserMemoryRepository } from '../../memory/postgres.js'
import { PostgresWorkspaceRepository } from '../../workspaces/postgres.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../goals/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { CompositeAviationProvider } from '../../aviation/providers/composite.js'
import { PostgresLocationResolver } from '../../aviation/location-resolver.js'
import { PostgresTopologyRepository } from '../../topology/postgres.js'
import { DeterministicFlightRoutePlanner, ParetoRouteOptimizer, ProductionConnectionSearchService } from '../../flight-routing/services.js'
import { CatalogDestinationDiscoveryService } from '../../destinations/discovery.js'
import { DeterministicTripRoutePlanner } from '../../trip-planning/planner.js'
import { DeterministicTravelGuideBuilder } from '../../travel-guides/artifact-builder.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { GuideFinalizer } from '../../travel-guides/finalization.js'
import { OpenRouterClient } from '../../providers/openrouter/client.js'
import { createRouteGenerationDependencies } from '../../route-generation/composition.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'

export function createDshManager(context: AppContext): DshSessionManager {
  const env = context.env
  const key = env.DSH_MODEL_PROVIDER === 'openrouter' ? env.OPENROUTER_API_KEY : env.DEEPSEEK_API_KEY
  if (!key) throw new AppError('PROVIDER_NOT_CONFIGURED', `DSH ${env.DSH_MODEL_PROVIDER} model is not configured`, 503)
  if (!env.DSH_MODEL.toLowerCase().includes('deepseek')) throw new AppError('DSH_MODEL_NOT_ALLOWED', 'DSH requires the configured DeepSeek route', 503)
  if (env.DSH_SEARCH_PROVIDER === 'deepseek-official' && !env.DEEPSEEK_SEARCH_API_KEY)
    throw new AppError('PROVIDER_NOT_CONFIGURED', 'DeepSeek official search requires its own explicit key', 503)
  return new DshSessionManager({ root: resolve(env.DSH_DATA_DIRECTORY),
    route: { provider: env.DSH_MODEL_PROVIDER, model: env.DSH_MODEL,
      baseURL: env.DSH_MODEL_PROVIDER === 'openrouter' ? env.OPENROUTER_BASE_URL : env.DEEPSEEK_BASE_URL, maxTokens: 4096 },
    modelKey: key, maxActive: env.DSH_MAX_ACTIVE, idleMs: env.DSH_IDLE_MS })
}

export function createDshService(context: AppContext, userId: string, sessions: DshSessionManager): DshPlannerService {
  const env = context.env
  const aviation = new CompositeAviationProvider(context.providers.aviation, new PostgresLocationResolver(context.db))
  // Localization has a direct model client, never a hidden legacy Planner/Runtime.
  const localizationClient = env.DSH_MODEL_PROVIDER === 'openrouter' ? context.providers.openrouter : new OpenRouterClient({ ...env,
    OPENROUTER_API_KEY: env.DEEPSEEK_API_KEY, OPENROUTER_BASE_URL: env.DEEPSEEK_BASE_URL, OPENROUTER_MODEL: env.DSH_MODEL })
  return new DshPlannerService({ ownerId: userId, sessions,
    trips: new PostgresTripRepository(context.db, userId), conversations: new PostgresConversationRepository(context.db, userId),
    artifacts: new PostgresArtifactRepository(context.db, userId), memory: new PostgresUserMemoryRepository(context.db, userId),
    flightSelections: new PostgresWorkspaceRepository(context.db, userId), goalRepository: new PostgresGoalRepository(context.db, userId),
    goalRunRepository: new PostgresGoalRunRepository(context.db, userId), goalVerifiers: createDefaultGoalVerifierRegistry(),
    aviation, fares: context.providers.fares, research: new UnavailableResearchAgent(),
    connectionSearch: new ProductionConnectionSearchService(new PostgresTopologyRepository(context.db), context.providers.fares),
    flightRoutePlanner: new DeterministicFlightRoutePlanner(), routeOptimizer: new ParetoRouteOptimizer(),
    destinationDiscovery: new CatalogDestinationDiscoveryService({ aviation }), tripRoutePlanner: new DeterministicTripRoutePlanner(),
    travelGuideBuilder: new DeterministicTravelGuideBuilder(), routeGeneration: createRouteGenerationDependencies(context, userId),
    createFinalizer: () => new GuideFinalizer(localizationClient, env.DSH_MODEL, { reasoning: { enabled: false, exclude: true } }),
  })
}
