import type { ConnectionSearchService, FlightRoutePlanner, RouteOptimizer } from './types.js'

export class RouteCapabilityUnavailableError extends Error {
  readonly code = 'ROUTE_CAPABILITY_UNAVAILABLE'
  constructor(capability: string) { super(`${capability} is unavailable until Phase 4`) }
}
export class UnavailableConnectionSearchService implements ConnectionSearchService {
  async search(): Promise<never> { throw new RouteCapabilityUnavailableError('Connection search') }
}
export class UnavailableFlightRoutePlanner implements FlightRoutePlanner {
  async plan(): Promise<never> { throw new RouteCapabilityUnavailableError('Flight route planning') }
}
export class UnavailableRouteOptimizer implements RouteOptimizer {
  async optimize(): Promise<never> { throw new RouteCapabilityUnavailableError('Route optimization') }
}
