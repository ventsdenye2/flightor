import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import type { LocationRef } from '../../aviation/types.js'
import { DeterministicTravelGuideBuilder } from '../../travel-guides/artifact-builder.js'
import type { TripRoutePlanPayload } from '../../trip-planning/types.js'
import { buildTravelGuideTool } from './travel-guide.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'

const tripId = 'trip-1'
const routeId = '018f3f7a-75a4-7cc7-b926-7f8fe2d39416'
const researchId = '018f3f7a-75a4-7cc7-b926-7f8fe2d39417'
const tokyo: LocationRef = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const verification = { status: 'partially_verified' as const, checkedAt: '2026-09-07T00:00:00.000Z', confidence: 0.5, sources: [{ provider: 'test' }] }

function route(): TripRoutePlanPayload {
  return {
    kind: 'trip_route_plan', schemaVersion: 1, plannerVersion: 'test', sourceArtifactIds: ['dest-1'],
    tripContextVersion: 1, cities: [{ location: tokyo, stayDays: 1, role: 'visit', reasons: ['required'] }],
    days: [{ day: 1, city: tokyo, activityRefs: [] }], stopoverOnly: [], landTransfers: [],
    unassignedActivityRefs: [], verification, warnings: []
  }
}

async function setup() {
  const artifacts = new InMemoryArtifactRepository('user-1', new Set([tripId]))
  await artifacts.create({ id: routeId, tripId, type: 'route', schemaVersion: 1, tripContextVersion: 1, payload: route() })
  await artifacts.create({
    id: researchId, tripId, type: 'research', schemaVersion: 2, tripContextVersion: 1,
    payload: {
      id: researchId, type: 'research', schemaVersion: 2,
      brief: { destinations: [tokyo], interests: [], questions: ['Ideas?'], researchTypes: ['activity'] },
      findings: [{
        id: 'finding-1', category: 'activity', destinations: [tokyo], title: 'Source idea', summary: 'Bounded summary.',
        sources: [{ title: 'Source', url: 'https://example.com/', domain: 'example.com', snippet: 'Bounded summary.', authority: 'unknown' }],
        verification, warnings: []
      }], queryCount: 1, warnings: [], createdAt: '2026-09-07T00:00:00.000Z'
    }
  })
  return artifacts
}

const tripsAt = (version = 1) => new InMemoryTripContextRepository([{ ...emptyTripContext(tripId), version, travelDays: 1 }])

describe('buildTravelGuideTool', () => {
  it('loads owned source artifacts, persists full guide, and returns compact output', async () => {
    const artifacts = await setup()
    const context = {
      tripId, conversationId: 'conversation-1', artifacts, trips: tripsAt(),
      travelGuideBuilder: new DeterministicTravelGuideBuilder(), isGenerationCurrent: () => true
    } as never
    const result = await buildTravelGuideTool.execute({
      routeArtifactId: routeId, researchArtifactIds: [researchId]
    }, context, new AbortController().signal)
    expect(result.summary).toMatchObject({ dayCount: 1, itemCount: 1, verificationStatus: 'partially_verified' })
    expect(JSON.stringify(result)).not.toContain('Bounded summary')
    const stored = await artifacts.get(result.artifact.id)
    expect(stored?.type).toBe('travel_guide')
    expect(stored?.tripContextVersion).toBe(1)
    expect((stored?.payload as any).days[0].items[0].sourceArtifactId).toBe(researchId)
  })

  it('rejects missing sources and stale generation before persistence', async () => {
    const artifacts = await setup()
    const base = { tripId, conversationId: 'conversation-1', artifacts, trips: tripsAt(), travelGuideBuilder: new DeterministicTravelGuideBuilder(), isGenerationCurrent: () => true } as never
    await expect(buildTravelGuideTool.execute({ routeArtifactId: routeId, researchArtifactIds: ['018f3f7a-75a4-7cc7-b926-7f8fe2d39418'] }, base, new AbortController().signal)).rejects.toThrow('not found')
    const stale = { ...(base as any), isGenerationCurrent: () => false }
    await expect(buildTravelGuideTool.execute({ routeArtifactId: routeId, researchArtifactIds: [] }, stale, new AbortController().signal)).rejects.toThrow('cancelled')
  })

  it('rejects an earlier itinerary after the Trip changes instead of relabeling it as current', async () => {
    const artifacts = await setup()
    const trips = tripsAt()
    await trips.update(tripId, { travelDays: 10 }, 1)
    const build = vi.fn(new DeterministicTravelGuideBuilder().build)
    const context = { tripId, artifacts, trips, travelGuideBuilder: { build } } as never
    await expect(buildTravelGuideTool.execute({ routeArtifactId: routeId, researchArtifactIds: [researchId] }, context, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
    expect(build).not.toHaveBeenCalled()
    expect((await artifacts.listForTrip(tripId)).map(record => record.type)).not.toContain('travel_guide')
  })

  it('checks Trip version again after guide building and before persistence', async () => {
    const artifacts = await setup()
    const trips = tripsAt()
    const delegate = new DeterministicTravelGuideBuilder()
    const build = vi.fn(async (...args: Parameters<typeof delegate.build>) => {
      const guide = await delegate.build(...args)
      await trips.update(tripId, { travelDays: 10 }, 1)
      return guide
    })
    const context = { tripId, artifacts, trips, travelGuideBuilder: { build } } as never
    await expect(buildTravelGuideTool.execute({ routeArtifactId: routeId, researchArtifactIds: [researchId] }, context, new AbortController().signal))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(build).toHaveBeenCalledOnce()
    expect((await artifacts.listForTrip(tripId)).map(record => record.type)).not.toContain('travel_guide')
  })
})
