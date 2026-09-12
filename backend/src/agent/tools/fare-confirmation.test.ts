import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import type { FareOffer, FareSearchInput, FareSearchResult } from '../../fares/types.js'
import type { FareProvider } from '../../fares/providers/provider.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import {
  confirmFlightPriceTool,
  confirmRoutePriceTool,
  confirmRoutePriceOutputSchema
} from './fare-confirmation.js'

const tripId = 'trip-1'
const flightArtifactId = '018f3f7a-75a4-7cc7-b926-7f8fe2d39416'
const routeArtifactId = '018f3f7a-75a4-7cc7-b926-7f8fe2d39417'
const origin = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', iata: 'PVG' }
const destination = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita', countryCode: 'JP', iata: 'NRT' }
const verification = {
  status: 'verified' as const,
  checkedAt: '2026-09-06T00:00:00.000Z',
  confidence: 1,
  sources: [{ provider: 'mock-fares', reference: 'fixture' }]
}

function query(overrides: Partial<FareSearchInput> = {}): FareSearchInput {
  return {
    origin: 'PVG', destination: 'NRT', departureDate: '2026-10-01',
    currency: 'CNY', travelClass: 1, ...overrides
  }
}

function result(input: FareSearchInput = query(), offerId = 'offer-1', amount = 1200): FareSearchResult {
  return {
    query: input,
    offers: [{
      id: offerId,
      segments: [{
        flightNumber: 'M1', airline: 'Mock Air', origin: input.origin, destination: input.destination,
        departsAt: `${input.departureDate}T08:00:00Z`, arrivesAt: `${input.departureDate}T12:00:00Z`, durationMinutes: 240
      }],
      totalAmount: amount, currency: input.currency, totalDurationMinutes: 240,
      airlines: ['Mock Air'], transferType: 'direct'
    }],
    provider: 'mock-fares', checkedAt: '2026-09-07T00:00:00.000Z', verification
  }
}

function provider(refresh: (input: { offerId: string; query: FareSearchInput }, signal?: AbortSignal) => Promise<FareSearchResult>): FareProvider {
  return {
    name: 'test-fares',
    searchFlights: vi.fn(),
    searchFlexibleFlights: vi.fn(),
    refreshFlight: (input, options) => refresh(input, options?.signal)
  } as unknown as FareProvider
}

function context(fares: FareProvider): ToolExecutionContext {
  return {
    requestId: 'request-1', conversationId: 'conversation-1', tripId, generationId: 'generation-1',
    trips: new InMemoryTripContextRepository([emptyTripContext(tripId)]),
    artifacts: new InMemoryArtifactRepository('user-1', new Set([tripId])),
    memory: new InMemoryUserMemoryRepository(), aviation: {} as never, fares,
    research: {} as never, connectionSearch: {} as never, flightRoutePlanner: {} as never, routeOptimizer: {} as never
  }
}

async function addFlightArtifact(ctx: ToolExecutionContext, input = query(), offerId = 'offer-1'): Promise<void> {
  await ctx.artifacts.create({
    id: flightArtifactId, tripId, conversationId: 'conversation-1', type: 'flight_search', schemaVersion: 1, tripContextVersion: 0,
    payload: { ...result(input, offerId), id: flightArtifactId, type: 'flight_search' }, verification
  })
}

function edge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'edge-pvg-nrt', from: origin, to: destination, departureDate: '2026-10-01',
    transferType: 'direct' as const, fare: { amount: 1200, currency: 'CNY' },
    fareArtifactId: flightArtifactId, fareOfferId: 'offer-1', availability: 'verified' as const,
    verification, warnings: [], reasons: [], ...overrides
  }
}

function path(overrides: Record<string, unknown> = {}) {
  return {
    id: 'path-1',
    nodes: [
      { location: origin, role: 'origin' as const },
      { location: destination, role: 'destination' as const }
    ],
    edges: [edge()], totalFare: { amount: 1200, currency: 'CNY' }, transferCount: 0,
    feasibility: 'feasible' as const, warnings: [], ...overrides
  }
}

