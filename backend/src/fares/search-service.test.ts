import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import { MockFareProvider } from './providers/mock.js'
import { InMemoryFlightSearchIdempotencyStore } from './idempotency.js'
import { executeFlexibleFlightSearch } from './search-service.js'

const origin = { type: 'airport' as const, iata: 'PEK', name: 'Beijing', countryCode: 'CN' }
const destination = { type: 'airport' as const, iata: 'KIX', name: 'Osaka', countryCode: 'JP' }

describe('flight search domain input validation', () => {
  it('rejects malformed flexible input before invoking the FareProvider', async () => {
    const searchFlexibleFlights = vi.fn()
    const fares = new MockFareProvider({ flexible: { results: [], scannedDates: [], failedDates: [] } })
    fares.searchFlexibleFlights = searchFlexibleFlights
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ title: 'Flexible validation' })
    const artifacts = new InMemoryArtifactRepository('owner-1', new Set([trip.id]))
    const context = { fares, artifacts, tripId: trip.id, conversationId: 'conversation-1' }

    await expect(executeFlexibleFlightSearch({
      origin: 'pek', destination: 'KIX', departureDateFrom: '2026-10-01', departureDateTo: '2026-10-01', currency: 'CNY', travelClass: 1
    }, context)).rejects.toThrow()
    await expect(executeFlexibleFlightSearch({
      origin: 'PEK', destination: 'KIX', departureDateFrom: '2026-10-10', departureDateTo: '2026-10-01', currency: 'CNY', travelClass: 1
    }, context)).rejects.toThrow()
    await expect(executeFlexibleFlightSearch({
      origin: 'PEK', destination: 'KIX', departureDateFrom: '2026-10-01', departureDateTo: '2026-11-01', currency: 'CNY', travelClass: 1
    }, context)).rejects.toThrow()
    expect(searchFlexibleFlights).not.toHaveBeenCalled()
  })

  it('accepts a strict canonical bounded window and persists schema v2', async () => {
    const fares = new MockFareProvider({ flexible: { results: [], scannedDates: [], failedDates: [] } })
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ title: 'Flexible valid' })
    const artifacts = new InMemoryArtifactRepository('owner-1', new Set([trip.id]))
    const result = await executeFlexibleFlightSearch({
      origin: origin.iata, destination: destination.iata, departureDateFrom: '2026-10-01', departureDateTo: '2026-10-03', currency: 'CNY', travelClass: 1
    }, { fares, artifacts, tripId: trip.id, conversationId: 'conversation-1' })
    expect(result.record.schemaVersion).toBe(2)
    expect(result.payload.window.departureDateTo).toBe('2026-10-03')
  })
})

describe('manual flight search idempotency store', () => {
  it('binds keys to owners and replays completed work', async () => {
    const store = new InMemoryFlightSearchIdempotencyStore<{ artifactId: string }>()
    let calls = 0
    const first = await store.run('owner-a', 'same-key', 'hash-a', async () => ({ artifactId: `artifact-${++calls}` }))
    const replay = await store.run('owner-a', 'same-key', 'hash-a', async () => ({ artifactId: `artifact-${++calls}` }))
    const otherOwner = await store.run('owner-b', 'same-key', 'hash-a', async () => ({ artifactId: `artifact-${++calls}` }))
    expect(first.replayed).toBe(false)
    expect(replay).toEqual({ value: { artifactId: 'artifact-1' }, replayed: true })
    expect(otherOwner.value.artifactId).toBe('artifact-2')
    expect(calls).toBe(2)
  })
})
