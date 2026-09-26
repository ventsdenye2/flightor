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
import { DshPlannerService, dshGoalRequestId } from './service.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { emptyTripContext } from '../../trips/types.js'

describe('DSH durable Goal request identity', () => {
  it('replays one running generation despite a changed transport ID and rejects changed accepted constraints', async () => {
    const scope = { ownerId: 'owner', tripId: 'trip', conversationId: '019543fa-6698-71ca-9f76-7f8fd5d92331', generationId: 'generation' }
    const goals = new InMemoryGoalRepository(scope.ownerId), runs = new InMemoryGoalRunRepository(scope.ownerId, goals)
    const transportA = { ...scope, requestId: 'req-i' }, transportB = { ...scope, requestId: 'new-http-id' }
    const input = { tripId: scope.tripId, conversationId: scope.conversationId, generationId: scope.generationId,
      requestId: dshGoalRequestId(transportA), contextSnapshot: emptyTripContext(scope.tripId),
      intent: { kind: 'trip_context_update' as const, parameters: { fields: ['budget' as const] } } }
    const first = await runs.accept(input)
    expect(await runs.accept({ ...input, requestId: dshGoalRequestId(transportB) })).toEqual(first)
    expect(await goals.listForTrip(scope.tripId)).toHaveLength(1)
    await expect(runs.accept({ ...input, intent: { kind: 'trip_context_update', parameters: { fields: ['notes'] } } }))
      .rejects.toMatchObject({ code: 'GOAL_IDEMPOTENCY_CONFLICT' })
  })

  it('separates every durable identity scope and distinct generations sharing one HTTP request ID', () => {
    const scope = { ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation', requestId: 'req-i' }
    const original = dshGoalRequestId(scope)
    expect(original.length).toBeLessThan(200)
    for (const field of ['ownerId', 'tripId', 'conversationId', 'generationId'] as const) {
      expect(dshGoalRequestId({ ...scope, [field]: `${scope[field]}-other` })).not.toBe(original)
    }
    expect(dshGoalRequestId({ ...scope, requestId: 'unrelated-http-id' })).toBe(original)
  })
})

describe('DSH service with the official worker and loop', () => {
  it('includes same-conversation assistant context in a cold snapshot with long-term memory disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-cold-history-'))
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' },
      fixture: [{ text: 'South Korea is the second country you asked about.' }] })
    const sessionRun = vi.spyOn(sessions, 'run')
    try {
      const trips = new InMemoryTripRepository(), trip = await trips.create(), unrelatedTrip = await trips.create()
      const ownerId = 'cold-history-owner', owned = new Set([trip.id, unrelatedTrip.id])
      const conversations = new InMemoryConversationRepository(ownerId, owned)
      const conversation = await conversations.create({ tripId: trip.id })
      const unrelatedConversation = await conversations.create({ tripId: unrelatedTrip.id })
      await conversations.appendMessage({ conversationId: conversation.id, role: 'user', content: 'Suggest another country after Japan.' })
      await conversations.appendMessage({ conversationId: conversation.id, role: 'assistant', content: 'South Korea could be a good second country.' })
      await conversations.appendMessage({ conversationId: unrelatedConversation.id, role: 'assistant', content: 'Unrelated destination: Arkania.' })
      const memory = new InMemoryUserMemoryRepository({ enabled: false, markdown: 'Long-term memory sentinel: Arkania.' })
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions,
        artifacts: new InMemoryArtifactRepository(ownerId, owned), memory,
        aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
        connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
        routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: vi.fn(() => { throw new Error('Unexpected finalizer') }) })

      const result = await service.runTurn({ requestId: 'cold-1', generationId: 'cold-generation', tripId: trip.id,
        conversationId: conversation.id, message: 'Tell me more about the second country.', locale: 'en' })
      const snapshot = JSON.parse(sessionRun.mock.calls[0]![0].snapshot)
      expect(result.reply).toContain('South Korea')
      expect(snapshot.memory).toBeNull()
      expect(snapshot.publicHistory).toEqual([
        { role: 'user', content: 'Suggest another country after Japan.' },
        { role: 'assistant', content: 'South Korea could be a good second country.' },
      ])
      expect(JSON.stringify(snapshot)).not.toContain('Arkania')
      expect(sessionRun.mock.calls[0]![0].persona).toContain('Exploratory country or place recommendations and clarifying questions are dialogue only')
      expect(sessionRun.mock.calls[0]![0].persona).toContain('a recommendation in conversation is not a Trip update or destination confirmation')
      expect(sessionRun.mock.calls[0]![0].persona).toContain('When the user explicitly asks to create or edit a guide')
      expect(sessionRun.mock.calls[0]![0].persona).toContain('Requested country/place recommendation research may use web_search/web_fetch but remains dialogue')
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)

  it('persists two independent objectives when Fastify request IDs repeat across generations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-request-id-'))
    const budget = (amount: number) => ({ tool: 'update_trip_context', args: { patch: { budget: { amount, currency: 'CNY', scope: 'trip' } },
      intent: { kind: 'trip_context_update', parameters: { fields: ['budget'] } } } })
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      budget(1200), { text: '预算目标已保存。' }, budget(1300), { text: '新的预算目标已保存。' }
    ] })
    const trips = new InMemoryTripRepository(), trip = await trips.create()
    const ownerId = 'durable-identity-owner', owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned), conversation = await conversations.create({ tripId: trip.id })
    const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
    const service = new DshPlannerService({ ownerId, trips, conversations, sessions,
      artifacts: new InMemoryArtifactRepository(ownerId, owned), memory: new InMemoryUserMemoryRepository(),
      aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
      connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
      routeOptimizer: new UnavailableRouteOptimizer(), goalRepository: goals, goalRunRepository: runs,
      goalVerifiers: createDefaultGoalVerifierRegistry(), createFinalizer: vi.fn(() => { throw new Error('Unexpected finalizer') }) })
    try {
      const input = { tripId: trip.id, conversationId: conversation.id, requestId: 'req-i', locale: 'zh' as const }
      const first = await service.runTurn({ ...input, generationId: 'generation-before-restart', message: '预算目标改成1200元。' })
      const second = await service.runTurn({ ...input, generationId: 'generation-after-restart', message: '预算目标改成1300元。' })
      expect(first.delivery.status).toBe('satisfied')
      expect(second.delivery.status).toBe('satisfied')
      expect(second.delivery.goalId).not.toBe(first.delivery.goalId)
      expect(await goals.listForTrip(trip.id)).toHaveLength(2)
      expect(await trips.get(trip.id)).toMatchObject({ budget: { amount: 1300, scope: 'trip' }, version: 2 })
      const metadata = (await conversations.listMessages(conversation.id)).map(message => message.metadata)
      expect(metadata.every(value => value.request_id === 'req-i')).toBe(true)
      expect(new Set(metadata.map(value => value.generation_id)).size).toBe(2)
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)
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
    const sessionRun = vi.spyOn(sessions, 'run')
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
      const request = sessionRun.mock.calls[0]![0]
      const commit = request.tools.find(tool => tool.name === 'commit_travel_guide')!
      expect(commit.rawSchema.anyOf).toEqual([{ required: ['intent'] }, { required: ['goalRef'] }])
      expect(commit.description).toContain('EVERY complete submission')
      expect(request.tools.find(tool => tool.name === 'get_trip_context')!.rawSchema).not.toHaveProperty('anyOf')
      const snapshot = JSON.parse(request.snapshot)
      expect(Object.keys(snapshot).at(-1)).toBe('turnState')
      expect(snapshot.turnState).toMatchObject({ generationId: 'g1', acceptedGoal: null, currentEvidenceRefs: [] })
      expect(snapshot.turnState.instruction).toContain('Old raw evidenceRefs are invalid')
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
