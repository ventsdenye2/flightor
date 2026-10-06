import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import type { AirportLookupInput } from '../../aviation/providers/provider.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { locationRefKey } from '../../aviation/types.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { createCoreToolRegistry, createPlannerToolRegistry } from './core.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'

const location = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', cityCode: 'SHA', iata: 'PVG' }
const destination = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita International', countryCode: 'JP', cityCode: 'TYO', iata: 'NRT' }
const fareResult = {
  query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-01', currency: 'CNY' as const, travelClass: 1 },
  offers: [{ id: 'offer-1', segments: [{ flightNumber: 'FM1', airline: 'Mock Air', origin: 'PVG', destination: 'NRT', departsAt: '2026-10-01T08:00:00Z', arrivesAt: '2026-10-01T12:00:00Z', durationMinutes: 240 }], totalAmount: 1200, currency: 'CNY', totalDurationMinutes: 240, airlines: ['Mock Air'], transferType: 'direct' as const }],
  provider: 'mock-fares', checkedAt: '2026-09-06T00:00:00.000Z',
  verification: { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-fares', reference: 'fixed' }] }
}

class TestAviationProvider extends MockAviationProvider {
  override async getAirport(input: AirportLookupInput) {
    return input.iata === 'PVG' ? location : input.iata === 'NRT' ? destination : undefined
  }
}

function context(): ToolExecutionContext {
  const trips = new Set(['trip-1'])
  return {
    requestId: 'req-1', conversationId: 'conv-1', tripId: 'trip-1', generationId: 'gen-1',
    trips: new InMemoryTripContextRepository([emptyTripContext('trip-1')]),
    artifacts: new InMemoryArtifactRepository('user-1', trips),
    memory: new InMemoryUserMemoryRepository(),
    aviation: new TestAviationProvider({ resolveLocation: { matches: [location], verification: { status: 'verified', checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-aviation' }] } } }),
    fares: new MockFareProvider({ search: fareResult }),
    research: new UnavailableResearchAgent(),
    connectionSearch: new UnavailableConnectionSearchService(),
    flightRoutePlanner: new UnavailableFlightRoutePlanner(),
    routeOptimizer: new UnavailableRouteOptimizer(),
    resolvedLocationKeys: new Set([locationRefKey(location), locationRefKey(destination)])
  }
}

async function tripUpdateContext(): Promise<ToolExecutionContext> {
  const ctx = context()
  ctx.ownerId = 'user-1'
  ctx.conversationId = randomUUID()
  ctx.requestId = randomUUID()
  ctx.tripContextSnapshot = await ctx.trips.get(ctx.tripId)
  const goals = new InMemoryGoalRepository(ctx.ownerId)
  ctx.goalRepository = goals
  ctx.goalRunRepository = new InMemoryGoalRunRepository(ctx.ownerId, goals)
  ctx.goalVerifiers = createDefaultGoalVerifierRegistry()
  return ctx
}

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

describe('core agent tools', () => {
  it('registers the complete Phase 4B tool vocabulary once', () => {
    const names = createCoreToolRegistry().definitions().map(definition => definition.function.name)
    expect(names).toEqual(expect.arrayContaining([
      'search_destinations',
      'recommend_destinations',
      'plan_trip_route',
      'confirm_flight_price',
      'confirm_route_price',
      'research_destination',
      'build_travel_guide'
    ]))
    expect(new Set(names).size).toBe(names.length)
  })

  it('exposes only the authorized route start operation, not internal route-engine tools', () => {
    const names = createPlannerToolRegistry().definitions().map(definition => definition.function.name)
    expect(names).not.toEqual(expect.arrayContaining([
      'search_connection_flights', 'plan_flight_route', 'optimize_route', 'confirm_route_price'
    ]))
    expect(names).toEqual(expect.arrayContaining([
      'search_destinations', 'research_destination', 'search_flights', 'start_route_generation'
    ]))
  })

  it('resolves a location through the mock provider', async () => {
    const result = await createCoreToolRegistry().execute(call('loc-1', 'resolve_location', { query: 'Shanghai', types: ['city'] }), context(), new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.content).data.matches[0]).toEqual(location)
    expect(result.provider).toBe('aviation_provider')
  })

  it('searches flights and emits a deterministic artifact/provenance', async () => {
    const result = await createCoreToolRegistry().execute(call('fare-1', 'search_flights', { departureDate: fareResult.query.departureDate, currency: fareResult.query.currency, travelClass: fareResult.query.travelClass, origin: 'PVG', destination: 'NRT' }), context(), new AbortController().signal)
    const body = JSON.parse(result.content)
    expect(result.ok, result.content).toBe(true)
    expect(result.artifactIds).toHaveLength(1)
    expect(body.data.artifact.type).toBe('flight_search')
    expect(body.data.summary.provider).toBe('mock-fares')
    expect(result.provider).toBe('fare_provider')
  })

  it('reads and updates enabled User Memory with optimistic concurrency', async () => {
    const ctx = context()
    const registry = createCoreToolRegistry()
    const initial = await registry.execute(call('m-1', 'get_user_memory', {}), ctx, new AbortController().signal)
    expect(JSON.parse(initial.content).data).toMatchObject({ enabled: true, markdown: '', version: 0 })
    const updated = await registry.execute(call('m-2', 'update_user_memory', { markdown: '- Prefers aisle seats', expectedVersion: 0 }), ctx, new AbortController().signal)
    expect(JSON.parse(updated.content).data).toMatchObject({ version: 1, markdown: '- Prefers aisle seats' })
    const stale = await registry.execute(call('m-3', 'update_user_memory', { markdown: 'stale', expectedVersion: 0 }), ctx, new AbortController().signal)
    expect(stale.errorCode).toBe('TOOL_FAILURE')
  })

  it('does not expose or automatically write disabled User Memory', async () => {
    const ctx = context()
    await ctx.memory.setEnabled(false, 0)
    const registry = createCoreToolRegistry()
    const read = await registry.execute(call('m-4', 'get_user_memory', {}), ctx, new AbortController().signal)
    expect(JSON.parse(read.content).data).toEqual({ enabled: false, version: 1 })
    const write = await registry.execute(call('m-5', 'update_user_memory', { markdown: 'blocked', expectedVersion: 1 }), ctx, new AbortController().signal)
    expect(write).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
    expect(write.content).toContain('User Memory is disabled')
  })

  it('rejects unknown airports at the aviation boundary', async () => {
    const ctx = context()
    const result = await createCoreToolRegistry().execute(call('fare-2', 'search_flights', {
      departureDate: fareResult.query.departureDate,
      origin: 'PVG',
      destination: 'ZZZ'
    }), ctx, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
  })

  it('rejects a provider offer whose endpoints do not match the query', async () => {
    const ctx = context()
    ctx.fares = new MockFareProvider({
      search: {
        ...fareResult,
        offers: [{
          ...fareResult.offers[0]!,
          segments: [{ ...fareResult.offers[0]!.segments[0]!, origin: 'LHR' }]
        }]
      }
    })
    const result = await createCoreToolRegistry().execute(call('fare-3', 'search_flights', {
      departureDate: fareResult.query.departureDate,
      origin: 'PVG',
      destination: 'NRT'
    }), ctx, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, errorCode: 'TOOL_FAILURE' })
  })

  it('updates trip context and enforces version conflicts', async () => {
    const ctx = context()
    const registry = createCoreToolRegistry()
    const updated = await registry.execute(call('u-1', 'update_trip_context', { patch: { notes: ['keep receipts'] }, expectedVersion: 0 }), ctx, new AbortController().signal)
    expect(JSON.parse(updated.content).data.tripContext.version).toBe(1)
    const conflict = await registry.execute(call('u-2', 'update_trip_context', { patch: { notes: ['stale'] }, expectedVersion: 0 }), ctx, new AbortController().signal)
    expect(conflict.errorCode).toBe('TOOL_FAILURE')
    expect(conflict.content).toContain('Trip context version conflict')
  })

  it('rejects Trip patch fields outside the accepted Goal without changing Trip or writing a receipt', async () => {
    const ctx = await tripUpdateContext()
    const before = await ctx.trips.get(ctx.tripId)
    const result = await createPlannerToolRegistry({ leanGoalsEnabled: true }).execute(call('goal-update-1', 'update_trip_context', {
      intent: { kind: 'trip_context_update', parameters: { fields: ['budget'] } },
      patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, notes: ['not requested'] }
    }), ctx, new AbortController().signal)

    expect(result).toMatchObject({ ok: false, domainErrorCode: 'GOAL_FIELD_SCOPE_MISMATCH' })
    expect(await ctx.trips.get(ctx.tripId)).toEqual(before)
    const [goal] = await ctx.goalRepository!.listForTrip(ctx.tripId)
    expect(goal).toBeDefined()
    const [run] = await ctx.goalRunRepository!.listForGoal(goal!.id)
    expect(run?.workingSet.tripUpdateReceipt).toBeUndefined()
    expect(run?.status).toBe('running')
  })

  it('allows exactly the accepted Trip fields and keeps an empty patch write-free', async () => {
    const ctx = await tripUpdateContext()
    const intent = { kind: 'trip_context_update' as const, parameters: { fields: ['budget', 'notes'] } }
    const registry = createPlannerToolRegistry({ leanGoalsEnabled: true })
    const result = await registry.execute(call('goal-update-2', 'update_trip_context', {
      intent, patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, notes: ['requested'] }
    }), ctx, new AbortController().signal)

    expect(result.ok).toBe(true)
    expect(JSON.parse(result.content).data.completion.status).toBe('satisfied')
    const updated = await ctx.trips.get(ctx.tripId)
    expect(updated).toMatchObject({ version: 1, budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, notes: ['requested'] })
    const [goal] = await ctx.goalRepository!.listForTrip(ctx.tripId)
    const [run] = await ctx.goalRunRepository!.listForGoal(goal!.id)
    expect(Object.keys(run!.workingSet.tripUpdateReceipt!.fieldHashes).sort()).toEqual(['budget', 'notes'])

    const empty = await tripUpdateContext()
    const beforeEmpty = await empty.trips.get(empty.tripId)
    const emptyResult = await createPlannerToolRegistry({ leanGoalsEnabled: true }).execute(call('goal-update-empty', 'update_trip_context', {
      intent: { kind: 'trip_context_update', parameters: { fields: ['budget'] } }, patch: {}
    }), empty, new AbortController().signal)
    expect(emptyResult.ok).toBe(true)
    expect(JSON.parse(emptyResult.content).data).toMatchObject({ changed: false, completion: { status: 'pending' } })
    expect(await empty.trips.get(empty.tripId)).toEqual(beforeEmpty)
    const [emptyGoal] = await empty.goalRepository!.listForTrip(empty.tripId)
    const [emptyRun] = await empty.goalRunRepository!.listForGoal(emptyGoal!.id)
    expect(emptyRun?.workingSet.tripUpdateReceipt).toBeUndefined()
  })

  it('does not allow a same-turn setter correction to expand accepted Goal fields', async () => {
    const ctx = await tripUpdateContext()
    const registry = createPlannerToolRegistry({ leanGoalsEnabled: true })
    const before = await ctx.trips.get(ctx.tripId)
    await registry.execute(call('goal-update-narrow', 'update_trip_context', {
      intent: { kind: 'trip_context_update', parameters: { fields: ['budget'] } },
      patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, notes: ['not requested'] }
    }), ctx, new AbortController().signal)
    const expanded = await registry.execute(call('goal-update-expand', 'update_trip_context', {
      intent: { kind: 'trip_context_update', parameters: { fields: ['budget', 'notes'] } },
      patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, notes: ['not requested'] }
    }), ctx, new AbortController().signal)

    expect(expanded).toMatchObject({ ok: false, domainErrorCode: 'GOAL_INTENT_CONFLICT' })
    expect(await ctx.trips.get(ctx.tripId)).toEqual(before)
    const [goal] = await ctx.goalRepository!.listForTrip(ctx.tripId)
    const [run] = await ctx.goalRunRepository!.listForGoal(goal!.id)
    expect(run?.workingSet.tripUpdateReceipt).toBeUndefined()
  })

  it('fails closed when a legacy active Trip update Goal has no accepted field binding', async () => {
    const ctx = context()
    ctx.activeGoalId = randomUUID()
    ctx.activeGoalKind = 'trip_context_update'
    const before = await ctx.trips.get(ctx.tripId)
    const result = await createCoreToolRegistry().execute(call('legacy-goal-update', 'update_trip_context', {
      patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }
    }), ctx, new AbortController().signal)

    expect(result).toMatchObject({ ok: false, domainErrorCode: 'GOAL_FIELD_SCOPE_MISMATCH' })
    expect(await ctx.trips.get(ctx.tripId)).toEqual(before)
  })

  it('allows a legacy declare_goal activation to update only its accepted Trip fields', async () => {
    const ctx = await tripUpdateContext()
    const registry = createPlannerToolRegistry()
    const declared = await registry.execute(call('legacy-declare-budget', 'declare_goal', {
      kind: 'trip_context_update', parameters: { fields: ['budget'] }
    }), ctx, new AbortController().signal)
    expect(declared.ok).toBe(true)

    const updated = await registry.execute(call('legacy-set-budget', 'update_trip_context', {
      patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }
    }), ctx, new AbortController().signal)

    expect(updated.ok).toBe(true)
    expect(await ctx.trips.get(ctx.tripId)).toMatchObject({ version: 1, budget: { amount: 1200, currency: 'CNY', scope: 'trip' } })
    const [goal] = await ctx.goalRepository!.listForTrip(ctx.tripId)
    const [run] = await ctx.goalRunRepository!.listForGoal(goal!.id)
    expect(Object.keys(run!.workingSet.tripUpdateReceipt!.fieldHashes)).toEqual(['budget'])
    const outsideScope = await registry.execute(call('legacy-set-notes', 'update_trip_context', {
      patch: { notes: ['out of scope'] }
    }), ctx, new AbortController().signal)
    expect(outsideScope).toMatchObject({ ok: false, domainErrorCode: 'GOAL_FIELD_SCOPE_MISMATCH' })
    expect(await ctx.trips.get(ctx.tripId)).toMatchObject({ version: 1, notes: [] })
  })

  it('allows a legacy resume_goal activation to update only its persisted Goal fields', async () => {
    const ctx = await tripUpdateContext()
    const created = await ctx.goalRepository!.create({ tripId: ctx.tripId, conversationId: ctx.conversationId,
      kind: 'trip_context_update', parameters: { fields: ['budget'] }, createdContextVersion: 0,
      idempotencyKey: 'legacy-resume-budget' })
    const previous = await ctx.goalRunRepository!.create({ goalId: created.goal.id, tripId: ctx.tripId,
      generationId: 'old-generation', contextVersion: 0, contextSnapshot: await ctx.trips.get(ctx.tripId),
      idempotencyKey: 'legacy-resume-old-run' })
    await ctx.goalRunRepository!.update(previous.run.id, previous.run.revision,
      { status: 'failed', workingSet: previous.run.workingSet })

    const registry = createPlannerToolRegistry()
    const resumed = await registry.execute(call('legacy-resume-budget', 'resume_goal', { goalId: created.goal.id }), ctx, new AbortController().signal)
    expect(resumed.ok).toBe(true)
    const updated = await registry.execute(call('legacy-resumed-set-budget', 'update_trip_context', {
      patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }
    }), ctx, new AbortController().signal)

    expect(updated.ok).toBe(true)
    expect(await ctx.trips.get(ctx.tripId)).toMatchObject({ version: 1, budget: { amount: 1200, currency: 'CNY', scope: 'trip' } })
  })

  it('keeps a legacy Trip update scope after finish_goal returns pending on a running attempt', async () => {
    const ctx = await tripUpdateContext()
    const registry = createPlannerToolRegistry()
    expect((await registry.execute(call('legacy-declare-budget-notes', 'declare_goal', {
      kind: 'trip_context_update', parameters: { fields: ['budget', 'notes'] }
    }), ctx, new AbortController().signal)).ok).toBe(true)
    const [goal] = await ctx.goalRepository!.listForTrip(ctx.tripId)

    const finished = await registry.execute(call('legacy-finish-pending-update', 'finish_goal', { goalId: goal!.id }),
      ctx, new AbortController().signal)
    expect(finished.ok).toBe(true)
    expect(JSON.parse(finished.content).data).toMatchObject({
      verification: { status: 'pending' }, run: { status: 'running' }
    })
    expect(ctx.tripContextUpdateGoalScope).toMatchObject({ goalId: goal!.id, fields: ['budget', 'notes'] })

    const updated = await registry.execute(call('legacy-write-after-pending-finish', 'update_trip_context', {
      patch: { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } }
    }), ctx, new AbortController().signal)
    expect(updated.ok).toBe(true)
    expect(await ctx.trips.get(ctx.tripId)).toMatchObject({ version: 1, budget: { amount: 1200, currency: 'CNY', scope: 'trip' } })
  })

  it('does not commit a delayed context mutation after cancellation', async () => {
    const ctx = context()
    const stored = emptyTripContext('trip-1')
    let committed = false
    ctx.trips = {
      async get() { return structuredClone(stored) },
      async update(_tripId, patch, _expectedVersion, guard) {
        await new Promise(resolve => setTimeout(resolve, 20))
        if (guard?.signal?.aborted || guard?.isCurrent?.() === false) throw new Error('cancelled')
        committed = true
        return { ...stored, ...patch, version: 1 }
      }
    }
    const controller = new AbortController()
    const pending = createCoreToolRegistry().execute(call('u-3', 'update_trip_context', {
      patch: { notes: ['must not commit'] },
      expectedVersion: 0
    }), ctx, controller.signal)
    setTimeout(() => controller.abort(), 1)
    expect((await pending).errorCode).toBe('TOOL_CANCELLED')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(committed).toBe(false)
  })
})
