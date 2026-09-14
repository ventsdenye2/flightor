import { describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import type { ArtifactRecord } from '../artifacts/repository.js'
import type { FareOffer } from '../fares/types.js'
import { assertFlightChoice, readSavedFlightSelection, sameFlightChoice, selectedFlightContext } from './flight-selection.js'

const checkedAt = '2026-09-14T00:00:00.000Z'
const verification = { status: 'verified' as const, checkedAt, confidence: 1, sources: [{ provider: 'fixture' }] }
const query = { origin: 'PEK' as const, destination: 'LIS' as const, departureDate: '2026-10-02', currency: 'CNY' as const, travelClass: 1 }

function offer(id = 'offer-main'): FareOffer {
  return {
    id,
    segments: [
      { flightNumber: 'FX1', airline: 'Fixture Air', origin: 'PEK', destination: 'DOH', departsAt: '2026-10-02T08:00:00+08:00', arrivesAt: '2026-10-02T13:00:00+03:00', durationMinutes: 600 },
      { flightNumber: 'FX2', airline: 'Fixture Air', origin: 'DOH', destination: 'FRA', departsAt: '2026-10-02T23:00:00+03:00', arrivesAt: '2026-10-03T05:00:00+02:00', durationMinutes: 420 },
      { flightNumber: 'FX3', airline: 'Fixture Air', origin: 'FRA', destination: 'LIS', departsAt: '2026-10-03T07:00:00+02:00', arrivesAt: '2026-10-03T09:00:00+01:00', durationMinutes: 180 }
    ],
    layovers: [
      { afterSegmentIndex: 0, airport: 'DOH', durationMinutes: 600, overnight: false },
      { afterSegmentIndex: 1, airport: 'FRA', durationMinutes: 120, overnight: false }
    ],
    totalAmount: 4380, currency: 'CNY', totalDurationMinutes: 1800,
    airlines: ['Fixture Air'], transferType: 'airline', bookingUrl: 'https://example.test/booking'
  }
}

function exactArtifact(contextVersion = 2): ArtifactRecord {
  const id = uuidv7()
  return {
    id, tripId: 'trip-a', type: 'flight_search', schemaVersion: 1, tripContextVersion: contextVersion,
    payload: { id, type: 'flight_search', query, offers: [offer()], provider: 'fixture', checkedAt, verification },
    sourceArtifactIds: [], createdAt: checkedAt, updatedAt: checkedAt
  }
}

describe('confirmed flight selection', () => {
  it('restores legacy route selections and compares the full user choice', () => {
    const artifactId = uuidv7()
    const legacy = readSavedFlightSelection({ artifactId, routeId: 'route-a', contextVersion: 3 })
    expect(legacy).toMatchObject({ kind: 'route', artifactId, routeId: 'route-a', revision: 1, layoverPreference: 'airport_only' })
    expect(sameFlightChoice(legacy, { kind: 'route', artifactId, routeId: 'route-a', layoverPreference: 'airport_only' })).toBe(true)
    expect(sameFlightChoice(legacy, { kind: 'route', artifactId, routeId: 'route-a', layoverPreference: 'consider_city' })).toBe(false)
  })

  it('validates the exact source and keeps every segment and layover', () => {
    const record = exactArtifact()
    const choice = { kind: 'offer' as const, artifactId: record.id, offerId: 'offer-main', layoverPreference: 'consider_city' as const }
    expect(() => assertFlightChoice(record, choice, 2)).not.toThrow()
    const context = selectedFlightContext({ ...choice, contextVersion: 2, revision: 1, selectedAt: checkedAt }, record)
    expect(context.segments).toHaveLength(3)
    expect(context.offer).not.toHaveProperty('bookingUrl')
    expect(context.layoverWindows).toMatchObject([
      { afterSegmentIndex: 0, arrivalAirport: 'DOH', durationMinutes: 600, availableMinutes: 330, cityOption: 'conditional', selectedMode: 'conditional_city' },
      { afterSegmentIndex: 1, arrivalAirport: 'FRA', durationMinutes: 120, availableMinutes: 0, cityOption: 'airport_only', selectedMode: 'airport' }
    ])
  })

  it('finds an offer in a flexible-date artifact without changing its query', () => {
    const record = exactArtifact()
    record.schemaVersion = 2
    record.payload = {
      id: record.id, type: 'flight_search',
      window: { origin: 'PEK', destination: 'LIS', departureDateFrom: '2026-10-01', departureDateTo: '2026-10-03', currency: 'CNY', travelClass: 1 },
      results: [{ query, offers: [offer('flex-offer')], provider: 'fixture', checkedAt, verification }],
      scannedDates: ['2026-10-02'], successfulDates: ['2026-10-02'], failedDates: []
    }
    const selection = { kind: 'offer' as const, artifactId: record.id, offerId: 'flex-offer', layoverPreference: 'airport_only' as const, contextVersion: 2, revision: 1, selectedAt: checkedAt }
    expect(selectedFlightContext(selection, record).query).toEqual(query)
  })

  it('rejects stale, missing, and wrong-type candidate references', () => {
    const record = exactArtifact()
    const choice = { kind: 'offer' as const, artifactId: record.id, offerId: 'missing', layoverPreference: 'airport_only' as const }
    expect(() => assertFlightChoice(record, choice, 3)).toThrowError(expect.objectContaining({ code: 'STALE_FLIGHT_SELECTION' }))
    expect(() => assertFlightChoice(record, choice, 2)).toThrowError(expect.objectContaining({ code: 'INVALID_FLIGHT_SELECTION' }))
    expect(() => assertFlightChoice({ ...record, type: 'research' }, choice, 2)).toThrowError(expect.objectContaining({ code: 'INVALID_FLIGHT_SELECTION' }))
  })
})
