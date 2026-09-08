import { describe, expect, it } from 'vitest'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { type LocationRef } from '../../aviation/types.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { createCoreToolRegistry } from './core.js'

const origin: LocationRef = { id: 'airport-origin', type: 'airport', name: 'Canonical Origin', countryCode: 'CN', iata: 'PVG', cityCode: 'SHA', latitude: 31.14, longitude: 121.8, timezone: 'Asia/Shanghai' }
const destination: LocationRef = { id: 'airport-destination', type: 'airport', name: 'Canonical Destination', countryCode: 'JP', iata: 'NRT', cityCode: 'TYO', latitude: 35.77, longitude: 140.39, timezone: 'Asia/Tokyo' }
const city: LocationRef = { id: 'city-stop', type: 'city', name: 'Canonical Stop', countryCode: 'JP', cityCode: 'OSA' }
const signal = () => new AbortController().signal
const call = (name: string, args: unknown) => ({ id: `call-${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

function context(locations: LocationRef[] = [origin, destination, city]): ToolExecutionContext {
  return {
    requestId: 'req', conversationId: 'conv', tripId: 'trip', generationId: 'generation',
    trips: new InMemoryTripContextRepository([emptyTripContext('trip')]),
    artifacts: new InMemoryArtifactRepository('owner', new Set(['trip'])),
    memory: new InMemoryUserMemoryRepository(),
    aviation: new MockAviationProvider({ resolveLocation: { matches: locations, verification: { status: 'verified', checkedAt: '2026-09-08T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock' }] } } }),
    fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
    connectionSearch: new UnavailableConnectionSearchService(),
    flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(),
    resolvedLocationKeys: new Set(), resolvedLocations: new Map()
  }
}

describe('update_trip_context canonical location input', () => {
  it('resolves ID selectors in every location field without model-copied facts', async () => {
    const registry = createCoreToolRegistry()
    const ctx = context()
    expect((await registry.execute(call('resolve_location', { query: 'requested places' }), ctx, signal())).ok).toBe(true)
    const result = await registry.execute(call('update_trip_context', { expectedVersion: 0, patch: {
      origin: origin.id,
      destinationIntent: { mode: 'mixed', required: [destination.id], preferred: [city.id], excluded: [origin.id] },
      locationRoleOverrides: [{ location: city.id, role: 'stopover_only' }],
      requiredGroundLegs: [{ from: destination.id, to: city.id, mode: 'rail' }],
      travelDays: 5
    } }), ctx, signal())
    expect(result.ok, result.content).toBe(true)
    expect(await ctx.trips.get('trip')).toMatchObject({
      version: 1, origin, travelDays: 5,
      destinationIntent: { mode: 'mixed', required: [destination], preferred: [city], excluded: [origin] },
      locationRoleOverrides: [{ location: city, role: 'stopover_only' }],
      requiredGroundLegs: [{ from: destination, to: city, mode: 'rail' }]
    })
  })

  it('restores omitted or altered legacy descriptions from the resolved identity', async () => {
    const registry = createCoreToolRegistry()
    const ctx = context()
    await registry.execute(call('resolve_location', { query: 'origin' }), ctx, signal())
    const result = await registry.execute(call('update_trip_context', { patch: {
      origin: { id: origin.id, type: origin.type, name: 'Model translation', countryCode: 'US', iata: 'LAX' }
    } }), ctx, signal())
    expect(result.ok, result.content).toBe(true)
    expect((await ctx.trips.get('trip'))?.origin).toEqual(origin)
  })

  it('selects saved Trip locations across turns without a new provider call', async () => {
    const registry = createCoreToolRegistry()
    const ctx = context([])
    ctx.trips = new InMemoryTripContextRepository([{ ...emptyTripContext('trip'), origin,
      destinationIntent: { mode: 'explicit', required: [destination], preferred: [city], excluded: [] } }])
    const result = await registry.execute(call('update_trip_context', { patch: {
      origin: null,
      destinationIntent: { mode: 'explicit', required: [city.id], preferred: [destination.id], excluded: [] },
      requiredGroundLegs: [{ from: destination.id, to: city.id, mode: 'rail' }]
    } }), ctx, signal())
    expect(result.ok, result.content).toBe(true)
    const stored = await ctx.trips.get('trip')
    expect(stored?.origin).toBeUndefined()
    expect(stored?.destinationIntent.required).toEqual([city])
    expect(stored?.requiredGroundLegs).toEqual([{ from: destination, to: city, mode: 'rail' }])
  })

  it.each([
    { origin: 'unresolved' },
    { destinationIntent: { mode: 'explicit', required: ['unresolved'], preferred: [], excluded: [] } },
    { locationRoleOverrides: [{ location: 'unresolved', role: 'visit' }] },
    { requiredGroundLegs: [{ from: origin.id, to: 'unresolved', mode: 'rail' }] },
    { origin: { ...origin, id: 'unresolved' } }
  ])('rejects an unknown location atomically: %j', async patch => {
    const registry = createCoreToolRegistry()
    const ctx = context()
    await registry.execute(call('resolve_location', { query: 'origin' }), ctx, signal())
    const result = await registry.execute(call('update_trip_context', { patch: { notes: ['must not write'], ...patch } }), ctx, signal())
    expect(result).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
    expect(await ctx.trips.get('trip')).toEqual(emptyTripContext('trip'))
  })

  it('rejects ambiguous IDs rather than picking a city or airport arbitrarily', async () => {
    const registry = createCoreToolRegistry()
    const ctx = context([origin, { ...city, id: origin.id }])
    await registry.execute(call('resolve_location', { query: 'ambiguous' }), ctx, signal())
    const result = await registry.execute(call('update_trip_context', { patch: { origin: origin.id } }), ctx, signal())
    expect(result.ok).toBe(false)
    expect((await ctx.trips.get('trip'))?.version).toBe(0)
  })

  it('runs ground-leg invariants after canonicalization', async () => {
    const registry = createCoreToolRegistry()
    const ctx = context()
    await registry.execute(call('resolve_location', { query: 'origin' }), ctx, signal())
    const result = await registry.execute(call('update_trip_context', { patch: {
      requiredGroundLegs: [{ from: origin.id, to: origin.id, mode: 'rail' }]
    } }), ctx, signal())
    expect(result.ok).toBe(false)
    expect((await ctx.trips.get('trip'))?.version).toBe(0)
  })

  it('preserves unmentioned constraints instead of applying schema defaults as edits', async () => {
    const registry = createCoreToolRegistry()
    const ctx = context()
    const groundLegs = [{ from: destination, to: city, mode: 'rail' as const }]
    ctx.trips = new InMemoryTripContextRepository([{ ...emptyTripContext('trip'), origin, requiredGroundLegs: groundLegs }])
    const empty = await registry.execute(call('update_trip_context', { patch: {} }), ctx, signal())
    expect(JSON.parse(empty.content).data).toMatchObject({ changed: false, tripContext: { version: 0, requiredGroundLegs: groundLegs } })
    const updated = await registry.execute(call('update_trip_context', { patch: { notes: ['keep existing legs'] } }), ctx, signal())
    expect(updated.ok, updated.content).toBe(true)
    expect(await ctx.trips.get('trip')).toMatchObject({ version: 1, origin, requiredGroundLegs: groundLegs, notes: ['keep existing legs'] })
    const cleared = await registry.execute(call('update_trip_context', { patch: { requiredGroundLegs: [] } }), ctx, signal())
    expect(cleared.ok).toBe(true)
    expect((await ctx.trips.get('trip'))?.requiredGroundLegs).toEqual([])
  })

  it('binds an implicit expected version to the snapshot used for canonical selection', async () => {
    const registry = createCoreToolRegistry()
    const ctx = context()
    const stored = new InMemoryTripContextRepository([{ ...emptyTripContext('trip'), origin }])
    ctx.trips = {
      get: id => stored.get(id),
      async update(id, patch, expectedVersion, guard) {
        await stored.update(id, { notes: ['concurrent user edit'] }, 0)
        return stored.update(id, patch, expectedVersion, guard)
      }
    }
    const result = await registry.execute(call('update_trip_context', { patch: { origin: origin.id, notes: ['late write'] } }), ctx, signal())
    expect(result).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
    expect(result.content).toContain('Trip context version conflict')
    expect(await stored.get('trip')).toMatchObject({ version: 1, origin, notes: ['concurrent user edit'] })
  })
})
