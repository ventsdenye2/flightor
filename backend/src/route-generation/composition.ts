import type { AppContext } from '../app/context.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import {
  DeterministicFlightRoutePlanner,
  ParetoRouteOptimizer,
  ProductionConnectionSearchService
} from '../flight-routing/services.js'
import { PostgresTopologyRepository } from '../topology/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresRouteGenerationRunRepository } from './repository.js'
import type { RouteGenerationDependencies } from './service.js'

export type RouteGenerationDependenciesFactory = (trustedUserId: string) => RouteGenerationDependencies

/** Shared production composition for both the authenticated API and worker. */
export function routeGenerationDependenciesFactory(context: AppContext): RouteGenerationDependenciesFactory {
  return trustedUserId => {
    const trips = new PostgresTripRepository(context.db, trustedUserId)
    return {
      runs: new PostgresRouteGenerationRunRepository(context.db, trustedUserId),
      trips,
      conversations: new PostgresConversationRepository(context.db, trustedUserId),
      artifacts: new PostgresArtifactRepository(context.db, trustedUserId),
      connectionSearch: new ProductionConnectionSearchService(
        new PostgresTopologyRepository(context.db),
        context.providers.fares
      ),
      flightRoutePlanner: new DeterministicFlightRoutePlanner(),
      routeOptimizer: new ParetoRouteOptimizer()
    }
  }
}

export function createRouteGenerationDependencies(context: AppContext, trustedUserId: string): RouteGenerationDependencies {
  return routeGenerationDependenciesFactory(context)(trustedUserId)
}
