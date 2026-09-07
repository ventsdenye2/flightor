import { describe, expect, it } from 'vitest'
import { locationRefKey } from '../../aviation/types.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import {
  MockConnectionSearchService,
  MockFlightRoutePlanner,
  MockRouteOptimizer
} from '../../flight-routing/mock.js'
import {
  UnavailableConnectionSearchService,
  UnavailableFlightRoutePlanner,
  UnavailableRouteOptimizer
} from '../../flight-routing/unavailable.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { ToolRegistry } from '../runtime/registry.js'
import {
  optimizeRouteInputSchema,
  optimizeRouteTool,
  planFlightRouteTool,
  searchConnectionFlightsInputSchema,
  searchConnectionFlightsTool
} from './flight-routing.js'

const origin = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', iata: 'PVG' }
const destination = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita', countryCode: 'JP', iata: 'NRT' }
const verification = {
  status: 'verified' as const,
  checkedAt: '2026-09-06T00:00:00.000Z',
  confidence: 1,
  sources: [{ provider: 'mock-routing' }]
}
const edge = {
  id: 'edge-pvg-nrt', from: origin, to: destination,
  departureDate: '2026-10-01', transferType: 'direct' as const,
  availability: 'verified' as const, verification, warnings: [], reasons: []
}
const nodes = [
  { location: origin, role: 'origin' as const },
  { location: destination, role: 'destination' as const }
]
const path = {
  id: 'path-pvg-nrt', nodes, edges: [edge],
  totalFare: { amount: 1_200, currency: 'CNY' },
  transferCount: 0, feasibility: 'feasible' as const, warnings: []
}
const score = {
  airfareSaving: 1, preferredCityMatch: 0, interestMatch: 0, eventMatch: 0,
  seasonMatch: 0, stopoverPlayability: 0, additionalCityValue: 0,
  routeNovelty: 0, selfTransferRisk: 0, complexity: 0, total: 1
}

function context(): ToolExecutionContext {
  return {
    requestId: 'req-1', conversationId: 'conv-1', tripId: 'trip-1', generationId: 'gen-1',
    trips: new InMemoryTripContextRepository([emptyTripContext('trip-1')]),
    artifacts: new InMemoryArtifactRepository('user-1', new Set(['trip-1'])),
    memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
    research: new UnavailableResearchAgent(),
    connectionSearch: new MockConnectionSearchService({
      edges: [edge], serviceVersion: 'mock-connection-v1', verification,
      warnings: [], truncated: false, exhausted: true
    }),
    flightRoutePlanner: new MockFlightRoutePlanner({
      paths: [path], serviceVersion: 'mock-planner-v1', verification,
      warnings: [], truncated: false, exhausted: true
    }),
    routeOptimizer: new MockRouteOptimizer({
      representatives: [{ path, score }], paretoFrontierCount: 1, rejectedCandidateCount: 0,
      serviceVersion: 'mock-optimizer-v1', algorithmVersion: 'pareto-v1', verification,
      warnings: [], truncated: false, exhausted: true
    }),
    resolvedLocationKeys: new Set([locationRefKey(origin), locationRefKey(destination)])
  }
}

describe('Phase 3 flight-routing tools', () => {
  it('persists compact connection, path, and optimized route-set handoffs', async () => {
    const ctx = context()
    const connection = await searchConnectionFlightsTool.execute({
      origin, destination, window: { from: '2026-10-01', to: '2026-10-10' },
      preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false,
      acceptsLongStopover: false, maxCandidates: 10
    }, ctx, new AbortController().signal)
    expect(connection.summary).toMatchObject({ edgeCount: 1, availabilityCounts: { verified: 1 } })
    expect(await ctx.artifacts.get(connection.artifact.id)).toMatchObject({
      type: 'route_set', schemaVersion: 1, payload: { kind: 'connection_edges' }
    })

    const planned = await planFlightRouteTool.execute({
      candidateArtifactId: connection.artifact.id, nodes,
      window: { from: '2026-10-01', to: '2026-10-10' }, maxPaths: 10
    }, ctx, new AbortController().signal)
    expect(planned.summary.pathCount).toBe(1)
    expect(await ctx.artifacts.get(planned.artifact.id)).toMatchObject({
      payload: { kind: 'flight_paths', sourceArtifactIds: [connection.artifact.id] }
    })

    const optimized = await optimizeRouteTool.execute({
      pathArtifactId: planned.artifact.id, weights: { airfareSaving: 1 }, maxRepresentatives: 5
    }, ctx, new AbortController().signal)
    expect(optimized.summary).toMatchObject({
      paretoFrontierCount: 1, representativeCount: 1, rejectedCandidateCount: 0
    })
    expect(await ctx.artifacts.get(optimized.artifact.id)).toMatchObject({
      payload: { kind: 'optimized_routes', sourceArtifactIds: [planned.artifact.id] }
    })
  })

  it('rejects untrusted locations, oversized windows, unknown weight fields, and wrong artifact kinds', async () => {
    const ctx = context()
    ctx.resolvedLocationKeys = new Set()
    await expect(searchConnectionFlightsTool.execute({
      origin, destination, window: { from: '2026-10-01', to: '2026-10-02' },
      preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false,
      acceptsLongStopover: false, maxCandidates: 10
    }, ctx, new AbortController().signal)).rejects.toThrow('authoritative')
    expect(() => searchConnectionFlightsInputSchema.parse({
      origin, destination, window: { from: '2026-10-01', to: '2026-11-01' }
    })).toThrow()
    expect(() => optimizeRouteInputSchema.parse({
      pathArtifactId: '018f3f7a-75a4-7cc7-b926-7f8fe2d39416', weights: { invented: 1 }
    })).toThrow()

    const owned = context()
    const source = await searchConnectionFlightsTool.execute({
      origin, destination, window: { from: '2026-10-01', to: '2026-10-02' },
      preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false,
      acceptsLongStopover: false, maxCandidates: 10
    }, owned, new AbortController().signal)
    await expect(optimizeRouteTool.execute({
      pathArtifactId: source.artifact.id, weights: {}, maxRepresentatives: 5
    }, owned, new AbortController().signal)).rejects.toThrow('flight_paths')
  })

  it('turns unavailable Phase 4 services into bounded tool failures', async () => {
    const ctx = context()
    ctx.connectionSearch = new UnavailableConnectionSearchService()
    ctx.flightRoutePlanner = new UnavailableFlightRoutePlanner()
    ctx.routeOptimizer = new UnavailableRouteOptimizer()
    const registry = new ToolRegistry().register(searchConnectionFlightsTool)
    const outcome = await registry.execute({
      id: 'route-call', type: 'function', function: {
        name: 'search_connection_flights',
        arguments: JSON.stringify({ origin, destination, window: { from: '2026-10-01', to: '2026-10-02' } })
      }
    }, ctx, new AbortController().signal)
    expect(outcome).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
    expect(outcome.content).not.toMatch(/provider|token|secret|key/i)
  })
})