async function addRouteArtifact(ctx: ToolExecutionContext, selectedPath = path(), kind: 'flight_paths' | 'optimized_routes' = 'flight_paths'): Promise<void> {
  const common = {
    schemaVersion: 1 as const, serviceVersion: 'test-service', algorithmVersion: 'test-algorithm',
    sourceArtifactIds: [] as string[], verification, warnings: [], truncated: false, exhausted: true
  }
  const payload = kind === 'flight_paths'
    ? { ...common, kind, paths: [selectedPath] }
    : {
        ...common, kind, representatives: [{ path: selectedPath, score: {
          airfareSaving: 1, preferredCityMatch: 0, interestMatch: 0, eventMatch: 0, seasonMatch: 0,
          stopoverPlayability: 0, additionalCityValue: 0, routeNovelty: 0, totalTravelTime: 0,
          transferCount: 0, selfTransferRisk: 0, airportChangePenalty: 0, backtrackingPenalty: 0,
          deadTimePenalty: 0, excessiveComplexity: 0, complexity: 0, total: 1
        }, badges: ['cheapest' as const], explanation: {
          scoreBreakdown: [], hardConstraintsSatisfied: ['fixture'], tradeoffs: [], warnings: []
        } }], paretoFrontierCount: 1, rejectedCandidateCount: 0
      }
  await ctx.artifacts.create({ id: routeArtifactId, tripId, conversationId: 'conversation-1', type: 'route_set', schemaVersion: 1, tripContextVersion: 0, payload, verification })
}

function connectingResult(amount = 1200): FareSearchResult {
  const base = result()
  const offer: FareOffer = { ...base.offers[0]!, transferType: 'airline', totalAmount: amount, totalDurationMinutes: 360,
    segments: [
      { ...base.offers[0]!.segments[0]!, destination: 'ICN', arrivesAt: '2026-10-01T10:00:00Z', durationMinutes: 120 },
      { ...base.offers[0]!.segments[0]!, flightNumber: 'M2', origin: 'ICN', departsAt: '2026-10-01T12:00:00Z', arrivesAt: '2026-10-01T14:00:00Z', durationMinutes: 120 }
    ], layovers: [{ afterSegmentIndex: 0, airport: 'ICN', durationMinutes: 120 }] }
  return { ...base, offers: [offer] }
}

async function addConnectingArtifacts(ctx: ToolExecutionContext, firstFlightNumber = 'M1'): Promise<void> {
  const source = connectingResult()
  await ctx.artifacts.create({ id: flightArtifactId, tripId, type: 'flight_search', schemaVersion: 1, tripContextVersion: 0,
    payload: { ...source, id: flightArtifactId, type: 'flight_search' }, verification })
  const hub = { id: 'airport-icn', type: 'airport' as const, name: 'Incheon', countryCode: 'KR', iata: 'ICN' }
  const segments = source.offers[0]!.segments.map((segment, index) => ({ id: `segment-${index}`, from: index === 0 ? origin : hub,
    to: index === 0 ? hub : destination, flightNumber: index === 0 ? firstFlightNumber : segment.flightNumber,
    marketingCarrier: segment.airline, departureAt: segment.departsAt, arrivalAt: segment.arrivesAt, verification }))
  await addRouteArtifact(ctx, path({ transferCount: 1, feasibility: 'partial', edges: [edge({ transferType: 'airline', segments,
    departureAt: '2026-10-01T08:00:00Z', arrivalAt: '2026-10-01T14:00:00Z', availability: 'partial' })] }))
}

