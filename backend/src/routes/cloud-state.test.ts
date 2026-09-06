import Fastify from 'fastify'
import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import type { AppContext } from '../app/context.js'
import { issueAccessToken } from '../auth/tokens.js'
import { parseEnv } from '../config/env.js'
import { InMemoryConversationRepository } from '../conversations/repository.js'
import { isAppError } from '../lib/errors.js'
import { InMemoryUserMemoryRepository } from '../memory/repository.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import { registerCloudStateRoutes } from './cloud-state.js'

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'cloud-state-route-test-secret-at-least-32-characters'
})

describe('cloud state API authorization contract', () => {
  it('derives repository ownership from JWT and rejects client user_id fields', async () => {
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'INVALID_REQUEST' })
      if (isAppError(error)) return reply.code(error.statusCode).send({ code: error.code })
      return reply.code(500).send({ code: 'INTERNAL_ERROR' })
    })
    const ownerIds: string[] = []
    const trips = new InMemoryTripRepository()
    const ownedTripIds = new Set<string>()
    const memory = new InMemoryUserMemoryRepository()
    const repositories = {
      trips,
      conversations: new InMemoryConversationRepository('42', ownedTripIds),
      artifacts: new InMemoryArtifactRepository('42', ownedTripIds),
      memory
    }
    await registerCloudStateRoutes(app, { env } as unknown as AppContext, userId => {
      ownerIds.push(userId)
      return repositories
    })
    const token = await issueAccessToken({ userId: '42', publicId: 'user-public' }, env)

    const rejected = await app.inject({
      method: 'POST', url: '/v1/trips',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Injected', user_id: '999' }
    })
    expect(rejected.statusCode).toBe(400)
    expect(ownerIds).toEqual([])

    const accepted = await app.inject({
      method: 'POST', url: '/v1/trips',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Trusted owner' }
    })
    expect(accepted.statusCode).toBe(201)
    expect(ownerIds).toEqual(['42'])
    expect(accepted.json().trip.title).toBe('Trusted owner')
    const tripId = accepted.json().trip.id as string
    const updatedTrip = await app.inject({
      method: 'PUT', url: `/v1/trips/${tripId}/context`, headers: { authorization: `Bearer ${token}` },
      payload: { patch: { notes: ['cloud'] }, expected_version: 0 }
    })
    expect(updatedTrip.json().trip_context).toMatchObject({ version: 1, notes: ['cloud'] })
    const staleTrip = await app.inject({
      method: 'PUT', url: `/v1/trips/${tripId}/context`, headers: { authorization: `Bearer ${token}` },
      payload: { patch: { notes: ['stale'] }, expected_version: 0 }
    })
    expect(staleTrip.statusCode).toBe(409)
    expect(staleTrip.json()).toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })

    const disabled = await app.inject({
      method: 'PATCH', url: '/v1/memory/settings', headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false, expected_version: 0 }
    })
    expect(disabled.json().memory).toMatchObject({ enabled: false, version: 1 })
    const editedWhileDisabled = await app.inject({
      method: 'PUT', url: '/v1/memory', headers: { authorization: `Bearer ${token}` },
      payload: { markdown: '# Explicit user edit', expected_version: 1 }
    })
    expect(editedWhileDisabled.json().memory).toMatchObject({ enabled: false, markdown: '# Explicit user edit', version: 2 })
    const stale = await app.inject({
      method: 'PUT', url: '/v1/memory', headers: { authorization: `Bearer ${token}` },
      payload: { markdown: 'stale', expected_version: 1 }
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ code: 'USER_MEMORY_VERSION_CONFLICT' })
    await app.close()
  })

  it('requires authentication for memory reads', async () => {
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => isAppError(error)
      ? reply.code(error.statusCode).send({ code: error.code })
      : reply.code(500).send({ code: 'INTERNAL_ERROR' }))
    await registerCloudStateRoutes(app, { env } as unknown as AppContext, () => {
      throw new Error('repository factory must not run without auth')
    })
    const response = await app.inject({ method: 'GET', url: '/v1/memory' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
    await app.close()
  })
})
