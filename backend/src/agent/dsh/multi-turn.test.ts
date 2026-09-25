import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { researchArtifactSchema } from '../../research-agent/types.js'
import { DeterministicTripRoutePlanner } from '../../trip-planning/planner.js'
import { DeterministicTravelGuideBuilder } from '../../travel-guides/artifact-builder.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { CloudPlannerService } from '../cloud/service.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'
import { DshEvidenceStore, InMemoryDshEvidenceRepository } from './evidence.js'

const roots: string[] = []
const managers: DshSessionManager[] = []
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map(manager => manager.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH multi-turn publication flow with the official worker', () => {
  it.each(['exact_cover', 'stale_evidence'] as const)('repairs %s, publishes once, explains without another write, and resumes persisted history after manager recreation', async failure => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-multiturn-'))
    roots.push(root)
    const ownerId = 'dsh-multiturn-owner'
    const tripId = randomUUID()
    const tripContext = {
      ...emptyTripContext(tripId),
      travelDays: 1,
      departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
      destinationIntent: { mode: 'explicit' as const,
        required: [{ id: 'city:TYO', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }], preferred: [], excluded: [] },
      interests: ['traditional culture'],
    }
    const trips = new InMemoryTripRepository([{ id: tripId, title: 'Tokyo', status: 'planning', currentContextVersion: 0,
      context: tripContext, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])
    const ownedTrips = new Set([tripId])
    const sharedConversations = { conversations: new Map(), messages: new Map() }
    const conversations = new InMemoryConversationRepository(ownerId, ownedTrips, sharedConversations)
    const conversation = await conversations.create({ tripId })
    const evidenceRepository = new InMemoryDshEvidenceRepository()
    const priorEvidence = new DshEvidenceStore({ ownerId, tripId, conversationId: conversation.id, generationId: randomUUID(), tripContextVersion: 0 }, { repository: evidenceRepository })
    const stale = await priorEvidence.recordSearch({ sources: [{ url: 'https://www.gotokyo.org/en/spot/15/index.html', title: 'Senso-ji Temple',
      snippet: 'The temple is a historic cultural destination in Tokyo.' }] }, 'offline-fixture', 'prior-search')
    const artifacts = new InMemoryArtifactRepository(ownerId, ownedTrips)
    const goals = new InMemoryGoalRepository(ownerId)
    const goalRuns = new InMemoryGoalRunRepository(ownerId, goals)
    const findingId = 'tokyo-temple'
    const research = researchArtifactSchema.parse({
      id: randomUUID(), type: 'research' as const, schemaVersion: 2 as const,
      brief: { destinations: tripContext.destinationIntent.required, interests: tripContext.interests,
        questions: ['Traditional culture'], researchTypes: ['activity' as const], travelWindow: { from: '2026-10-10', to: '2026-10-10' } },
      findings: [{ id: findingId, category: 'activity' as const, destinations: tripContext.destinationIntent.required,
        title: 'Senso-ji Temple', summary: 'Explore the temple grounds and traditional architecture.',
        sources: [{ title: 'Senso-ji Temple', url: 'https://www.gotokyo.org/en/spot/15/index.html', domain: 'gotokyo.org',
          snippet: 'The temple is a historic cultural destination in Tokyo.', authority: 'government_tourism' as const }],
        verification: { status: 'partially_verified' as const, confidence: 0.5,
          sources: [{ provider: 'offline-fixture', reference: 'https://www.gotokyo.org/en/spot/15/index.html' }],
          checkedAt: '2026-09-24T00:00:00.000Z', expiresAt: '2026-10-10T00:00:00.000Z' }, warnings: [] }],
      queryCount: 0, warnings: [], createdAt: '2026-09-24T00:00:00.000Z',
    })
    await artifacts.create({ id: research.id, tripId, conversationId: conversation.id, tripContextVersion: 0,
      type: 'research', schemaVersion: 2, payload: research })
    const candidateRef = guideCandidateRef({ ownerId, tripId, tripContextVersion: 0 }, research, findingId)
    const intent = { kind: 'travel_guide', parameters: { questions: ['Traditional culture'], researchTypes: ['activity'],
      requiredEvidenceTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: true } }
    const call = (name: string, args: unknown) => ({ tool: name, args })
    const commitArgs = {
      intent,
      days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'Traditional Tokyo', items: [{ activityKey: 'temple',
        candidateRef, timeOfDay: 'morning', planningNote: 'Explore the temple grounds and traditional architecture at a relaxed pace.' }] }],
      text: { reply: 'Your Tokyo cultural guide is ready.', overview: 'Explore traditional culture at a relaxed pace in Tokyo.',
        days: [{ day: 1, theme: 'Traditional Tokyo' }], activities: [{ activityKey: 'temple', name: 'Senso-ji Temple',
          introduction: 'Explore the temple grounds and appreciate traditional architecture.',
          recommendationReason: 'This visit matches your interest in traditional culture.' }] },
    }
    const invalidCommit = failure === 'exact_cover' ? { ...commitArgs, text: { ...commitArgs.text,
      activities: [...commitArgs.text.activities, { ...commitArgs.text.activities[0], activityKey: 'rail-guidance' }] } } : {
      ...commitArgs, candidates: [{ key: 'temple', evidenceRefs: stale.evidenceRefs, title: 'Senso-ji Temple',
        summary: 'Explore the temple grounds and traditional architecture.', category: 'activity', locationId: 'city:TYO' }],
      days: commitArgs.days.map(day => ({ ...day, items: day.items.map(({ candidateRef: _ref, ...item }) => ({ ...item, candidateKey: 'temple' })) }))
    }
    const firstManager = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      call('commit_travel_guide', invalidCommit),
      call('commit_travel_guide', commitArgs), { text: 'DEBUG: commit_travel_guide accepted. Admission costs USD 500 and everything is within your budget.' },
      { text: 'Senso-ji is a historic temple and fits your interest in traditional culture.' },
    ] })
    const actualRun = firstManager.run.bind(firstManager)
    const commitFeedback: unknown[] = []
    vi.spyOn(firstManager, 'run').mockImplementation(input => actualRun({ ...input, execute: async (...args) => {
      const result = await input.execute(...args)
      if (args[0] === 'commit_travel_guide') commitFeedback.push(result)
      return result
    } }))
    managers.push(firstManager)
    const researchAgent = new UnavailableResearchAgent()
    const researchSpy = vi.spyOn(researchAgent, 'research')
    const legacy = vi.spyOn(CloudPlannerService.prototype, 'runTurn').mockRejectedValue(new Error('legacy forbidden'))
    const runtime = vi.spyOn(AgentRuntime.prototype, 'run').mockRejectedValue(new Error('runtime forbidden'))
    const finalizer = vi.fn(() => { throw new Error('Unexpected finalizer') })
    const service = new DshPlannerService({ ownerId, trips, conversations, sessions: firstManager, artifacts, evidenceRepository,
      tripRoutePlanner: new DeterministicTripRoutePlanner(), travelGuideBuilder: new DeterministicTravelGuideBuilder(),
      goalRepository: goals, goalRunRepository: goalRuns, goalVerifiers: createDefaultGoalVerifierRegistry(),
      memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
      research: researchAgent, connectionSearch: new UnavailableConnectionSearchService(),
      flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: finalizer })
    const base = { tripId, conversationId: conversation.id, locale: 'en' as const }
    const first = await service.runTurn({ ...base, requestId: randomUUID(), generationId: randomUUID(), message: 'Create a Tokyo cultural guide.' })
    expect(first.reply).toBe('Your Tokyo cultural guide is ready.')
    expect(commitFeedback[0]).toMatchObject({ ok: false, error: { code: 'DSH_GUIDE_NEEDS_REVISION', details: failure === 'exact_cover' ? {
      hint: 'Text must cover exactly the submitted activities; protected activities cannot be rewritten',
      requiredActivityKeys: ['temple'], unexpectedActivityKeys: ['rail-guidance'], missingActivityKeys: [],
      repairHint: expect.stringContaining('supportingCandidateKeys')
    } : {
      code: 'candidate_evidence_unavailable', candidates: [{ candidateKey: 'temple', unavailableEvidenceRefs: stale.evidenceRefs }],
      hint: 'Candidate evidence must be available in the current turn and Trip context', repairHint: expect.stringContaining('candidateRef')
    } } })
    expect(commitFeedback[1]).toMatchObject({ status: 'accepted' })
    expect(first.delivery.status).toBe('satisfied')
    expect(await goals.get(first.delivery.goalId!)).toMatchObject({ status: 'satisfied' })
    expect(first.artifactRefs).toHaveLength(1)
    expect((await artifacts.get(first.artifactRefs[0]!.id))?.type).toBe('travel_guide')

    const explanation = await service.runTurn({ ...base, requestId: randomUUID(), generationId: randomUUID(), message: 'Why did you choose it? Explain only.' })
    expect(explanation.reply).toContain('historic temple')
    expect(explanation.delivery.status).toBe('not_requested')
    expect(explanation.artifactRefs).toEqual([])

    const guideArtifacts = (await artifacts.listForTrip(tripId)).filter(record => record.type === 'travel_guide')
    expect(guideArtifacts).toHaveLength(1)
    expect(await trips.get(tripId)).toMatchObject({ version: 0 })
    const messagesBeforeRestart = await conversations.listMessages(conversation.id)
    expect(messagesBeforeRestart.map(({ role }) => role)).toEqual(['user', 'assistant', 'user', 'assistant'])

    await firstManager.close()
    const resumedManager = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { text: 'This resumed session still has the Tokyo guide context.' },
    ] })
    managers.push(resumedManager)
    const resumedService = new DshPlannerService({ ownerId, trips, conversations, sessions: resumedManager, artifacts,
      goalRepository: goals, goalRunRepository: goalRuns, goalVerifiers: createDefaultGoalVerifierRegistry(),
      memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
      research: researchAgent, connectionSearch: new UnavailableConnectionSearchService(),
      flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: finalizer })
    const resumed = await resumedService.runTurn({ ...base, requestId: randomUUID(), generationId: randomUUID(), message: 'Continue from our saved conversation.' })
    expect(resumed.reply).toContain('resumed session')
    const messages = await conversations.listMessages(conversation.id)
    expect(messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    expect(messages.at(-1)?.metadata).toMatchObject({ engine: 'dsh', resumed: true })
    expect((await artifacts.listForTrip(tripId)).filter(record => record.type === 'travel_guide')).toHaveLength(1)

    const foreignConversations = new InMemoryConversationRepository('other-owner', ownedTrips, sharedConversations)
    const foreignService = new DshPlannerService({ ownerId: 'other-owner', trips, conversations: foreignConversations,
      sessions: resumedManager, artifacts: new InMemoryArtifactRepository('other-owner', ownedTrips),
      goalRepository: new InMemoryGoalRepository('other-owner'),
      goalRunRepository: new InMemoryGoalRunRepository('other-owner', new InMemoryGoalRepository('other-owner')),
      goalVerifiers: createDefaultGoalVerifierRegistry(),
      memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
      research: researchAgent, connectionSearch: new UnavailableConnectionSearchService(),
      flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: finalizer })
    await expect(foreignConversations.listMessages(conversation.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(foreignService.validateTurn({ tripId, conversationId: conversation.id })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(researchSpy).not.toHaveBeenCalled()
    expect(legacy).not.toHaveBeenCalled()
    expect(runtime).not.toHaveBeenCalled()
    expect(finalizer).not.toHaveBeenCalled()
    legacy.mockRestore(); runtime.mockRestore()
  }, 45_000)
})
