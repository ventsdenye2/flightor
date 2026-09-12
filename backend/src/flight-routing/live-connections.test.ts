import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import type { FareProvider } from '../fares/providers/provider.js'
import type { FareOffer } from '../fares/types.js'
import { airportTimeToIso, LiveFareConnectionSearch } from './live-connections.js'
import { DeterministicFlightRoutePlanner } from './planner.js'
import { InMemoryTripContextRepository } from '../trips/repository.js'
import { emptyTripContext } from '../trips/types.js'
import { createArtifactWorkspace } from '../artifacts/workspace.js'
import type { LocationRef } from '../aviation/types.js'
import { ParetoRouteOptimizer } from './optimizer.js'

const origin = { id: 'pvg', type: 'airport' as const, name: 'Shanghai Pudong', iata: 'PVG', countryCode: 'CN', timezone: 'Asia/Shanghai' }
const destination = { id: 'nrt', type: 'airport' as const, name: 'Tokyo Narita', iata: 'NRT', countryCode: 'JP', timezone: 'Asia/Tokyo' }
const hub = { id: 'icn', type: 'airport' as const, name: 'Incheon', iata: 'ICN', cityCode: 'SEL', countryCode: 'KR', timezone: 'Asia/Seoul' }
const verification = { status: 'verified' as const, checkedAt: '2026-09-07T00:00:00.000Z', confidence: 0.9, sources: [{ provider: 'fixture' }] }
const query = { origin, destination, window: { from: '2026-10-10', to: '2026-10-10' }, preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 100 }
const offer: FareOffer = { id: 'real-shape', segments: [{ flightNumber: 'MU523', airline: 'China Eastern', origin: 'PVG', destination: 'NRT', departsAt: '2026-10-10 22:00', arrivesAt: '2026-10-11 02:00', durationMinutes: 180 }], totalAmount: 1100, currency: 'CNY', totalDurationMinutes: 180, airlines: ['China Eastern'], transferType: 'direct' }
const connectingOffer: FareOffer = { ...offer, id: 'complete-connection', totalAmount: 1000, transferType: 'airline', totalDurationMinutes: 390,
  segments: [
    { ...offer.segments[0]!, flightNumber: 'MU101', destination: 'ICN', departsAt: '2026-10-10 08:00', arrivesAt: '2026-10-10 11:00', durationMinutes: 120 },
    { ...offer.segments[0]!, flightNumber: 'MU102', origin: 'ICN', departsAt: '2026-10-10 13:00', arrivesAt: '2026-10-10 15:30', durationMinutes: 150 }
  ], layovers: [{ afterSegmentIndex: 0, airport: 'ICN', durationMinutes: 120 }] }
function setup(offers: FareOffer[] = [offer], airports: LocationRef[] = [hub]) {
  const artifacts = new InMemoryArtifactRepository('owner', new Set(['trip']))
  const trips = new InMemoryTripContextRepository([emptyTripContext('trip')])
  const searchFlights = vi.fn(async input => ({ query: input, offers, provider: 'fixture', checkedAt: verification.checkedAt, verification }))
  const fares = { searchFlights } as unknown as FareProvider
  const topology = { search: vi.fn(async () => ({ edges: [], serviceVersion: 'empty', verification, warnings: ['No active topology snapshot is available'], truncated: false, exhausted: true })) }
  const getAirport = vi.fn(async ({ iata }: { iata: string }) => airports.find(airport => airport.iata === iata))
  return { artifacts, trips, searchFlights, getAirport, service: new LiveFareConnectionSearch({ artifacts, trips, fares, aviation: { getAirport }, topology }) }
}

