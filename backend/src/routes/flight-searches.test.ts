import Fastify from 'fastify'
import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import type { AppContext } from '../app/context.js'
import { issueAccessToken } from '../auth/tokens.js'
import { parseEnv } from '../config/env.js'
import { InMemoryConversationRepository } from '../conversations/repository.js'
import { MockFareProvider } from '../fares/providers/mock.js'
import { isAppError } from '../lib/errors.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import { registerFlightSearchRoutes } from './flight-searches.js'

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'manual-flight-search-test-secret-at-least-32-characters'
})

const fare = {
  query: { origin: 'PEK', destination: 'KIX', departureDate: '2026-10-03', currency: 'CNY' as const, travelClass: 1 },
  offers: [{
    id: 'fare-1',
    segments: [{
      flightNumber: 'MU100', airline: 'Mock Air', origin: 'PEK', destination: 'KIX',
      departsAt: '2026-10-03T08:00:00Z', arrivesAt: '2026-10-03T11:30:00Z', durationMinutes: 210
    }],
    totalAmount: 1880, currency: 'CNY', totalDurationMinutes: 210,
    airlines: ['Mock Air'], transferType: 'direct' as const
  }],
  provider: 'mock-fares',
  checkedAt: '2026-09-07T00:00:00.000Z',
  verification: {
    status: 'verified' as const,
    checkedAt: '2026-09-07T00:00:00.000Z',
    confidence: 1,
    sources: [{ provider: 'mock-fares', reference: 'fixture' }]
  }
}

async function fixture() {
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ code: 'INVALID_REQUEST' })
    if (isAppError(error)) return reply.code(error.statusCode).send({ code: error.code })
    return reply.code(500).send({ code: 'INTERNAL_ERROR' })
  })
  const trips = new InMemoryTripRepository()
  const trip = await trips.create({ title: 'Manual search' })
  const ownedTripIds = new Set([trip.id])
  const conversations = new InMemoryConversationRepository('42', ownedTripIds)
  const conversation = await conversations.create({ tripId: trip.id })
  const artifacts = new InMemoryArtifactRepository('42', ownedTripIds)
  await registerFlightSearchRoutes(app, { env } as unknown as AppContext, userId => {
    if (userId !== '42') throw new Error('unexpected owner')
    return { trips, conversations, artifacts, fares: new MockFareProvider({ search: fare }) }
  })
  const token = await issueAccessToken({ userId: '42', publicId: 'public-42' }, env)
  return { app, trip, conversation, artifacts, token }
}

describe('manual flight search API', () => {
  it('uses authenticated Trip ownership and persists the same FlightSearchArtifact contract as the Planner tool', async () => {
    const { app, trip, conversation, artifacts, token } = await fixture()
    const response = await app.inject({
      method: 'POST',
      url: '/v1/flight-searches',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'manual-search-1' },
      payload: {
        tripId: trip.id,
        conversationId: conversation.id,
        origin: 'pek',
        destination: 'kix',
        departureDate: '2026-10-03',
        currency: 'CNY',
        travelClass: 1
      }
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      artifactRef: { type: 'flight_search', schemaVersion: 1, presentationHint: 'flight_cards' },
      summary: { origin: 'PEK', destination: 'KIX', offerCount: 1, provider: 'mock-fares' }
    })
    const stored = await artifacts.get(response.json().artifactRef.id)
    expect(stored).toMatchObject({ tripId: trip.id, conversationId: conversation.id, type: 'flight_search', schemaVersion: 1 })
    expect(stored?.payload).toMatchObject({ type: 'flight_search', offers: [{ id: 'fare-1', totalAmount: 1880 }] })
    await app.close()
  })

  it('requires authentication and rejects a conversation outside the supplied Trip', async () => {
    const { app, trip, token } = await fixture()
    const body = {
      tripId: trip.id,
      conversationId: '018f4dc2-0100-7000-8000-000000000001',
      origin: 'PEK', destination: 'KIX', departureDate: '2026-10-03'
    }
    const unauthenticated = await app.inject({ method: 'POST', url: '/v1/flight-searches', payload: body })
    expect(unauthenticated.statusCode).toBe(401)
    const foreign = await app.inject({
      method: 'POST', url: '/v1/flight-searches', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'foreign-trip' }, payload: body
    })
    expect(foreign.statusCode).toBe(404)
    await app.close()
  })

  it('requires a bounded Idempotency-Key and replays the same artifact for the same request', async () => {
    const { app, trip, conversation, token } = await fixture()
    const payload = {
      tripId: trip.id, conversationId: conversation.id, origin: 'PEK', destination: 'KIX', departureDate: '2026-10-03'
    }
    const missing = await app.inject({ method: 'POST', url: '/v1/flight-searches', headers: { authorization: `Bearer ${token}` }, payload })
    expect(missing.statusCode).toBe(400)
    const malformed = await app.inject({
      method: 'POST', url: '/v1/flight-searches', headers: { authorization: `Bearer ${token}`, 'idempotency-key': '\u0001' }, payload
    })
    expect(malformed.statusCode).toBe(400)

    const first = await app.inject({
      method: 'POST', url: '/v1/flight-searches', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'replay-key' }, payload
    })
    const replay = await app.inject({
      method: 'POST', url: '/v1/flight-searches', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'replay-key' }, payload
    })
    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(200)
    expect(replay.json().artifactRef.id).toBe(first.json().artifactRef.id)
    await app.close()
  })

  it('rejects reusing a key for a different request and keeps keys owner-scoped', async () => {
    const { app, trip, conversation, token } = await fixture()
    const payload = {
      tripId: trip.id, conversationId: conversation.id, origin: 'PEK', destination: 'KIX', departureDate: '2026-10-03'
    }
    const first = await app.inject({
      method: 'POST', url: '/v1/flight-searches', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'conflict-key' }, payload
    })
    const conflict = await app.inject({
      method: 'POST', url: '/v1/flight-searches', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'conflict-key' },
      payload: { ...payload, destination: 'NRT' }
    })
    expect(first.statusCode).toBe(201)
    expect(conflict.statusCode).toBe(409)
    await app.close()
  })
})
