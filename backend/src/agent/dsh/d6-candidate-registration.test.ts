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
import { goalDeliverySchema } from '../goals/completion.js'
import { DshSessionManager } from './session-manager.js'
import { DshPlannerService } from './service.js'

const sources = [
  { url: 'https://example.test/ueno-museums', title: 'Ueno museums and park', snippet: 'Ueno Park brings together museum collections, a pond walk, and public garden paths suited to a relaxed cultural visit.' },
  { url: 'https://example.test/asakusa-culture', title: 'Asakusa streets and temple grounds', snippet: 'Asakusa pairs historic temple grounds with traditional craft streets and small food stalls within a compact neighborhood.' },
  { url: 'https://example.test/tokyo-crafts', title: 'Tokyo craft and garden visits', snippet: 'Tokyo visitors can combine a hands-on craft workshop with a quiet Japanese garden visit for a slower local culture day.' }
]
const intent = { kind: 'travel_guide', parameters: { questions: ['Plan two relaxed cultural days in Tokyo'],
  researchTypes: ['activity'], requiredEvidenceTypes: ['activity'], maxResults: 6, maxCities: 1, allowPartial: true } }
const candidateDefs = [
  ['ueno-museum', 'Ueno museum collection', 'Visit a museum collection in Ueno.'],
  ['ueno-pond', 'Shinobazu pond walk', 'Take a relaxed walk beside Shinobazu Pond.'],
  ['asakusa-temple', 'Asakusa temple grounds', 'Explore the historic temple grounds in Asakusa.'],
  ['asakusa-craft-street', 'Traditional craft street', 'Browse traditional craft shops in Asakusa.'],
  ['tokyo-craft-workshop', 'Tokyo craft workshop', 'Join a hands-on local craft workshop.'],
  ['japanese-garden', 'Japanese garden visit', 'Spend a quiet visit in a Japanese garden.']
] as const
const sourceForCandidate = [0, 0, 1, 1, 2, 2]
const days = [
  { day: 1, kind: 'visit', theme: 'Ueno and Asakusa culture', items: [0, 1, 2].map((index) => ({
    candidateKey: candidateDefs[index]![0], timeOfDay: (['morning', 'afternoon', 'evening'] as const)[index],
    planningNote: candidateDefs[index]![2], text: { name: candidateDefs[index]![1], introduction: candidateDefs[index]![2],
      recommendationReason: 'This distinct cultural stop supports a relaxed pace and matches your interest in local history.' }
  })) },
  { day: 2, kind: 'visit', theme: 'Crafts and garden time', items: [3, 4, 5].map((index) => ({
    candidateKey: candidateDefs[index]![0], timeOfDay: (['morning', 'afternoon', 'evening'] as const)[index - 3],
    planningNote: candidateDefs[index]![2], text: { name: candidateDefs[index]![1], introduction: candidateDefs[index]![2],
      recommendationReason: 'This distinct local experience supports a relaxed pace and adds a different view of Tokyo culture.' }
  })) }
]
const guideText = { reply: 'Your two-day cultural guide is ready.', overview: 'Explore Tokyo culture through museums, neighborhood history, craft, and quiet garden time.',
  days: [{ day: 1, theme: 'Ueno and Asakusa culture' }, { day: 2, theme: 'Crafts and garden time' }] }
const makeCandidates = (sourceRefs: string[]) => candidateDefs.map(([key, title, summary], index) => ({ key,
  sourceRefs: [sourceRefs[sourceForCandidate[index]!] ?? `fixture-source-${sourceForCandidate[index]}`], title, summary,
  category: 'activity', locationId: 'city:TYO' }))
const makeCommit = (includeCandidates: boolean, sourceRefs: string[]) => ({
  ...(includeCandidates ? { candidates: makeCandidates(sourceRefs) } : {}), intent, days,
  text: guideText
})

