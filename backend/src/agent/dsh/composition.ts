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
import { createDshLocalizationClient } from './localization-client.js'
import { createRouteGenerationDependencies } from '../../route-generation/composition.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'
import { FileDshEvidenceRepository } from './evidence-file.js'
import { FileDshBudget } from './budget.js'

function budgetFor(context: AppContext) {
  const env = context.env
  if (env.DSH_AUTHORIZED_USD <= 0 || env.DSH_AUTHORIZED_MODEL_CALLS <= 0)
    throw new AppError('DSH_BUDGET_REQUIRED', 'Configure a freshly authorized DSH budget before live execution', 503)
  return new FileDshBudget({ path: resolve(env.DSH_BUDGET_PATH), authorizedUsd: env.DSH_AUTHORIZED_USD,
    maxModelCalls: env.DSH_AUTHORIZED_MODEL_CALLS, maxSearchCalls: env.DSH_AUTHORIZED_SEARCH_CALLS })
}

export function createDshManager(context: AppContext): DshSessionManager {
  const env = context.env
  const key = env.DSH_MODEL_PROVIDER === 'openrouter' ? env.OPENROUTER_API_KEY : env.DEEPSEEK_API_KEY
  if (!key) throw new AppError('PROVIDER_NOT_CONFIGURED', `DSH ${env.DSH_MODEL_PROVIDER} model is not configured`, 503)
  if (!env.DSH_MODEL.toLowerCase().includes('deepseek')) throw new AppError('DSH_MODEL_NOT_ALLOWED', 'DSH requires the configured DeepSeek route', 503)
  if (env.DSH_SEARCH_PROVIDER === 'deepseek-official' && !env.DEEPSEEK_SEARCH_API_KEY)
    throw new AppError('PROVIDER_NOT_CONFIGURED', 'DeepSeek official search requires its own explicit key', 503)
  return new DshSessionManager({ root: resolve(env.DSH_DATA_DIRECTORY),
    metered: true,
    web: { provider: env.DSH_SEARCH_PROVIDER, baseURL: env.DEEPSEEK_SEARCH_BASE_URL, model: env.DEEPSEEK_SEARCH_MODEL },
    searchKey: env.DEEPSEEK_SEARCH_API_KEY,
    route: { provider: env.DSH_MODEL_PROVIDER, model: env.DSH_MODEL,
      baseURL: env.DSH_MODEL_PROVIDER === 'openrouter' ? env.OPENROUTER_BASE_URL : env.DEEPSEEK_BASE_URL, maxTokens: env.DSH_MODEL_MAX_TOKENS },
    modelKey: key, maxActive: env.DSH_MAX_ACTIVE, idleMs: env.DSH_IDLE_MS })
}

export function createDshService(context: AppContext, userId: string, sessions: DshSessionManager): DshPlannerService {
  const env = context.env
  const budget = budgetFor(context)
  const aviation = new CompositeAviationProvider(context.providers.aviation, new PostgresLocationResolver(context.db))
  // Localization has a direct model client, never a hidden legacy Planner/Runtime.
  const localizationClient = createDshLocalizationClient(env, context.providers.openrouter, budget)
  return new DshPlannerService({ ownerId: userId, sessions,
    budget, modelProvider: env.DSH_MODEL_PROVIDER,
    web: { provider: env.DSH_SEARCH_PROVIDER, serpapi: context.providers.serpapi },
    evidenceRepository: new FileDshEvidenceRepository(resolve(env.DSH_DATA_DIRECTORY, 'evidence')),
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
