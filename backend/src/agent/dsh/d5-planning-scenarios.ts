/** Offline D5-C evaluation harness. The model protocol uses the real official
 * worker against a loopback DeepSeek-shaped server; evidence is a labeled
 * synthetic persisted research fixture. No external provider is contacted. */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { emptyTripContext } from '../../trips/types.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import { guideCandidateRef } from '../../travel-guides/candidates.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { researchArtifactSchema } from '../../research-agent/types.js'
import { assertFlightChoice, selectedFlightContext, type SelectedFlightContext } from '../../workspaces/flight-selection.js'
import { DeterministicTripRoutePlanner } from '../../trip-planning/planner.js'
import { DeterministicTravelGuideBuilder } from '../../travel-guides/artifact-builder.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { FileDshBudget } from './budget.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'

export type D5PlanningCase = 1 | 2 | 3 | 4 | 5 | 6 | 10
export interface D5PlanningMetrics {
  caseNumber: D5PlanningCase
  runIndex: number
  simulation: true
  accepted: boolean
  delivery: string
  modelCalls: number
  providerRetries: number
  httpRequests: number
  commitCalls: number
  committedGuides: number
  pendingBudgetCalls: number
  researchArtifacts: number
  schemaRepairCount: number
  semanticRepairCount: number
  argumentCorrections: number
  contentAttempts: number
  wallTimeMs: number
  searchCalls: number
  inputTokens: number
  outputTokens: number
  resumed?: boolean
  restoredWithoutWrite?: boolean
}

function sse(res: import('node:http').ServerResponse, delta: Record<string, unknown>, finishReason: string | null = null,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) {
  res.write(`data: ${JSON.stringify({ id: 'd5-local', object: 'chat.completion.chunk', created: 1, model: 'd5-local',
    choices: [{ index: 0, delta, finish_reason: finishReason }], ...(usage ? { usage } : {}) })}\n\n`)
}

