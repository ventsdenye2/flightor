import { describe, expect, it, vi } from 'vitest'
import { SerpApiFareProvider } from './serpapi.js'
import { flightSearchArtifactSchema } from '../types.js'
import { summarizeFareItineraries } from '../summary.js'
import { executeFlightSearch } from '../search-service.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'

const input = { origin: 'PEK', destination: 'HKG', departureDate: '2026-10-01', currency: 'CNY' as const, travelClass: 1 }
const raw = {
  best_flights: [{
    price: 1000,
    total_duration: 210,
    flights: [{
      flight_number: 'CA101',
      airline: 'Air China',
      departure_airport: { id: 'PEK', time: '2026-10-01 08:00' },
      arrival_airport: { id: 'HKG', time: '2026-10-01 11:30' },
      duration: 210
    }]
  }]
}

describe('SerpApiFareProvider', () => {
  it('persists complete connecting fares alongside direct fares with every layover and unknown baggage/protection', async () => {
    const connected = {
      price: 800, total_duration: 510,
      flights: [
        { flight_number: 'CA1', airline: 'Air China', duration: 90, departure_airport: { id: 'PEK', time: '2026-10-01 08:00' }, arrival_airport: { id: 'SHA', time: '2026-10-01 09:30' } },
        { flight_number: 'CA2', airline: 'Air China', duration: 100, departure_airport: { id: 'SHA', time: '2026-10-01 10:30' }, arrival_airport: { id: 'XMN', time: '2026-10-01 12:10' } },
        { flight_number: 'CA3', airline: 'Air China', duration: 80, departure_airport: { id: 'XMN', time: '2026-10-01 15:10' }, arrival_airport: { id: 'HKG', time: '2026-10-01 16:30' } }
      ],
      layovers: [{ id: 'SHA', duration: 60 }, { id: 'XMN', duration: 180, overnight: false }]
    }
    const provider = new SerpApiFareProvider({ searchFlights: vi.fn().mockResolvedValue({ ...raw, other_flights: [connected] }) })
    const artifacts = new InMemoryArtifactRepository('u', new Set(['trip-1']))
    const stored = await executeFlightSearch(input, {
      artifacts, fares: provider, tripId: 'trip-1', tripContextVersion: 0,
      trips: new InMemoryTripContextRepository([emptyTripContext('trip-1')])
    })
    const artifact = flightSearchArtifactSchema.parse((await artifacts.get(stored.record.id))!.payload)
    expect(artifact.offers).toHaveLength(2)
    const offer = artifact.offers[1]!
    expect(offer).toMatchObject({ transferType: 'airline', totalAmount: 800, totalDurationMinutes: 510,
      layovers: [{ afterSegmentIndex: 0, airport: 'SHA', durationMinutes: 60 }, { afterSegmentIndex: 1, airport: 'XMN', durationMinutes: 180, overnight: false }] })
    expect(offer.segments.map(s => s.flightNumber)).toEqual(['CA1', 'CA2', 'CA3'])
    expect(offer.baggageRecheck).toBeUndefined()
    expect(offer.protectedConnection).toBeUndefined()
    expect(summarizeFareItineraries(artifact.offers)).toMatchObject({
      counts: { direct: 1, airline: 1, self: 0 },
      lowestByType: [{ transferType: 'direct', totalAmount: 1000 }, { transferType: 'airline', totalAmount: 800, route: ['PEK', 'SHA', 'XMN', 'HKG'], segmentCount: 3 }]
    })
  })
  it('normalizes provider itineraries into owned fare output', async () => {
    const result = await new SerpApiFareProvider({ searchFlights: vi.fn().mockResolvedValue(raw) }).searchFlights(input)
    expect(result.offers[0]).toMatchObject({ totalAmount: 1000, currency: 'CNY', segments: [{ origin: 'PEK', destination: 'HKG' }] })
    expect(result.verification.status).toBe('verified')
  })
  it('samples bounded flexible dates and refresh reruns the query', async () => {
    const searchFlights = vi.fn().mockResolvedValue(raw)
    const provider = new SerpApiFareProvider({ searchFlights })
    const flexible = await provider.searchFlexibleFlights({ ...input, departureDateFrom: '2026-10-01', departureDateTo: '2026-10-10' })
    expect(flexible.results.length).toBeLessThanOrEqual(4)
    expect(flexible.scannedDates).toHaveLength(flexible.results.length)
    await provider.refreshFlight({ offerId: flexible.results[0]!.offers[0]!.id, query: input })
    expect(searchFlights).toHaveBeenCalled()
  })

  it('preserves successful sampled dates when another date fails', async () => {
    const searchFlights = vi.fn()
      .mockResolvedValueOnce(raw)
      .mockRejectedValueOnce(new Error('one sampled date failed'))
      .mockResolvedValue(raw)
    const provider = new SerpApiFareProvider({ searchFlights })
    const flexible = await provider.searchFlexibleFlights({ ...input, departureDateFrom: '2026-10-01', departureDateTo: '2026-10-10' })
    expect(flexible.results.length).toBeGreaterThan(0)
    expect(flexible.failedDates).toHaveLength(1)
    expect(flexible.scannedDates).toContain(flexible.failedDates[0])
  })

  it('drops provider itineraries whose endpoints do not match the airport query', async () => {
    const mismatched = structuredClone(raw)
    mismatched.best_flights[0]!.flights[0]!.arrival_airport.id = 'NRT'
    const result = await new SerpApiFareProvider({ searchFlights: vi.fn().mockResolvedValue(mismatched) }).searchFlights(input)
    expect(result.offers).toEqual([])
    expect(result.verification.status).toBe('partially_verified')
  })
})
