import { describe, expect, it, vi } from 'vitest'
import { BoundedBudgetConnectionSearch, BUDGET_CONNECTION_LIMITS } from './budget-connections.js'
import { DeterministicFlightRoutePlanner } from './planner.js'
import { runBudgetRoutingScenario } from './d5-budget-scenarios.js'
import type { ConnectionEdge, ConnectionSearchInput, ConnectionSearchResult } from './types.js'

const loc = (iata: string) => ({ id: iata, type: 'airport' as const, name: iata, iata, countryCode: 'CN' })
const origin = loc('PEK'), destination = loc('CDG'), hub = loc('NRT'), other = loc('ICN')
const verification = { status: 'verified' as const, checkedAt: '2026-09-27T00:00:00.000Z', confidence: 0.9, sources: [{ provider: 'fixture' }] }
const input: ConnectionSearchInput = { origin, destination, window: { from: '2026-10-10', to: '2026-10-10' }, preferredLocations: [hub],
  excludedLocations: [], acceptsSelfTransfer: true, acceptsLongStopover: false, maxCandidates: 100 }
const edge = (from: string, to: string, amount: number, departureAt: string, arrivalAt: string, bound = true): ConnectionEdge => ({
  id: `${from}-${to}-${departureAt}`, from: loc(from), to: loc(to), departureDate: departureAt.slice(0, 10),
  arrivalDate: arrivalAt.slice(0, 10), departureAt, arrivalAt, transferType: 'direct', availability: 'verified',
  fare: { amount, currency: 'CNY' }, ...(bound ? { fareArtifactId: `artifact-${from}-${to}`, fareOfferId: `offer-${from}-${to}` } : {}),
  verification, warnings: [], reasons: [],
})
const baseline = edge('PEK', 'CDG', 1500, '2026-10-10T00:00:00Z', '2026-10-10T12:00:00Z')
const first = edge('PEK', 'NRT', 400, '2026-10-10T00:00:00Z', '2026-10-10T02:00:00Z')
const second = edge('NRT', 'CDG', 500, '2026-10-10T06:00:00Z', '2026-10-10T12:00:00Z')
const result = (edges: ConnectionEdge[]): ConnectionSearchResult => ({ edges, serviceVersion: 'fixture', coverageStatus: 'reachable',
  verification, warnings: [], truncated: false, exhausted: true })

function setup(overrides: Record<string, ConnectionEdge[]> = {}) {
  const fares = new Map(Object.entries({ 'PEK|CDG|2026-10-10': [baseline], 'PEK|NRT|2026-10-10': [first],
    'NRT|CDG|2026-10-10': [second], ...overrides }))
  const live = { search: vi.fn(async (query: ConnectionSearchInput) => result(fares.get(`${query.origin.iata}|${query.destination.iata}|${query.window.from}`) ?? [])) }
  const topology = { search: vi.fn(async () => result([edge('PEK', 'NRT', 0, '2026-10-10T00:00:00Z', '2026-10-10T02:00:00Z'),
    edge('PEK', 'ICN', 0, '2026-10-10T00:00:00Z', '2026-10-10T02:00:00Z')])) }
  return { search: new BoundedBudgetConnectionSearch({ live, topology }), live, topology }
}