/** Cases 1–6 exercise real service, official worker, Goal, publication and ledger. */
export async function runPlanningScenario(caseNumber: D5PlanningCase, runIndex: number): Promise<D5PlanningMetrics> {
  const startedAt = Date.now()
  if (!Number.isInteger(runIndex) || runIndex < 1) throw new Error('runIndex must be positive')
  const root = await mkdtemp(join(tmpdir(), `flightor-d5-case-${caseNumber}-`))
  const ownerId = `d5-owner-${caseNumber}-${runIndex}`
  const tripId = randomUUID()
  const destination = { id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
  const tripContext = { ...emptyTripContext(tripId), travelDays: 1,
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
    destinationIntent: { mode: 'explicit' as const, required: [destination], preferred: [], excluded: [] },
    interests: ['traditional culture'] }
  const trips = new InMemoryTripRepository([{ id: tripId, title: 'Tokyo', status: 'planning', currentContextVersion: 0,
    context: tripContext, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])
  const owned = new Set([tripId])
  const conversations = new InMemoryConversationRepository(ownerId, owned)
  const conversation = await conversations.create({ tripId })
  const artifacts = new InMemoryArtifactRepository(ownerId, owned)
  const goals = new InMemoryGoalRepository(ownerId)
  const goalRuns = new InMemoryGoalRunRepository(ownerId, goals)
  const research = researchArtifactSchema.parse({ id: randomUUID(), type: 'research', schemaVersion: 2,
    brief: { destinations: [destination], interests: tripContext.interests, questions: ['Traditional culture'],
      researchTypes: ['activity'], travelWindow: { from: '2026-10-10', to: '2026-10-10' } },
    findings: (caseNumber === 10 ? ['temple', 'museum', 'garden'] : ['temple']).map(id => ({ id, category: 'activity', destinations: [destination],
      title: id === 'temple' ? 'Senso-ji Temple' : 'Tokyo Culture Museum',
      summary: id === 'temple' ? 'Explore the temple grounds and traditional architecture.' : 'Explore indoor cultural exhibits.',
      sources: [{ title: 'Synthetic Senso-ji source', url: 'https://example.invalid/temple', domain: 'example.invalid',
        snippet: 'Synthetic fixture: temple grounds and architecture.', authority: 'unknown' }],
      verification: { status: 'partially_verified', confidence: 0.5,
        sources: [{ provider: 'd5-local-fixture', reference: 'https://example.invalid/temple' }],
        checkedAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-10-10T00:00:00.000Z' }, warnings: [] })),
    queryCount: 0, warnings: [], createdAt: '2026-09-27T00:00:00.000Z' })
  await artifacts.create({ id: research.id, tripId, conversationId: conversation.id, tripContextVersion: 0,
    type: 'research', schemaVersion: 2, payload: research })
  const candidateRef = guideCandidateRef({ ownerId, tripId, tripContextVersion: 0 }, research, 'temple')
  const intent = { kind: 'travel_guide', parameters: { questions: ['Traditional culture'], researchTypes: ['activity'],
    requiredEvidenceTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: true } }
  const guide = { intent, days: [{ day: 1, cityId: destination.id, kind: 'visit', theme: 'Traditional Tokyo',
    items: [{ activityKey: 'temple', candidateRef, timeOfDay: 'morning',
      planningNote: 'Explore the temple grounds and traditional architecture.' }] }],
    text: { reply: 'Your Tokyo cultural guide is ready.', overview: 'Explore traditional Tokyo culture.',
      days: [{ day: 1, theme: 'Traditional Tokyo' }], activities: [{ activityKey: 'temple', name: 'Senso-ji Temple',
        introduction: 'Explore the temple grounds and traditional architecture.',
        recommendationReason: 'This visit fits your interest in traditional culture.' }] } }
  const malformed = { ...guide, text: { ...guide.text, activities: undefined } }
  const duplicate = { ...guide, days: [{ ...guide.days[0]!, items: [...guide.days[0]!.items,
    { ...guide.days[0]!.items[0]!, activityKey: 'duplicate', timeOfDay: 'afternoon' }] }],
    text: { ...guide.text, activities: [...guide.text.activities,
      { ...guide.text.activities[0]!, activityKey: 'duplicate' }] } }
  const script: Array<{ tool?: string; args?: unknown; text?: string }> = caseNumber === 10
    ? [{ tool: 'search_flights', args: { origin: 'PEK', destination: 'NRT', departureDate: '2026-10-10', currency: 'CNY', travelClass: 1 } },
      { text: 'A flight option is available for your review.' }]
    : caseNumber === 3
    ? [{ tool: 'commit_travel_guide', args: malformed }, { tool: 'commit_travel_guide', args: guide }, { text: 'The guide is ready.' }]
    : caseNumber === 4 || caseNumber === 5
      ? [{ tool: 'commit_travel_guide', args: duplicate }, { tool: 'commit_travel_guide', args: guide }, { text: 'The guide is ready.' }]
      : [{ tool: 'commit_travel_guide', args: guide }, { text: 'The guide is ready.' }]
  let scriptIndex = 0, httpRequests = 0, injectedFailure = false
  const server = createServer(async (req, res) => {
    httpRequests++
    let requestBody = ''
    for await (const chunk of req) requestBody += chunk
    if ((caseNumber === 2 || caseNumber === 5) && !injectedFailure) {
      injectedFailure = true
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'local scripted outage', type: 'server_error' } }))
      return
    }
    const step = script[scriptIndex++] ?? { text: 'The saved guide remains available.' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    sse(res, { role: 'assistant' })
    if (step.tool) sse(res, { tool_calls: [{ index: 0, id: `d5-call-${scriptIndex}`, type: 'function',
      function: { name: step.tool, arguments: JSON.stringify(step.args) } }] })
    else sse(res, { content: step.text })
    // Local simulated usage comes from the actual request and scripted response bytes.
    const promptTokens = Math.ceil(requestBody.length / 4)
    const completionTokens = Math.ceil(JSON.stringify(step).length / 4)
    sse(res, {}, step.tool ? 'tool_calls' : 'stop', { prompt_tokens: promptTokens,
      completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens })
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('loopback server did not bind')
  const budget = new FileDshBudget({ path: join(root, 'simulated-budget.json'), authorizedUsd: 100,
    maxModelCalls: 100, maxSearchCalls: 0, unlimited: true })
  const fareQuery = { origin: 'PEK', destination: 'NRT', departureDate: '2026-10-10', currency: 'CNY' as const, travelClass: 1 }
  const fareResult = { query: fareQuery, offers: [{ id: 'd5-offer', segments: [{ flightNumber: 'D501', airline: 'Fixture Air',
    origin: 'PEK', destination: 'NRT', departsAt: '2026-10-10T00:00:00+08:00', arrivesAt: '2026-10-10T05:00:00+09:00',
    durationMinutes: 240 }], layovers: [], totalAmount: 1200, currency: 'CNY', totalDurationMinutes: 240,
    airlines: ['Fixture Air'], transferType: 'direct' as const }], provider: 'd5-local-fixture',
    checkedAt: '2026-09-27T00:00:00.000Z', verification: { status: 'verified' as const, checkedAt: '2026-09-27T00:00:00.000Z',
      confidence: 1, sources: [{ provider: 'd5-local-fixture' }] } }
  const aviation = new MockAviationProvider()
  aviation.getAirport = async input => input.iata === 'PEK'
    ? { id: 'airport:PEK', type: 'airport', name: 'Beijing Capital', countryCode: 'CN', iata: 'PEK' }
    : input.iata === 'NRT' ? { id: 'airport:NRT', type: 'airport', name: 'Narita', countryCode: 'JP', iata: 'NRT' } : undefined
  let selectedFlight: SelectedFlightContext | null = null
  const sessions = new DshSessionManager({ root: join(root, 'sessions'), route: { provider: 'deepseek', model: 'd5-local',
    baseURL: `http://127.0.0.1:${address.port}/v1`, maxTokens: 4096 }, modelKey: 'd5-local-fixture-key', metered: true })
  let schemaRepairCount = 0, semanticRepairCount = 0
  const observedRun = sessions.run.bind(sessions)
  sessions.run = async input => observedRun({ ...input, execute: async (...args) => {
    const result = await input.execute(...args)
    if (args[0] === 'commit_travel_guide') {
      const error = result && typeof result === 'object' ? (result as { error?: { kind?: string; recovery?: {
        argumentCorrections?: number; contentAttempts?: number } } }).error : undefined
      if (error?.kind === 'arguments') schemaRepairCount++
      if (error?.kind === 'content') semanticRepairCount++
    }
    return result
  } })
  const usage = (ledger: Awaited<ReturnType<FileDshBudget['readSnapshot']>>) => ({
    inputTokens: ledger.entries.reduce((sum, item) => sum + (item.receipt?.usage?.promptTokens ?? 0), 0),
    outputTokens: ledger.entries.reduce((sum, item) => sum + (item.receipt?.usage?.completionTokens ?? 0), 0) })
  const dependencies = { ownerId, trips, conversations, sessions, artifacts, budget, modelProvider: 'd5-local',
    tripRoutePlanner: new DeterministicTripRoutePlanner(), travelGuideBuilder: new DeterministicTravelGuideBuilder(),
    goalRepository: goals, goalRunRepository: goalRuns, goalVerifiers: createDefaultGoalVerifierRegistry(),
    memory: new InMemoryUserMemoryRepository(), aviation, fares: new MockFareProvider({ search: fareResult }),
    flightSelections: { getSelectedFlight: async () => selectedFlight },
    research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
    flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(),
    createFinalizer: () => { throw new Error('Legacy finalizer called') } }
  const service = new DshPlannerService(dependencies)
  try {
    if (caseNumber === 10) {
      const turn = (message: string) => service.runTurn({ requestId: randomUUID(), generationId: randomUUID(),
        tripId, conversationId: conversation.id, locale: 'en', message })
      const search = await turn('Search one flight from Beijing to Tokyo on October 10.')
      const flightRef = search.artifactRefs.find(ref => ref.type === 'flight_search')
      if (!flightRef) throw new Error('Case 10 did not persist a flight search')
      const flightRecord = await artifacts.get(flightRef.id)
      if (!flightRecord) throw new Error('Case 10 flight artifact missing')
      const choice = { kind: 'offer' as const, artifactId: flightRecord.id, offerId: 'd5-offer', layoverPreference: 'airport_only' as const }
      assertFlightChoice(flightRecord, choice, 0)
      selectedFlight = selectedFlightContext({ ...choice,
        layoverPreference: 'airport_only', contextVersion: 0, revision: 1, selectedAt: new Date().toISOString() }, flightRecord)
      const flightGuide = { ...guide, days: [{ ...guide.days[0]!, items: [...guide.days[0]!.items,
        { activityKey: 'garden', candidateRef: guideCandidateRef({ ownerId, tripId, tripContextVersion: 0 }, research, 'garden'),
          timeOfDay: 'afternoon', planningNote: 'Explore a garden at a relaxed pace.' }] }],
        text: { ...guide.text, activities: [...guide.text.activities,
          { activityKey: 'garden', name: 'Tokyo Culture Garden', introduction: 'Explore a garden at a relaxed pace.',
            recommendationReason: 'This adds a calm outdoor cultural stop.' }] } }
      script.push({ tool: 'commit_travel_guide', args: flightGuide }, { text: 'Guide saved.' })
      const first = await turn('I adopted that flight. Create a Tokyo cultural guide for the trip.')
      const baseRef = first.artifactRefs.find(ref => ref.type === 'travel_guide')
      if (!baseRef || first.delivery.status !== 'satisfied') throw new Error(`Case 10 initial bound guide was not accepted: ${JSON.stringify({
        delivery: first.delivery, stopReason: first.stopReason, reply: first.reply,
        messages: (await conversations.listMessages(conversation.id)).map(message => message.metadata) })}`)
      const base = await artifacts.get(baseRef.id)
      if (!base) throw new Error('Case 10 base guide missing')
      const before = travelGuideArtifactPayloadSchema.parse(base.payload)
      const basePublication = publicationFor(base)
      const patch = { intent, baseGuideId: base.id, expectedContentHash: basePublication?.guideContentHash,
        replaceSlots: [{ day: 1, slot: 'morning' }],
        days: [{ day: 1, cityId: destination.id, kind: 'visit', theme: 'Indoor culture', items: [{ activityKey: 'museum',
          candidateRef: guideCandidateRef({ ownerId, tripId, tripContextVersion: 0 }, research, 'museum'),
          timeOfDay: 'morning', planningNote: 'Explore indoor cultural exhibits.' }] }],
        text: { reply: 'The morning now focuses on indoor culture.', overview: 'Explore traditional Tokyo culture indoors.',
          days: [{ day: 1, theme: 'Indoor culture' }], activities: [{ activityKey: 'museum', name: 'Tokyo Culture Museum',
            introduction: 'Explore indoor cultural exhibits.', recommendationReason: 'This fits your interest in culture.' }] } }
      script.push({ tool: 'commit_travel_guide', args: patch }, { text: 'Guide updated.' })
      const edited = await turn('Replace only the morning visit with an indoor museum.')
      const editedRef = edited.artifactRefs.find(ref => ref.type === 'travel_guide')
      if (!editedRef || edited.delivery.status !== 'satisfied') throw new Error('Case 10 local edit was not accepted')
      const editedRecord = await artifacts.get(editedRef.id)
      if (!editedRecord) throw new Error('Case 10 revised guide missing')
      const after = travelGuideArtifactPayloadSchema.parse(editedRecord.payload)
      if (before.flightSelection?.revision !== 1 || after.flightSelection?.revision !== 1 ||
        after.days[0]?.items[0]?.sourceFindingId !== 'museum' ||
        JSON.stringify(after.days[0]?.items[1]) !== JSON.stringify(before.days[0]?.items[1]))
        throw new Error('Case 10 flight binding or protected afternoon changed')
      const countBeforeRead = (await artifacts.listForTrip(tripId)).length
      const ledgerBeforeRead = await budget.readSnapshot()
      const state = await service.publicationContext({ tripId, conversationId: conversation.id })
      const restoredRecord = await artifacts.get(editedRecord.id)
      const countAfterRead = (await artifacts.listForTrip(tripId)).length
      const ledgerAfterRead = await budget.readSnapshot()
      if (countBeforeRead !== countAfterRead || ledgerBeforeRead.modelCalls !== ledgerAfterRead.modelCalls ||
        state.selectedFlightRevision !== 1 ||
        publicationFor(restoredRecord!)?.finalization?.variants.en?.status !== 'accepted')
        throw new Error('Case 10 read-only refresh changed durable state or failed publication recovery')
      const ledger = await budget.readSnapshot()
      const assistantMessages = (await conversations.listMessages(conversation.id)).filter(message => message.role === 'assistant')
      const recoveries = assistantMessages.map(message => message.metadata.commit_recovery as { argumentCorrections?: number; contentAttempts?: number } | undefined)
      return { caseNumber, runIndex, simulation: true, accepted: true, delivery: edited.delivery.status,
        modelCalls: ledger.modelCalls, providerRetries: assistantMessages.reduce((sum, message) => sum + Number(message.metadata.provider_retry_count ?? 0), 0),
        httpRequests, commitCalls: assistantMessages.reduce((sum, message) => sum + Number((message.metadata.commit_recovery as { calls?: number } | undefined)?.calls ?? 0), 0),
        committedGuides: (await artifacts.listForTrip(tripId)).filter(record => record.type === 'travel_guide').length,
        pendingBudgetCalls: ledger.pendingCalls, researchArtifacts: 1, restoredWithoutWrite: true,
        schemaRepairCount, semanticRepairCount,
        argumentCorrections: recoveries.reduce((sum, value) => sum + (value?.argumentCorrections ?? 0), 0),
        contentAttempts: recoveries.reduce((sum, value) => sum + (value?.contentAttempts ?? 0), 0),
        wallTimeMs: Date.now() - startedAt, searchCalls: ledger.searchCalls, ...usage(ledger) }
    }
    const result = await service.runTurn({ requestId: randomUUID(), generationId: randomUUID(), tripId,
      conversationId: conversation.id, locale: 'en', message: 'Create a one-day Tokyo cultural guide.' })
    const records = await artifacts.listForTrip(tripId)
    const guides = records.filter(record => record.type === 'travel_guide')
    const accepted = guides.filter(record => publicationFor(record)?.finalization?.variants.en?.status === 'accepted')
    const messages = await conversations.listMessages(conversation.id)
    const last = messages.at(-1)?.metadata ?? {}
    const ledger = await budget.readSnapshot()
    if (result.delivery.status !== 'satisfied' || accepted.length !== 1 || ledger.pendingCalls !== 0)
      throw new Error(`D5 case ${caseNumber} failed acceptance: ${JSON.stringify({ delivery: result.delivery.status,
        accepted: accepted.length, pending: ledger.pendingCalls, last })}`)
    let restoredWithoutWrite: boolean | undefined
    let resumed: boolean | undefined
    if (caseNumber === 6) {
      await sessions.close()
      const reopened = new DshSessionManager({ root: join(root, 'sessions'), route: { provider: 'deepseek', model: 'd5-local',
        baseURL: `http://127.0.0.1:${address.port}/v1`, maxTokens: 4096 }, modelKey: 'd5-local-fixture-key', metered: true })
      try {
        const resumedService = new DshPlannerService({ ...dependencies, sessions: reopened })
        const before = (await artifacts.listForTrip(tripId)).length
        const read = await resumedService.runTurn({ requestId: randomUUID(), generationId: randomUUID(), tripId,
          conversationId: conversation.id, locale: 'en', message: 'Why this temple? Explain only.' })
        const after = (await artifacts.listForTrip(tripId)).length
        restoredWithoutWrite = before === after && read.delivery.status === 'not_requested'
        resumed = Boolean((await conversations.listMessages(conversation.id)).at(-1)?.metadata.resumed)
        if (!restoredWithoutWrite || !resumed) throw new Error('Cold resume changed durable guide or did not resume')
      } finally { await reopened.close() }
    }
    const finalLedger = caseNumber === 6 ? await budget.readSnapshot() : ledger
    return { caseNumber, runIndex, simulation: true, accepted: true, delivery: result.delivery.status,
      modelCalls: finalLedger.modelCalls, providerRetries: Number(last.provider_retry_count ?? 0), httpRequests,
      commitCalls: Number((last.commit_recovery as { calls?: number } | undefined)?.calls ?? 0), committedGuides: accepted.length,
      pendingBudgetCalls: finalLedger.pendingCalls, researchArtifacts: records.filter(record => record.type === 'research').length,
      schemaRepairCount, semanticRepairCount,
      argumentCorrections: Number((last.commit_recovery as { argumentCorrections?: number } | undefined)?.argumentCorrections ?? 0),
      contentAttempts: Number((last.commit_recovery as { contentAttempts?: number } | undefined)?.contentAttempts ?? 0),
      wallTimeMs: Date.now() - startedAt, searchCalls: finalLedger.searchCalls, ...usage(finalLedger),
      ...(resumed === undefined ? {} : { resumed }), ...(restoredWithoutWrite === undefined ? {} : { restoredWithoutWrite }) }
  } finally {
    await sessions.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}
