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
  it('withholds unsafe free replies before persistence without another model call or domain write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-reply-'))
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { text: 'DEBUG: artifactId 019543fa-6698-71ca-9f76-7f8fd5d92331. Admission costs USD 50.' },
      { text: 'This is an English answer in the wrong locale.' },
      { text: '哪一天？' },
    ] })
    const trips = new InMemoryTripRepository(), trip = await trips.create()
    const ownerId = 'reply-owner', owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned), conversation = await conversations.create({ tripId: trip.id })
    const artifacts = new InMemoryArtifactRepository(ownerId, owned)
    const finalizer = vi.fn(() => { throw new Error('Unexpected finalizer') })
    const service = new DshPlannerService({ ownerId, trips, conversations, sessions, artifacts,
      memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
      research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
      flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: finalizer })
    try {
      const input = { requestId: 'r1', generationId: 'g1', tripId: trip.id, conversationId: conversation.id, message: 'Why this morning?', locale: 'en' as const }
      const first = await service.runTurn(input)
      expect(first.reply).toBe('I could not provide a suitable explanation this time. Please rephrase your question.')
      expect(first.warnings).toContain('dsh_reply_withheld')
      expect(first.delivery.status).toBe('not_requested')
      const second = await service.runTurn({ ...input, requestId: 'r2', generationId: 'g2', locale: 'zh', message: '请用中文解释。' })
      expect(second.reply).toBe('这次未能给出合适的说明，请换一种方式描述你想了解的问题。')
      expect(second.warnings).toContain('dsh_reply_withheld')
      const third = await service.runTurn({ ...input, requestId: 'r3', generationId: 'g3', locale: 'zh', message: '我想换一天。' })
      expect(third.reply).toBe('哪一天？')
      expect(third.warnings).toEqual([])
      const replies = (await conversations.listMessages(conversation.id)).filter(message => message.role === 'assistant')
      expect(replies.map(message => message.content)).toEqual([first.reply, second.reply, third.reply])
      expect(replies.every(message => message.metadata.model_calls === 1)).toBe(true)
      expect(replies[0]!.metadata.warnings).toEqual(['dsh_reply_withheld'])
      expect(await artifacts.listForTrip(trip.id)).toEqual([])
      expect((await trips.get(trip.id))!.version).toBe(0)
      expect(finalizer).not.toHaveBeenCalled()
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)

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