describe('fare confirmation tools', () => {
  it('refreshes one complete connecting quote once and preserves its unknown booking facts', async () => {
    const refresh = vi.fn(async () => connectingResult(1350))
    const ctx = context(provider(refresh))
    await addConnectingArtifacts(ctx)
    const source = await ctx.artifacts.get(routeArtifactId)
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1', maxLegs: 1 }, ctx, new AbortController().signal)
    expect(refresh).toHaveBeenCalledOnce()
    expect(output.summary).toMatchObject({ confirmed: 1, failed: 0, totalFare: { amount: 1350 }, verificationStatus: 'partially_verified' })
    const successor = await ctx.artifacts.get(output.artifact.id)
    const updated = (successor?.payload as { paths: Array<{ edges: Array<Record<string, unknown>>; transferCount: number }> }).paths[0]!
    expect(updated.transferCount).toBe(1)
    expect(updated.edges).toHaveLength(1)
    expect(updated.edges[0]).toMatchObject({ transferType: 'airline', fare: { amount: 1350 }, segments: expect.arrayContaining([expect.objectContaining({ flightNumber: 'M1' }), expect.objectContaining({ flightNumber: 'M2' })]) })
    expect(updated.edges[0]?.protectedConnection).toBeUndefined()
    expect(updated.edges[0]?.baggageRecheck).toBeUndefined()
    expect(await ctx.artifacts.get(routeArtifactId)).toEqual(source)
  })
  it('rejects a refreshed offer with the same id and endpoints but a different connecting airport', async () => {
    const changed = connectingResult()
    changed.offers[0]!.segments[0]!.destination = 'HKG'
    changed.offers[0]!.segments[1]!.origin = 'HKG'
    changed.offers[0]!.layovers = [{ afterSegmentIndex: 0, airport: 'HKG', durationMinutes: 120 }]
    const ctx = context(provider(async () => changed))
    await addConnectingArtifacts(ctx)
    await expect(confirmFlightPriceTool.execute({ artifactId: flightArtifactId, offerId: 'offer-1' }, ctx, new AbortController().signal)).rejects.toThrow(/different itinerary/)
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1', maxLegs: 1 }, ctx, new AbortController().signal)
    expect(output.summary).toMatchObject({ confirmed: 0, failed: 1 })
    expect(output.summary.totalFare).toBeUndefined()
  })
  it('rejects a source offer binding whose internal flight number differs from the route before refresh', async () => {
    const refresh = vi.fn(async () => connectingResult())
    const ctx = context(provider(refresh))
    await addConnectingArtifacts(ctx, 'DIFFERENT1')
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1', maxLegs: 1 }, ctx, new AbortController().signal)
    expect(refresh).not.toHaveBeenCalled()
    expect(output.summary).toMatchObject({ confirmed: 0, failed: 1 })
    expect(output.summary.totalFare).toBeUndefined()
  })
  it('refreshes one exact flight offer and writes a successor snapshot with provenance', async () => {
    const ctx = context(provider(async input => result(input.query, input.offerId, 1300)))
    await addFlightArtifact(ctx)
    const output = await confirmFlightPriceTool.execute({ artifactId: flightArtifactId, offerId: 'offer-1' }, ctx, new AbortController().signal)
    expect(output.summary).toMatchObject({ offerId: 'offer-1', price: { amount: 1300, currency: 'CNY' }, verificationStatus: 'verified' })
    expect(output.artifact.id).not.toBe(flightArtifactId)
    const stored = await ctx.artifacts.get(output.artifact.id)
    expect(stored).toMatchObject({ type: 'flight_search', schemaVersion: 1, tripContextVersion: 0, payload: { id: output.artifact.id } })
    const sources = (stored?.payload as { verification: { sources: Array<{ reference?: string }> } }).verification.sources
    expect(sources.some(source => source.reference?.includes(flightArtifactId))).toBe(true)
    expect(sources.some(source => source.reference?.includes('offer-1'))).toBe(true)
  })

  it('rejects missing offers, mismatched provider queries, and does not persist a failed flight confirmation', async () => {
    const ctx = context(provider(async input => result({ ...input.query, destination: 'LHR' }, input.offerId)))
    await addFlightArtifact(ctx)
    await expect(confirmFlightPriceTool.execute({ artifactId: flightArtifactId, offerId: 'missing' }, ctx, new AbortController().signal)).rejects.toThrow()
    await expect(confirmFlightPriceTool.execute({ artifactId: flightArtifactId, offerId: 'offer-1' }, ctx, new AbortController().signal)).rejects.toThrow()
    expect(await ctx.artifacts.get('missing-successor')).toBeUndefined()
  })

  it('rejects old-version fare sources before refresh and rechecks the Trip before saving a refresh', async () => {
    const refresh = vi.fn(async input => result(input.query, input.offerId))
    const stale = context(provider(refresh))
    await addFlightArtifact(stale)
    await stale.trips.update(tripId, { travelDays: 10 }, 0)
    await expect(confirmFlightPriceTool.execute({ artifactId: flightArtifactId, offerId: 'offer-1' }, stale, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
    expect(refresh).not.toHaveBeenCalled()

    const racing = context(provider(async input => {
      await racing.trips.update(tripId, { travelDays: 10 }, 0)
      return result(input.query, input.offerId)
    }))
    await addFlightArtifact(racing)
    await expect(confirmFlightPriceTool.execute({ artifactId: flightArtifactId, offerId: 'offer-1' }, racing, new AbortController().signal))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(await racing.artifacts.listForTrip?.(tripId)).toHaveLength(1)
  })

  it('confirms a strong route binding, keeps the source immutable, and recomputes total fare', async () => {
    const ctx = context(provider(async input => result(input.query, input.offerId, 1250)))
    await addFlightArtifact(ctx)
    await addRouteArtifact(ctx)
    const before = await ctx.artifacts.get(routeArtifactId)
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1' }, ctx, new AbortController().signal)
    expect(output.summary).toMatchObject({ confirmed: 1, failed: 0, unconfirmed: 0, totalFare: { amount: 1250, currency: 'CNY' }, verificationStatus: 'verified' })
    expect(output.warnings).toEqual(expect.any(Array))
    expect(await ctx.artifacts.get(routeArtifactId)).toEqual(before)
    const successor = await ctx.artifacts.get(output.artifact.id)
    expect(successor?.payload).toMatchObject({ kind: 'flight_paths', sourceArtifactIds: expect.arrayContaining([routeArtifactId]) })
    expect((successor?.payload as { paths: Array<{ edges: Array<{ fareArtifactId?: string; fare?: { amount: number } }> }> }).paths[0]!.edges[0]).toMatchObject({ fare: { amount: 1250 }, fareArtifactId: expect.any(String) })
  })

  it('uses weak migration binding without claiming full verification', async () => {
    const ctx = context(provider(async input => result(input.query, input.offerId, 1100)))
    const weak = path({ edges: [edge({ fareArtifactId: undefined })] })
    await addRouteArtifact(ctx, weak)
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1', maxLegs: 1 }, ctx, new AbortController().signal)
    expect(output.summary).toMatchObject({ confirmed: 1, verificationStatus: 'partially_verified', totalFare: { amount: 1100, currency: 'CNY' } })
    expect(output.warnings.some(item => /weak/i.test(item))).toBe(true)
  })

  it('localizes failed and unconfirmed legs, omits stale total fare, and caps provider concurrency at two', async () => {
    let active = 0
    let maxActive = 0
    const refresh = vi.fn(async (input: { offerId: string; query: FareSearchInput }) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active--
      if (input.offerId === 'offer-fail') throw new Error('provider outage')
      return result(input.query, input.offerId, input.offerId === 'offer-2' ? 900 : 800)
    })
    const ctx = context(provider(refresh))
    const second = { ...destination, id: 'airport-hkg', name: 'Hong Kong', countryCode: 'CN', iata: 'HKG' }
    const third = { ...destination, id: 'airport-sin', name: 'Singapore', countryCode: 'SG', iata: 'SIN' }
    const legs = [
      edge({ id: 'edge-1', to: second, fareOfferId: 'offer-1', fareArtifactId: undefined }),
      edge({ id: 'edge-2', from: second, to: third, fareOfferId: 'offer-fail', fareArtifactId: undefined }),
      edge({ id: 'edge-3', from: third, to: destination, fareOfferId: undefined, fareArtifactId: undefined })
    ]
    const threeLegPath = path({ id: 'path-1', nodes: [
      { location: origin, role: 'origin' as const }, { location: second, role: 'stopover' as const },
      { location: third, role: 'stopover' as const }, { location: destination, role: 'destination' as const }
    ], edges: legs, totalFare: { amount: 3600, currency: 'CNY' }, transferCount: 2 })
    await addRouteArtifact(ctx, threeLegPath)
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1', maxLegs: 2 }, ctx, new AbortController().signal)
    expect(output.summary).toMatchObject({ confirmed: 1, failed: 1, unconfirmed: 1, verificationStatus: 'partially_verified' })
    expect(output.summary.totalFare).toBeUndefined()
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('creates an unverified successor for total provider failure without retaining a fare', async () => {
    const ctx = context(provider(async () => { throw new Error('provider outage') }))
    await addRouteArtifact(ctx)
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1' }, ctx, new AbortController().signal)
    expect(output.summary).toMatchObject({ confirmed: 0, failed: 1, unconfirmed: 0, verificationStatus: 'unverified' })
    const successor = await ctx.artifacts.get(output.artifact.id)
    const successorEdge = (successor?.payload as { paths: Array<{ edges: Array<{ fare?: unknown; availability: string; verification: { status: string } }> }> }).paths[0]!.edges[0]!
    expect(successorEdge.fare).toBeUndefined()
    expect(successorEdge.availability).toBe('unknown')
    expect(successorEdge.verification.status).toBe('unverified')
  })

  it('rejects oversized refresh sets and cancellation before creating a successor', async () => {
    const refresh = vi.fn(async (input: { offerId: string; query: FareSearchInput }) => result(input.query, input.offerId))
    const ctx = context(provider(refresh))
    const second = { ...destination, id: 'airport-hkg', name: 'Hong Kong', countryCode: 'CN', iata: 'HKG' }
    const oversized = path({ id: 'path-1', nodes: [
      { location: origin, role: 'origin' as const }, { location: second, role: 'stopover' as const },
      { location: destination, role: 'destination' as const }
    ], edges: [edge({ id: 'edge-1', to: second, fareArtifactId: undefined }), edge({ id: 'edge-2', from: second, fareArtifactId: undefined })], transferCount: 1 })
    await addRouteArtifact(ctx, oversized)
    await expect(confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1', maxLegs: 1 }, ctx, new AbortController().signal)).rejects.toThrow(/maxLegs/)
    expect(refresh).not.toHaveBeenCalled()
    ctx.isGenerationCurrent = () => false
    await expect(confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1', maxLegs: 2 }, ctx, new AbortController().signal)).rejects.toThrow(/cancelled/)
    expect(await ctx.artifacts.get('missing-successor')).toBeUndefined()
  })

  it('supports optimized route representatives and rejects unsupported/cross-trip route artifacts', async () => {
    const ctx = context(provider(async input => result(input.query, input.offerId, 1000)))
    await addFlightArtifact(ctx)
    await addRouteArtifact(ctx, path(), 'optimized_routes')
    const output = await confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1' }, ctx, new AbortController().signal)
    const successor = await ctx.artifacts.get(output.artifact.id)
    expect(successor?.payload).toMatchObject({ kind: 'optimized_routes' })
    const wrong = context(provider(async input => result(input.query, input.offerId)))
    wrong.artifacts = new InMemoryArtifactRepository('user-1', new Set([tripId, 'other-trip']))
    await wrong.artifacts.create({ id: routeArtifactId, tripId: 'other-trip', type: 'route_set', schemaVersion: 1, payload: {}, verification })
    await expect(confirmRoutePriceTool.execute({ routeArtifactId, pathId: 'path-1' }, wrong, new AbortController().signal)).rejects.toThrow()
    expect(confirmRoutePriceOutputSchema.parse(output).summary.confirmed).toBe(1)
  })
})
