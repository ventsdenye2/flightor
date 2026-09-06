import { describe, expect, it, vi } from 'vitest'
import { SerpApiFareProvider } from './serpapi.js'

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
  it('normalizes provider itineraries into owned fare output', async () => {
    const result = await new SerpApiFareProvider({ searchFlights: vi.fn().mockResolvedValue(raw) }).searchFlights(input)
    expect(result.offers[0]).toMatchObject({ totalAmount: 1000, currency: 'CNY', segments: [{ origin: 'PEK', destination: 'HKG' }] })
    expect(result.verification.status).toBe('verified')
  })
  it('samples bounded flexible dates and refresh reruns the query', async () => {
    const searchFlights = vi.fn().mockResolvedValue(raw)
    const provider = new SerpApiFareProvider({ searchFlights })
    const results = await provider.searchFlexibleFlights({ ...input, departureDateFrom: '2026-10-01', departureDateTo: '2026-10-10' })
    expect(results.length).toBeLessThanOrEqual(4)
    await provider.refreshFlight({ offerId: results[0]!.offers[0]!.id, query: input })
    expect(searchFlights).toHaveBeenCalled()
  })

  it('drops provider itineraries whose endpoints do not match the airport query', async () => {
    const mismatched = structuredClone(raw)
    mismatched.best_flights[0]!.flights[0]!.arrival_airport.id = 'NRT'
    const result = await new SerpApiFareProvider({ searchFlights: vi.fn().mockResolvedValue(mismatched) }).searchFlights(input)
    expect(result.offers).toEqual([])
    expect(result.verification.status).toBe('partially_verified')
  })
})
