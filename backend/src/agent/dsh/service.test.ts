import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InMemoryTripRepository } from '../../trips/repository.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { CloudPlannerService } from '../cloud/service.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'

describe('DSH service with the official worker and loop', () => {
  it('answers two current questions, persists only real messages and keeps GET inert without legacy runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-service-'))
    const legacy = vi.spyOn(CloudPlannerService.prototype, 'runTurn').mockRejectedValue(new Error('legacy forbidden'))
    const runtime = vi.spyOn(AgentRuntime.prototype, 'run').mockRejectedValue(new Error('runtime forbidden'))
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' },
      fixture: [{ tool: 'get_trip_context' }, { text: 'Tokyo is your destination.' }, { text: 'It matches your cultural interests.' }] })
    try {
      const trips = new InMemoryTripRepository(), trip = await trips.create()
      const ownerId = 'owner-a', owned = new Set([trip.id])
      const conversations = new InMemoryConversationRepository(ownerId, owned), conversation = await conversations.create({ tripId: trip.id })
      const finalizer = vi.fn(() => { throw new Error('Unexpected finalizer') })
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions,
        artifacts: new InMemoryArtifactRepository(ownerId, owned), memory: new InMemoryUserMemoryRepository(),
        aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
        connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
        routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: finalizer })
      const input = { requestId: 'r1', generationId: 'g1', tripId: trip.id, conversationId: conversation.id, message: 'Where are we going?', locale: 'en' as const }
      await service.validateTurn(input)
      expect(await service.publicationContext(input)).toEqual({ tripContextVersion: 0, selectedFlightRevision: undefined })
      const first = await service.runTurn(input)
      expect(first.reply).toBe('Tokyo is your destination.')
      expect(first.delivery.status).toBe('not_requested')
      const second = await service.runTurn({ ...input, requestId: 'r2', generationId: 'g2', message: 'Why? Just explain.' })
      expect(second.reply).toBe('It matches your cultural interests.')
      expect(second.reply).not.toContain('saved')
      expect(await conversations.listMessages(conversation.id)).toHaveLength(4)
      await service.publicationContext(input)
      expect(legacy).not.toHaveBeenCalled(); expect(runtime).not.toHaveBeenCalled(); expect(finalizer).not.toHaveBeenCalled()
      await expect(service.validateTurn({ ...input, conversationId: trip.id })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    } finally { await sessions.close(); legacy.mockRestore(); runtime.mockRestore(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)
})
