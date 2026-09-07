import { describe, expect, it, vi } from 'vitest'
import { locationRefKey } from '../../aviation/types.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { ToolRegistry } from '../runtime/registry.js'
import { searchFlexibleFlightsInputSchema, searchFlexibleFlightsOutputSchema, searchFlexibleFlightsTool } from './flexible-flights.js'

const origin = { id: 'airport-pvg', type: 'airport' as const, name: 'Shanghai Pudong', countryCode: 'CN', cityCode: 'SHA', iata: 'PVG' }
const destination = { id: 'airport-nrt', type: 'airport' as const, name: 'Narita', countryCode: 'JP', cityCode: 'TYO', iata: 'NRT' }
const base = { origin: 'PVG', destination: 'NRT', currency: 'CNY' as const, travelClass: 1 }
const result = (date = '2026-10-01', offers = [{ id: 'offer-1', segments: [{ flightNumber: 'M1', airline: 'Mock', origin: 'PVG', destination: 'NRT', departsAt: `${date}T08:00:00Z`, arrivesAt: `${date}T12:00:00Z`, durationMinutes: 240 }], totalAmount: 1200, currency: 'CNY', totalDurationMinutes: 240, airlines: ['Mock'], transferType: 'direct' as const }]) => ({ query: { ...base, departureDate: date }, offers, provider: 'mock-fares', checkedAt: '2026-09-06T00:00:00.000Z', verification: { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'mock-fares' }] } })

function context(flexible: ReturnType<typeof result>[] = [result()]): ToolExecutionContext {
  const trips = new Set(['trip-1'])
  return { requestId: 'r', conversationId: 'c', tripId: 'trip-1', generationId: 'g', trips: new InMemoryTripContextRepository([emptyTripContext('trip-1')]), artifacts: new InMemoryArtifactRepository('u', trips), memory: new InMemoryUserMemoryRepository(), aviation: {} as never, fares: new MockFareProvider({ flexible }), resolvedLocationKeys: new Set([locationRefKey(origin), locationRefKey(destination)]) }
}
const input = { origin, destination, departureDateFrom: '2026-10-01', departureDateTo: '2026-10-10', currency: 'CNY' as const, travelClass: 1 }

describe('search_flexible_flights', () => {
  it('persists one v2 artifact and returns compact summary', async () => {
    const ctx = context([result('2026-10-01'), result('2026-10-05')])
    const output = await searchFlexibleFlightsTool.execute(input, ctx, new AbortController().signal)
    expect(searchFlexibleFlightsOutputSchema.parse(output).artifact.schemaVersion).toBe(2)
    const stored = await ctx.artifacts.get(output.artifact.id)
    expect(stored?.schemaVersion).toBe(2)
    expect(output.summary).toMatchObject({ scannedDates: ['2026-10-01', '2026-10-05'], successfulDates: ['2026-10-01', '2026-10-05'], offerCount: 2 })
  })
  it('accepts empty provider results without persistence failure', async () => {
    const ctx = context([])
    const output = await searchFlexibleFlightsTool.execute(input, ctx, new AbortController().signal)
    expect(output.summary.offerCount).toBe(0)
    expect(await ctx.artifacts.get(output.artifact.id)).toBeDefined()
  })
  it('preserves partial sampled-date failures', async () => {
    const ctx = context()
    ctx.fares = new MockFareProvider({ flexible: {
      results: [result('2026-10-01')],
      scannedDates: ['2026-10-01', '2026-10-05'],
      failedDates: ['2026-10-05']
    } })
    const output = await searchFlexibleFlightsTool.execute(input, ctx, new AbortController().signal)
    expect(output.summary).toMatchObject({
      scannedDates: ['2026-10-01', '2026-10-05'],
      successfulDates: ['2026-10-01'],
      failedDates: ['2026-10-05']
    })
    expect(output.summary.verificationStatus).toBe('partially_verified')
  })
  it('rejects inconsistent or total-failure sampled-date metadata', async () => {
    const outside = context()
    outside.fares = new MockFareProvider({ flexible: {
      results: [result('2026-10-01')], scannedDates: ['2026-11-01'], failedDates: []
    } })
    await expect(searchFlexibleFlightsTool.execute(input, outside, new AbortController().signal)).rejects.toThrow()
    const failed = context()
    failed.fares = new MockFareProvider({ flexible: {
      results: [], scannedDates: ['2026-10-01'], failedDates: ['2026-10-01']
    } })
    await expect(searchFlexibleFlightsTool.execute(input, failed, new AbortController().signal)).rejects.toThrow('every sampled date')
  })
  it.each([
    ['same endpoint', { ...input, destination: origin }],
    ['reversed', { ...input, departureDateFrom: '2026-10-10', departureDateTo: '2026-10-01' }],
    ['over 31 days', { ...input, departureDateTo: '2026-11-01' }],
    ['return before window', { ...input, returnDate: '2026-10-09' }]
  ])('rejects %s', (_name, value) => expect(() => searchFlexibleFlightsInputSchema.parse(value)).toThrow())
  it('rejects untrusted locations', async () => {
    const ctx = context(); ctx.resolvedLocationKeys = new Set()
    await expect(searchFlexibleFlightsTool.execute(input, ctx, new AbortController().signal)).rejects.toThrow('authoritative')
  })
  it('rejects provider query and endpoint mismatches', async () => {
    const q = context([result('2026-11-01')])
    await expect(searchFlexibleFlightsTool.execute(input, q, new AbortController().signal)).rejects.toThrow('different flexible query')
    const bad = result(); bad.offers[0]!.segments[0]!.origin = 'LHR'
    await expect(searchFlexibleFlightsTool.execute(input, context([bad]), new AbortController().signal)).rejects.toThrow('different route')
  })
  it('does not persist when generation is stale', async () => {
    const ctx = context(); ctx.isGenerationCurrent = () => false
    await expect(searchFlexibleFlightsTool.execute(input, ctx, new AbortController().signal)).rejects.toThrow('cancelled')
    expect(await ctx.artifacts.get('missing')).toBeUndefined()
  })
  it('registry bounds provider rejection', async () => {
    const registry = new ToolRegistry().register(searchFlexibleFlightsTool)
    const ctx = context(); ctx.fares = new MockFareProvider({ failures: { flexible: new Error('secret provider failure') } })
    const outcome = await registry.execute({ id: 'x', type: 'function', function: { name: searchFlexibleFlightsTool.name, arguments: JSON.stringify(input) } }, ctx, new AbortController().signal)
    expect(outcome.ok).toBe(false)
    expect(outcome.content).not.toContain('secret provider failure')
  })
})
