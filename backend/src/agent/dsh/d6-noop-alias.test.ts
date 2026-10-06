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

const sources = [
  { url: 'https://example.test/tokyo-transit', title: 'Tokyo transit', snippet: 'Tokyo local transit guidance for visitors.' },
  { url: 'https://example.test/tokyo-museum', title: 'Tokyo museum', snippet: 'The Tokyo museum presents Japanese cultural exhibits.' }
]
const guideIntent = { kind: 'travel_guide', parameters: { questions: ['Visit a cultural museum in Tokyo'], researchTypes: ['activity', 'practical'],
  requiredEvidenceTypes: ['activity'], maxResults: 2, maxCities: 1, allowPartial: true } }
const setterIntent = { kind: 'trip_context_update', parameters: { fields: ['budget'] } }

describe('D6 no-op Trip setter preserves same-generation reference identity', () => {
  it('does not reassign an old alias after an empty patch and reordered candidate enumeration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-noop-alias-'))
    const ownerId = 'd6-noop-alias-owner', generation1 = randomUUID(), generation2 = randomUUID()
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ initialContext: { travelDays: 1,
      destinationIntent: { mode: 'explicit', required: [{ id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }],
        preferred: [], excluded: [] }, interests: ['traditional culture'] } })
    const owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned)
    const conversation = await conversations.create({ tripId: trip.id })
    const evidence = new DshEvidenceStore({ ownerId, tripId: trip.id, conversationId: conversation.id,
      generationId: generation1, tripContextVersion: trip.context.version })
    const evidenceRefs = (await evidence.recordSearch({ sources }, 'serpapi-raw', 'fixture-search')).sourceRefs

    const firstCommit = {
      intent: guideIntent,
      candidates: [
        { key: 'practical-transit', sourceRefs: [evidenceRefs[0]!], title: 'Tokyo transit',
          summary: 'Use local transit to reach cultural places in Tokyo.', category: 'practical' },
        { key: 'museum-activity', sourceRefs: [evidenceRefs[1]!], title: 'Tokyo museum',
          summary: 'Explore Japanese cultural exhibits at a relaxed pace.', category: 'activity' }
      ],
      supportingCandidateKeys: ['practical-transit'],
      days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'Tokyo culture', items: [{ candidateKey: 'museum-activity',
        timeOfDay: 'afternoon', planningNote: 'Explore the cultural exhibits.', text: { name: 'Tokyo museum visit',
          introduction: 'Explore exhibits about Japanese culture.', recommendationReason: 'The museum matches your cultural interests.' } }] }],
      text: { reply: 'Your Tokyo museum visit is ready.', overview: 'Explore Japanese culture at a relaxed pace in Tokyo.',
        days: [{ day: 1, theme: 'Tokyo culture' }] }
    }
    const fixture = [
      { tool: 'web_search', args: { queries: ['Tokyo cultural museum and transit'] } },
      { tool: 'commit_travel_guide', args: firstCommit },
      { text: 'Your Tokyo museum visit is saved.' },
      { tool: 'web_search', args: { queries: ['same-scope evidence A'] } },
      { tool: 'update_trip_context', args: { patch: {}, intent: setterIntent } },
      { tool: 'web_search', args: { queries: ['same-scope evidence B'] } },
      { text: 'The existing guide is still available.' }
    ]
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, web: { provider: 'serpapi-raw' }, fixture })
    const actualRun = sessions.run.bind(sessions)
    const snapshots: string[] = []
    const toolResults: Array<{ name: string; args: Record<string, unknown>; result: any }> = []
    vi.spyOn(sessions, 'run').mockImplementation(input => {
      snapshots.push(input.snapshot)
      return actualRun({ ...input, execute: async (...args) => {
        const result = await input.execute(...args)
        if (['commit_travel_guide', 'read_artifact', 'update_trip_context', '__record_web'].includes(args[0])) {
          toolResults.push({ name: args[0], args: args[1] as Record<string, unknown>, result })
        }
        return result
      } })
    })

    try {
      const artifacts = new InMemoryArtifactRepository(ownerId, owned)
      const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
    const sameBody = 'The same short source text is returned from two different source pages.'
    const searchOrganic = vi.fn(async ({ query }: { query: string }) => query === 'Tokyo cultural museum and transit' ? sources : [
      { url: query.endsWith('A') ? 'https://example.test/source-a' : 'https://example.test/source-b', title: query,
        snippet: sameBody }
    ])
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions, artifacts,
        goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
        memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
        research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
        flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(),
        createFinalizer: vi.fn(() => { throw new Error('Unexpected legacy finalizer') }),
        web: { provider: 'serpapi-raw', serpapi: { searchOrganic } } })
      const first = await service.runTurn({ requestId: 'noop-alias-first', generationId: generation1, tripId: trip.id,
        conversationId: conversation.id, locale: 'en', message: 'Make a one-day cultural guide for Tokyo.' })
      expect(first.delivery.status).toBe('satisfied')
      const researchRecord = (await artifacts.listForTrip(trip.id)).find(record => record.type === 'research')!
      const researchId = researchRecord.id
      const guideId = first.artifactRefs.find(ref => ref.type === 'travel_guide')!.id
      const baseGuide = await artifacts.get(guideId)
      expect(baseGuide).toMatchObject({ type: 'travel_guide', tripContextVersion: trip.context.version })

      const second = await service.runTurn({ requestId: 'noop-alias-second', generationId: generation2, tripId: trip.id,
        conversationId: conversation.id, locale: 'en', message: 'Keep the existing guide while I confirm the current budget.' })
      const searches = toolResults.filter(value => value.name === '__record_web'
        && (value.args as { tool?: string }).tool === 'web_search').slice(-2)
      const update = toolResults.find(value => value.name === 'update_trip_context')!
      expect(searches).toHaveLength(2)
      const firstSearch = searches[0]!.result as { sourceRefs: string[]; urls: string[] }
      const secondSearch = searches[1]!.result as { sourceRefs: string[]; urls: string[] }
      expect(firstSearch.urls).toEqual(['https://example.test/source-a'])
      expect(secondSearch.urls).toEqual(['https://example.test/source-b'])
      // An empty setter must preserve the evidence sequence within this generation.
      // Resetting it recreates the same scoped alias for another evidence record.
      expect(secondSearch.sourceRefs[0]).not.toBe(firstSearch.sourceRefs[0])
      expect(update.result).toMatchObject({ changed: false, completion: { status: 'pending' } })
      expect(second.delivery.status).toBe('pending')
      expect(JSON.parse(snapshots[1]!).preparedGuide).not.toBeNull()
      expect(JSON.parse(JSON.parse(snapshots[1]!).planning)).toMatchObject({ research: expect.arrayContaining([
        expect.objectContaining({ findings: expect.arrayContaining([expect.objectContaining({ candidateRef: expect.stringMatching(/^C-/) })]) })
      ]) })
      expect((await trips.get(trip.id))?.version).toBe(trip.context.version)
      expect((await artifacts.get(guideId))?.type).toBe('travel_guide')
      expect((await artifacts.get(researchId))?.type).toBe('research')
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)
})