describe('bounded budget connection search', () => {
  it('discovers a 900 two-ticket route beside a 1500 baseline with immutable bindings', async () => {
    const { search, live } = setup()
    const found = await search.search(input)
    const plan = await new DeterministicFlightRoutePlanner().plan({
      nodes: [{ location: origin, role: 'origin' }, { location: destination, role: 'destination' }], edges: found.edges,
      window: input.window, constraints: { allowSelfTransfer: true, maxTransfers: 1, minSelfTransferMinutes: 120 }, maxPaths: 10,
    })
    expect(plan.paths.map(path => path.totalFare?.amount).sort((a, b) => a! - b!)).toEqual([900, 1500])
    expect(plan.paths.find(path => path.totalFare?.amount === 900)?.edges).toHaveLength(2)
    expect(live.search).toHaveBeenCalledTimes(4)
    expect(search.metricsFor(found)).toMatchObject({ fareCalls: 4, selectedHubs: ['NRT', 'ICN'], candidateEdges: 3 })
  })

  it('does not query independent legs when self-transfer is disabled', async () => {
    const { search, live, topology } = setup()
    const found = await search.search({ ...input, acceptsSelfTransfer: false })
    expect(found.edges).toEqual([baseline])
    expect(live.search).toHaveBeenCalledTimes(1)
    expect(topology.search).not.toHaveBeenCalled()
  })

  it('excludes hubs and never presents an unbound quoted fare as a route candidate', async () => {
    const { search, live } = setup({ 'PEK|NRT|2026-10-10': [{ ...first, fareArtifactId: undefined }] })
    const found = await search.search({ ...input, excludedLocations: [other] })
    expect(found.edges).toEqual([baseline])
    expect(live.search).toHaveBeenCalledTimes(2)
    const unbound = { ...first, fareArtifactId: undefined }
    const planned = await new DeterministicFlightRoutePlanner().plan({ nodes: [{ location: origin, role: 'origin' },
      { location: hub, role: 'stopover' }, { location: destination, role: 'destination' }], edges: [unbound, second],
      window: input.window, constraints: { allowSelfTransfer: true, minSelfTransferMinutes: 120 }, maxPaths: 10 })
    expect(planned.paths[0]?.totalFare).toBeUndefined()
  })

  it('bounds date and hub expansion regardless of the requested window', async () => {
    const { search, live } = setup()
    const found = await search.search({ ...input, window: { from: '2026-10-10', to: '2026-10-20' },
      preferredLocations: [hub, other, loc('HKG'), loc('SIN')] })
    const metrics = search.metricsFor(found)!
    expect(metrics.departureDates).toEqual(['2026-10-10', '2026-10-20'])
    expect(metrics.selectedHubs).toHaveLength(BUDGET_CONNECTION_LIMITS.hubs)
    expect(metrics.fareCalls).toBeLessThanOrEqual(BUDGET_CONNECTION_LIMITS.fareCalls)
    expect(metrics.truncated).toBe(true)
    expect(live.search).toHaveBeenCalledTimes(metrics.fareCalls)
  })

  it('uses real saved FlightSearchArtifacts for all three reusable scenario probes', async () => {
    const seven = await runBudgetRoutingScenario(7, 0)
    const eight = await runBudgetRoutingScenario(8, 0)
    const nine = await runBudgetRoutingScenario(9, 0)
    expect(seven).toMatchObject({ pass: true, cheapestAvailable: 900, observedFareLookupCount: 3,
      optimizer: { cheapestBadgeCount: 1 } })
    expect(eight).toMatchObject({ pass: true, cheapestAvailable: 1500, observedFareLookupCount: 1,
      optimizer: { cheapestBadgeCount: 1 } })
    expect(nine).toMatchObject({ pass: true, cheapestAvailable: undefined, observedFareLookupCount: 3,
      routeCandidates: 1, pricedRoutes: 0, missingBindingRejections: 1, optimizer: { cheapestBadgeCount: 0 } })
    expect(seven.bindingMatches).toEqual([true, true, true])
  })

  it('rejects mismatched OD/date quotes and excluded internal transfer cities', async () => {
    const internal = { ...baseline, id: 'internal-excluded', segments: [
      { id: 'a', from: origin, to: hub, verification }, { id: 'b', from: hub, to: destination, verification }], transferType: 'airline' as const }
    const { search } = setup({ 'PEK|CDG|2026-10-10': [
      edge('PEK', 'CDG', 1, '2026-10-11T00:00:00Z', '2026-10-11T12:00:00Z'),
      edge('NRT', 'CDG', 1, '2026-10-10T00:00:00Z', '2026-10-10T12:00:00Z'), internal,
    ] })
    const found = await search.search({ ...input, acceptsSelfTransfer: false, excludedLocations: [hub] })
    expect(found.edges).toEqual([])
  })

  it('honors cancellation before any fare request', async () => {
    const { search, live } = setup()
    await expect(search.search(input, { signal: AbortSignal.abort() })).rejects.toThrow()
    expect(live.search).not.toHaveBeenCalled()
  })
})
