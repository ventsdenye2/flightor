import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../trips/repository.js'
import { emptyTripContext } from '../trips/types.js'
import type { FareProvider } from '../fares/providers/provider.js'
import type { FareOffer } from '../fares/types.js'
import { flightSearchArtifactSchema } from '../fares/types.js'
import type { LocationRef } from '../aviation/types.js'
import { LiveFareConnectionSearch } from './live-connections.js'
import { BoundedBudgetConnectionSearch } from './budget-connections.js'
import { DeterministicFlightRoutePlanner } from './planner.js'
import { ParetoRouteOptimizer } from './optimizer.js'
import type { ConnectionSearchResult } from './types.js'
import type { ConnectionEdge } from './types.js'

const airport = (iata: string): LocationRef => ({ id: iata, type: 'airport', name: iata, iata, countryCode: 'CN', timezone: 'Etc/UTC' })
const origin = airport('PEK'), destination = airport('CDG'), hub = { ...airport('NRT'), cityCode: 'TYO' }
const checkedAt = '2026-09-27T00:00:00.000Z'
const verification = { status: 'verified' as const, checkedAt, confidence: 1, sources: [{ provider: 'fixture-fare' }] }
const offer = (id: string, from: string, to: string, departsAt: string, arrivesAt: string, totalAmount: number): FareOffer => ({
  id, segments: [{ origin: from, destination: to, departsAt, arrivesAt, airline: 'Fixture Air', flightNumber: 'FX1', durationMinutes: 240 }],
  totalAmount, currency: 'CNY', totalDurationMinutes: 240, airlines: ['Fixture Air'], transferType: 'direct',
})
const emptyTopology: ConnectionSearchResult = { edges: [], serviceVersion: 'scenario-empty-topology', verification,
  warnings: [], truncated: false, exhausted: true }

