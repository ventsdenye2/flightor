import { connectionSearchInputSchema, connectionSearchResultSchema, flightRoutePlanInputSchema, flightRoutePlanResultSchema, routeOptimizationInputSchema, routeOptimizationResultSchema, type ConnectionSearchResult, type ConnectionSearchService, type FlightRoutePlanResult, type FlightRoutePlanner, type RouteOptimizationResult, type RouteOptimizer } from './types.js'

export class MockConnectionSearchService implements ConnectionSearchService {
  constructor(private readonly result: ConnectionSearchResult | Error) {}
  async search(input: Parameters<ConnectionSearchService['search']>[0]): Promise<ConnectionSearchResult> {
    connectionSearchInputSchema.parse(input)
    if (this.result instanceof Error) throw this.result
    return connectionSearchResultSchema.parse(structuredClone(this.result))
  }
}
export class MockFlightRoutePlanner implements FlightRoutePlanner {
  constructor(private readonly result: FlightRoutePlanResult | Error) {}
  async plan(input: Parameters<FlightRoutePlanner['plan']>[0]): Promise<FlightRoutePlanResult> {
    flightRoutePlanInputSchema.parse(input)
    if (this.result instanceof Error) throw this.result
    return flightRoutePlanResultSchema.parse(structuredClone(this.result))
  }
}
export class MockRouteOptimizer implements RouteOptimizer {
  constructor(private readonly result: RouteOptimizationResult | Error) {}
  async optimize(input: Parameters<RouteOptimizer['optimize']>[0]): Promise<RouteOptimizationResult> {
    routeOptimizationInputSchema.parse(input)
    if (this.result instanceof Error) throw this.result
    return routeOptimizationResultSchema.parse(structuredClone(this.result))
  }
}
