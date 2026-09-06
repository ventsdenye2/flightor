import { describe, expect, it } from 'vitest'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { locationRefKey } from '../../aviation/types.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { createCoreToolRegistry } from './core.js'
import type { ToolExecutionContext } from '../runtime/registry.js'

const location = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', cityCode: 'SHA', iata: 'PVG' }
const destination = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita International', countryCode: 'JP', cityCode: 'TYO', iata: 'NRT' }
const fareResult = {
  query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-01', currency: 'CNY' as const, travelClass: 1 },
  offers: [{ id: 'offer-1', segments: [{ flightNumber: 'FM1', airline: 'Mock Air', origin: 'PVG', destination: 'NRT', departsAt: '2026-10-01T08:00:00Z', arrivesAt: '2026-10-01T12:00:00Z', durationMinutes: 240 }], totalAmount: 1200, currency: 'CNY', totalDurationMinutes: 240, airlines: ['Mock Air'], transferType: 'direct' as const }],
  provider: 'mock-fares', checkedAt: '2026-09-06T00:00:00.000Z',
  verification: { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-fares', reference: 'fixed' }] }
}

function context(): ToolExecutionContext {
  return {
    requestId: 'req-1', conversationId: 'conv-1', tripId: 'trip-1', generationId: 'gen-1',
    trips: new InMemoryTripContextRepository([emptyTripContext('trip-1')]),
    aviation: new MockAviationProvider({ resolveLocation: { matches: [location], verification: { status: 'verified', checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-aviation' }] } } }),
    fares: new MockFareProvider({ search: fareResult }),
    resolvedLocationKeys: new Set([locationRefKey(location), locationRefKey(destination)])
  }
}

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

describe('core agent tools', () => {
  it('resolves a location through the mock provider', async () => {
    const result = await createCoreToolRegistry().execute(call('loc-1', 'resolve_location', { query: 'Shanghai', types: ['city'] }), context(), new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.content).data.matches[0]).toEqual(location)
    expect(result.provider).toBe('aviation_provider')
  })

  it('searches flights and emits a deterministic artifact/provenance', async () => {
    const result = await createCoreToolRegistry().execute(call('fare-1', 'search_flights', { departureDate: fareResult.query.departureDate, currency: fareResult.query.currency, travelClass: fareResult.query.travelClass, origin: location, destination }), context(), new AbortController().signal)
    const body = JSON.parse(result.content)
    expect(result.ok).toBe(true)
    expect(result.artifactIds).toHaveLength(1)
    expect(body.data.type).toBe('flight_search')
    expect(body.data.provider).toBe('mock-fares')
    expect(result.provider).toBe('fare_provider')
  })

  it('rejects syntactically valid but unresolved airport facts', async () => {
    const ctx = context()
    ctx.resolvedLocationKeys = new Set()
    const result = await createCoreToolRegistry().execute(call('fare-2', 'search_flights', {
      departureDate: fareResult.query.departureDate,
      origin: location,
      destination
    }), ctx, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
  })

  it('rejects a provider offer whose endpoints do not match the query', async () => {
    const ctx = context()
    ctx.fares = new MockFareProvider({
      search: {
        ...fareResult,
        offers: [{
          ...fareResult.offers[0]!,
          segments: [{ ...fareResult.offers[0]!.segments[0]!, origin: 'LHR' }]
        }]
      }
    })
    const result = await createCoreToolRegistry().execute(call('fare-3', 'search_flights', {
      departureDate: fareResult.query.departureDate,
      origin: location,
      destination
    }), ctx, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
  })

  it('updates trip context and enforces version conflicts', async () => {
    const ctx = context()
    const registry = createCoreToolRegistry()
    const updated = await registry.execute(call('u-1', 'update_trip_context', { patch: { notes: ['keep receipts'] }, expectedVersion: 0 }), ctx, new AbortController().signal)
    expect(JSON.parse(updated.content).data.tripContext.version).toBe(1)
    const conflict = await registry.execute(call('u-2', 'update_trip_context', { patch: { notes: ['stale'] }, expectedVersion: 0 }), ctx, new AbortController().signal)
    expect(conflict.errorCode).toBe('TOOL_FAILURE')
    expect(conflict.content).toContain('Trip context version conflict')
  })

  it('does not commit a delayed context mutation after cancellation', async () => {
    const ctx = context()
    const stored = emptyTripContext('trip-1')
    let committed = false
    ctx.trips = {
      async get() { return structuredClone(stored) },
      async update(_tripId, patch, _expectedVersion, guard) {
        await new Promise(resolve => setTimeout(resolve, 20))
        if (guard?.signal?.aborted || guard?.isCurrent?.() === false) throw new Error('cancelled')
        committed = true
        return { ...stored, ...patch, version: 1 }
      }
    }
    const controller = new AbortController()
    const pending = createCoreToolRegistry().execute(call('u-3', 'update_trip_context', {
      patch: { notes: ['must not commit'] },
      expectedVersion: 0
    }), ctx, controller.signal)
    setTimeout(() => controller.abort(), 1)
    expect((await pending).errorCode).toBe('TOOL_CANCELLED')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(committed).toBe(false)
  })
})
