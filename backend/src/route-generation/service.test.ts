import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { createDefaultGoalVerifierRegistry } from '../agent/goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../agent/goals/repository.js'
import type { ConnectionSearchResult, RouteServiceContext } from '../flight-routing/types.js'
import { DeterministicFlightRoutePlanner } from '../flight-routing/planner.js'
import { ParetoRouteOptimizer } from '../flight-routing/optimizer.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import type { TripContextPatch } from '../trips/types.js'
import { InMemoryRouteGenerationRunRepository } from './repository.js'
import { executeRouteGenerationRun, startRouteGenerationRun, type RouteGenerationDependencies } from './service.js'

const verification = {
  status: 'verified' as const,
  checkedAt: '2026-09-07T00:00:00.000Z',
  confidence: 1,
  sources: [{ provider: 'test-topology' }]
}
const location = (iata: string, name = iata, cityCode?: string) => ({
  id: `airport-${iata.toLowerCase()}`, type: 'airport' as const, name,
  countryCode: iata === 'PEK' ? 'CN' : iata === 'CDG' ? 'FR' : 'JP', iata,
  ...(cityCode ? { cityCode } : {})
})
const origin = location('PEK', 'Beijing')
const destination = location('CDG', 'Paris', 'PAR')
const city = (cityCode: string, name: string, countryCode = 'JP') => ({
  id: `city-${cityCode.toLowerCase()}`, type: 'city' as const, name, countryCode, cityCode
})

function contextPatch(overrides: Partial<TripContextPatch> = {}): TripContextPatch {
  return {
    origin,
    departureWindow: { from: '2026-10-01', precision: 'approximate' },
    destinationIntent: { mode: 'explicit', required: [destination], preferred: [], excluded: [] },
    ...overrides
  }
}

function connectionResult(edges: ConnectionSearchResult['edges']): ConnectionSearchResult {
  return {
    edges,
    serviceVersion: 'test-connection-v1',
    verification,
    warnings: [],
    truncated: false,
    exhausted: true
  }
}

function directEdge() {
  return {
    id: 'edge-pek-cdg', from: origin, to: destination,
    departureDate: '2026-10-01', durationMinutes: 720,
    transferType: 'direct' as const, availability: 'verified' as const,
    verification, warnings: [], reasons: []
  }
}

async function fixture(options: { edges?: ConnectionSearchResult['edges']; onSearch?: (context?: RouteServiceContext) => Promise<void> } = {}) {
  const trips = new InMemoryTripRepository()
  const trip = await trips.create({ initialContext: contextPatch() })
  const runs = new InMemoryRouteGenerationRunRepository('user-1', new Set([trip.id]))
  const goals = new InMemoryGoalRepository('user-1')
  const goalRuns = new InMemoryGoalRunRepository('user-1', goals)
  const artifacts = new InMemoryArtifactRepository('user-1', new Set([trip.id]))
  const connectionSearch = {
    search: vi.fn(async (_input, context?: RouteServiceContext) => {
      await options.onSearch?.(context)
      return connectionResult(options.edges ?? [directEdge()])
    })
  }
  const dependencies: RouteGenerationDependencies = {
    runs, goals, goalRuns, goalVerifiers: createDefaultGoalVerifierRegistry(),
    trips, artifacts, connectionSearch,
    flightRoutePlanner: new DeterministicFlightRoutePlanner(),
    routeOptimizer: new ParetoRouteOptimizer()
  }
  return { trip, trips, runs, goals, goalRuns, artifacts, connectionSearch, dependencies }
}