async function createHarness(fixture: unknown[], locale: 'en' | 'zh' = 'en') {
  const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-candidate-registration-'))
  const ownerId = 'd6-candidate-registration-owner', generationId = randomUUID()
  const trips = new InMemoryTripRepository()
  const trip = await trips.create({ initialContext: { travelDays: 2,
    destinationIntent: { mode: 'explicit', required: [{ id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }],
      preferred: [], excluded: [] }, interests: ['traditional culture', 'relaxed pace'] } })
  const owned = new Set([trip.id])
  const conversations = new InMemoryConversationRepository(ownerId, owned)
  const conversation = await conversations.create({ tripId: trip.id })
  const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' },
    web: { provider: 'serpapi-raw' }, fixture })
  const artifacts = new InMemoryArtifactRepository(ownerId, owned)
  const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
  const searchOrganic = vi.fn(async () => sources)
  const createFinalizer = vi.fn(() => { throw new Error('Unexpected legacy finalizer') })
  const service = new DshPlannerService({ ownerId, trips, conversations, sessions, artifacts,
    goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
    memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
    research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
    flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer,
    web: { provider: 'serpapi-raw', serpapi: { searchOrganic } } })
  return { root, ownerId, generationId, trips, trip, conversation, sessions, artifacts, goals, runs,
    searchOrganic, createFinalizer, service }
}

