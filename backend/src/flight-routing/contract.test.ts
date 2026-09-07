import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { connectionEdgeSchema, routeSetPayloadSchema, type ConnectionSearchResult, type FlightRoutePlanResult, type RouteOptimizationResult, MockConnectionSearchService, MockFlightRoutePlanner, MockRouteOptimizer, UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from './services.js'

const loc = (iata: string) => ({ id: iata, type: 'airport' as const, name: iata, countryCode: 'CN', iata })
const verification = { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock' }] }
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from: loc(from), to: loc(to), departureDate: '2026-09-10', transferType: 'direct' as const, availability: 'verified' as const, verification, warnings: [], reasons: [] })
const base = { serviceVersion: 'mock-v1', verification, warnings: [], truncated: false, exhausted: true }

describe('flight-routing Phase 3 contracts', () => {
  it('rejects same-endpoint edges and malformed strict fields', () => {
    expect(() => connectionEdgeSchema.parse(edge('PEK', 'PEK'))).toThrow()
    expect(() => connectionEdgeSchema.parse({ ...edge('PEK', 'NRT'), extra: true })).toThrow()
  })
  it('discriminates route_set payload kinds', () => {
    const common = { schemaVersion: 1 as const, serviceVersion: 'v1', algorithmVersion: 'v1', sourceArtifactIds: [], verification, warnings: [], truncated: false, exhausted: true }
    expect(routeSetPayloadSchema.parse({ ...common, kind: 'connection_edges', edges: [edge('PEK', 'NRT')] })).toMatchObject({ kind: 'connection_edges' })
    expect(() => routeSetPayloadSchema.parse({ ...common, kind: 'flight_paths', edges: [] })).toThrow()
    expect(() => routeSetPayloadSchema.parse({ ...common, kind: 'connection_edges', edges: [], paths: [] })).toThrow()
  })
  it('mocks validate and delegate configured results', async () => {
    const connection: ConnectionSearchResult = { ...base, edges: [edge('PEK', 'NRT')] }
    const planner: FlightRoutePlanResult = { ...base, paths: [] }
    const optimizer: RouteOptimizationResult = { ...base, algorithmVersion: 'mock-v1', representatives: [], paretoFrontierCount: 0, rejectedCandidateCount: 0 }
    await expect(new MockConnectionSearchService(connection).search({ origin: loc('PEK'), destination: loc('CDG'), window: { from: '2026-09-10', to: '2026-09-11' }, preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 2 })).resolves.toEqual(connection)
    await expect(new MockFlightRoutePlanner(planner).plan({ nodes: [{ location: loc('PEK'), role: 'origin' }, { location: loc('CDG'), role: 'destination' }], edges: [edge('PEK', 'CDG')], window: { from: '2026-09-10', to: '2026-09-11' }, maxPaths: 2 })).resolves.toEqual(planner)
    await expect(new MockRouteOptimizer(optimizer).optimize({ paths: [{ id: 'p', nodes: [{ location: loc('PEK'), role: 'origin' }, { location: loc('CDG'), role: 'destination' }], edges: [edge('PEK', 'CDG')], transferCount: 0, feasibility: 'feasible', warnings: [] }], weights: {}, maxRepresentatives: 2 })).resolves.toEqual(optimizer)
  })
  it('fails unavailable capabilities deterministically and without secrets', async () => {
    for (const promise of [new UnavailableConnectionSearchService().search({} as never), new UnavailableFlightRoutePlanner().plan({} as never), new UnavailableRouteOptimizer().optimize({} as never)]) {
      await expect(promise).rejects.toMatchObject({ code: 'ROUTE_CAPABILITY_UNAVAILABLE' })
      await expect(promise).rejects.not.toThrow(/key|token|secret|provider/i)
    }
  })
  it('exports zod schemas for downstream contracts', () => expect(z.object({}).strict).toBeTypeOf('function'))
})