describe('route generation service', () => {
  it('validates origin and approximate departure at action time', async () => {
    const missingOrigin = await fixture()
    await missingOrigin.trips.update(missingOrigin.trip.id, { origin: null })
    await expect(startRouteGenerationRun(missingOrigin.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: missingOrigin.trip.id, idempotencyKey: 'origin-missing'
    })).rejects.toMatchObject({ code: 'ROUTE_ORIGIN_REQUIRED' })

    const missingWindow = await fixture()
    await missingWindow.trips.update(missingWindow.trip.id, { departureWindow: null })
    await expect(startRouteGenerationRun(missingWindow.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: missingWindow.trip.id, idempotencyKey: 'window-missing'
    })).rejects.toMatchObject({ code: 'DEPARTURE_WINDOW_REQUIRED' })
  })

  it('returns the same durable run and enqueues one job for an idempotent request', async () => {
    const value = await fixture()
    const first = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'same-request'
    })
    const second = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'same-request'
    })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.run.id).toBe(first.run.id)
    expect(first.run.goalId).toBeDefined()
    expect(first.run.goalRunId).toBeDefined()
    expect(second.run).toMatchObject({ goalId: first.run.goalId, goalRunId: first.run.goalRunId })
    expect(await value.goals.listForTrip(value.trip.id)).toEqual([
      expect.objectContaining({ id: first.run.goalId, kind: 'route_generation', status: 'pending', authorization: expect.objectContaining({ source: 'button' }) })
    ])
    expect(await value.goalRuns.listForGoal(first.run.goalId!)).toHaveLength(1)
    expect(value.runs.enqueuedJobRunIds).toEqual([first.run.id])
  })

  it('executes the frozen snapshot even after the trip context changes', async () => {
    const value = await fixture()
    const started = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'stale-context'
    })
    await value.trips.update(value.trip.id, { notes: ['changed after enqueue'] })
    const finished = await executeRouteGenerationRun(value.dependencies, started.run.id)
    expect(finished?.status).toBe('succeeded')
    expect(finished?.contextVersion).toBe(0)
  })

  it('cancels between stages without writing a result artifact', async () => {
    let runId = ''
    let value!: Awaited<ReturnType<typeof fixture>>
    value = await fixture({ onSearch: async () => { await value.runs.cancel(runId) } })
    const started = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'cancel-me'
    })
    runId = started.run.id
    const finished = await executeRouteGenerationRun(value.dependencies, started.run.id)
    expect(finished?.status).toBe('cancelled')
    expect(finished?.resultArtifactId).toBeUndefined()
    await expect(value.goals.get(started.run.goalId!)).resolves.toMatchObject({ status: 'cancelled' })
    await expect(value.goalRuns.get(started.run.goalRunId!)).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('checks persistent cancellation inside connection-provider work', async () => {
    let runId = ''
    let value!: Awaited<ReturnType<typeof fixture>>
    value = await fixture({ onSearch: async context => {
      await value.runs.cancel(runId)
      await context?.checkpoint?.()
    } })
    const started = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'cancel-provider-loop'
    })
    runId = started.run.id

    const finished = await executeRouteGenerationRun(value.dependencies, runId)

    expect(finished?.status).toBe('cancelled')
    expect(value.connectionSearch.search).toHaveBeenCalledOnce()
    expect(finished?.resultArtifactId).toBeUndefined()
  })

  it('keeps cancellation authoritative when a provider fails after cancellation', async () => {
    let runId = ''
    let value!: Awaited<ReturnType<typeof fixture>>
    value = await fixture({ onSearch: async () => {
      await value.runs.cancel(runId)
      throw new Error('provider failed after cancellation')
    } })
    const started = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'cancel-before-provider-failure'
    })
    runId = started.run.id

    const finished = await executeRouteGenerationRun(value.dependencies, runId)

    expect(finished?.status).toBe('cancelled')
    await expect(value.goals.get(started.run.goalId!)).resolves.toMatchObject({ status: 'cancelled' })
    await expect(value.goalRuns.get(started.run.goalRunId!)).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('persists an immutable connection -> paths -> optimized route_set chain without fake fare', async () => {
    const value = await fixture()
    const started = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'generate-route'
    })
    const finished = await executeRouteGenerationRun(value.dependencies, started.run.id)
    expect(finished?.status).toBe('succeeded')
    expect(finished?.resultArtifactId).toBeDefined()
    expect(finished?.warnings.some(warning => warning.includes('no price is fabricated'))).toBe(true)
    const optimized = await value.artifacts.get(finished!.resultArtifactId!)
    expect(optimized?.type).toBe('route_set')
    expect(optimized).toMatchObject({
      goalId: started.run.goalId,
      runId: started.run.goalRunId,
      tripContextVersion: started.run.contextVersion
    })
    expect((optimized?.payload as { kind: string }).kind).toBe('optimized_routes')
    const optimizedPayload = optimized?.payload as { sourceArtifactIds: string[] }
    const paths = await value.artifacts.get(optimizedPayload.sourceArtifactIds[0]!)
    expect((paths?.payload as { kind: string }).kind).toBe('flight_paths')
    const connection = await value.artifacts.get((paths?.payload as { sourceArtifactIds: string[] }).sourceArtifactIds[0]!)
    expect((connection?.payload as { kind: string }).kind).toBe('connection_edges')
    expect(paths?.sourceArtifactIds).toEqual([connection?.id])
    expect(optimized?.sourceArtifactIds).toEqual([paths?.id])
    await expect(value.goals.get(started.run.goalId!)).resolves.toMatchObject({ status: 'satisfied' })
    await expect(value.goalRuns.get(started.run.goalRunId!)).resolves.toMatchObject({
      status: 'satisfied',
      workingSet: { artifactRefs: expect.arrayContaining([
        expect.objectContaining({ id: connection?.id }),
        expect.objectContaining({ id: paths?.id }),
        expect.objectContaining({ id: optimized?.id })
      ]) }
    })
  })

  it('marks no-path results explicitly and never creates a fake route artifact', async () => {
    const value = await fixture({ edges: [] })
    const started = await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'no-paths'
    })
    const finished = await executeRouteGenerationRun(value.dependencies, started.run.id)
    expect(finished).toMatchObject({ status: 'failed', errorCode: 'NO_ROUTE_PATHS' })
    expect(finished?.resultArtifactId).toBeUndefined()
    await expect(value.goals.get(started.run.goalId!)).resolves.toMatchObject({ status: 'failed' })
    await expect(value.goalRuns.get(started.run.goalRunId!)).resolves.toMatchObject({ status: 'failed' })
  })

  it('rejects unsupported return or multi-city contexts before enqueue', async () => {
    const roundTrip = await fixture()
    await roundTrip.trips.update(roundTrip.trip.id, { returnWindow: { from: '2026-10-10', precision: 'exact' } })
    await expect(startRouteGenerationRun(roundTrip.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: roundTrip.trip.id, idempotencyKey: 'round-trip'
    })).rejects.toMatchObject({ code: 'ROUND_TRIP_UNSUPPORTED' })
    expect(roundTrip.runs.enqueuedJobRunIds).toHaveLength(0)

    const multiCity = await fixture()
    const second = location('NRT', 'Tokyo')
    await multiCity.trips.update(multiCity.trip.id, {
      destinationIntent: { mode: 'explicit', required: [destination, second], preferred: [], excluded: [] }
    })
    await expect(startRouteGenerationRun(multiCity.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: multiCity.trip.id, idempotencyKey: 'multi-city'
    })).rejects.toMatchObject({ code: 'MULTI_CITY_UNSUPPORTED' })
    expect(multiCity.runs.enqueuedJobRunIds).toHaveLength(0)

    const groundLeg = await fixture()
    await groundLeg.trips.update(groundLeg.trip.id, {
      requiredGroundLegs: [{ from: origin, to: destination, mode: 'rail' }]
    })
    await expect(startRouteGenerationRun(groundLeg.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: groundLeg.trip.id, idempotencyKey: 'ground-leg'
    })).rejects.toMatchObject({ code: 'GROUND_LEGS_UNSUPPORTED' })
    expect(groundLeg.runs.enqueuedJobRunIds).toHaveLength(0)
  })

  it('does not promote a soft preferred destination into a final visit', async () => {
    const value = await fixture()
    await value.trips.update(value.trip.id, {
      destinationIntent: { mode: 'open', required: [], preferred: [destination], excluded: [] }
    })

    await expect(startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'soft-preference-only'
    })).rejects.toMatchObject({ code: 'DESTINATION_AIRPORT_REQUIRED' })
    expect(value.runs.enqueuedJobRunIds).toHaveLength(0)
  })

  it('preserves city preferences for topology ranking and treats excluded cities as hard airport exclusions', async () => {
    const preferred = await fixture()
    const tokyo = city('TYO', 'Tokyo')
    await preferred.trips.update(preferred.trip.id, {
      destinationIntent: { mode: 'explicit', required: [destination], preferred: [tokyo], excluded: [] }
    })
    const started = await startRouteGenerationRun(preferred.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: preferred.trip.id, idempotencyKey: 'city-preference'
    })
    await executeRouteGenerationRun(preferred.dependencies, started.run.id)
    expect(preferred.connectionSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ preferredLocations: [tokyo] }),
      expect.any(Object)
    )

    const excluded = await fixture()
    await excluded.trips.update(excluded.trip.id, {
      destinationIntent: { mode: 'explicit', required: [destination], preferred: [], excluded: [city('PAR', 'Paris', 'FR')] }
    })
    await expect(startRouteGenerationRun(excluded.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: excluded.trip.id, idempotencyKey: 'city-exclusion'
    })).rejects.toMatchObject({ code: 'DESTINATION_EXCLUDED' })
    expect(excluded.runs.enqueuedJobRunIds).toHaveLength(0)
  })

  it('conflicts when an idempotency key is reused with another accepted context version', async () => {
    const value = await fixture()
    await startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'reuse-key'
    })
    await value.trips.update(value.trip.id, { notes: ['new version'] })
    await expect(startRouteGenerationRun(value.dependencies, {
      ownerId: 'user-1', authorizationSource: 'button', tripId: value.trip.id, idempotencyKey: 'reuse-key', expectedTripVersion: 1
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE' })
  })
})
