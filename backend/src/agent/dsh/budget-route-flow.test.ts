import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { DeterministicFlightRoutePlanner } from '../../flight-routing/planner.js'
import { ParetoRouteOptimizer } from '../../flight-routing/optimizer.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { InMemoryRouteGenerationRunRepository } from '../../route-generation/repository.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'

const origin = { id: 'airport-pek', type: 'airport' as const, name: 'Beijing', countryCode: 'CN', iata: 'PEK' }
const destination = { id: 'airport-cdg', type: 'airport' as const, name: 'Paris', countryCode: 'FR', iata: 'CDG' }
const checkedAt = '2026-09-27T00:00:00.000Z'
const verification = { status: 'verified' as const, checkedAt, confidence: 1, sources: [{ provider: 'fixture-fare' }] }

describe('DSH budget route public flow through the official worker', () => {
  it.each(['zh', 'en'] as const)('publishes a controlled %s reply after durable route Goal success', async locale => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-route-flow-'))
    const ownerId = 'route-flow-owner'
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ initialContext: { origin, departureWindow: { from: '2026-10-01', precision: 'approximate' },
      destinationIntent: { mode: 'explicit', required: [destination], preferred: [], excluded: [] } } })
    const owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned)
    const conversation = await conversations.create({ tripId: trip.id })
    const artifacts = new InMemoryArtifactRepository(ownerId, owned)
    const goals = new InMemoryGoalRepository(ownerId)
    const goalRuns = new InMemoryGoalRunRepository(ownerId, goals)
    const fareArtifactId = randomUUID()
    await artifacts.create({ id: fareArtifactId, tripId: trip.id, conversationId: conversation.id,
      tripContextVersion: trip.context.version, type: 'flight_search', schemaVersion: 1,
      payload: { id: fareArtifactId, type: 'flight_search', query: { origin: 'PEK', destination: 'CDG',
        departureDate: '2026-10-01', currency: 'CNY', travelClass: 1 }, offers: [{ id: 'fare-offer',
        segments: [{ flightNumber: 'FX1', airline: 'Fixture Air', origin: 'PEK', destination: 'CDG',
          departsAt: '2026-10-01T08:00:00Z', arrivesAt: '2026-10-01T12:00:00Z', durationMinutes: 240 }],
        totalAmount: 900, currency: 'CNY', airlines: ['Fixture Air'], transferType: 'direct' }],
        provider: 'fixture-fare', checkedAt, verification } })
    const connectionSearch = { search: async () => ({ edges: [{ id: 'direct-quote', from: origin, to: destination,
      departureDate: '2026-10-01', transferType: 'direct' as const, availability: 'verified' as const,
      fare: { amount: 900, currency: 'CNY' }, fareArtifactId, fareOfferId: 'fare-offer',
      durationMinutes: 240, departureAt: '2026-10-01T08:00:00Z', arrivalAt: '2026-10-01T12:00:00Z',
      verification, warnings: [], reasons: ['fixture quote'] }], serviceVersion: 'fixture', verification,
      warnings: [], truncated: false, exhausted: true }) }
    const flightRoutePlanner = new DeterministicFlightRoutePlanner()
    const routeOptimizer = new ParetoRouteOptimizer()
    const routeGeneration = { runs: new InMemoryRouteGenerationRunRepository(ownerId, owned), goals, goalRuns,
      goalVerifiers: createDefaultGoalVerifierRegistry(), trips, artifacts, connectionSearch, flightRoutePlanner, routeOptimizer }
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { tool: 'search_budget_routes', args: {} },
      { text: locale === 'zh' ? '全网最低票价是900元，我保证行李和中转。' : 'The global lowest fare is CNY 900 and all transfers are protected.' }
    ] })
    const service = new DshPlannerService({ ownerId, trips, conversations, artifacts, sessions,
      memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
      research: new UnavailableResearchAgent(), connectionSearch, flightRoutePlanner, routeOptimizer,
      routeGeneration, goalRepository: goals, goalRunRepository: goalRuns, goalVerifiers: createDefaultGoalVerifierRegistry(),
      createFinalizer: () => { throw new Error('Legacy finalizer called') } })
    try {
      const result = await service.runTurn({ requestId: randomUUID(), generationId: randomUUID(), tripId: trip.id,
        conversationId: conversation.id, locale, message: 'Find the cheapest route in my saved flight search scope.' })
      expect(result.delivery.status).toBe('satisfied')
      expect(result.artifactRefs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'route_set' })]))
      expect(result.warnings).not.toContain('dsh_reply_withheld')
      expect(result.reply).toContain('CNY 900.00')
      expect(result.reply).not.toContain(locale === 'zh' ? '全网最低票价是' : 'global lowest fare')
      expect(result.reply).toContain(locale === 'zh' ? '明确采用航班' : 'explicitly select a flight')
      const messagesBeforeRead = await conversations.listMessages(conversation.id)
      const routesBeforeRead = (await artifacts.listForTrip(trip.id)).filter(record => record.type === 'route_set')
      const context = await service.publicationContext({ tripId: trip.id, conversationId: conversation.id })
      const recovered = await artifacts.get(result.artifactRefs.find(ref => ref.type === 'route_set')!.id)
      expect(context.tripContextVersion).toBe(trip.context.version)
      expect(recovered?.type).toBe('route_set')
      expect((await conversations.listMessages(conversation.id))).toEqual(messagesBeforeRead)
      expect((await artifacts.listForTrip(trip.id)).filter(record => record.type === 'route_set')).toEqual(routesBeforeRead)
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)
})
