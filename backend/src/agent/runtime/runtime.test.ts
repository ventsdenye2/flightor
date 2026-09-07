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

const ctx: ToolExecutionContext = { requestId: 'r', conversationId: 'c', tripId: 't', generationId: 'g', trips: new InMemoryTripContextRepository([emptyTripContext('t')]), artifacts: new InMemoryArtifactRepository('u', new Set(['t'])), memory: new InMemoryUserMemoryRepository(), aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer() }
const call = (id: string, name: string, args = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const tool = (name: string, execute: AgentTool['execute'], extra: Partial<AgentTool> = {}): AgentTool => ({ name, description: name, inputSchema: z.object({}).strict(), outputSchema: z.object({ ok: z.boolean() }), costClass: 'free', costUnits: 1, sideEffect: 'none', parallelSafe: true, timeoutMs: 30, execute, ...extra })

describe('AgentRuntime and ToolRegistry', () => {
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

  it('repairs a premature promise once and never completes a missing required write', async () => {
    const registry = new ToolRegistry().register(tool('write', async () => ({ ok: true })))
    const promise = { message: { role: 'assistant' as const, content: 'I will save it.' } }
    const complete = vi.fn().mockResolvedValueOnce(promise)
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('w', 'write')] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Saved.' } })
    const result = await new AgentRuntime({ complete }, registry).run({ messages: [{ role: 'user', content: 'save' }], context: ctx, requiredSuccessfulTool: 'write' })
    expect(result.stopReason).toBe('completed')
    expect(result.toolCalls).toBe(1)
    expect(complete.mock.calls[1]?.[2]).toMatchObject({ toolChoice: 'required' })
    const stuck = vi.fn().mockResolvedValue(promise)
    const failed = await new AgentRuntime({ complete: stuck }, registry).run({ messages: [{ role: 'user', content: 'save' }], context: ctx, requiredSuccessfulTool: 'write' })
    expect(failed.stopReason).toBe('model_failure')
    expect(stuck).toHaveBeenCalledTimes(2)
  })
  it('publishes the complete Phase 4B Core Tool vocabulary', () => {
    expect(createCoreToolRegistry().definitions().map(definition => definition.function.name)).toEqual([
      'get_trip_artifacts', 'read_artifact',
      'get_trip_context', 'update_trip_context', 'resolve_location', 'search_flights',
      'search_flexible_flights', 'confirm_flight_price', 'search_connection_flights',
      'plan_flight_route', 'optimize_route', 'confirm_route_price', 'search_destinations',
      'recommend_destinations', 'plan_trip_route', 'research_destination', 'web_research',
      'build_travel_guide', 'get_user_memory', 'update_user_memory'
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
    }
    const runtimeContext = { ...ctx, aviation: new QueryAviationProvider(), fares: new MockFareProvider({ search: fare }) }
    const model: AgentModelClient = { complete: vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('origin', 'resolve_location', { query: 'Shanghai', types: ['city'] }), call('destination', 'resolve_location', { query: 'Tokyo', types: ['city'] })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [call('update', 'update_trip_context', { patch: { origin: location, destinationIntent: { mode: 'explicit', required: [tokyo], preferred: [], excluded: [] } }, expectedVersion: 0 }), call('fare', 'search_flights', { departureDate: fare.query.departureDate, currency: fare.query.currency, travelClass: fare.query.travelClass, origin: location, destination: tokyo })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: '已找到符合条件的航班。' } }) }
    const result = await new AgentRuntime(model, registry).run({ messages: [{ role: 'user', content: '帮我找上海到东京的航班' }], context: runtimeContext })
    expect(result).toMatchObject({ reply: '已找到符合条件的航班。', stopReason: 'completed', fallback: false, toolSteps: 2, costUnits: 6 })
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
