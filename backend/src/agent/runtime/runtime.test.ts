import { describe, expect, it, vi } from 'vitest'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { createCoreToolRegistry } from '../tools/core.js'
import { ToolRegistry, type AgentTool, type ToolExecutionContext } from './registry.js'
import { AgentRuntime } from './runtime.js'
import type { AgentModelClient } from './model.js'
import type { ProviderCallOptions, ResolveLocationInput } from '../../aviation/providers/provider.js'
import { z } from 'zod'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import { GoalVerifierRegistry, type GoalVerification } from '../goals/verifier.js'
import { AppError } from '../../lib/errors.js'

const ctx: ToolExecutionContext = { requestId: 'r', conversationId: 'c', tripId: 't', generationId: 'g', trips: new InMemoryTripContextRepository([emptyTripContext('t')]), artifacts: new InMemoryArtifactRepository('u', new Set(['t'])), memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer() }
const call = (id: string, name: string, args = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const tool = (name: string, execute: AgentTool['execute'], extra: Partial<AgentTool> = {}): AgentTool => ({ name, description: name, inputSchema: z.object({}).strict(), outputSchema: z.object({ ok: z.boolean() }), costClass: 'free', costUnits: 1, sideEffect: 'none', parallelSafe: true, timeoutMs: 30, execute, ...extra })

describe('AgentRuntime and ToolRegistry', () => {
  it('emits only actual model/tool execution events and isolates observer errors', async () => {
    const events: unknown[] = []
    const registry = new ToolRegistry().register(tool('research', async () => ({ ok: true })))
    const complete = vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('bad', 'missing'), call('good', 'research')] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'done' } })
    const result = await new AgentRuntime({ complete }, registry).run({
      messages: [{ role: 'user', content: 'plan' }], context: ctx,
      onActivity: activity => { events.push(activity); throw new Error('observer failed') }
    })
    expect(result.reply).toBe('done')
    expect(events).toEqual([
      { type: 'model_start' }, { type: 'model_end' },
      { type: 'tool_start', toolName: 'research', toolCallId: 'good' },
      { type: 'tool_end', toolName: 'research', toolCallId: 'good' },
      { type: 'model_start' }, { type: 'model_end' }, { type: 'finalizing' }
    ])
    expect(JSON.stringify(result.messages)).not.toContain('model_start')
  })

  it('cancels an uncooperative model and observes its late rejection', async () => {
    vi.useFakeTimers()
    try {
      let rejectLate!: (error: Error) => void
      const complete = vi.fn(async () => new Promise<never>((_resolve, reject) => { rejectLate = reject }))
      const runtime = new AgentRuntime({ complete }, new ToolRegistry(), { turnTimeoutMs: 1_000 })
      const pending = runtime.run({ messages: [{ role: 'user', content: 'plan' }], context: ctx })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await pending).toMatchObject({ stopReason: 'turn_timeout', fallback: true })
      rejectLate(new Error('late rejection'))
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('does not start or charge a tool when the parent signal is already cancelled', async () => {
    const execute = vi.fn(async (_input, _context, signal) => { signal.throwIfAborted(); return { ok: true } })
    const registry = new ToolRegistry().register(tool('cancelled', execute))
    const controller = new AbortController()
    controller.abort(new Error('Agent turn timeout'))
    const outcome = await registry.execute(call('cancelled', 'cancelled'), ctx, controller.signal)
    expect(outcome).toMatchObject({ errorCode: 'TOOL_CANCELLED', costUnits: 0 })
    expect(execute).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('owns late tool rejection after cancellation and a synchronous abort during startup', async () => {
    const controller = new AbortController()
    let rejectLate!: (reason: Error) => void
    const registry = new ToolRegistry().register(tool('late', async () => {
      controller.abort(new Error('cancelled during startup'))
      return new Promise((_resolve, reject) => { rejectLate = reject })
    }))
    const outcome = await registry.execute(call('late', 'late'), ctx, controller.signal)
    expect(outcome.errorCode).toBe('TOOL_CANCELLED')
    rejectLate(new Error('late provider rejection'))
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('returns a turn timeout without starting later tools in the same sequential batch', async () => {
    vi.useFakeTimers()
    try {
      const later = vi.fn(async (_input, _context, signal) => { signal.throwIfAborted(); return { ok: true } })
      const registry = new ToolRegistry()
        .register(tool('research', async (_input, _context, signal) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }), { timeoutMs: 10_000, sideEffect: 'state', parallelSafe: false }))
        .register(tool('later', later))
      const complete = vi.fn().mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('research', 'research'), call('later', 'later')] } })
      const pending = new AgentRuntime({ complete }, registry, { turnTimeoutMs: 1_000 }).run({ messages: [{ role: 'user', content: 'plan' }], context: ctx })
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await pending
      expect(result).toMatchObject({ stopReason: 'turn_timeout', fallback: true })
      expect(result.reply).toContain('超时')
      expect(later).not.toHaveBeenCalled()
      expect(complete).toHaveBeenCalledTimes(1)
      expect(result.traces.map(trace => trace.errorCode)).toEqual(['TOOL_CANCELLED', 'TOOL_CANCELLED'])
    } finally { vi.useRealTimers() }
  })

  it('preserves safe domain error codes for replanning without exposing internal messages', async () => {
    const registry = new ToolRegistry().register(tool('stale_source', async () => {
      throw new AppError('TRIP_CONTEXT_VERSION_CONFLICT', 'internal credential=must-not-leak', 409, { token: 'must-not-leak' })
    }))
    const outcome = await registry.execute(call('stale', 'stale_source'), ctx, new AbortController().signal)
    expect(outcome).toMatchObject({ errorCode: 'TOOL_FAILURE', domainErrorCode: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(JSON.parse(outcome.content)).toMatchObject({ error: { details: { domainCode: 'TRIP_CONTEXT_VERSION_CONFLICT' } } })
    expect(outcome.content).not.toContain('must-not-leak')
  })

  it('reads persisted artifacts only from the current trip and bounds large excerpts', async () => {
    const artifacts = new InMemoryArtifactRepository('u', new Set(['t', 'other']))
    const current = await artifacts.create({ tripId: 't', type: 'route_set', schemaVersion: 1, payload: { kind: 'generated_route_set', text: 'x'.repeat(25000) } })
    const other = await artifacts.create({ tripId: 'other', type: 'research', schemaVersion: 1, payload: { secret: 'other-trip-data' } })
    const registry = createCoreToolRegistry()
    const signal = new AbortController().signal
    const scoped = { ...ctx, artifacts }
    const listed = await registry.execute(call('list', 'get_trip_artifacts'), scoped, signal)
    expect(listed.ok).toBe(true)
    expect(listed.content).toContain(current.id)
    expect(listed.content).not.toContain(other.id)
    const read = await registry.execute(call('read', 'read_artifact', { artifactId: current.id }), scoped, signal)
    expect(read.ok).toBe(true)
    expect(read.content).toContain('"truncated":true')
    const denied = await registry.execute(call('deny', 'read_artifact', { artifactId: other.id }), scoped, signal)
    expect(denied.ok).toBe(false)
    expect(denied.content).not.toContain('other-trip-data')
  })
  it('does not execute truncated tool calls or report truncated output as completed', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const registry = new ToolRegistry().register(tool('write', execute))
    for (const tool_calls of [undefined, [call('x', 'write')]]) {
      const model: AgentModelClient = { complete: vi.fn(async () => ({ finishReason: 'length', message: { role: 'assistant' as const, content: 'Saved', ...(tool_calls ? { tool_calls } : {}) } })) }
      const result = await new AgentRuntime(model, registry).run({ messages: [{ role: 'user', content: 'save' }], context: ctx })
      expect(result).toMatchObject({ stopReason: 'model_failure', fallback: true, toolCalls: 0 })
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('allows ordinary conversation to complete without a fixed tool requirement', async () => {
    const registry = new ToolRegistry().register(tool('write', async () => ({ ok: true })))
    const promise = { message: { role: 'assistant' as const, content: 'Hello. What would you like to explore?' } }
    const complete = vi.fn().mockResolvedValueOnce(promise)
    const result = await new AgentRuntime({ complete }, registry).run({ messages: [{ role: 'user', content: 'Hello' }], context: ctx })
    expect(result.stopReason).toBe('responded')
    expect(result.delivery.status).toBe('not_requested')
    expect(result.toolCalls).toBe(0)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0]?.[2]).toMatchObject({ toolChoice: 'auto' })
  })
  it('publishes the complete Phase 4B Core Tool vocabulary', () => {
    expect(createCoreToolRegistry().definitions().map(definition => definition.function.name)).toEqual([
      'declare_goal', 'get_active_goal', 'resume_goal', 'finish_goal', 'cancel_goal', 'start_route_generation',
      'get_trip_artifacts', 'read_artifact',
      'get_trip_context', 'update_trip_context', 'resolve_location', 'search_flights',
      'search_flexible_flights', 'confirm_flight_price', 'search_connection_flights',
      'plan_flight_route', 'optimize_route', 'confirm_route_price', 'search_destinations',
      'recommend_destinations', 'plan_trip_route', 'research_destination', 'web_research',
      'build_travel_guide', 'save_travel_guide', 'get_user_memory', 'update_user_memory'
    ])
  })

  it('returns deterministic errors for unknown and malformed/schema-invalid calls', async () => {
    const reg = createCoreToolRegistry()
    const signal = new AbortController().signal
    expect((await reg.execute(call('x', 'no_such_tool'), ctx, signal)).errorCode).toBe('UNKNOWN_TOOL')
    expect((await reg.execute({ ...call('x', 'resolve_location'), function: { name: 'resolve_location', arguments: '{' } }, ctx, signal)).errorCode).toBe('MALFORMED_ARGUMENTS')
    expect((await reg.execute(call('x', 'resolve_location', { query: '' }), ctx, signal)).errorCode).toBe('INVALID_ARGUMENTS')
  })

  it('handles timeout, tool failures, and runtime cost/max-step cutoffs', async () => {
    const reg = new ToolRegistry().register(tool('slow', async () => new Promise(() => undefined), { timeoutMs: 5 })).register(tool('bad', async () => { throw new Error('boom') }))
    expect((await reg.execute(call('s', 'slow'), ctx, new AbortController().signal)).errorCode).toBe('TOOL_TIMEOUT')
    expect((await reg.execute(call('b', 'bad'), ctx, new AbortController().signal)).errorCode).toBe('TOOL_FAILURE')
    const model: AgentModelClient = { complete: vi.fn(async () => ({ message: { role: 'assistant' as const, content: null, tool_calls: [call('x', 'bad')] } })) }
    const limited = await new AgentRuntime(model, reg, { maxToolSteps: 1, maxCostUnits: 0 }).run({ messages: [{ role: 'user', content: 'go' }], context: ctx })
    expect(limited.stopReason).toBe('max_tool_steps')
    expect(limited.traces[0]?.errorCode).toBe('COST_BUDGET_EXCEEDED')
  })

  it('supports cancellation and stale-generation guards', async () => {
    const reg = new ToolRegistry()
    const model: AgentModelClient = { complete: vi.fn(async (_messages, _model, options) => { await new Promise(resolve => setTimeout(resolve, 10)); if (options?.signal?.aborted) throw new Error('cancelled'); return { message: { role: 'assistant' as const, content: 'done' } } }) }
    const controller = new AbortController(); controller.abort()
    expect((await new AgentRuntime(model, reg).run({ messages: [{ role: 'user', content: 'x' }], context: ctx, signal: controller.signal })).stopReason).toBe('cancelled')
    expect((await new AgentRuntime(model, reg).run({ messages: [{ role: 'user', content: 'x' }], context: ctx, isGenerationCurrent: () => false })).stopReason).toBe('stale_generation')
  })

  it('runs a complete mocked conversation with location and fare tools', async () => {
    const registry = createCoreToolRegistry()
    const location = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', iata: 'PVG', cityCode: 'SHA' }
    const fare = { query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-01', currency: 'CNY' as const, travelClass: 1 }, offers: [], provider: 'mock-fares', checkedAt: '2026-09-06T00:00:00.000Z', verification: { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-fares' }] } }
    const tokyo = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita International', countryCode: 'JP', iata: 'NRT', cityCode: 'TYO' }
    class QueryAviationProvider extends MockAviationProvider {
      override async resolveLocation(input: ResolveLocationInput, _options?: ProviderCallOptions) {
        return { matches: [input.query === 'Tokyo' ? tokyo : location], verification: { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-aviation' }] } }
      }
      override async getAirport(input: { iata: string }) { return input.iata === 'NRT' ? tokyo : input.iata === 'PVG' ? location : undefined }
    }
    const runtimeContext = { ...ctx, aviation: new QueryAviationProvider(), fares: new MockFareProvider({ search: fare }) }
    const model: AgentModelClient = { complete: vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('origin', 'resolve_location', { query: 'Shanghai', types: ['city'] }), call('destination', 'resolve_location', { query: 'Tokyo', types: ['city'] })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('update', 'update_trip_context', { patch: { origin: location, destinationIntent: { mode: 'explicit', required: [tokyo], preferred: [], excluded: [] } }, expectedVersion: 0 }), call('fare', 'search_flights', { departureDate: fare.query.departureDate, currency: fare.query.currency, travelClass: fare.query.travelClass, origin: 'PVG', destination: 'NRT' })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: '已找到符合条件的航班。' } }) }
    const result = await new AgentRuntime(model, registry).run({ messages: [{ role: 'user', content: '帮我找上海到东京的航班' }], context: runtimeContext })
    expect(result).toMatchObject({ reply: '已找到符合条件的航班。', stopReason: 'responded', delivery: { status: 'not_requested' }, fallback: false, toolSteps: 2, costUnits: 6 })
    expect(result.traces.map(trace => trace.toolName)).toEqual(['resolve_location', 'resolve_location', 'update_trip_context', 'search_flights'])
    expect(result.traces[3]?.artifactIds).toHaveLength(1)
  })

  it('rejects oversized tool-call batches before executing them', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const registry = new ToolRegistry().register(tool('read', execute))
    const model: AgentModelClient = { complete: vi.fn(async () => ({
      message: { role: 'assistant' as const, content: null, tool_calls: Array.from({ length: 9 }, (_, index) => call(`c${index}`, 'read')) }
    })) }
    const result = await new AgentRuntime(model, registry, { maxToolCallsPerStep: 8 }).run({ messages: [{ role: 'user', content: 'go' }], context: ctx })
    expect(result.stopReason).toBe('tool_call_limit')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('Server-verified turn delivery', () => {
  async function setup(verification: GoalVerification) {
    const goals = new InMemoryGoalRepository('u')
    const runs = new InMemoryGoalRunRepository('u', goals)
    const verifiers = new GoalVerifierRegistry().register({ kind: 'travel_guide', async verify() { return verification } })
    const goal = (await goals.create({
      tripId: 't', kind: 'travel_guide', createdContextVersion: 0, idempotencyKey: 'goal',
      parameters: { questions: ['museums'], researchTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: false }
    })).goal
    const run = (await runs.create({ goalId: goal.id, tripId: 't', generationId: 'g', contextVersion: 0, contextSnapshot: emptyTripContext('t'), idempotencyKey: 'run' })).run
    const context = {
      ...ctx, trips: new InMemoryTripContextRepository([emptyTripContext('t')]), ownerId: 'u',
      goalRepository: goals, goalRunRepository: runs, goalVerifiers: verifiers,
      activeGoalId: goal.id, activeGoalKind: goal.kind, activeGoalRunId: run.id, activeGoalContextVersion: 0
    }
    return { context, goals, runs, goal, run }
  }

  it('bounds a stalled working-set read and prevents writes when that read resumes after cancellation', async () => {
    const state = await setup({ status: 'pending', artifactIds: [], missing: ['travel_guide_artifact'], warnings: [] })
    let releaseRead!: (run: typeof state.run) => void
    vi.spyOn(state.runs, 'get').mockImplementationOnce(async () => new Promise(resolve => { releaseRead = resolve }))
    const update = vi.spyOn(state.runs, 'update')
    const registry = new ToolRegistry().register(tool('resolve', async (_input, context) => {
      context.resolvedLocations?.set('airport-nrt', { id: 'airport-nrt', type: 'airport', name: 'Narita', countryCode: 'JP', iata: 'NRT' })
      return { ok: true }
    }))
    const complete = vi.fn().mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('resolve', 'resolve')] } })
    vi.useFakeTimers()
    try {
      const pending = new AgentRuntime({ complete }, registry, { turnTimeoutMs: 1_000 })
        .run({ messages: [{ role: 'user', content: 'plan' }], context: state.context })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await pending).toMatchObject({ stopReason: 'turn_timeout', fallback: true })
      releaseRead(state.run)
      await vi.advanceTimersByTimeAsync(0)
      expect(update).not.toHaveBeenCalled()
      expect(complete).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('rejects a premature success claim when the Agent omits finish_goal', async () => {
    const state = await setup({ status: 'pending', artifactIds: [], missing: ['travel_guide_artifact'], warnings: [] })
    const complete = vi.fn(async () => ({ message: { role: 'assistant' as const, content: 'Your complete itinerary is saved.' } }))
    const result = await new AgentRuntime({ complete }, new ToolRegistry()).run({ messages: [{ role: 'user', content: 'Save my itinerary' }], context: state.context })
    expect(result).toMatchObject({ stopReason: 'goal_pending', delivery: { status: 'pending', goalId: state.goal.id } })
    expect(result.reply).not.toContain('Your complete itinerary is saved.')
    expect(complete).toHaveBeenCalledTimes(1)
    expect((await state.runs.get(state.run.id))?.status).toBe('running')
  })

  it('persists a verified result even without an explicit finish_goal call', async () => {
    const state = await setup({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    const complete = vi.fn(async () => ({ message: { role: 'assistant' as const, content: 'Your itinerary is ready.' } }))
    const result = await new AgentRuntime({ complete }, new ToolRegistry()).run({ messages: [{ role: 'user', content: 'Save my itinerary' }], context: state.context })
    expect(result).toMatchObject({ stopReason: 'completed', delivery: { status: 'satisfied' } })
    expect((await state.goals.get(state.goal.id))?.status).toBe('satisfied')
    expect((await state.runs.get(state.run.id))?.status).toBe('satisfied')
  })

  it('reports partial results separately from a completed delivery', async () => {
    const state = await setup({ status: 'partial', artifactIds: [], missing: ['guide_day:2'], warnings: [] })
    const complete = vi.fn(async () => ({ message: { role: 'assistant' as const, content: 'All days are done.' } }))
    const result = await new AgentRuntime({ complete }, new ToolRegistry()).run({ messages: [{ role: 'user', content: 'Save all days' }], context: state.context })
    expect(result).toMatchObject({ stopReason: 'goal_partial', delivery: { status: 'partial', missing: ['guide_day:2'] } })
    expect(result.reply).not.toContain('All days are done.')
    expect((await state.runs.get(state.run.id))?.status).toBe('partial')
  })

  it('keeps each working set scoped when one tool batch switches Goals and aggregates both deliveries', async () => {
    const state = await setup({ status: 'pending', artifactIds: [], missing: [], warnings: [] })
    const otherGoal = (await state.goals.create({
      tripId: 't', kind: 'travel_guide', createdContextVersion: 0, idempotencyKey: 'other-goal',
      parameters: { questions: ['parks'], researchTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: false }
    })).goal
    const otherRun = (await state.runs.create({
      goalId: otherGoal.id, tripId: 't', generationId: 'g', contextVersion: 0,
      contextSnapshot: emptyTripContext('t'), idempotencyKey: 'other-run'
    })).run
    state.context.artifacts = new InMemoryArtifactRepository('u', new Set(['t']))
    state.context.goalVerifiers = new GoalVerifierRegistry().register({
      kind: 'travel_guide', async verify(_goal, scope) {
        const artifactIds = scope.run.workingSet.artifactRefs.map(ref => ref.id)
        return {
          status: artifactIds.length === 2 ? 'satisfied' : artifactIds.length === 1 ? 'partial' : 'pending',
          artifactIds, missing: artifactIds.length === 2 ? [] : ['second_source'], warnings: []
        }
      }
    })
    const registry = createCoreToolRegistry().register(tool('save_scoped_evidence', async (_input, context) => {
      if (!context.activeGoalId || !context.activeGoalRunId) throw new Error('Goal scope missing')
      const artifact = await context.artifacts.create({
        tripId: context.tripId, goalId: context.activeGoalId, runId: context.activeGoalRunId,
        tripContextVersion: context.activeGoalContextVersion, type: 'research', schemaVersion: 1, payload: {}
      })
      return { artifact: { id: artifact.id } }
    }, { sideEffect: 'state', parallelSafe: false, outputSchema: z.object({ artifact: z.object({ id: z.string().uuid() }) }) }))
    const complete = vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [
        call('goal-a', 'resume_goal', { goalId: state.goal.id }),
        call('evidence-a1', 'save_scoped_evidence'), call('evidence-a2', 'save_scoped_evidence'),
        call('goal-b', 'resume_goal', { goalId: otherGoal.id }), call('evidence-b', 'save_scoped_evidence')
      ] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Both goals are complete.' } })

    const result = await new AgentRuntime({ complete }, registry)
      .run({ messages: [{ role: 'user', content: 'Prepare both plans' }], context: state.context })
    const firstArtifacts = await state.context.artifacts.listForRun(state.run.id)
    const secondArtifacts = await state.context.artifacts.listForRun(otherRun.id)
    expect(firstArtifacts).toHaveLength(2)
    expect(secondArtifacts).toHaveLength(1)
    expect((await state.runs.get(state.run.id))?.workingSet.artifactRefs.map(ref => ref.id))
      .toEqual(expect.arrayContaining(firstArtifacts.map(artifact => artifact.id)))
    expect((await state.runs.get(state.run.id))?.workingSet.artifactRefs).toHaveLength(2)
    expect((await state.runs.get(otherRun.id))?.workingSet.artifactRefs.map(ref => ref.id)).toEqual([secondArtifacts[0]!.id])
    expect(result.delivery.goals).toEqual([
      expect.objectContaining({ goalId: state.goal.id, status: 'satisfied', artifactIds: expect.arrayContaining(firstArtifacts.map(artifact => artifact.id)) }),
      expect.objectContaining({ goalId: otherGoal.id, status: 'partial', artifactIds: [secondArtifacts[0]!.id] })
    ])
    expect(result).toMatchObject({ stopReason: 'goal_partial', delivery: { status: 'partial' }, toolSteps: 1, toolCalls: 5 })
    expect(result.reply).not.toContain('Both goals are complete.')
  })

  it('fails closed when completion evidence cannot be read', async () => {
    const state = await setup({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    state.context.goalVerifiers = new GoalVerifierRegistry().register({ kind: 'travel_guide', async verify() { throw new Error('Database unavailable') } })
    const result = await new AgentRuntime({ complete: async () => ({ message: { role: 'assistant', content: 'Saved.' } }) }, new ToolRegistry())
      .run({ messages: [{ role: 'user', content: 'Save' }], context: state.context })
    expect(result).toMatchObject({ stopReason: 'goal_failed', delivery: { status: 'failed', warnings: ['goal_verification_failed'] } })
    expect((await state.goals.get(state.goal.id))?.status).toBe('pending')
  })

  it('bounds final verification when an evidence store does not respond', async () => {
    const state = await setup({ status: 'satisfied', artifactIds: [], missing: [], warnings: [] })
    state.context.goalVerifiers = new GoalVerifierRegistry().register({ kind: 'travel_guide', async verify() { return new Promise(() => undefined) } })
    vi.useFakeTimers()
    try {
      const pending = new AgentRuntime({ complete: async () => ({ message: { role: 'assistant', content: 'Saved.' } }) }, new ToolRegistry())
        .run({ messages: [{ role: 'user', content: 'Save' }], context: state.context })
      await vi.advanceTimersByTimeAsync(3_001)
      const result = await pending
      expect(result).toMatchObject({ stopReason: 'goal_pending', delivery: { status: 'pending', warnings: ['goal_verification_interrupted'] } })
      expect(result.delivery.goals).toMatchObject([{ goalId: state.goal.id, kind: 'travel_guide', status: 'pending' }])
      expect((await state.goals.get(state.goal.id))?.status).toBe('pending')
    } finally { vi.useRealTimers() }
  })
})
