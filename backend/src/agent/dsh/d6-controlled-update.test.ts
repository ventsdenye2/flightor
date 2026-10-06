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

const snippet = 'The Tokyo National Museum presents exhibits about Japanese culture and history.'
const source = { url: 'https://example.test/tokyo-museum', title: 'Tokyo National Museum', snippet }
const query = 'Tokyo cultural museum'
const guideIntent = { kind: 'travel_guide', parameters: { questions: ['Visit a cultural museum in Tokyo'], researchTypes: ['activity'],
  requiredEvidenceTypes: ['activity'], maxResults: 1, maxCities: 1, allowPartial: true } }
const updateIntent = { kind: 'trip_context_update', parameters: { fields: ['budget'] } }
const budget = { amount: 1200, currency: 'CNY', scope: 'trip' }

async function sourceAlias(input: { ownerId: string; tripId: string; conversationId: string; generationId: string; version: number }) {
  const store = new DshEvidenceStore({ ownerId: input.ownerId, tripId: input.tripId, conversationId: input.conversationId,
    generationId: input.generationId, tripContextVersion: input.version }, { now: () => new Date('2026-10-06T00:00:00.000Z') })
  const result = await store.recordSearch({ sources: [source] }, 'serpapi-raw', 'fixture-search')
  return result.sourceRefs[0]!
}

