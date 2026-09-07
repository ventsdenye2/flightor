import { describe, expect, it } from 'vitest'
import { DeterministicFlightRoutePlanner } from './planner.js'
import type { ConnectionEdge, FlightRoutePlanInput } from './types.js'

const verification = { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'golden' }] }
const loc = (iata: string, cityCode?: string) => ({ id: iata, type: 'airport' as const, name: iata, countryCode: 'CN', iata, ...(cityCode ? { cityCode } : {}) })
const city = (cityCode: string) => ({ id: `city-${cityCode}`, type: 'city' as const, name: cityCode, countryCode: 'CN', cityCode })
const edge = (from: string, to: string, id = `${from}-${to}`, extra: Partial<ConnectionEdge> = {}): ConnectionEdge => ({
  id, from: loc(from), to: loc(to), departureDate: '2026-09-10', transferType: 'direct', availability: 'verified', verification, warnings: [], reasons: [], ...extra
})
const input = (edges: ConnectionEdge[], constraints: FlightRoutePlanInput['constraints'] = {}, maxPaths = 50): FlightRoutePlanInput => ({
  nodes: [{ location: loc('PEK'), role: 'origin' }, { location: loc('CDG'), role: 'destination' }],
  edges,
  window: { from: '2026-09-10', to: '2026-09-20' },
  constraints,
  maxPaths
})

describe('DeterministicFlightRoutePlanner golden world', () => {
  it('keeps stable adjacency order and reports a real maxPaths truncation', async () => {
    const result = await new DeterministicFlightRoutePlanner().plan(input([
      edge('PEK', 'CDG', 'direct'), edge('PEK', 'NRT', 'via-nrt-a'), edge('NRT', 'CDG', 'via-nrt-b'),
      edge('PEK', 'ICN', 'via-icn-a'), edge('ICN', 'CDG', 'via-icn-b')
    ], {}, 1))
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]!.id).toBe('path:direct')
    expect(result.truncated).toBe(true)
    expect(result.exhausted).toBe(false)
  })

  it('enforces excluded and required locations plus transfer policies', async () => {
    const planner = new DeterministicFlightRoutePlanner()
    const rejected = await planner.plan(input([edge('PEK', 'NRT'), edge('NRT', 'CDG')], { excludedLocations: [loc('NRT')] }))
    expect(rejected.paths).toHaveLength(0)
    const required = await planner.plan(input([edge('PEK', 'NRT'), edge('NRT', 'CDG')], { requiredLocations: [loc('NRT')] }))
    expect(required.paths).toHaveLength(1)
    const selfTransfer = await planner.plan(input([edge('PEK', 'NRT', 'self', { transferType: 'self' }), edge('NRT', 'CDG')]))
    expect(selfTransfer.paths).toHaveLength(0)
  })

  it('retains unknown edges as partial or unknown paths without inventing fares', async () => {
    const result = await new DeterministicFlightRoutePlanner().plan(input([edge('PEK', 'CDG', 'unknown', { availability: 'unknown' })]))
    expect(result.paths[0]!.feasibility).toBe('unknown')
    expect(result.paths[0]!.totalFare).toBeUndefined()
    expect(result.paths[0]!.warnings.some(value => value.includes('unknown availability'))).toBe(true)
  })

  it('never sums weak offer-id-only segment quotes into a protected itinerary total', async () => {
    const result = await new DeterministicFlightRoutePlanner().plan(input([
      edge('PEK', 'NRT', 'protected-a', { transferType: 'protected', fare: { amount: 800, currency: 'CNY' }, fareOfferId: 'offer-a' }),
      edge('NRT', 'CDG', 'protected-b', { transferType: 'protected', fare: { amount: 1800, currency: 'CNY' }, fareOfferId: 'offer-b' })
    ]))
    expect(result.paths[0]?.totalFare).toBeUndefined()
    expect(result.paths[0]?.warnings.some(value => value.includes('immutable fare artifact binding'))).toBe(true)
  })

  it('rejects date-only multi-leg paths whose next leg departs before the previous leg date', async () => {
    const result = await new DeterministicFlightRoutePlanner().plan(input([
      edge('PEK', 'NRT', 'monday-leg', { departureDate: '2026-09-14' }),
      edge('NRT', 'CDG', 'sunday-leg', { departureDate: '2026-09-13' })
    ]))

    expect(result.paths).toHaveLength(0)
  })

  it('applies a hard city exclusion to every constituent airport', async () => {
    const result = await new DeterministicFlightRoutePlanner().plan(input([
      edge('PEK', 'NRT', 'via-tokyo-a', { to: loc('NRT', 'TYO') }),
      edge('NRT', 'CDG', 'via-tokyo-b', { from: loc('NRT', 'TYO') })
    ], { excludedLocations: [city('TYO')] }))

    expect(result.paths).toHaveLength(0)
  })

  it('uses a bounded stable digest when composed edge ids exceed the path-id contract', async () => {
    const routeInput = input([
      edge('PEK', 'NRT', `first-${'a'.repeat(140)}`),
      edge('NRT', 'CDG', `second-${'b'.repeat(139)}`)
    ])
    const planner = new DeterministicFlightRoutePlanner()

    const first = await planner.plan(routeInput)
    const second = await planner.plan(routeInput)

    expect(first.paths[0]?.id.length).toBeLessThanOrEqual(160)
    expect(second.paths[0]?.id).toBe(first.paths[0]?.id)
  })
})
