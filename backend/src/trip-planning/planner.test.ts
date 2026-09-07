import { describe, expect, it } from 'vitest'
import { emptyTripContext, type TripContext } from '../trips/types.js'
import type { LocationRef } from '../aviation/types.js'
import { DeterministicTripRoutePlanner } from './planner.js'
import { destinationCandidateSchema, type DestinationCandidate } from '../destinations/types.js'

const location = (iata: string, countryCode = 'JP'): LocationRef => ({
  id: `airport-${iata.toLowerCase()}`,
  type: 'airport',
  name: iata,
  countryCode,
  iata
})

const candidate = (iata: string, minStayDays: number, score: number, countryCode = 'JP'): DestinationCandidate => destinationCandidateSchema.parse({
  location: location(iata, countryCode),
  cityZh: iata,
  cityEn: iata,
  region: countryCode === 'JP' ? 'japan' : 'visa_free',
  interests: [],
  minStayDays,
  costTier: 2,
  score,
  reasons: [`catalog candidate ${iata}`],
  accessibility: 'unknown',
  verification: {
    status: 'partially_verified',
    checkedAt: '1970-01-01T00:00:00.000Z',
    confidence: 0.5,
    sources: [{ provider: 'test-catalog' }]
  }
})

const trip = (patch: Partial<TripContext> = {}): TripContext => ({
  ...emptyTripContext('trip-1'),
  travelDays: 5,
  ...patch
})

describe('DeterministicTripRoutePlanner', () => {
  it('keeps required visits, excludes avoid locations, and does not allocate stopover_only days', async () => {
    const nrt = location('NRT')
    const result = await new DeterministicTripRoutePlanner().plan({
      candidates: [candidate('KIX', 2, 0.4), candidate('NRT', 3, 0.9), candidate('BKK', 2, 0.8, 'TH')],
      tripContext: trip({
        destinationIntent: {
          mode: 'mixed',
          required: [location('KIX')],
          preferred: [],
          excluded: [location('BKK', 'TH')]
        },
        locationRoleOverrides: [{ location: nrt, role: 'stopover_only' }]
      }),
      maxCities: 4
    })

    expect(result.cities.map(city => city.location.iata)).toEqual(['KIX'])
    expect(result.stopoverOnly.map(value => value.iata)).toEqual(['NRT'])
    expect(result.days).toHaveLength(5)
    expect(result.days.every(day => day.city.iata === 'KIX')).toBe(true)
    expect(result.landTransfers).toEqual([])
    expect(result.warnings).toContain('land_transfers_unresolved')
  })

  it('drops optional cities to fit days and allocates every declared day exactly once', async () => {
    const result = await new DeterministicTripRoutePlanner().plan({
      candidates: [candidate('KIX', 3, 0.5), candidate('BKK', 3, 0.9, 'TH'), candidate('SIN', 2, 0.8, 'SG')],
      tripContext: trip({ destinationIntent: { mode: 'open', required: [location('KIX')], preferred: [], excluded: [] } }),
      maxCities: 3
    })

    expect(result.cities.map(city => city.location.iata)).toEqual(['KIX', 'SIN'])
    expect(result.cities.reduce((sum, city) => sum + city.stayDays, 0)).toBe(5)
    expect(result.days.map(day => day.day)).toEqual([1, 2, 3, 4, 5])
    expect(result.warnings).toContain('optional_cities_dropped_to_fit_travel_days')
  })

  it('rejects impossible required minimum stays and preserves requested events as unassigned refs', async () => {
    await expect(new DeterministicTripRoutePlanner().plan({
      candidates: [candidate('KIX', 3, 1)],
      tripContext: trip({ travelDays: 2, destinationIntent: { mode: 'explicit', required: [location('KIX')], preferred: [], excluded: [] } }),
      maxCities: 2
    })).rejects.toThrow('minimum stays')

    const result = await new DeterministicTripRoutePlanner().plan({
      candidates: [candidate('KIX', 2, 1)],
      tripContext: trip({
        travelDays: 2,
        destinationIntent: { mode: 'explicit', required: [location('KIX')], preferred: [], excluded: [] },
        mustIncludeEvents: [{ id: 'event-1', title: 'User event' }]
      }),
      maxCities: 1
    })
    expect(result.unassignedActivityRefs).toEqual([{ id: 'event-1', title: 'User event', reason: 'user_requested' }])
    expect(result.days.every(day => day.activityRefs.length === 0)).toBe(true)
    expect(result.warnings).toContain('must_include_events_unassigned')
  })

  it('honours cancellation before producing a result', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new DeterministicTripRoutePlanner().plan({
      candidates: [candidate('KIX', 2, 1)],
      tripContext: trip({ travelDays: 2, destinationIntent: { mode: 'explicit', required: [location('KIX')], preferred: [], excluded: [] } }),
      maxCities: 1
    }, { signal: controller.signal })).rejects.toThrow('aborted')
  })
})
