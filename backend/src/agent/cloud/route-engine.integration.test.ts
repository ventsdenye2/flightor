import { describe, expect, it, vi } from 'vitest'
import type { AgentModelClient, ChatMessage } from '../runtime/model.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { createCoreToolRegistry } from '../tools/core.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import type { FareProvider } from '../../fares/providers/provider.js'
import { ProductionConnectionSearchService } from '../../flight-routing/connection-search.js'
import { ParetoRouteOptimizer } from '../../flight-routing/optimizer.js'
import { DeterministicFlightRoutePlanner } from '../../flight-routing/planner.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { MockTopologyRepository } from '../../topology/mock.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import { CloudPlannerService } from './service.js'

const verification = { status: 'verified' as const, checkedAt: '2026-09-07T00:00:00.000Z', confidence: 1, sources: [{ provider: 'golden-topology' }] }
const location = (iata: string, countryCode: string) => ({ id: `airport-${iata.toLowerCase()}`, type: 'airport' as const, name: iata, countryCode, iata })
const origin = location('PEK', 'CN')
const stopover = location('NRT', 'JP')
const destination = location('CDG', 'FR')
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

function lastArtifactId(messages: ChatMessage[]): string {
  const tool = [...messages].reverse().find(message => message.role === 'tool')
  if (!tool || tool.role !== 'tool') throw new Error('Expected a tool result')
  return JSON.parse(tool.content).data.artifact.id as string
}

describe('complete Core Tool registry with the production Phase 4 route engine', () => {
  it('keeps the generation-only tool chain compatible outside the restricted public Planner registry', async () => {
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ initialContext: {
      origin,
      departureWindow: { from: '2026-10-01', to: '2026-10-10', precision: 'approximate' },
      destinationIntent: { mode: 'mixed', required: [destination], preferred: [stopover], excluded: [] },
      transferPreferences: { acceptsSelfTransfer: false, acceptsLongStopover: true, acceptsAirportChange: false }
    } })
    const ownedTrips = new Set([trip.id])
    const conversations = new InMemoryConversationRepository('user-1', ownedTrips)
    const conversation = await conversations.create({ tripId: trip.id })
    const artifacts = new InMemoryArtifactRepository('user-1', ownedTrips)
    const topology = new MockTopologyRepository({
      snapshot: { id: 'topology-golden', coverage: 'complete', activatedAt: verification.checkedAt, verification },
      coverageStatus: 'reachable', warnings: [], truncated: false, exhausted: true,
      candidates: [{
        id: 'via-nrt', origin, destination,
        segments: [
          { id: 'pek-nrt', from: origin, to: stopover, durationMinutes: 210, verification },
          { id: 'nrt-cdg', from: stopover, to: destination, durationMinutes: 840, verification }
        ],
        transferMinutes: [720], transferType: 'protected', verification, warnings: []
      }]
    })
    const fares: FareProvider = {
      name: 'golden-fares',
      async searchFlights(input) {
        return {
          query: input,
          offers: [{
            id: `${input.origin}-${input.destination}`,
            segments: [{ flightNumber: 'MOCK1', airline: 'Mock Air', origin: input.origin, destination: input.destination, departsAt: `${input.departureDate}T08:00:00Z`, arrivesAt: `${input.departureDate}T12:00:00Z`, durationMinutes: 240 }],
            totalAmount: 500, currency: input.currency, totalDurationMinutes: 240,
            airlines: ['Mock Air'], transferType: 'direct'
          }],
          provider: 'golden-fares', checkedAt: verification.checkedAt, verification
        }
      },
      async searchFlexibleFlights() { return { results: [], scannedDates: [], failedDates: [] } },
      async refreshFlight() { throw new Error('not used') }
    }
    const model: AgentModelClient = { complete: vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('context', 'get_trip_context', {})] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('connections', 'search_connection_flights', { origin, destination, window: { from: '2026-10-01', to: '2026-10-10' } })] } })
      .mockImplementationOnce(async messages => ({ message: { role: 'assistant', content: null, tool_calls: [call('plan', 'plan_flight_route', {
        candidateArtifactId: lastArtifactId(messages),
        nodes: [{ location: origin, role: 'origin' }, { location: stopover, role: 'visit' }, { location: destination, role: 'destination' }],
        window: { from: '2026-10-01', to: '2026-10-10' }
      })] } }))
      .mockImplementationOnce(async messages => ({ message: { role: 'assistant', content: null, tool_calls: [call('optimize', 'optimize_route', {
        pathArtifactId: lastArtifactId(messages), weights: { preferredCityMatch: 2, airfareSaving: 1 }
      })] } }))
      .mockResolvedValueOnce({ message: { role: 'assistant', content: '已生成一条经东京的可验证路线。' } }) }
    const service = new CloudPlannerService({
      trips, conversations, artifacts, memory: new InMemoryUserMemoryRepository(),
      runtime: new AgentRuntime(model, createCoreToolRegistry()),
      aviation: new MockAviationProvider(), fares, research: new UnavailableResearchAgent(),
      connectionSearch: new ProductionConnectionSearchService(topology, fares),
      flightRoutePlanner: new DeterministicFlightRoutePlanner(), routeOptimizer: new ParetoRouteOptimizer()
    })

    const result = await service.runTurn({
      requestId: 'request-1', tripId: trip.id, conversationId: conversation.id,
      generationId: 'generation-1', message: '生成一条经东京去巴黎的路线'
    })

    expect(result.reply).toContain('东京')
    expect(result.artifactRefs).toHaveLength(3)
    const records = await Promise.all(result.artifactRefs.map(ref => artifacts.get(ref.id)))
    expect(records.map(record => (record?.payload as { kind?: string }).kind)).toEqual(['connection_edges', 'flight_paths', 'optimized_routes'])
    expect((records[1]?.payload as { paths: Array<{ nodes: unknown[] }> }).paths[0]?.nodes).toHaveLength(3)
    expect((records[2]?.payload as { representatives: Array<{ badges: string[] }> }).representatives[0]?.badges.length).toBeGreaterThan(0)
    expect((await conversations.listMessages(conversation.id)).map(message => message.role)).toEqual(['user', 'assistant'])
  })
})
