import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { InMemoryRouteGenerationRunRepository } from '../../route-generation/repository.js'
import { DeterministicFlightRoutePlanner } from '../../flight-routing/planner.js'
import { ParetoRouteOptimizer } from '../../flight-routing/optimizer.js'
import { AppError } from '../../lib/errors.js'
import { vi } from 'vitest'
import { InMemoryTripRepository } from '../../trips/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { createPlannerToolRegistry } from './core.js'
import { searchBudgetRoutesTool } from './route-generation.js'

const call = { id: 'route-call', type: 'function' as const, function: { name: 'start_route_generation', arguments: '{}' } }
const budgetCall = { id: 'budget-call', type: 'function' as const, function: { name: 'search_budget_routes', arguments: '{}' } }
const origin = { id: 'airport-pek', type: 'airport' as const, name: 'Beijing', countryCode: 'CN', iata: 'PEK' }
const destination = { id: 'airport-cdg', type: 'airport' as const, name: 'Paris', countryCode: 'FR', iata: 'CDG' }
const verification = { status: 'verified' as const, checkedAt: '2026-09-27T00:00:00.000Z', confidence: 1, sources: [{ provider: 'fixture' }] }

async function fixture() {
  const ownerId = 'owner-route-tool'
  const fareArtifactId = randomUUID()
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
  const connectionSearch = {
    search: vi.fn(async () => ({ edges: [{ id: 'direct-quote', from: origin, to: destination,
      departureDate: '2026-10-01', transferType: 'direct' as const, availability: 'partial' as const,
      segments: [{ id: 'quote-segment', from: origin, to: destination, departureAt: '2026-10-01T08:00:00Z',
        arrivalAt: '2026-10-01T12:00:00Z', durationMinutes: 240, verification }],
      fare: { amount: 900, currency: 'CNY' }, fareArtifactId, fareOfferId: 'fare-offer',
      durationMinutes: 240, departureAt: '2026-10-01T08:00:00Z', arrivalAt: '2026-10-01T12:00:00Z',
      verification, warnings: ['Ticketing and baggage terms need review.'], reasons: ['complete quote'] }],
      serviceVersion: 'test', verification, warnings: [], truncated: false, exhausted: true }))
  }
  const flightRoutePlanner = new DeterministicFlightRoutePlanner()
  const routeOptimizer = new ParetoRouteOptimizer()
  const routeGeneration = {
    runs: new InMemoryRouteGenerationRunRepository(ownerId, ownedTrips),
    goals,
    goalRuns,
    goalVerifiers: createDefaultGoalVerifierRegistry(),
    trips,
    artifacts,
    connectionSearch,
    flightRoutePlanner,
    routeOptimizer,
    onFailure: vi.fn()
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
    goalRepository: goals,
    goalRunRepository: goalRuns,
    goalVerifiers: createDefaultGoalVerifierRegistry(),
    routeGeneration
  }
  const fareArtifact = await artifacts.create({ id: fareArtifactId, tripId: trip.id, conversationId: context.conversationId,
    tripContextVersion: 0, type: 'flight_search', schemaVersion: 1, payload: {} })
  return { trip, goals, goalRuns, context, connectionSearch, routeGeneration, fareArtifact }
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

describe('search_budget_routes tool', () => {
  it('executes an inline one-way run and returns only a validated route summary and artifact ref', async () => {
    const value = await fixture()
    const before = await value.context.trips.get(value.trip.id)
    const result = await createPlannerToolRegistry().execute(budgetCall, value.context, new AbortController().signal)
    expect(result.ok).toBe(true)
    const data = JSON.parse(result.content).data
    expect(data).toMatchObject({ created: true, run: { status: 'succeeded', progress: { stage: 'completed', percent: 100 } },
      artifact: { type: 'route_set', schemaVersion: 1 }, summary: { lowestFare: { amount: 900, currency: 'CNY' },
        scope: expect.stringContaining('this one-way search window'), routes: [{ totalFare: { amount: 900, currency: 'CNY' },
          riskNotices: expect.arrayContaining(['Ticketing and baggage terms need review.']) }] } })
    expect(data.summary).not.toHaveProperty('providerBody')
    expect(await value.context.trips.get(value.trip.id)).toEqual(before)
    expect(value.context.activeGoalKind).toBe('route_generation')
  })

  it('preserves the existing eligibility code and never adopts missing Trip constraints', async () => {
    const value = await fixture()
    await value.context.trips.update(value.trip.id, { returnWindow: { from: '2026-10-02', to: '2026-10-02', precision: 'exact' } }, 0)
    await expect(searchBudgetRoutesTool.execute({}, value.context, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ROUND_TRIP_UNSUPPORTED' })
    expect(value.connectionSearch.search).not.toHaveBeenCalled()
    expect(value.context.activeGoalId).toBeUndefined()
  })

  it('allows only a completed trip_context_update before accepting a separate route goal', async () => {
    const value = await fixture()
    const trip = await value.context.trips.get(value.trip.id)
    const { goal } = await value.goals.create({ tripId: value.trip.id, conversationId: value.context.conversationId,
      kind: 'trip_context_update', parameters: { fields: ['budget'] }, createdContextVersion: trip!.version,
      idempotencyKey: 'prior-update' })
    const { run } = await value.goalRuns.create({ goalId: goal.id, tripId: value.trip.id,
      generationId: value.context.generationId, contextVersion: trip!.version, contextSnapshot: trip!, idempotencyKey: 'prior-update-run' })
    const satisfiedGoal = await value.goals.update(goal.id, goal.revision, { status: 'satisfied' })
    const satisfiedRun = await value.goalRuns.update(run.id, run.revision, { status: 'satisfied' })
    value.context.activeGoalId = goal.id
    value.context.activeGoalKind = 'trip_context_update'
    value.context.activeGoalRunId = run.id
    value.context.acceptedGoalIntent = { goalId: satisfiedGoal.id, runId: satisfiedRun.id, kind: 'trip_context_update',
      contextVersion: trip!.version, fingerprint: 'fixture' }
    await expect(searchBudgetRoutesTool.execute({}, value.context, new AbortController().signal)).resolves.toMatchObject({
      created: true, run: { status: 'succeeded' }
    })
    expect(value.context.acceptedGoalIntent).toBeUndefined()

    const blocked = await fixture()
    blocked.context.acceptedGoalIntent = { goalId: '018f3f7a-75a4-7cc7-b926-7f8fe2d39411',
      runId: '018f3f7a-75a4-7cc7-b926-7f8fe2d39412', kind: 'travel_guide', contextVersion: 0, fingerprint: 'fixture' }
    await expect(searchBudgetRoutesTool.execute({}, blocked.context, new AbortController().signal))
      .rejects.toMatchObject({ code: 'GOAL_INTENT_CONFLICT' })
    expect(blocked.connectionSearch.search).not.toHaveBeenCalled()
  })

  it('fences stale flight selection and parent cancellation before starting a run', async () => {
    const stale = await fixture()
    stale.context.assertFlightSelectionCurrent = async () => { throw new AppError('FLIGHT_SELECTION_CHANGED', 'Selection changed', 409) }
    await expect(searchBudgetRoutesTool.execute({}, stale.context, new AbortController().signal))
      .rejects.toMatchObject({ code: 'FLIGHT_SELECTION_CHANGED' })
    expect(stale.connectionSearch.search).not.toHaveBeenCalled()

    const cancelled = await fixture()
    await expect(searchBudgetRoutesTool.execute({}, cancelled.context, AbortSignal.abort()))
      .rejects.toBeDefined()
    expect(cancelled.connectionSearch.search).not.toHaveBeenCalled()
  })

  it('does not turn an empty route result into a success reply', async () => {
    const value = await fixture()
    value.context.routeGeneration!.connectionSearch = { search: async () => ({ edges: [], serviceVersion: 'empty', verification,
      warnings: [], truncated: false, exhausted: true }) }
    await expect(searchBudgetRoutesTool.execute({}, value.context, new AbortController().signal))
      .rejects.toMatchObject({ code: 'NO_ROUTE_PATHS' })
  })

  it('registers alongside ordinary fare search in both planner registries', () => {
    for (const registry of [createPlannerToolRegistry(), createPlannerToolRegistry({ leanGoalsEnabled: true })]) {
      expect(registry.get('search_budget_routes')).toBe(searchBudgetRoutesTool)
      expect(registry.get('search_flights')).toBeDefined()
    }
  })
})
