import type { AppContext } from '../app/context.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { createDefaultGoalVerifierRegistry } from '../agent/goals/default-verifiers.js'
import { PostgresGoalRepository, PostgresGoalRunRepository } from '../agent/goals/postgres.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import {
  DeterministicFlightRoutePlanner,
  ParetoRouteOptimizer,
  ProductionConnectionSearchService
} from '../flight-routing/services.js'
import { PostgresTopologyRepository } from '../topology/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { LiveFareConnectionSearch } from '../flight-routing/live-connections.js'
import { PostgresRouteGenerationRunRepository } from './repository.js'
import type { RouteGenerationDependencies } from './service.js'

export type RouteGenerationDependenciesFactory = (trustedUserId: string) => RouteGenerationDependencies

/** Shared production composition for both the authenticated API and worker. */
export function routeGenerationDependenciesFactory(context: AppContext): RouteGenerationDependenciesFactory {
  return trustedUserId => {
    const trips = new PostgresTripRepository(context.db, trustedUserId)
    const artifacts = new PostgresArtifactRepository(context.db, trustedUserId)
    return {
      runs: new PostgresRouteGenerationRunRepository(context.db, trustedUserId),
      goals: new PostgresGoalRepository(context.db, trustedUserId),
      goalRuns: new PostgresGoalRunRepository(context.db, trustedUserId),
      goalVerifiers: createDefaultGoalVerifierRegistry(),
      trips,
      conversations: new PostgresConversationRepository(context.db, trustedUserId),
      artifacts,
      connectionSearch: new LiveFareConnectionSearch({
        artifacts, fares: context.providers.fares,
        aviation: context.providers.aviation,
        topology: new ProductionConnectionSearchService(new PostgresTopologyRepository(context.db))
      }),
      flightRoutePlanner: new DeterministicFlightRoutePlanner(),
      routeOptimizer: new ParetoRouteOptimizer(),
      onFailure: (error, runId) => {
        // Only diagnostic codes and code locations; never provider bodies,
        // request headers, credentials, or user inputs.
        const issue = error as { code?: string; issues?: Array<{ code: string; path: unknown[] }> }
        console.error(JSON.stringify({ event: 'route_generation_failed', runId,
          code: typeof issue.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(issue.code) ? issue.code : 'INTERNAL_ERROR',
          validation: Array.isArray(issue.issues) ? issue.issues.slice(0, 10).map(value => ({ code: value.code, path: value.path })) : undefined,
          frames: error instanceof Error ? error.stack?.split('\n').filter(line => line.trim().startsWith('at ')).slice(0, 5) : undefined
        }))
      }
    }
  }
}

export function createRouteGenerationDependencies(context: AppContext, trustedUserId: string): RouteGenerationDependencies {
  return routeGenerationDependenciesFactory(context)(trustedUserId)
}
