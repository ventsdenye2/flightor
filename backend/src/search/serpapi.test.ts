import { describe, expect, it } from 'vitest'
import { buildFlightSearchResponse, itinerariesFromSerpResponse, returnDateFor, sampleDates, type FlightSearchInput } from './serpapi.js'

const input: FlightSearchInput = {
  origin: 'SIN',
  destination: 'LHR',
  originCandidates: ['SIN'],
  destinationCandidates: ['LHR'],
  departDate: '2026-09-15',
  currency: 'CNY'
}

describe('SerpApi flight search normalization', () => {
  it('maps direct and connected Google Flights itineraries', () => {
    const options = itinerariesFromSerpResponse({
      best_flights: [{
        price: 4321,
        total_duration: 900,
        flights: [{
          flight_number: 'SQ306', airline: 'Singapore Airlines', duration: 900,
          departure_airport: { id: 'SIN', time: '2026-09-15 01:00' },
          arrival_airport: { id: 'LHR', time: '2026-09-15 08:00' }
        }]
      }],
      other_flights: [{
        price: 3888,
        total_duration: 1100,
        flights: [
          { flight_number: 'AF181', airline: 'Air France', duration: 780, departure_airport: { id: 'SIN', time: '2026-09-15 10:00' }, arrival_airport: { id: 'CDG', time: '2026-09-15 18:00' } },
          { flight_number: 'AF1380', airline: 'Air France', duration: 80, departure_airport: { id: 'CDG', time: '2026-09-15 20:00' }, arrival_airport: { id: 'LHR', time: '2026-09-15 20:20' } }
        ],
        layovers: [{ id: 'CDG', name: 'Paris', duration: 120 }]
      }]
    }, input, input.departDate)
    const response = buildFlightSearchResponse(options, { dates: [input.departDate], fetched: 1, failedDates: [], cacheHit: false })
    expect(response.direct).toHaveLength(1)
    expect(response.airlineTransfer).toHaveLength(1)
    expect(response.airlineTransfer[0]?.hub).toMatchObject({ iata: 'CDG', layoverMinutes: 120 })
  })

  it('samples long windows and computes a midpoint return date', () => {
    expect(sampleDates('2026-09-01', '2026-09-30')).toEqual(['2026-09-01', '2026-09-11', '2026-09-20', '2026-09-30'])
    expect(returnDateFor('2026-09-15', [7, 10])).toBe('2026-09-24')
  })
})
