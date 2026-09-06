import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import type { ProviderCallOptions, ResolveLocationInput } from '../../aviation/providers/provider.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import type { AgentModelClient } from '../runtime/model.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { createCoreToolRegistry } from '../tools/core.js'
import { CloudPlannerService } from './service.js'

const call = (id: string, name: string, args: unknown) => ({
  id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) }
})

describe('CloudPlannerService vertical slice', () => {
  it('uses cloud-shaped state, persists a fare artifact, and records the conversation without OAG', async () => {
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ title: 'Tokyo' })
    const ownedTrips = new Set([trip.id])
    const conversations = new InMemoryConversationRepository('user-a', ownedTrips)
    const conversation = await conversations.create({ tripId: trip.id })
    const artifacts = new InMemoryArtifactRepository('user-a', ownedTrips)
    const memory = new InMemoryUserMemoryRepository({ markdown: '- Prefers aisle seats' })
    const shanghai = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', iata: 'PVG', cityCode: 'SHA' }
    const tokyo = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita International', countryCode: 'JP', iata: 'NRT', cityCode: 'TYO' }
    class Aviation extends MockAviationProvider {
      override async resolveLocation(input: ResolveLocationInput, _options?: ProviderCallOptions) {
        return { matches: [input.query === 'Tokyo' ? tokyo : shanghai], verification: { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-aviation' }] } }
      }
    }
    const fares = new MockFareProvider({ search: {
      query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-01', currency: 'CNY', travelClass: 1 },
      offers: [{ id: 'offer-1', segments: [{ flightNumber: 'MO1', airline: 'Mock Air', origin: 'PVG', destination: 'NRT', departsAt: '2026-10-01T01:00:00Z', arrivesAt: '2026-10-01T05:00:00Z', durationMinutes: 240 }], totalAmount: 1200, currency: 'CNY', totalDurationMinutes: 240, airlines: ['Mock Air'], transferType: 'direct' }],
      provider: 'mock-fares', checkedAt: '2026-09-06T00:00:00.000Z',
      verification: { status: 'verified', checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-fares' }] }
    } })
    const model: AgentModelClient = { complete: vi.fn()
      .mockImplementationOnce(async messages => {
        expect(messages[0]?.content).toContain('Prefers aisle seats')
        return { message: { role: 'assistant', content: null, tool_calls: [
          call('loc-1', 'resolve_location', { query: 'Shanghai' }),
          call('loc-2', 'resolve_location', { query: 'Tokyo' })
        ] } }
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [
        call('trip-1', 'update_trip_context', { expectedVersion: 0, patch: { origin: shanghai, destinationIntent: { mode: 'explicit', required: [tokyo], preferred: [], excluded: [] } } }),
        call('fare-1', 'search_flights', { origin: shanghai, destination: tokyo, departureDate: '2026-10-01' })
      ] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: '已找到一个经过验证的航班选项。' } }) }
    const runtime = new AgentRuntime(model, createCoreToolRegistry())
    const service = new CloudPlannerService({ trips, conversations, artifacts, memory, runtime, aviation: new Aviation(), fares })

    const result = await service.runTurn({
      requestId: 'req-1', tripId: trip.id, conversationId: conversation.id,
      generationId: 'gen-1', message: '帮我找上海到东京的航班'
    })

    expect(result).toMatchObject({ reply: '已找到一个经过验证的航班选项。', tripVersion: 1, stopReason: 'completed' })
    expect(result.artifactRefs).toHaveLength(1)
    const artifact = await artifacts.get(result.artifactRefs[0]!)
    expect(artifact).toMatchObject({ type: 'flight_search', schemaVersion: 1 })
    expect(artifact?.payload).toMatchObject({ id: result.artifactRefs[0], query: { origin: 'PVG', destination: 'NRT' } })
    const messages = await conversations.listMessages(conversation.id)
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1]?.metadata.artifact_refs).toEqual(result.artifactRefs)
  })
})
