import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import type { FareProvider } from '../fares/providers/provider.js'
import type { FareOffer } from '../fares/types.js'
import { airportTimeToIso, LiveFareConnectionSearch } from './live-connections.js'
import { DeterministicFlightRoutePlanner } from './planner.js'

const origin = { id: 'pvg', type: 'airport' as const, name: 'Shanghai Pudong', iata: 'PVG', countryCode: 'CN', timezone: 'Asia/Shanghai' }
const destination = { id: 'nrt', type: 'airport' as const, name: 'Tokyo Narita', iata: 'NRT', countryCode: 'JP', timezone: 'Asia/Tokyo' }
const verification = { status: 'verified' as const, checkedAt: '2026-09-07T00:00:00.000Z', confidence: 0.9, sources: [{ provider: 'fixture' }] }
const query = { origin, destination, window: { from: '2026-10-10', to: '2026-10-10' }, preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 100 }
const offer: FareOffer = { id: 'real-shape', segments: [{ flightNumber: 'MU523', airline: 'China Eastern', origin: 'PVG', destination: 'NRT', departsAt: '2026-10-10 22:00', arrivesAt: '2026-10-11 02:00', durationMinutes: 180 }], totalAmount: 1100, currency: 'CNY', totalDurationMinutes: 180, airlines: ['China Eastern'], transferType: 'direct' }
function setup(offers: FareOffer[] = [offer]) {
  const artifacts = new InMemoryArtifactRepository('owner', new Set(['trip']))
  const searchFlights = vi.fn(async input => ({ query: input, offers, provider: 'fixture', checkedAt: verification.checkedAt, verification }))
  const fares = { searchFlights } as unknown as FareProvider
  const topology = { search: vi.fn(async () => ({ edges: [], serviceVersion: 'empty', verification, warnings: ['No active topology snapshot is available'], truncated: false, exhausted: true })) }
  return { artifacts, searchFlights, service: new LiveFareConnectionSearch({ artifacts, fares, aviation: { getAirport: async () => undefined }, topology }) }
}

describe('live fare route generation', () => {
  it('creates a priced overnight route with immutable fare provenance when topology is empty', async () => {
    const { service, artifacts } = setup()
    const result = await service.search(query, { tripId: 'trip' })
    expect(result.edges).toHaveLength(1)
    const edge = result.edges[0]!
    expect(edge).toMatchObject({ departureAt: '2026-10-10T14:00:00.000Z', arrivalAt: '2026-10-10T17:00:00.000Z', fareOfferId: offer.id })
    const source = await artifacts.get(edge.fareArtifactId!)
    expect(source).toMatchObject({ tripId: 'trip', type: 'flight_search', schemaVersion: 1 })
    const planned = await new DeterministicFlightRoutePlanner().plan({ nodes: [{ location: origin, role: 'origin' }, { location: destination, role: 'destination' }], edges: result.edges, window: query.window, constraints: { maxTransfers: 0 }, maxPaths: 10 })
    expect(planned.paths[0]?.totalFare).toEqual({ amount: 1100, currency: 'CNY' })
    expect(planned.paths[0]?.totalDurationMinutes).toBe(180)
  })
  it('never relabels a through quote or invents segment-level prices', async () => {
    const { service } = setup([{ ...offer, transferType: 'airline', segments: [offer.segments[0]!, offer.segments[0]!] }])
    const result = await service.search(query, { tripId: 'trip' })
    expect(result.edges).toEqual([])
    expect(result.warnings.some(w => w.includes('Multi-segment'))).toBe(true)
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
    await expect(service.search(query, { tripId: 'foreign' })).rejects.toMatchObject({ code: 'FARE_PROVIDER_UNAVAILABLE' })
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
