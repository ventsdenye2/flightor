import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { issueAccessToken } from '../auth/tokens.js'
import type { AppContext } from '../app/context.js'
import type { AppEnv } from '../config/env.js'
import { DeterministicFlightRoutePlanner } from '../flight-routing/planner.js'
import { ParetoRouteOptimizer } from '../flight-routing/optimizer.js'
import { InMemoryRouteGenerationRunRepository } from '../route-generation/repository.js'
import type { RouteGenerationDependencies } from '../route-generation/service.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import { registerRouteGenerationRoutes } from './route-generation.js'

const env = { JWT_SECRET: 'route-generation-test-secret', ACCESS_TOKEN_TTL_SECONDS: 3600 } as AppEnv
const origin = { id: 'airport-pek', type: 'airport' as const, name: 'Beijing', countryCode: 'CN', iata: 'PEK' }
const destination = { id: 'airport-cdg', type: 'airport' as const, name: 'Paris', countryCode: 'FR', iata: 'CDG' }

async function fixture() {
  const trips = new InMemoryTripRepository()
  const trip = await trips.create({ initialContext: {
    origin, departureWindow: { from: '2026-10-01', precision: 'approximate' },
    destinationIntent: { mode: 'explicit', required: [destination], preferred: [], excluded: [] }
  } })
  const runs = new InMemoryRouteGenerationRunRepository('user-a', new Set([trip.id]))
  const dependencies: RouteGenerationDependencies = {
    runs, trips, artifacts: new InMemoryArtifactRepository('user-a', new Set([trip.id])),
    connectionSearch: { search: async () => ({ edges: [], serviceVersion: 'test', verification: { status: 'unverified' as const, checkedAt: '2026-09-07T00:00:00.000Z', confidence: 0, sources: [{ provider: 'test' }] }, warnings: [], truncated: false, exhausted: true }) },
    flightRoutePlanner: new DeterministicFlightRoutePlanner(), routeOptimizer: new ParetoRouteOptimizer()
  }
  return { trip, dependencies }
}

describe('route-generation HTTP contract', () => {
  it('requires auth and a bounded idempotency key, then returns a pollable run', async () => {
    const value = await fixture()
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ error: { code: (error as { code?: string }).code, message: error.message } }))
    const context = { env, db: {}, redis: {}, providers: {} } as unknown as AppContext
    await registerRouteGenerationRoutes(app, context, () => value.dependencies)
    const token = await issueAccessToken({ userId: 'user-a', publicId: '00000000-0000-4000-8000-000000000001' }, env)

    const unauthenticated = await app.inject({
      method: 'POST', url: `/v1/trips/${value.trip.id}/route-generation-runs`,
      headers: { 'idempotency-key': 'no-auth' }, payload: {}
    })
    expect(unauthenticated.statusCode).toBe(401)

    const missingKey = await app.inject({ method: 'POST', url: `/v1/trips/${value.trip.id}/route-generation-runs`, headers: { authorization: `Bearer ${token}` }, payload: {} })
    expect(missingKey.statusCode).toBe(400)
    expect(missingKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const created = await app.inject({ method: 'POST', url: `/v1/trips/${value.trip.id}/route-generation-runs`, headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'route-1' }, payload: {} })
    expect(created.statusCode).toBe(202)
    expect(created.json().run.status).toBe('queued')
    const replay = await app.inject({ method: 'POST', url: `/v1/trips/${value.trip.id}/route-generation-runs`, headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'route-1' }, payload: {} })
    expect(replay.statusCode).toBe(202)
    expect(replay.json().run.id).toBe(created.json().run.id)
    expect(replay.json().created).toBe(false)
    await value.dependencies.trips.update(value.trip.id, { notes: ['edited after request'] })
    const stale = await app.inject({ method: 'GET', url: `/v1/route-generation-runs/${created.json().run.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(stale.json().run.stale).toBe(true)
    await app.close()
  })

  it('does not reveal an owner-scoped run to another authenticated user', async () => {
    const value = await fixture()
    const app = Fastify()
    const context = { env, db: {}, redis: {}, providers: {} } as unknown as AppContext
    await registerRouteGenerationRoutes(app, context, trustedUserId => trustedUserId === 'user-a'
      ? value.dependencies
      : { ...value.dependencies, runs: new InMemoryRouteGenerationRunRepository(trustedUserId, new Set([value.trip.id])) })
    const tokenA = await issueAccessToken({ userId: 'user-a', publicId: '00000000-0000-4000-8000-000000000001' }, env)
    const created = await app.inject({ method: 'POST', url: `/v1/trips/${value.trip.id}/route-generation-runs`, headers: { authorization: `Bearer ${tokenA}`, 'idempotency-key': 'owner-only' }, payload: {} })
    const id = created.json().run.id as string
    const tokenB = await issueAccessToken({ userId: 'user-b', publicId: '00000000-0000-4000-8000-000000000002' }, env)
    const foreign = await app.inject({ method: 'GET', url: `/v1/route-generation-runs/${id}`, headers: { authorization: `Bearer ${tokenB}` } })
    expect(foreign.statusCode).toBe(404)
    await app.close()
  })
})
