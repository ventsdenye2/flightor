import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { DshEvidenceStore } from './evidence.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'

const source = { url: 'https://example.test/tokyo-culture', title: 'Tokyo culture',
  snippet: 'Tokyo cultural sites welcome visitors interested in local history.' }
const query = 'Tokyo traditional culture'
const intent = (allowPartial: boolean, maxResults = 1) => ({ kind: 'travel_guide', parameters: { questions: ['Plan a relaxed cultural guide for Tokyo'],
  researchTypes: ['activity'], requiredEvidenceTypes: ['activity'], maxResults, maxCities: 1, allowPartial } })

describe('D6 first-intent preflight across the official fixture worker', () => {
  it.each(['strict_evidence', 'initial_count'] as const)('rejects %s before writes and accepts an explicit first-intent correction', async failure => {
    const isCount = failure === 'initial_count'
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-evidence-intent-'))
    const ownerId = 'd6-evidence-intent-owner', generationId = randomUUID()
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ initialContext: { travelDays: isCount ? 2 : 1,
      destinationIntent: { mode: 'explicit', required: [{ id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }],
        preferred: [], excluded: [] }, interests: ['traditional culture', 'relaxed pace'] } })
    const owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned)
    const conversation = await conversations.create({ tripId: trip.id })
    const evidence = new DshEvidenceStore({ ownerId, tripId: trip.id, conversationId: conversation.id,
      generationId, tripContextVersion: trip.context.version })
    const sourceRef = (await evidence.recordSearch({ sources: [source] }, 'serpapi-raw', 'fixture-search')).sourceRefs[0]!
    const candidateKeys = Array.from({ length: isCount ? 10 : 1 }, (_, index) => `tokyo-culture-${index + 1}`)
    const commit = (corrected: boolean) => ({
      intent: intent(isCount || corrected, isCount ? corrected ? 10 : 8 : 1),
      candidates: candidateKeys.map((key, index) => ({ key, sourceRefs: [sourceRef], title: `Tokyo cultural place ${index + 1}`,
        summary: 'Visit a cultural site in Tokyo at a relaxed pace.', category: 'activity' })),
      days: Array.from({ length: isCount ? 2 : 1 }, (_, dayIndex) => ({ day: dayIndex + 1, kind: 'visit', theme: 'Tokyo culture',
        items: candidateKeys.slice(dayIndex * 5, dayIndex * 5 + 5).map(candidateKey => ({ candidateKey,
        timeOfDay: 'afternoon', planningNote: 'Explore the site without rushing.', text: { name: 'Tokyo cultural visit',
          introduction: 'Explore a cultural site in Tokyo.',
          recommendationReason: 'This relaxed visit matches your interest in local history.' } })) })),
      text: { reply: 'Your Tokyo cultural guide is ready.', overview: 'Explore local history in Tokyo at a relaxed pace.',
        days: Array.from({ length: isCount ? 2 : 1 }, (_, index) => ({ day: index + 1, theme: 'Tokyo culture' })) }
    })
    const fixture = [
      { tool: 'web_search', args: { queries: [query] } },
      { tool: 'commit_travel_guide', args: commit(false) },
      { tool: 'commit_travel_guide', args: commit(true) },
      { text: 'Your Tokyo cultural guide is ready.' }
    ]
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' },
      web: { provider: 'serpapi-raw' }, fixture })
    const actualRun = sessions.run.bind(sessions)
    const toolResults: Array<{ name: string; args: Record<string, unknown>; result: any }> = []
    let stateAfterInitialRejection: { goals: number; artifacts: number } | undefined
    const artifacts = new InMemoryArtifactRepository(ownerId, owned)
    const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
    const accept = vi.spyOn(runs, 'accept')
    const searchOrganic = vi.fn(async () => [source])
    vi.spyOn(sessions, 'run').mockImplementation(input => actualRun({ ...input, execute: async (...args) => {
      const result = await input.execute(...args)
      if (args[0] === 'commit_travel_guide') {
        toolResults.push({ name: args[0], args: args[1] as Record<string, unknown>, result })
        if (toolResults.length === 1) stateAfterInitialRejection = {
          goals: (await goals.listForTrip(trip.id)).length,
          artifacts: (await artifacts.listForTrip(trip.id)).length
        }
      }
      return result
    } }))

    try {
      const createFinalizer = vi.fn(() => { throw new Error('Unexpected legacy finalizer') })
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions, artifacts,
        goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
        memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
        research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
        flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer,
        web: { provider: 'serpapi-raw', serpapi: { searchOrganic } } })

      const result = await service.runTurn({ requestId: 'strict-evidence-request', generationId, tripId: trip.id,
        conversationId: conversation.id, locale: 'en', message: `Plan a relaxed ${isCount ? 'two' : 'one'}-day cultural guide for Tokyo.` })
      const commits = toolResults.filter(value => value.name === 'commit_travel_guide')
      expect(commits).toHaveLength(2)
      expect(commits[0]!.result).toMatchObject({ ok: false, error: {
        code: 'DSH_GUIDE_NEEDS_REVISION', kind: isCount ? 'arguments' : 'prerequisite',
        revisionCode: isCount ? 'guide_initial_result_limit' : 'raw_evidence_requires_partial',
        fields: [isCount ? 'intent.parameters.maxResults' : 'intent.parameters.allowPartial'],
        ...(isCount ? { selectedFindingCount: 10, maxResults: 8, maxAllowedResults: 20 } : {}),
        recovery: { calls: 1, argumentCorrections: isCount ? 1 : 0, contentAttempts: 0 }
      } })
      expect(commits[0]!.result.error.correction).toContain(isCount ? 'consistent with the user request' : 'only if this matches the user request')
      expect(stateAfterInitialRejection).toEqual({ goals: 0, artifacts: 0 })
      expect(commits[1]!.args.intent).toMatchObject({ kind: 'travel_guide', parameters: { allowPartial: true, maxResults: isCount ? 10 : 1 } })
      expect(commits[1]!.result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
      for (const commitResult of commits) {
        expect(commitResult.args).not.toHaveProperty('baseGuideId')
        expect(commitResult.args).not.toHaveProperty('expectedContentHash')
        expect(commitResult.args).not.toHaveProperty('replaceSlots')
        expect(commitResult.args).not.toHaveProperty('goalRef')
      }
      expect(await goals.listForTrip(trip.id)).toHaveLength(1)
      expect(accept).toHaveBeenCalledTimes(1)
      const saved = await artifacts.listForTrip(trip.id)
      expect(saved.filter(record => record.type === 'research')).toHaveLength(1)
      expect(saved.filter(record => record.type === 'travel_guide')).toHaveLength(1)
      expect(searchOrganic).toHaveBeenCalledTimes(1)
      expect(createFinalizer).not.toHaveBeenCalled()
      expect(result.delivery.status).toBe('satisfied')
    } finally {
      await sessions.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
