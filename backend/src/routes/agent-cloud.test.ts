import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../app/context.js'
import { CloudPlannerService } from '../agent/cloud/service.js'
import type { AgentModelClient } from '../agent/runtime/model.js'
import { AgentRuntime } from '../agent/runtime/runtime.js'
import { createCoreToolRegistry } from '../agent/tools/core.js'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { MockAviationProvider } from '../aviation/providers/mock.js'
import type { ProviderCallOptions, ResolveLocationInput } from '../aviation/providers/provider.js'
import { issueAccessToken } from '../auth/tokens.js'
import { parseEnv } from '../config/env.js'
import { InMemoryConversationRepository } from '../conversations/repository.js'
import { MockFareProvider } from '../fares/providers/mock.js'
import { InMemoryUserMemoryRepository } from '../memory/repository.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import { registerCloudAgentRoutes } from './agent-cloud.js'

const env = parseEnv({
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test', REDIS_URL: 'redis://test',
  JWT_SECRET: 'authenticated-cloud-agent-test-secret-32-chars'
})
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

describe('authenticated cloud Agent route', () => {
  it('runs cloud Trip, location, fare, Artifact, Memory, and Conversation without OAG', async () => {
    const trips = new InMemoryTripRepository()
    const trip = await trips.create()
    const ownedTrips = new Set([trip.id])
    const conversations = new InMemoryConversationRepository('internal-7', ownedTrips)
    const conversation = await conversations.create({ tripId: trip.id })
    const artifacts = new InMemoryArtifactRepository('internal-7', ownedTrips)
    const memory = new InMemoryUserMemoryRepository({ markdown: '- Avoid red-eye flights' })
    const origin = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', iata: 'PVG' }
    const destination = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita', countryCode: 'JP', iata: 'NRT' }
    class Aviation extends MockAviationProvider {
      override async resolveLocation(input: ResolveLocationInput, _options?: ProviderCallOptions) {
        return { matches: [input.query === 'Tokyo' ? destination : origin], verification: { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock' }] } }
      }
    }
    const fares = new MockFareProvider({ search: {
      query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-01', currency: 'CNY', travelClass: 1 }, offers: [],
      provider: 'mock-fares', checkedAt: '2026-09-06T00:00:00.000Z',
      verification: { status: 'verified', checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-fares' }] }
    } })
    const model: AgentModelClient = { complete: vi.fn()
      .mockImplementationOnce(async messages => {
        expect(messages[0]?.content).toContain('Avoid red-eye flights')
        return { message: { role: 'assistant', content: null, tool_calls: [call('o', 'resolve_location', { query: 'Shanghai' }), call('d', 'resolve_location', { query: 'Tokyo' })] } }
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [
        call('u', 'update_trip_context', { expectedVersion: 0, patch: { origin, destinationIntent: { mode: 'explicit', required: [destination], preferred: [], excluded: [] } } }),
        call('f', 'search_flights', { origin, destination, departureDate: '2026-10-01' })
      ] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: '完成。' } }) }
    const service = new CloudPlannerService({
      trips, conversations, artifacts, memory,
      runtime: new AgentRuntime(model, createCoreToolRegistry()), aviation: new Aviation(), fares
    })
    const owners: string[] = []
    const app = Fastify()
    await registerCloudAgentRoutes(app, { env } as unknown as AppContext, userId => { owners.push(userId); return service })
    const token = await issueAccessToken({ userId: 'internal-7', publicId: 'public-7' }, env)
    const response = await app.inject({
      method: 'POST', url: '/v1/agent-v2/converse', headers: { authorization: `Bearer ${token}` },
      payload: { trip_id: trip.id, conversation_id: conversation.id, message: '上海到东京' }
    })

    expect(response.statusCode).toBe(200)
    expect(owners).toEqual(['internal-7'])
    expect(response.json()).toMatchObject({ reply: '完成。', trip_version: 1, stop_reason: 'completed' })
    expect(response.json().artifact_refs).toHaveLength(1)
    expect(await artifacts.get(response.json().artifact_refs[0])).toMatchObject({ type: 'flight_search', schemaVersion: 1 })
    expect((await conversations.listMessages(conversation.id)).map(message => message.role)).toEqual(['user', 'assistant'])
    await app.close()
  })
})
