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
import { publicFailureReply } from './public-errors.js'

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
  it.each(['completed', 'output_limit'] as const)('keeps the publication cause at repair exhaustion, with %s worker result', async workerResult => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-publication-limit-'))
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [{ text: 'Unused fixture' }] })
    const receipts: any[] = []
    vi.spyOn(sessions, 'run').mockImplementation(async request => {
      await request.onAdmitted!()
      const signal = new AbortController().signal
      const source = await request.execute('__record_web', { tool: 'web_search', args: {}, value: {
        sources: [{ url: 'https://www.gotokyo.org/en/spot/15/index.html', title: 'Temple culture',
          snippet: 'Explore the temple grounds, traditional architecture and the historic neighborhood culture.' }]
      } }, 'source', signal) as { evidenceRefs: string[] }
      const input = { intent: { kind: 'travel_guide', parameters: { questions: ['Culture'], researchTypes: ['activity'],
        requiredEvidenceTypes: ['activity'], maxResults: 1, maxCities: 1, allowPartial: true } },
        candidates: [{ key: 'temple', sourceRefs: source.evidenceRefs, title: 'Tokyo temple',
          summary: 'Explore the temple grounds and traditional architecture.', category: 'activity' }],
        days: [{ day: 1, kind: 'visit', theme: 'Temple culture', items: [{ candidateKey: 'temple', timeOfDay: 'afternoon',
          planningNote: 'Explore temple culture.', text: { name: 'Temple visit',
            introduction: 'Explore the temple grounds and traditional architecture.',
            recommendationReason: 'The visit matches your interest in traditional culture.' } }] }],
        text: { reply: 'Explore the Tokyo temple and its neighborhood culture.',
          overview: 'The walk takes 15 minutes through the historic neighborhood.', days: [{ day: 1, theme: 'Temple culture' }] } }
      receipts.push(await request.execute('commit_travel_guide', input, 'commit-1', signal))
      const { intent: _intent, candidates: _candidates, ...repair } = input
      receipts.push(await request.execute('commit_travel_guide', repair, 'commit-2', signal))
      receipts.push(await request.execute('commit_travel_guide', repair, 'commit-3', signal))
      return { reply: 'PRIVATE_RAW_REPLY', reason: workerResult === 'completed' ? 'completed' : 'error',
        ...(workerResult === 'output_limit' ? { errorCode: 'MODEL_OUTPUT_LIMIT' } : {}), calls: 4, resumed: false, cancelled: false }
    })
    try {
      const trips = new InMemoryTripRepository(), trip = await trips.create({ initialContext: {
        travelDays: 1, departureWindow: { from: '2026-11-03', to: '2026-11-03', precision: 'exact' },
        destinationIntent: { mode: 'explicit', required: [{ id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }], preferred: [], excluded: [] }
      } })
      const ownerId = 'publication-limit-owner', owned = new Set([trip.id])
      const conversations = new InMemoryConversationRepository(ownerId, owned), conversation = await conversations.create({ tripId: trip.id })
      const artifacts = new InMemoryArtifactRepository(ownerId, owned)
      const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions, artifacts,
        goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
        memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
        web: { provider: 'deepseek-official', serpapi: { searchOrganic: vi.fn(() => { throw Error('Unexpected outgoing request') }) } },
        research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
        flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(),
        createFinalizer: vi.fn(() => { throw Error('Unexpected finalizer') }) })
      const result = await service.runTurn({ requestId: 'publication-limit', generationId: 'publication-limit-generation',
        tripId: trip.id, conversationId: conversation.id, message: 'Plan a cultural day in Tokyo.', locale: 'en' })
      expect(receipts.slice(0, 2).map(receipt => receipt.error.publicationIssues)).toEqual([
        [{ code: 'format' }], [{ code: 'format' }]
      ])
      expect(receipts[2]).toMatchObject({ ok: false, error: { code: 'DSH_REPAIR_LIMIT', recovery: {
        calls: 2, contentAttempts: 2, lastFailure: 'content' } } })
      expect(result.reply).toBe(publicFailureReply(workerResult === 'completed' ? 'publication' : 'output_limit', 'en'))
      expect(result.delivery).toMatchObject({ status: 'partial', artifactIds: [], missing: ['accepted_publication'] })
      const assistant = (await conversations.listMessages(conversation.id)).at(-1)!
      expect(assistant.metadata.commit_recovery).toMatchObject({ calls: 2, contentAttempts: 2, lastFailure: 'content' })
      expect(result.reply).not.toContain('PRIVATE_')
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('shows the Trip location preparation failure without inventing a Goal or adopting the model day city', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-location-preparation-'))
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { tool: 'commit_travel_guide', args: {
        intent: { kind: 'travel_guide', parameters: { questions: ['Visit a cultural venue'], researchTypes: ['activity'],
          requiredEvidenceTypes: ['activity'], maxResults: 1, maxCities: 1, allowPartial: true } },
        candidates: [{ key: 'venue', sourceRefs: ['s1.0123456789.abcdef0123.1'], title: 'A cultural venue',
          summary: 'Explore local culture.', category: 'activity' }],
        days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'Culture', items: [{ candidateKey: 'venue',
          timeOfDay: 'afternoon', planningNote: 'Explore local culture.', text: { name: 'Cultural visit',
            introduction: 'Explore local culture.', recommendationReason: 'Matches your cultural interest.' } }] }],
        text: { reply: 'Your guide is ready.', overview: 'Explore local culture.', days: [{ day: 1, theme: 'Culture' }] }
      } },
      { text: 'Could not prepare the guide.' }
    ] })
    try {
      const trips = new InMemoryTripRepository(), trip = await trips.create()
      const ownerId = 'location-preparation-owner', owned = new Set([trip.id])
      const conversations = new InMemoryConversationRepository(ownerId, owned), conversation = await conversations.create({ tripId: trip.id })
      const artifacts = new InMemoryArtifactRepository(ownerId, owned)
      const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
      const accept = vi.spyOn(runs, 'accept')
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions, artifacts,
        goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
        memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
        research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
        flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(),
        createFinalizer: vi.fn(() => { throw new Error('Unexpected finalizer') }) })
      const result = await service.runTurn({ requestId: 'location-preparation', generationId: 'location-preparation-generation',
        tripId: trip.id, conversationId: conversation.id, message: 'Plan a cultural day in Tokyo.', locale: 'en' })
      expect(result.reply).toMatch(/current trip|trip destination/i)
      expect(result.reply).not.toMatch(/more specific place name|candidate_location_unresolved|city:TYO|s1\.|stack|token=/i)
      expect(result.delivery).toEqual({ status: 'partial', kind: 'travel_guide', artifactIds: [],
        missing: ['accepted_publication'], warnings: [], goals: [] })
      expect(accept).not.toHaveBeenCalled()
      expect(await trips.get(trip.id)).toEqual(trip.context)
      expect(await artifacts.listForTrip(trip.id)).toEqual([])
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)

  it('uses precise safe copy when the latest guide has no prepared current-language edit base', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-no-edit-base-'))
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { tool: 'commit_travel_guide', args: { replaceSlots: [{ day: 1, slot: 'afternoon' }],
        days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'A revised afternoon', items: [{ candidateKey: 'garden', timeOfDay: 'afternoon',
          planningNote: 'Take a relaxed walk.', text: { name: 'A garden walk', introduction: 'Walk along quiet garden paths.',
            recommendationReason: 'A quieter activity fits the request.' } }] }],
        text: { reply: 'Updated itinerary.', overview: 'An updated afternoon.', days: [{ day: 1, theme: 'A revised afternoon' }] } } },
      { text: 'I could not prepare that edit.' }
    ] })
    const toolResults: Array<{ name: string; result: unknown }> = []
    const actualRun = sessions.run.bind(sessions)
    vi.spyOn(sessions, 'run').mockImplementation(input => actualRun({ ...input, execute: async (...args) => {
      const result = await input.execute(...args)
      if (args[0] === 'commit_travel_guide') toolResults.push({ name: args[0], result })
      return result
    } }))
    try {
      const trips = new InMemoryTripRepository(), trip = await trips.create()
      const ownerId = 'no-edit-base-owner', owned = new Set([trip.id])
      const conversations = new InMemoryConversationRepository(ownerId, owned), conversation = await conversations.create({ tripId: trip.id })
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions,
        artifacts: new InMemoryArtifactRepository(ownerId, owned), memory: new InMemoryUserMemoryRepository(),
        aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
        connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
        routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: vi.fn(() => { throw new Error('Unexpected finalizer') }) })
      const result = await service.runTurn({ requestId: 'no-edit-base', generationId: 'no-edit-base-generation', tripId: trip.id,
        conversationId: conversation.id, message: 'Change the second afternoon of my guide.', locale: 'en' })
      expect(toolResults[0]?.result).toMatchObject({ error: { code: 'DSH_GUIDE_BASE_UNAVAILABLE' } })
      expect(result.reply).toBe('There is no published guide available for a local edit. Reopen the current guide and complete preparation in the displayed language before requesting a local edit.')
      expect(result.reply).not.toMatch(/changed while|DSH_GUIDE_BASE_UNAVAILABLE|stack|token=/i)
      expect(result.delivery).toEqual({ status: 'partial', kind: 'travel_guide', artifactIds: [],
        missing: ['accepted_publication'], warnings: [], goals: [] })
      expect(result.stopReason).toBe('goal_partial')
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)

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
      const kinds = (value: unknown): string[] => {
        if (!value || typeof value !== 'object') return []
        const data = value as Record<string, any>
        const kind = data.properties?.kind?.const
        return [...(typeof kind === 'string' ? [kind] : []), ...Object.values(data).flatMap(kinds)]
      }
      for (const [name, kind] of [['commit_travel_guide', 'travel_guide'], ['update_trip_context', 'trip_context_update'],
        ['search_flights', 'flight_search'], ['search_flexible_flights', 'flight_search'], ['confirm_flight_price', 'flight_search']]) {
        const visible = request.tools.find(tool => tool.name === name)!
        expect(visible).toBeDefined()
        expect(kinds((visible.rawSchema.properties as Record<string, unknown>).intent)).toEqual([kind])
      }
      expect(commit.rawSchema).not.toHaveProperty('anyOf')
      expect(commit.description).toContain('same-turn repairs omit it')
      expect(commit.rawSchema.properties).not.toHaveProperty('baseGuideId')
      expect(commit.rawSchema.properties).not.toHaveProperty('expectedContentHash')
      expect(commit.rawSchema.properties).not.toHaveProperty('goalRef')
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