describe('D6 candidate registration across the official fixture worker', () => {
  it('rejects unregistered scheduled keys before writes, then registers and publishes with the same NEW intent and search sources', async () => {
    const harness = await createHarness([
      { tool: 'web_search', args: { queries: ['Tokyo relaxed cultural activities'] } },
      { tool: 'commit_travel_guide', args: makeCommit(false, []) },
      { tool: 'commit_travel_guide', args: makeCommit(true, ['source-placeholder-0', 'source-placeholder-1', 'source-placeholder-2']) },
      { text: guideText.reply }
    ])
    const { root, trip, conversation, generationId, sessions, artifacts, goals,
      searchOrganic, createFinalizer, service } = harness
    const rawRun = sessions.run.bind(sessions)
    const calls: Array<{ name: string; args: Record<string, any>; result: any }> = []
    let searchedRefs: string[] = []
    let afterFirstReject: { goals: number; artifacts: number } | undefined
    vi.spyOn(sessions, 'run').mockImplementation(input => rawRun({ ...input, execute: async (...args) => {
      const name = args[0] as string
      const actualArgs = structuredClone(args[1]) as Record<string, any>
      if (name === 'commit_travel_guide' && calls.filter(call => call.name === name).length === 1) {
        for (const candidate of actualArgs.candidates ?? []) {
          const index = Number(candidate.sourceRefs[0].split('-').at(-1))
          candidate.sourceRefs = [searchedRefs[index] ?? candidate.sourceRefs[0]]
        }
        args[1] = actualArgs
      }
      const result = await input.execute(...args)
      if (name === '__record_web') searchedRefs = (result as { sourceRefs: string[] }).sourceRefs
      if (name === 'commit_travel_guide') {
        calls.push({ name, args: actualArgs, result })
        if (calls.filter(call => call.name === name).length === 1) afterFirstReject = {
          goals: (await goals.listForTrip(trip.id)).length,
          artifacts: (await artifacts.listForTrip(trip.id)).length
        }
      }
      return result
    } }))

    try {
      const result = await service.runTurn({ requestId: 'candidate-registration-request', generationId,
        tripId: trip.id, conversationId: conversation.id, locale: 'en',
        message: 'Plan a relaxed two-day cultural guide for Tokyo.' })
      const commits = calls.filter(call => call.name === 'commit_travel_guide')
      expect(commits).toHaveLength(2)
      expect(commits[0]!.args.candidates).toBeUndefined()
      expect(commits[0]!.args.days.flatMap(day => day.items.map((item: any) => item.candidateKey))).toHaveLength(6)
      expect(commits[0]!.result).toMatchObject({ ok: false, error: {
        code: 'DSH_GUIDE_NEEDS_REVISION', kind: 'prerequisite', revisionCode: 'candidate_key_unavailable',
        fieldPath: 'candidates', registrationStatus: 'not_submitted', availableCandidateKeys: []
      } })
      expect(JSON.stringify(commits[0]!.result)).toMatch(/candidates/i)
      expect(JSON.stringify(commits[0]!.result)).toMatch(/No candidates are registered/i)
      expect(JSON.stringify(commits[0]!.result)).toMatch(/sourceRefs|source refs|source references/i)
      expect(afterFirstReject).toEqual({ goals: 0, artifacts: 0 })
      expect(commits[1]!.args.intent).toEqual(intent)
      expect(commits[1]!.args.candidates).toHaveLength(6)
      expect(commits[1]!.args.candidates.flatMap((candidate: any) => candidate.sourceRefs))
        .toEqual(candidateDefs.map((_, index) => searchedRefs[sourceForCandidate[index]!]))
      expect(commits[1]!.result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' } })
      expect(await goals.listForTrip(trip.id)).toHaveLength(1)
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

  it('keeps an unavailable candidate-key failure private when no registration is ever supplied', async () => {
    const harness = await createHarness([
      { tool: 'update_trip_context', args: { patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } },
        intent: { kind: 'trip_context_update', parameters: { fields: ['budget'] } } } },
      { tool: 'web_search', args: { queries: ['Tokyo relaxed cultural activities'] } },
      { tool: 'commit_travel_guide', args: makeCommit(false, []) },
      { tool: 'commit_travel_guide', args: { ...makeCommit(false, []), days: days.map((day, dayIndex) => ({ ...day,
        items: day.items.map((item, itemIndex) => ({ ...item, candidateKey: `renamed-${dayIndex}-${itemIndex}` })) })) } },
      { text: 'The guide is ready.' }
    ], 'zh')
    const { root, trip, conversation, generationId, trips, sessions, artifacts, goals,
      searchOrganic, createFinalizer, service } = harness
    const calls: Array<{ name: string; args: Record<string, any>; result: any }> = []
    const rawRun = sessions.run.bind(sessions)
    vi.spyOn(sessions, 'run').mockImplementation(input => rawRun({ ...input, execute: async (...args) => {
      const result = await input.execute(...args)
      if (args[0] === 'commit_travel_guide') calls.push({ name: args[0], args: args[1] as Record<string, any>, result })
      return result
    } }))
    try {
      const result = await service.runTurn({ requestId: 'candidate-registration-unavailable-request', generationId,
        tripId: trip.id, conversationId: conversation.id, locale: 'zh',
        message: 'Plan a relaxed two-day cultural guide for Tokyo.' })
      expect(calls).toHaveLength(2)
      expect(calls[0]!.args.candidates).toBeUndefined()
      expect(calls[1]!.args.candidates).toBeUndefined()
      expect(calls[1]!.args.intent).toEqual(intent)
      expect(result.reply).toBe('行程活动与参考资料未能正确关联，本轮未确认新的攻略结果。请先查看行程中已保存的结果，再重试本次请求。')
      expect(result.reply).not.toMatch(/candidate_key_unavailable|DSH_GUIDE_NEEDS_REVISION|ueno-museum|renamed-[0-9]/i)
      expect(result.delivery).toMatchObject({ status: 'partial', kind: 'travel_guide', artifactIds: [],
        missing: ['accepted_publication'], goals: [] })
      expect(result.delivery).not.toHaveProperty('goalId')
      expect(goalDeliverySchema.parse(result.delivery)).toEqual(result.delivery)
      expect(result.stopReason).toBe('goal_partial')
      const savedGoals = await goals.listForTrip(trip.id)
      expect(savedGoals).toHaveLength(1)
      expect(savedGoals[0]).toMatchObject({ kind: 'trip_context_update', status: 'satisfied' })
      expect((await trips.get(trip.id))?.budget).toEqual({ amount: 1200, currency: 'CNY', scope: 'trip' })
      expect((await artifacts.listForTrip(trip.id)).filter(record => ['research', 'travel_guide'].includes(record.type))).toHaveLength(0)
      expect(searchOrganic).toHaveBeenCalledTimes(1)
      expect(createFinalizer).not.toHaveBeenCalled()
    } finally {
      await sessions.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