describe('live fare route generation', () => {
  it('creates a priced overnight route with immutable fare provenance when topology is empty', async () => {
    const { service, artifacts } = setup()
    const result = await service.search(query, { tripId: 'trip' })
    expect(result.edges).toHaveLength(1)
    const edge = result.edges[0]!
    expect(edge).toMatchObject({ departureAt: '2026-10-10T14:00:00.000Z', arrivalAt: '2026-10-10T17:00:00.000Z', fareOfferId: offer.id })
    const source = await artifacts.get(edge.fareArtifactId!)
    expect(source).toMatchObject({ tripId: 'trip', type: 'flight_search', schemaVersion: 1, tripContextVersion: 0 })
    const planned = await new DeterministicFlightRoutePlanner().plan({ nodes: [{ location: origin, role: 'origin' }, { location: destination, role: 'destination' }], edges: result.edges, window: query.window, constraints: { maxTransfers: 0 }, maxPaths: 10 })
    expect(planned.paths[0]?.totalFare).toEqual({ amount: 1100, currency: 'CNY' })
    expect(planned.paths[0]?.totalDurationMinutes).toBe(180)
  })
  it('compares complete airline offers without inventing segment prices, protection, baggage or a visit city', async () => {
    const { service, artifacts, getAirport } = setup([offer, connectingOffer])
    const result = await service.search(query, { tripId: 'trip' })
    expect(result.edges).toHaveLength(2)
    const connection = result.edges.find(edge => edge.transferType === 'airline')!
    expect(connection.segments).toHaveLength(2)
    expect(connection).toMatchObject({ fare: { amount: 1000, currency: 'CNY' }, availability: 'partial', fareOfferId: connectingOffer.id })
    expect(connection.protectedConnection).toBeUndefined()
    expect(connection.baggageRecheck).toBeUndefined()
    expect(connection.segments?.every(segment => !('fare' in segment))).toBe(true)
    expect(connection.segments?.[0]?.arrivalAt).toBe('2026-10-10T02:00:00.000Z')
    expect(connection.segments?.[1]?.departureAt).toBe('2026-10-10T04:00:00.000Z')
    expect(getAirport).toHaveBeenCalledTimes(1)
    expect(await artifacts.get(connection.fareArtifactId!)).toMatchObject({ payload: { offers: expect.arrayContaining([expect.objectContaining({ id: connectingOffer.id, segments: connectingOffer.segments })]) } })
    const plan = await new DeterministicFlightRoutePlanner().plan({ nodes: [{ location: origin, role: 'origin' }, { location: destination, role: 'destination' }], edges: result.edges, window: query.window, constraints: { maxTransfers: 1 }, maxPaths: 10 })
    const throughPath = plan.paths.find(path => path.edges[0]?.transferType === 'airline')!
    expect(throughPath).toMatchObject({ transferCount: 1, totalFare: { amount: 1000 }, totalDurationMinutes: 390 })
    expect(throughPath.nodes).toHaveLength(2)
    const optimized = await new ParetoRouteOptimizer().optimize({ paths: plan.paths, weights: {}, preferredLocations: [], interestLocations: [], maxRepresentatives: 10 })
    expect(optimized.representatives.find(item => item.path.id === throughPath.id)?.badges).toContain('cheapest')
    expect(optimized.rejectedCandidateCount).toBe(0)
  })
  it('preserves incomplete timezone evidence as partial and still enforces known provider layover duration', async () => {
    const { timezone: _timezone, ...unknownTimeHub } = hub
    const { service } = setup([{ ...connectingOffer, layovers: [{ afterSegmentIndex: 0, airport: 'ICN', durationMinutes: 20 }] }], [unknownTimeHub])
    const result = await service.search(query, { tripId: 'trip' })
    expect(result.edges[0]).toMatchObject({ availability: 'partial', layovers: [{ durationMinutes: 20 }] })
    expect(result.edges[0]?.segments?.[0]?.arrivalAt).toBeUndefined()
    const plan = await new DeterministicFlightRoutePlanner().plan({ nodes: [{ location: origin, role: 'origin' }, { location: destination, role: 'destination' }], edges: result.edges, window: query.window, constraints: { maxTransfers: 1 }, maxPaths: 10 })
    expect(plan.paths).toHaveLength(0)
  })
  it('retains source fare evidence when an internal airport cannot be resolved and honors transit exclusions', async () => {
    const unresolved = setup([connectingOffer], [])
    expect((await unresolved.service.search(query, { tripId: 'trip' })).edges).toEqual([])
    expect(await unresolved.artifacts.listForTrip('trip')).toHaveLength(1)
    const resolved = setup([connectingOffer])
    expect((await resolved.service.search({ ...query, excludedLocations: [hub] }, { tripId: 'trip' })).edges).toEqual([])
  })
  it('supports more than four physical segments as one quoted edge', async () => {
    const airportCodes = ['PVG', 'AAA', 'BBB', 'CCC', 'DDD', 'NRT']
    const middleAirports = airportCodes.slice(1, -1).map(iata => ({ ...hub, id: iata, iata, name: iata, timezone: 'UTC' }))
    const segments = airportCodes.slice(0, -1).map((iata, index) => ({ ...offer.segments[0]!, origin: iata, destination: airportCodes[index + 1]!, flightNumber: `M${index}`,
      departsAt: `2026-10-10T${String(index * 2 + 1).padStart(2, '0')}:00:00Z`, arrivesAt: `2026-10-10T${String(index * 2 + 2).padStart(2, '0')}:00:00Z`, durationMinutes: 60 }))
    const { service } = setup([{ ...offer, transferType: 'airline', segments, totalDurationMinutes: 540 }], middleAirports)
    const result = await service.search(query, { tripId: 'trip' })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]?.segments).toHaveLength(5)
    expect(result.edges[0]?.fare?.amount).toBe(offer.totalAmount)
  })
  it('bounds wide-window lookups and does not mask provider failure as a successful route', async () => {
    const { service, searchFlights } = setup([])
    const result = await service.search({ ...query, window: { from: '2026-10-01', to: '2026-10-20' } }, { tripId: 'trip' })
    expect(searchFlights).toHaveBeenCalledTimes(4)
    expect(result.truncated).toBe(true)
    searchFlights.mockRejectedValue(new Error('provider secret response'))
    await expect(service.search(query, { tripId: 'trip' })).rejects.toMatchObject({ code: 'FARE_PROVIDER_UNAVAILABLE' })
  })
  it('honors cancellation before providers and ownership before persisting evidence', async () => {
    const { service, searchFlights } = setup()
    await expect(service.search(query, { tripId: 'trip', checkpoint: async () => { throw new Error('ROUTE_GENERATION_CANCELLED') } })).rejects.toThrow('ROUTE_GENERATION_CANCELLED')
    expect(searchFlights).not.toHaveBeenCalled()
    await expect(service.search(query, { tripId: 'foreign' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(searchFlights).not.toHaveBeenCalled()
  })

  it('preserves the frozen run lineage of fare evidence and stops stale provider work before writing', async () => {
    const { service, artifacts, trips, searchFlights } = setup()
    const artifactWorkspace = await createArtifactWorkspace({ artifacts, trips, tripId: 'trip', goalId: 'goal', runId: 'run' })
    const result = await service.search(query, { tripId: 'trip', artifactWorkspace })
    expect(await artifacts.get(result.edges[0]!.fareArtifactId!)).toMatchObject({ goalId: 'goal', runId: 'run', tripContextVersion: 0 })
    const before = (await artifacts.listForTrip('trip')).length
    searchFlights.mockImplementationOnce(async input => {
      await trips.update('trip', { travelDays: 10 }, 0)
      return { query: input, offers: [offer], provider: 'fixture', checkedAt: verification.checkedAt, verification }
    })
    await expect(service.search(query, { tripId: 'trip', artifactWorkspace })).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(await artifacts.listForTrip('trip')).toHaveLength(before)
  })
})

describe('airport-local timestamps', () => {
  it('converts known timezones and rejects ambiguous or impossible DST times', () => {
    expect(airportTimeToIso('2026-10-10 09:00', 'Asia/Tokyo')).toBe('2026-10-10T00:00:00.000Z')
    expect(airportTimeToIso('2026-10-10 09:00')).toBeUndefined()
    expect(airportTimeToIso('2026-03-08 02:30', 'America/New_York')).toBeUndefined()
    expect(airportTimeToIso('2026-11-01 01:30', 'America/New_York')).toBeUndefined()
  })
})
