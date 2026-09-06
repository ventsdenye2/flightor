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

const ctx: ToolExecutionContext = { requestId: 'r', conversationId: 'c', tripId: 't', generationId: 'g', trips: new InMemoryTripContextRepository([emptyTripContext('t')]), aviation: new MockAviationProvider(), fares: new MockFareProvider() }
const call = (id: string, name: string, args = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const tool = (name: string, execute: AgentTool['execute'], extra: Partial<AgentTool> = {}): AgentTool => ({ name, description: name, inputSchema: z.object({}).strict(), outputSchema: z.object({ ok: z.boolean() }), costClass: 'free', costUnits: 1, sideEffect: 'none', parallelSafe: true, timeoutMs: 30, execute, ...extra })

describe('AgentRuntime and ToolRegistry', () => {
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
