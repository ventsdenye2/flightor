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
const throughEdge = (overrides: Partial<ConnectionEdge> = {}): ConnectionEdge => edge('PEK', 'CDG', 'one-quoted-itinerary', {
  transferType: 'airline', fareArtifactId: 'immutable-fare', fareOfferId: 'one-offer', fare: { amount: 1234, currency: 'CNY' },
  departureAt: '2026-09-10T00:00:00Z', arrivalAt: '2026-09-10T14:00:00Z', durationMinutes: 840,
  segments: [
    { id: 'physical-1', from: loc('PEK'), to: loc('NRT', 'TYO'), departureAt: '2026-09-10T00:00:00Z', arrivalAt: '2026-09-10T02:00:00Z', verification },
    { id: 'physical-2', from: loc('NRT', 'TYO'), to: loc('CDG'), departureAt: '2026-09-10T04:00:00Z', arrivalAt: '2026-09-10T14:00:00Z', verification }
  ], ...overrides
})

describe('DeterministicFlightRoutePlanner golden world', () => {
  it('counts internal flights without turning a connecting airport into a requested visit', async () => {
    const planner = new DeterministicFlightRoutePlanner()
    const accepted = await planner.plan(input([throughEdge()], { maxTransfers: 1 }))
    expect(accepted.paths[0]).toMatchObject({ transferCount: 1, totalFare: { amount: 1234, currency: 'CNY' } })
    expect(accepted.paths[0]?.edges).toHaveLength(1)
    expect(accepted.paths[0]?.nodes).toHaveLength(2)
    expect((await planner.plan(input([throughEdge()], { maxTransfers: 0 }))).paths).toHaveLength(0)
    expect((await planner.plan(input([throughEdge()], { maxStops: 0 }))).paths).toHaveLength(0)
    expect((await planner.plan(input([throughEdge()], { excludedLocations: [city('TYO')] }))).paths).toHaveLength(0)
    expect((await planner.plan(input([throughEdge()], { requiredLocations: [loc('NRT')] }))).paths).toHaveLength(0)
  })
  it('uses the same elapsed duration for constraints and totals instead of trusting a shorter provider duration', async () => {
    const planner = new DeterministicFlightRoutePlanner()
    const quoted = throughEdge({ durationMinutes: 240 })
    expect((await planner.plan(input([quoted], { maxTotalDurationMinutes: 300 }))).paths).toHaveLength(0)
    expect((await planner.plan(input([quoted], { maxTotalDurationMinutes: 900 }))).paths[0]?.totalDurationMinutes).toBe(840)
    expect((await planner.plan(input([edge('PEK', 'CDG')], { maxTotalDurationMinutes: 900 }))).paths).toHaveLength(0)
  })
  it('enforces internal chronology, MCT, long-stopover and airport-change buffers', async () => {
    const planner = new DeterministicFlightRoutePlanner()
    const at = (departureAt: string, changedAirport = false) => {
      const quoted = throughEdge({ airportChange: changedAirport, arrivalAt: '2026-09-11T00:00:00Z' })
      quoted.segments![1] = { ...quoted.segments![1]!, departureAt, arrivalAt: '2026-09-11T00:00:00Z', ...(changedAirport ? { from: loc('HND', 'TYO') } : {}) }
      return quoted
    }
    await expect(planner.plan(input([at('2026-09-10T01:00:00Z')]))).rejects.toThrow(/connection departs before arrival/)
    expect((await planner.plan(input([at('2026-09-10T02:20:00Z')]))).paths).toHaveLength(0)
    expect((await planner.plan(input([at('2026-09-10T15:00:00Z')], { allowLongStopover: false }))).paths).toHaveLength(0)
    expect((await planner.plan(input([at('2026-09-10T03:00:00Z', true)], { allowAirportChange: true }))).paths).toHaveLength(0)
    expect((await planner.plan(input([at('2026-09-10T15:00:00Z', true)], { allowAirportChange: false }))).paths).toHaveLength(0)
    expect((await planner.plan(input([at('2026-09-10T15:00:00Z', true)], { allowAirportChange: true, allowLongStopover: true }))).paths).toHaveLength(1)
  })
  it('keeps airline connections distinct from self-transfers and joins of separately priced offers', async () => {
    const planner = new DeterministicFlightRoutePlanner()
    expect((await planner.plan(input([throughEdge()], { allowSelfTransfer: false }))).paths).toHaveLength(1)
    expect((await planner.plan(input([throughEdge({ transferType: 'self' })], { allowSelfTransfer: true }))).paths).toHaveLength(0)
    const separate = [
      edge('PEK', 'NRT', 'ticket-a', { fareArtifactId: 'fare-a', fareOfferId: 'offer-a', arrivalAt: '2026-09-10T02:00:00Z' }),
      edge('NRT', 'CDG', 'ticket-b', { fareArtifactId: 'fare-b', fareOfferId: 'offer-b', departureAt: '2026-09-10T10:00:00Z' })
    ]
    expect((await planner.plan(input(separate, { allowSelfTransfer: false }))).paths).toHaveLength(0)
    expect((await planner.plan(input(separate, { allowSelfTransfer: true }))).paths[0]?.feasibility).toBe('partial')
    separate[1]!.departureAt = '2026-09-10T09:00:00Z'
    expect((await planner.plan(input(separate, { allowSelfTransfer: true }))).paths).toHaveLength(0)
  })
  it('treats an exact departure date as a start window and permits an overnight arrival', async () => {
    const query = input([edge('PEK', 'CDG', 'overnight', { arrivalDate: '2026-09-11', durationMinutes: 600 })])
    query.window.to = query.window.from
    const result = await new DeterministicFlightRoutePlanner().plan(query)
    expect(result.paths).toHaveLength(1)
    query.edges[0]!.departureDate = '2026-09-11'
    expect((await new DeterministicFlightRoutePlanner().plan(query)).paths).toHaveLength(0)
  })
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