describe('D6 same-turn controlled Trip update then guide publication', () => {
  it('accepts a compact sourced guide after the budget update Goal is satisfied and refuses pre-update evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-controlled-update-'))
    const ownerId = 'd6-controlled-update-owner', generationId = randomUUID()
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ initialContext: { travelDays: 1,
      destinationIntent: { mode: 'explicit', required: [{ id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }],
        preferred: [], excluded: [] }, interests: ['traditional culture'] } })
    const owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned)
    const conversation = await conversations.create({ tripId: trip.id })
    const oldAlias = await sourceAlias({ ownerId, tripId: trip.id, conversationId: conversation.id, generationId, version: trip.context.version })
    const currentAlias = await sourceAlias({ ownerId, tripId: trip.id, conversationId: conversation.id, generationId, version: trip.context.version + 1 })
    expect(oldAlias).not.toBe(currentAlias)

    const compactCommit = (sourceRef: string, includeIntent: boolean) => ({
      ...(includeIntent ? { intent: guideIntent } : {}),
      candidates: [{ key: 'tokyo-museum', sourceRefs: [sourceRef], title: 'Tokyo National Museum',
        summary: 'Explore exhibits about Japanese culture and history at a relaxed pace.', category: 'activity' }],
      days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'Tokyo culture', items: [{ candidateKey: 'tokyo-museum',
        timeOfDay: 'afternoon', planningNote: 'Explore the exhibits at a relaxed pace.', text: { name: 'Tokyo National Museum visit',
          introduction: 'Explore exhibits about Japanese culture and history.',
          recommendationReason: 'The museum matches your interest in traditional culture.' } }] }],
      text: { reply: 'Your Tokyo museum visit is ready.', overview: 'Explore Japanese culture at a relaxed pace in Tokyo.',
        days: [{ day: 1, theme: 'Tokyo culture' }] }
    })
    const fixture = [
      { tool: 'web_search', args: { queries: [query] } },
      { tool: 'update_trip_context', args: { patch: { budget }, intent: updateIntent } },
      { tool: 'commit_travel_guide', args: compactCommit(oldAlias, false) },
      { tool: 'commit_travel_guide', args: compactCommit(oldAlias, true) },
      { tool: 'web_search', args: { queries: [query] } },
      { tool: 'commit_travel_guide', args: compactCommit(currentAlias, false) },
      { text: 'The Tokyo museum itinerary is saved.' }
    ]
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, web: { provider: 'serpapi-raw' }, fixture })
    const actualRun = sessions.run.bind(sessions)
    const toolResults: Array<{ name: string; args: Record<string, unknown>; result: unknown }> = []
    vi.spyOn(sessions, 'run').mockImplementation(input => actualRun({ ...input, execute: async (...args) => {
      const result = await input.execute(...args)
      if (['update_trip_context', 'commit_travel_guide'].includes(args[0])) {
        toolResults.push({ name: args[0], args: args[1] as Record<string, unknown>, result })
      }
      return result
    } }))
    try {
      const artifacts = new InMemoryArtifactRepository(ownerId, owned)
      const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
      const accept = vi.spyOn(runs, 'accept')
      const searchOrganic = vi.fn(async () => [source])
      const research = new UnavailableResearchAgent()
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions, artifacts,
        goalRepository: goals, goalRunRepository: runs, goalVerifiers: createDefaultGoalVerifierRegistry(),
        memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
        research, connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
        routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: vi.fn(() => { throw new Error('Unexpected legacy finalizer') }),
        web: { provider: 'serpapi-raw', serpapi: { searchOrganic } } })

      const result = await service.runTurn({ requestId: 'controlled-update-request', generationId, tripId: trip.id,
        conversationId: conversation.id, locale: 'en', message: 'Set my whole-trip budget to CNY 1200 and make a one-day cultural guide for Tokyo.' })
      const updates = toolResults.filter(value => value.name === 'update_trip_context')
      const commits = toolResults.filter(value => value.name === 'commit_travel_guide')
      expect(updates).toHaveLength(1)
      expect(updates[0]!.result).toMatchObject({ completion: { status: 'satisfied' }, acceptedGoal: { kind: 'trip_context_update' } })
      expect(commits).toHaveLength(3)
      expect(commits[0]!.args.intent).toBeUndefined()
      expect(commits[0]!.result).toMatchObject({ ok: false, error: { code: 'GOAL_INTENT_REQUIRED' } })
      expect((commits[1]!.args.candidates as Array<{ sourceRefs: string[] }>)[0]!.sourceRefs).toEqual([oldAlias])
      expect(commits[1]!.result).toMatchObject({ ok: false,
        error: { code: 'DSH_GUIDE_NEEDS_REVISION', revisionCode: 'candidate_evidence_unavailable' } })
      expect(commits[1]!.args.intent).toEqual(guideIntent)
      expect((commits[2]!.args.candidates as Array<{ sourceRefs: string[] }>)[0]!.sourceRefs).toEqual([currentAlias])
      expect(commits[2]!.args.intent).toBeUndefined()
      for (const commit of commits) {
        expect(commit.args).not.toHaveProperty('baseGuideId')
        expect(commit.args).not.toHaveProperty('expectedContentHash')
        expect(commit.args).not.toHaveProperty('replaceSlots')
      }
      expect(commits[2]!.result).toMatchObject({ status: 'accepted', completion: { status: 'satisfied' }, acceptedGoal: { kind: 'travel_guide' } })
      expect(await trips.get(trip.id)).toMatchObject({ version: trip.context.version + 1, budget })
      expect(result.delivery.status).toBe('satisfied')
      expect(result.artifactRefs).toHaveLength(1)
      const acceptedGoals = await goals.listForTrip(trip.id)
      expect(acceptedGoals).toHaveLength(2)
      expect(acceptedGoals.sort((left, right) => left.createdContextVersion - right.createdContextVersion)
        .map(goal => [goal.kind, goal.status, goal.createdContextVersion])).toEqual([
        ['trip_context_update', 'satisfied', trip.context.version], ['travel_guide', 'satisfied', trip.context.version + 1]
      ])
      expect(accept.mock.calls).toHaveLength(2)
      const acceptedRuns = accept.mock.calls.map(([input]) => input)
      expect(acceptedRuns[0]!.requestId).not.toBe(acceptedRuns[1]!.requestId)
      expect(acceptedRuns.map(input => input.contextSnapshot.version)).toEqual([trip.context.version, trip.context.version + 1])
      expect(acceptedRuns.every(input => input.generationId === generationId)).toBe(true)
      expect(await artifacts.listForTrip(trip.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'research', tripContextVersion: trip.context.version + 1 }),
        expect.objectContaining({ type: 'travel_guide', tripContextVersion: trip.context.version + 1 })
      ]))
      expect(searchOrganic).toHaveBeenCalledTimes(2)
      expect(result.reply).toContain('Tokyo museum visit')
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  it('does not start a new Goal after a changed setter whose requested fields are not satisfied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-controlled-update-pending-'))
    const ownerId = 'd6-pending-update-owner', generationId = randomUUID()
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ initialContext: { travelDays: 1,
      destinationIntent: { mode: 'explicit', required: [{ id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }],
        preferred: [], excluded: [] } } })
    const owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned)
    const conversation = await conversations.create({ tripId: trip.id })
    const commitIntent = { kind: 'travel_guide', parameters: { questions: ['Visit a cultural museum in Tokyo'], researchTypes: ['activity'],
      requiredEvidenceTypes: ['activity'], maxResults: 1, maxCities: 1, allowPartial: true } }
    const args = { intent: commitIntent, candidates: [{ key: 'tokyo-museum', sourceRefs: ['s1.stale.abc1234567.1'],
      title: 'Tokyo National Museum', summary: 'Explore exhibits about Japanese culture.', category: 'activity' }],
      days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'Tokyo culture', items: [{ candidateKey: 'tokyo-museum', timeOfDay: 'afternoon',
        planningNote: 'Explore the exhibits.', text: { name: 'Tokyo National Museum visit', introduction: 'Explore exhibits about Japanese culture.',
          recommendationReason: 'The visit matches your cultural interest.' } }] }],
      text: { reply: 'Your Tokyo museum visit is ready.', overview: 'Explore Japanese culture in Tokyo.', days: [{ day: 1, theme: 'Tokyo culture' }] } }
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { tool: 'update_trip_context', args: { patch: { notes: ['Relaxed pace'] }, intent: updateIntent } },
      { tool: 'commit_travel_guide', args }
    ] })
    const actualRun = sessions.run.bind(sessions)
    const results: Array<{ name: string; result: unknown }> = []
    vi.spyOn(sessions, 'run').mockImplementation(input => actualRun({ ...input, execute: async (...call) => {
      const result = await input.execute(...call)
      if (['update_trip_context', 'commit_travel_guide'].includes(call[0])) results.push({ name: call[0], result })
      return result
    } }))
    try {
      const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
      const accept = vi.spyOn(runs, 'accept')
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions,
        artifacts: new InMemoryArtifactRepository(ownerId, owned), goalRepository: goals, goalRunRepository: runs,
        goalVerifiers: createDefaultGoalVerifierRegistry(), memory: new InMemoryUserMemoryRepository(),
        aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
        connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
        routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: vi.fn(() => { throw new Error('Unexpected legacy finalizer') }) })
      await service.runTurn({ requestId: 'pending-update-request', generationId, tripId: trip.id,
        conversationId: conversation.id, locale: 'en', message: 'Set a budget and make a Tokyo guide.' })
      expect(results[0]!.result).toMatchObject({ acceptedGoal: { kind: 'trip_context_update' }, completion: { status: 'pending' } })
      expect(results[1]!.result).toMatchObject({ ok: false, error: { code: 'GOAL_INTENT_CONFLICT' } })
      expect(accept).toHaveBeenCalledTimes(1)
      expect(await goals.listForTrip(trip.id)).toHaveLength(1)
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  it('does not start a new Goal after a Trip setter fails before its controlled write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-controlled-update-error-'))
    const ownerId = 'd6-error-update-owner', generationId = randomUUID()
    const trips = new InMemoryTripRepository()
    const trip = await trips.create({ initialContext: { travelDays: 1,
      destinationIntent: { mode: 'explicit', required: [{ id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }],
        preferred: [], excluded: [] } } })
    const owned = new Set([trip.id])
    const conversations = new InMemoryConversationRepository(ownerId, owned)
    const conversation = await conversations.create({ tripId: trip.id })
    const failedUpdateIntent = { kind: 'trip_context_update', parameters: { fields: ['departureWindow', 'returnWindow', 'travelDays'] } }
    const args = { intent: guideIntent, candidates: [{ key: 'tokyo-museum', sourceRefs: ['s1.stale.abc1234567.1'],
      title: 'Tokyo National Museum', summary: 'Explore exhibits about Japanese culture.', category: 'activity' }],
      days: [{ day: 1, cityId: 'city:TYO', kind: 'visit', theme: 'Tokyo culture', items: [{ candidateKey: 'tokyo-museum', timeOfDay: 'afternoon',
        planningNote: 'Explore the exhibits.', text: { name: 'Tokyo National Museum visit', introduction: 'Explore exhibits about Japanese culture.',
          recommendationReason: 'The visit matches your cultural interest.' } }] }],
      text: { reply: 'Your Tokyo museum visit is ready.', overview: 'Explore Japanese culture in Tokyo.', days: [{ day: 1, theme: 'Tokyo culture' }] } }
    const sessions = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [
      { tool: 'update_trip_context', args: { patch: { departureWindow: { from: '2026-10-01', to: '2026-10-01', precision: 'exact' },
        returnWindow: { from: '2026-10-05', to: '2026-10-05', precision: 'exact' }, travelDays: 2 }, intent: failedUpdateIntent } },
      { tool: 'commit_travel_guide', args }
    ] })
    const actualRun = sessions.run.bind(sessions)
    const results: Array<{ name: string; result: unknown }> = []
    vi.spyOn(sessions, 'run').mockImplementation(input => actualRun({ ...input, execute: async (...call) => {
      const result = await input.execute(...call)
      if (['update_trip_context', 'commit_travel_guide'].includes(call[0])) results.push({ name: call[0], result })
      return result
    } }))
    try {
      const goals = new InMemoryGoalRepository(ownerId), runs = new InMemoryGoalRunRepository(ownerId, goals)
      const accept = vi.spyOn(runs, 'accept')
      const service = new DshPlannerService({ ownerId, trips, conversations, sessions,
        artifacts: new InMemoryArtifactRepository(ownerId, owned), goalRepository: goals, goalRunRepository: runs,
        goalVerifiers: createDefaultGoalVerifierRegistry(), memory: new InMemoryUserMemoryRepository(),
        aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
        connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(),
        routeOptimizer: new UnavailableRouteOptimizer(), createFinalizer: vi.fn(() => { throw new Error('Unexpected legacy finalizer') }) })
      await service.runTurn({ requestId: 'error-update-request', generationId, tripId: trip.id,
        conversationId: conversation.id, locale: 'en', message: 'Change dates and make a Tokyo guide.' })
      expect(results[0]!.result).toMatchObject({ ok: false, error: { code: 'TRIP_DATES_INCONSISTENT' } })
      expect(results[1]!.result).toMatchObject({ ok: false, error: { code: 'GOAL_INTENT_CONFLICT' } })
      expect(accept).toHaveBeenCalledTimes(1)
      expect(await goals.listForTrip(trip.id)).toHaveLength(1)
      expect(await trips.get(trip.id)).toMatchObject({ version: trip.context.version, travelDays: 1 })
    } finally { await sessions.close(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)
})
