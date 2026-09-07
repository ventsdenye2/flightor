import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { emptyTripContext, type TripContext } from '../../trips/types.js'
import { CatalogDestinationDiscoveryService } from '../../destinations/discovery.js'
import { DeterministicTripRoutePlanner } from '../../trip-planning/planner.js'
import { destinationSetPayloadSchema } from '../../destinations/types.js'
import {
  planTripRouteInputSchema,
  planTripRouteTool,
  recommendDestinationsInputSchema,
  recommendDestinationsTool,
  searchDestinationsInputSchema,
  searchDestinationsTool
} from './destinations.js'

const location = (iata: string, countryCode = 'CN') => ({
  id: `airport-${iata.toLowerCase()}`,
  type: 'airport' as const,
  name: iata,
  countryCode,
  iata
})

function makeContext(trip: TripContext = emptyTripContext('trip-1'), memory = '') {
  const trips = new InMemoryTripContextRepository([trip])
  return {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    tripId: trip.id,
    generationId: 'generation-1',
    trips,
    artifacts: new InMemoryArtifactRepository('user-1', new Set([trip.id])),
    memory: new InMemoryUserMemoryRepository({ enabled: true, markdown: memory }),
    aviation: {} as never,
    fares: {} as never,
    research: {} as never,
    connectionSearch: {} as never,
    flightRoutePlanner: {} as never,
    routeOptimizer: {} as never,
    destinationDiscovery: new CatalogDestinationDiscoveryService(),
    tripRoutePlanner: new DeterministicTripRoutePlanner(),
    resolvedLocationKeys: new Set<string>(),
    isGenerationCurrent: () => true
  }
}

describe('destination Agent tools', () => {
  it('exposes strict bounded inputs and persists a complete destination candidate artifact with compact top five', async () => {
    expect(searchDestinationsInputSchema.safeParse({ regions: ['japan'], interests: ['food'], limit: 5, extra: true }).success).toBe(false)
    const trip = {
      ...emptyTripContext('trip-1'),
      origin: location('PEK'),
      destinationIntent: { mode: 'open' as const, required: [], preferred: [], excluded: [] }
    }
    const context = makeContext(trip)
    const result = await searchDestinationsTool.execute(searchDestinationsInputSchema.parse({ regions: ['japan'], interests: ['food'], limit: 8 }), context, new AbortController().signal)

    expect(result.artifact.type).toBe('destination_set')
    expect(result.summary.topCandidates.length).toBeLessThanOrEqual(5)
    expect(result.summary.candidateCount).toBeGreaterThan(0)
    const stored = await context.artifacts.get(result.artifact.id)
    expect(stored).toMatchObject({ tripId: 'trip-1', type: 'destination_set', schemaVersion: 1 })
    const payload = destinationSetPayloadSchema.parse(stored?.payload)
    expect(payload.kind).toBe('destination_candidates')
    expect(payload.candidates.length).toBe(result.summary.candidateCount)
    expect(context.resolvedLocationKeys?.size).toBe(payload.candidates.length)
  })

  it('uses enabled Memory city mentions as soft preference while trip exclusions remain hard', async () => {
    const trip = {
      ...emptyTripContext('trip-1'),
      travelDays: 5,
      destinationIntent: {
        mode: 'mixed' as const,
        required: [location('KIX', 'JP')],
        preferred: [],
        excluded: [location('NRT', 'JP')]
      },
      locationRoleOverrides: [{ location: location('NRT', 'JP'), role: 'avoid' as const }]
    }
    const context = makeContext(trip, '# 偏好\n- 东京\n- 曼谷')
    const result = await recommendDestinationsTool.execute(recommendDestinationsInputSchema.parse({ limit: 6 }), context, new AbortController().signal)
    const stored = await context.artifacts.get(result.artifact.id)
    const payload = destinationSetPayloadSchema.parse(stored?.payload)

    expect(payload.kind).toBe('destination_recommendations')
    expect(payload.query.requiredIatas).toContain('KIX')
    expect(payload.query.excludedIatas).toContain('NRT')
    expect(payload.query.preferredIatas).toContain('NRT')
    expect(payload.candidates[0]?.location.iata).toBe('KIX')
    expect(payload.candidates.map(candidate => candidate.location.iata)).not.toContain('NRT')
  })

  it('validates owner/trip/type/kind and creates a route artifact from a trusted destination set', async () => {
    const trip = {
      ...emptyTripContext('trip-1'),
      travelDays: 4,
      destinationIntent: { mode: 'explicit' as const, required: [location('KIX', 'JP')], preferred: [], excluded: [] },
      mustIncludeEvents: [{ id: 'event-1', title: 'User event' }]
    }
    const context = makeContext(trip)
    const destinations = await searchDestinationsTool.execute(searchDestinationsInputSchema.parse({ regions: ['japan'], interests: [], limit: 3 }), context, new AbortController().signal)
    const result = await planTripRouteTool.execute(planTripRouteInputSchema.parse({ candidateArtifactId: destinations.artifact.id, maxCities: 2 }), context, new AbortController().signal)

    expect(result.artifact.type).toBe('route')
    expect(result.summary.dayCount).toBe(4)
    const stored = await context.artifacts.get(result.artifact.id)
    expect(stored).toMatchObject({ type: 'route', schemaVersion: 1 })
    expect(stored?.payload).toMatchObject({ kind: 'trip_route_plan', schemaVersion: 1, sourceArtifactIds: [destinations.artifact.id], landTransfers: [] })
    expect((stored?.payload as { unassignedActivityRefs: unknown[] }).unassignedActivityRefs).toEqual([{ id: 'event-1', title: 'User event', reason: 'user_requested' }])

    const wrong = await context.artifacts.create({
      tripId: 'trip-1', type: 'route_set', schemaVersion: 1, payload: {}, verification: {}
    })
    await expect(planTripRouteTool.execute(
      planTripRouteInputSchema.parse({ candidateArtifactId: wrong.id }), context, new AbortController().signal
    )).rejects.toMatchObject({ code: 'ARTIFACT_TYPE_MISMATCH' })
  })

  it('does not persist when the generation is cancelled before the service call', async () => {
    const trip = { ...emptyTripContext('trip-1'), origin: location('PEK') }
    const context = makeContext(trip)
    context.isGenerationCurrent = () => false
    await expect(searchDestinationsTool.execute(searchDestinationsInputSchema.parse({}), context, new AbortController().signal)).rejects.toThrow('cancelled')

    const missing = await context.artifacts.get('00000000-0000-7000-8000-000000000000')
    expect(missing).toBeUndefined()
  })
})
