import { describe, expect, it, vi } from 'vitest'
import { MockTopologyRepository } from '../topology/mock.js'
import { ProductionConnectionSearchService } from './connection-search.js'
import type { TopologyQueryResult } from '../topology/repository.js'
import type { FareProvider } from '../fares/providers/provider.js'

const loc = (iata: string, id = iata) => ({ id, type: 'airport' as const, name: iata, countryCode: 'CN', iata })
const verification = { status: 'verified' as const, checkedAt: '2026-09-07T00:00:00.000Z', confidence: 1, sources: [{ provider: 'test' }] }
const topology: TopologyQueryResult = {
  snapshot: { id: 'topology-1', coverage: 'complete', activatedAt: '2026-09-07T00:00:00.000Z', verification }, coverageStatus: 'reachable', truncated: false, exhausted: true, warnings: [], candidates: [
    { id: 'preferred', origin: loc('AAA'), destination: loc('CCC'), segments: [{ id: 's1', from: loc('AAA'), to: loc('BBB'), verification }, { id: 's2', from: loc('BBB'), to: loc('CCC'), verification }], transferMinutes: [120], transferType: 'protected', verification, warnings: [] },
    { id: 'general', origin: loc('AAA'), destination: loc('CCC'), segments: [{ id: 's3', from: loc('AAA'), to: loc('CCC'), verification }], transferMinutes: [], transferType: 'direct', verification, warnings: [] },
    { id: 'self', origin: loc('AAA'), destination: loc('CCC'), segments: [{ id: 's4', from: loc('AAA'), to: loc('CCC'), verification }], transferMinutes: [], transferType: 'self', verification, warnings: [] }
  ]
}
describe('ProductionConnectionSearchService', () => {
  it('never attaches a complete connecting quote to a single topology flight', async () => {
    const searchFlights = vi.fn(async (query: Parameters<FareProvider['searchFlights']>[0]) => ({
      query, offers: [{ id: 'whole-itinerary', segments: [
        { flightNumber: 'M1', airline: 'Mock', origin: query.origin, destination: 'DDD', departsAt: `${query.departureDate}T00:00:00Z`, arrivesAt: `${query.departureDate}T02:00:00Z`, durationMinutes: 120 },
        { flightNumber: 'M2', airline: 'Mock', origin: 'DDD', destination: query.destination, departsAt: `${query.departureDate}T04:00:00Z`, arrivesAt: `${query.departureDate}T06:00:00Z`, durationMinutes: 120 }
      ], totalAmount: 900, currency: 'CNY', totalDurationMinutes: 360, airlines: ['Mock'], transferType: 'airline' }], provider: 'fixture', checkedAt: verification.checkedAt, verification
    }))
    const fares = { searchFlights } as unknown as FareProvider
    const result = await new ProductionConnectionSearchService(new MockTopologyRepository(topology), fares, { maxFareLookups: 1 }).search({ origin: loc('AAA'), destination: loc('CCC'), window: { from: '2026-10-04', to: '2026-10-04' }, preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 1 })
    expect(searchFlights).toHaveBeenCalledOnce()
    expect(result.edges[0]?.fare).toBeUndefined()
    expect(result.edges[0]?.fareOfferId).toBeUndefined()
  })
  it('keeps preferred-first ordering while retaining general candidates and caps fare calls', async () => {
    const searchFlights = vi.fn().mockImplementation(async (query: Parameters<FareProvider['searchFlights']>[0]) => ({
      query,
      offers: [{
        id: `offer-${query.origin}-${query.destination}`,
        segments: [{ flightNumber: 'TF1', airline: 'Test Fare', origin: query.origin, destination: query.destination, departsAt: `${query.departureDate}T01:00:00Z`, arrivesAt: `${query.departureDate}T03:00:00Z`, durationMinutes: 120 }],
        totalAmount: 800, currency: query.currency, totalDurationMinutes: 120,
        airlines: ['Test Fare'], transferType: 'direct' as const
      }],
      provider: 'test-fares', checkedAt: '2026-09-07T00:00:00.000Z', verification
    }))
    const fares = { name: 'test-fares', searchFlights, searchFlexibleFlights: vi.fn(), refreshFlight: vi.fn() } as unknown as FareProvider
    const result = await new ProductionConnectionSearchService(new MockTopologyRepository(topology), fares, { maxFareLookups: 1 }).search({ origin: loc('AAA'), destination: loc('CCC'), window: { from: '2026-10-04', to: '2026-10-10' }, preferredLocations: [loc('BBB')], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 10 })
    expect(result.edges.map(edge => edge.id)).toEqual(['preferred:s1:0', 'preferred:s2:1', 'general:s3:0'])
    expect(searchFlights).toHaveBeenCalledTimes(1)
    expect(result.edges.every(edge => edge.availability !== 'unknown')).toBe(true)
    expect(result.verification.status).toBe('partially_verified')
    expect(result.edges[0]?.fareArtifactId).toBeUndefined()
    expect(result.warnings.some(warning => warning.includes('excluded from route totals'))).toBe(true)
  })

  it('preserves structural candidates when fare enrichment fails', async () => {
    const fares = { name: 'test-fares', searchFlights: vi.fn().mockRejectedValue(new Error('provider outage')), searchFlexibleFlights: vi.fn(), refreshFlight: vi.fn() } as unknown as FareProvider
    const result = await new ProductionConnectionSearchService(new MockTopologyRepository(topology), fares).search({ origin: loc('AAA'), destination: loc('CCC'), window: { from: '2026-10-04', to: '2026-10-10' }, preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 1 })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]?.availability).toBe('partial')
    expect(result.warnings).toContain('Fare enrichment failed; structural candidate preserved')
  })

  it('never presents the window start as a verified operating date when schedule detail is absent', async () => {
    const result = await new ProductionConnectionSearchService(new MockTopologyRepository(topology), { maxFareLookups: 0 }).search({ origin: loc('AAA'), destination: loc('CCC'), window: { from: '2026-10-04', to: '2026-10-10' }, preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 1 })
    expect(result.edges[0]).toMatchObject({ departureDate: '2026-10-04', availability: 'partial' })
    expect(result.edges[0]?.warnings.some(warning => warning.includes('search anchor'))).toBe(true)
    expect(result.verification.status).toBe('partially_verified')
  })

  it('stops remaining fare-provider calls when a persistent checkpoint cancels the run', async () => {
    const searchFlights = vi.fn().mockResolvedValue({ query: { origin: 'AAA', destination: 'BBB', departureDate: '2026-10-04', currency: 'CNY', travelClass: 1 }, offers: [], provider: 'test-fares', checkedAt: '2026-09-07T00:00:00.000Z', verification })
    const fares = { name: 'test-fares', searchFlights, searchFlexibleFlights: vi.fn(), refreshFlight: vi.fn() } as unknown as FareProvider
    let checkpoints = 0
    const service = new ProductionConnectionSearchService(new MockTopologyRepository(topology), fares)

    await expect(service.search(
      { origin: loc('AAA'), destination: loc('CCC'), window: { from: '2026-10-04', to: '2026-10-10' }, preferredLocations: [], excludedLocations: [], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 10 },
      { checkpoint: async () => {
        checkpoints += 1
        if (checkpoints === 4) throw new Error('ROUTE_GENERATION_CANCELLED')
      } }
    )).rejects.toThrow('ROUTE_GENERATION_CANCELLED')
    expect(searchFlights).toHaveBeenCalledTimes(1)
  })
})
