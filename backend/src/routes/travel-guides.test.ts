import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../app/context.js'
import { registerTravelGuideRoutes } from './travel-guides.js'

const route = {
  kind: 'cheapest' as const,
  route: {
    cities: ['NRT'],
    citySeq: ['PEK', 'NRT', 'PEK'],
    legs: [{
      from: 'PEK',
      to: 'NRT',
      date: '2026-10-01',
      departTime: '10:00',
      arriveTime: '14:00',
      crossDay: false,
      duration: 240,
      price: 1_000,
      airline: 'TEST'
    }, {
      from: 'NRT',
      to: 'PEK',
      date: '2026-10-05',
      departTime: '10:00',
      arriveTime: '14:00',
      crossDay: false,
      duration: 240,
      price: 1_000,
      airline: 'TEST'
    }],
    totalPrice: 2_000,
    effCost: 2_000,
    nightsSaved: 0,
    hasReal: false
  }
}

describe('travel guide route', () => {
  it('rejects arbitrary query and URL fields before the provider is reached', async () => {
    const searchTravelGuide = vi.fn(async () => [])
    const app = Fastify()
    const context = {
      env: { OPENROUTER_API_KEY: '' },
      providers: { serpapi: { searchTravelGuide }, openrouter: {} },
      redis: { get: async () => null, set: async () => undefined }
    } as unknown as AppContext
    app.setErrorHandler((_error, _request, reply) => reply.code(400).send({ error: 'invalid request' }))
    await registerTravelGuideRoutes(app, context)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/travel-guides',
      payload: { route, query: 'site:evil.example', url: 'https://evil.example' }
    })
    expect(response.statusCode).toBe(400)
    expect(searchTravelGuide).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns a cache-disabled guide response for a valid route', async () => {
    const app = Fastify()
    const searchTravelGuide = vi.fn(async () => [])
    const context = {
      env: { OPENROUTER_API_KEY: '' },
      providers: {
        serpapi: { searchTravelGuide },
        openrouter: {}
      },
      redis: { get: async () => null, set: async () => undefined }
    } as unknown as AppContext
    await registerTravelGuideRoutes(app, context)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/travel-guides',
      payload: { route, travel_days: 5, interests: ['culture'] }
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ travelGuide: { source: 'catalog' } })
    expect(searchTravelGuide).not.toHaveBeenCalled()
    await app.close()
  })
})
