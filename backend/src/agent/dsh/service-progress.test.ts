import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AirportLookupInput } from '../../aviation/providers/provider.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import type { AgentActivity } from '../runtime/activity.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'

const origin = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', iata: 'PVG' }
const destination = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita', countryCode: 'JP', iata: 'NRT' }
class Aviation extends MockAviationProvider {
  override async getAirport(input: AirportLookupInput) {
    return input.iata === 'PVG' ? origin : input.iata === 'NRT' ? destination : undefined
  }
}

describe('DSH committed-result progress', () => {
  it('keeps a read as a reference and emits exactly one event for a later real workspace commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-progress-'))
    const ownerId = 'progress-owner', trips = new InMemoryTripRepository(), trip = await trips.create()
    const owned = new Set([trip.id]), artifacts = new InMemoryArtifactRepository(ownerId, owned)
    const conversations = new InMemoryConversationRepository(ownerId, owned), conversation = await conversations.create({ tripId: trip.id })
    const base = await artifacts.create({ tripId: trip.id, conversationId: conversation.id, tripContextVersion: 0,
      type: 'flight_search', schemaVersion: 1, payload: { notice: 'Previously saved quote.' } })
    const query = { origin: 'PVG', destination: 'NRT', departureDate: '2026-11-03', currency: 'CNY' as const, travelClass: 1 }
    const checkedAt = '2026-10-06T00:00:00.000Z'
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { tool: 'read_artifact', args: { artifactId: base.id } }, { text: 'This is your previously saved quote.' },
      { tool: 'read_artifact', args: { artifactId: base.id } },
      { tool: 'search_flights', args: { ...query, intent: { kind: 'flight_search', parameters: { requestKey: 'new-quote', departureDate: query.departureDate } } } },
      { text: 'Your new flight search is saved.' }
    ] })
    const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
    const service = new DshPlannerService({ ownerId, trips, conversations, artifacts, sessions,
      memory: new InMemoryUserMemoryRepository(), aviation: new Aviation(),
      fares: new MockFareProvider({ search: { query, provider: 'mock-fares', checkedAt,
        verification: { status: 'verified', checkedAt, confidence: 1, sources: [{ provider: 'mock-fares', reference: 'fixture' }] },
        offers: [{ id: 'offer-1', segments: [{ flightNumber: 'FM1', airline: 'Mock Air', origin: 'PVG', destination: 'NRT',
          departsAt: '2026-11-03T08:00:00Z', arrivesAt: '2026-11-03T12:00:00Z', durationMinutes: 240 }],
          totalAmount: 1200, currency: 'CNY', totalDurationMinutes: 240, airlines: ['Mock Air'], transferType: 'direct' }] } }),
      research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
      flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(),
      goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry() })
    const activities: AgentActivity[] = [], input = { requestId: 'read', generationId: 'read-generation',
      tripId: trip.id, conversationId: conversation.id, message: 'Explain the saved flight quote only.', locale: 'en' as const,
      onActivity: (activity: AgentActivity) => activities.push(activity) }
    try {
      const read = await service.runTurn(input)
      expect(read.delivery.status).toBe('not_requested')
      expect(read.artifactRefs.map(ref => ref.id)).toEqual([base.id])
      expect(activities.filter(activity => activity.type === 'artifact_committed')).toEqual([])
      expect(await goals.listForTrip(trip.id)).toEqual([])
      expect(await artifacts.listForTrip(trip.id, 20)).toHaveLength(1)
      expect(await trips.get(trip.id)).toEqual(trip.context)
      activities.length = 0
      const saved = await service.runTurn({ ...input, requestId: 'search', generationId: 'search-generation', message: 'Search new flights.' })
      const committed = activities.filter(activity => activity.type === 'artifact_committed')
      expect(committed).toHaveLength(1)
      expect(committed[0]).toMatchObject({ artifact: { type: 'flight_search' }, generationId: 'search-generation' })
      expect((committed[0] as Extract<AgentActivity, { type: 'artifact_committed' }>).artifact.id).not.toBe(base.id)
      expect(saved.artifactRefs).toHaveLength(2)
      expect(await artifacts.listForTrip(trip.id, 20)).toHaveLength(2)
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)
})
