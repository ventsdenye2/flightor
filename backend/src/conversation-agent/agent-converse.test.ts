import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { AppContext } from '../app/context.js'
import { registerAgentConverseRoutes } from '../routes/agent-converse.js'

describe('agent converse route', () => {
  it('does not call the provider when the API key is absent', async () => {
    let called = false
    const app = Fastify()
    const context = {
      env: { OPENROUTER_API_KEY: '' },
      providers: {
        openrouter: {
          chat: async () => {
            called = true
            throw new Error('provider must not be called')
          }
        }
      }
    } as unknown as AppContext
    await registerAgentConverseRoutes(app, context)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/converse',
      payload: {
        today: '2026-09-03',
        messages: [{ role: 'user', content: '北京出发，先日本再欧洲，7天，预算2万，文化，欧洲知名城市' }]
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(called).toBe(false)
    await app.close()
  })
})
