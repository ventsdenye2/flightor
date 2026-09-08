import { describe, expect, it } from 'vitest'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { InMemoryRouteGenerationRunRepository } from '../../route-generation/repository.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { createPlannerToolRegistry } from './core.js'

const call = { id: 'route-call', type: 'function' as const, function: { name: 'start_route_generation', arguments: '{}' } }
const origin = { id: 'airport-pek', type: 'airport' as const, name: 'Beijing', countryCode: 'CN', iata: 'PEK' }
const destination = { id: 'airport-cdg', type: 'airport' as const, name: 'Paris', countryCode: 'FR', iata: 'CDG' }

async function fixture() {
  const ownerId = 'owner-route-tool'
  const trips = new InMemoryTripRepository()
  const trip = await trips.create({ initialContext: {
    origin,
    departureWindow: { from: '2026-10-01', precision: 'approximate' },
    destinationIntent: { mode: 'explicit', required: [destination], preferred: [], excluded: [] }
  } })
  const ownedTrips = new Set([trip.id])
  const artifacts = new InMemoryArtifactRepository(ownerId, ownedTrips)
  const goals = new InMemoryGoalRepository(ownerId)
  const goalRuns = new InMemoryGoalRunRepository(ownerId, goals)
  const connectionSearch = new UnavailableConnectionSearchService()
  const flightRoutePlanner = new UnavailableFlightRoutePlanner()
  const routeOptimizer = new UnavailableRouteOptimizer()
  const routeGeneration = {
    runs: new InMemoryRouteGenerationRunRepository(ownerId, ownedTrips),
    goals,
    goalRuns,
    goalVerifiers: createDefaultGoalVerifierRegistry(),
    trips,
    artifacts,
    connectionSearch,
    flightRoutePlanner,
    routeOptimizer
  }
  const context: ToolExecutionContext = {
    ownerId,
    requestId: 'request-route-tool',
    conversationId: '018f3f7a-75a4-7cc7-b926-7f8fe2d39410',
    tripId: trip.id,
    generationId: 'generation-route-tool',
    trips,
    artifacts,
    memory: new InMemoryUserMemoryRepository(),
    aviation: new MockAviationProvider(),
    fares: new MockFareProvider(),
    research: new UnavailableResearchAgent(),
    connectionSearch,
    flightRoutePlanner,
    routeOptimizer,
    routeGeneration
  }
  return { trip, goals, goalRuns, context }
}

describe('start_route_generation tool', () => {
  it('records explicit conversational authorization and idempotently queues the deterministic engine', async () => {
    const value = await fixture()
    const registry = createPlannerToolRegistry()
    const first = await registry.execute(call, value.context, new AbortController().signal)
    const replay = await registry.execute(call, value.context, new AbortController().signal)

    expect(first.ok).toBe(true)
    const firstData = JSON.parse(first.content).data
    const replayData = JSON.parse(replay.content).data
    expect(firstData).toMatchObject({ created: true, run: { status: 'queued', goalId: expect.any(String), goalRunId: expect.any(String) } })
    expect(replayData).toMatchObject({ created: false, run: { id: firstData.run.id } })
    await expect(value.goals.get(firstData.run.goalId)).resolves.toMatchObject({
      kind: 'route_generation',
      authorization: expect.objectContaining({ source: 'explicit_user_message' })
    })
    await expect(value.goalRuns.get(firstData.run.goalRunId)).resolves.toMatchObject({ status: 'running' })
    expect(value.context).toMatchObject({
      activeGoalId: firstData.run.goalId,
      activeGoalRunId: firstData.run.goalRunId,
      activeGoalContextVersion: 0
    })
  })
})