/** Offline, reproducible D5 budget-route probes. No external provider is used. */
export async function runBudgetRoutingScenario(caseId: 7 | 8 | 9, runIndex: number) {
  if (!Number.isSafeInteger(runIndex) || runIndex < 0) throw new Error('Invalid scenario run index')
  const tripId = `d5-budget-${caseId}-${runIndex}`
  const artifacts = new InMemoryArtifactRepository('scenario-owner', new Set([tripId]))
  const trips = new InMemoryTripContextRepository([emptyTripContext(tripId)])
  const fareOffers = new Map<string, FareOffer[]>([
    ['PEK|CDG|2026-10-10', caseId === 9 ? [] : [offer('baseline', 'PEK', 'CDG', '2026-10-10 00:00', '2026-10-10 12:00', 1500)]],
    ['PEK|NRT|2026-10-10', [offer('first', 'PEK', 'NRT', '2026-10-10 00:00', '2026-10-10 02:00', 400)]],
    ['NRT|CDG|2026-10-10', [offer('second', 'NRT', 'CDG', '2026-10-10 06:00', '2026-10-10 12:00', 500)]],
  ])
  let observedFareLookupCount = 0
  const fares = { searchFlights: async (query: Parameters<FareProvider['searchFlights']>[0]) => {
    observedFareLookupCount++
    return { query, offers: fareOffers.get(`${query.origin}|${query.destination}|${query.departureDate}`) ?? [],
      provider: 'fixture-fare', checkedAt, verification }
  } } as FareProvider
  const aviation = {
    getAirport: async ({ iata }: { iata: string }) => [origin, destination, hub].find(location => location.iata === iata),
    resolveLocation: async () => ({ matches: [hub], verification }),
  }
  const live = new LiveFareConnectionSearch({ artifacts, trips, fares, aviation,
    topology: { search: async () => emptyTopology } })
  let missingBindingEdge: ConnectionEdge | undefined
  const faultedLive = { search: async (...args: Parameters<LiveFareConnectionSearch['search']>) => {
    const result = await live.search(...args)
    if (caseId !== 9 || args[0].origin.iata !== 'NRT') return result
    const edges = result.edges.map(edge => ({ ...edge, fareArtifactId: undefined }))
    missingBindingEdge = edges[0]
    return { ...result, edges }
  } }
  const search = new BoundedBudgetConnectionSearch({ live: faultedLive, topology: { search: async () => emptyTopology }, aviation,
    knownHubIata: ['NRT'] })
  const found = await search.search({ origin, destination, window: { from: '2026-10-10', to: '2026-10-10' },
    preferredLocations: caseId === 8 ? [] : [{ id: 'city-TYO', type: 'city', name: 'Tokyo', cityCode: 'TYO', countryCode: 'JP' }],
    excludedLocations: [], acceptsSelfTransfer: caseId !== 8, acceptsLongStopover: false, maxCandidates: 100 }, { tripId })
  const planner = new DeterministicFlightRoutePlanner()
  const planningInput = {
    nodes: [{ location: origin, role: 'origin' }, { location: destination, role: 'destination' }],
    edges: found.edges, window: { from: '2026-10-10', to: '2026-10-10' },
    constraints: { requiredLocations: [], excludedLocations: [], allowSelfTransfer: caseId !== 8,
      allowAirportChange: false, allowLongStopover: false, maxTransfers: 1,
      minTransferMinutes: 45, minSelfTransferMinutes: 120 }, maxPaths: 20,
  } as const
  const pathResult = await planner.plan({ ...planningInput, nodes: [...planningInput.nodes], edges: [...found.edges],
    constraints: { ...planningInput.constraints, requiredLocations: [], excludedLocations: [] } })
  const caseNinePaths = caseId === 9 && missingBindingEdge
    ? (await planner.plan({ ...planningInput, nodes: [...planningInput.nodes], edges: [...found.edges, missingBindingEdge],
      constraints: { ...planningInput.constraints, requiredLocations: [], excludedLocations: [] } })).paths : []
  const candidatePaths = caseId === 9 ? caseNinePaths : pathResult.paths
  const optimized = candidatePaths.length ? await new ParetoRouteOptimizer().optimize({ paths: candidatePaths,
    weights: {}, preferredLocations: caseId === 8 ? [] : [hub], interestLocations: [], maxRepresentatives: 10 }) : undefined
  const bindingMatches = await Promise.all(found.edges.map(async edge => {
    if (!edge.fareArtifactId || !edge.fareOfferId) return false
    const stored = await artifacts.get(edge.fareArtifactId)
    const payload = stored?.type === 'flight_search' ? flightSearchArtifactSchema.safeParse(stored.payload) : undefined
    return stored?.type === 'flight_search' && stored.tripId === tripId && stored.tripContextVersion === 0
      && payload?.success === true && payload.data.offers.some(candidate => candidate.id === edge.fareOfferId && candidate.totalAmount === edge.fare?.amount)
  }))
  const cheapest = optimized?.representatives.find(representative => representative.badges.includes('cheapest'))
  const cheapestAvailable = cheapest?.path.totalFare?.amount
  const expected = caseId === 7 ? 900 : caseId === 8 ? 1500 : undefined
  const metrics = search.metricsFor(found)
  return { caseId, runIndex, observedFareLookupCount, routeCandidates: candidatePaths.length,
    pricedRoutes: candidatePaths.filter(path => !!path.totalFare).length, cheapestAvailable,
    pass: cheapestAvailable === expected && bindingMatches.every(Boolean) && observedFareLookupCount <= 14
      && (caseId !== 9 || ((metrics?.missingBindingRejections ?? 0) > 0 && caseNinePaths.length === 1
        && caseNinePaths[0]?.totalFare === undefined && !optimized?.representatives.some(representative => representative.badges.includes('cheapest')))),
    bindingMatches, missingBindingRejections: metrics?.missingBindingRejections ?? 0, metrics,
    optimizer: { representatives: optimized?.representatives.length ?? 0,
      cheapestBadgeCount: optimized?.representatives.filter(representative => representative.badges.includes('cheapest')).length ?? 0,
      rejectedCandidateCount: optimized?.rejectedCandidateCount ?? 0 },
  }
}
