import { describe, expect, it } from 'vitest'
import type { ArtifactRecord } from '../../artifacts/repository.js'
import { routeSetPayloadSchema } from '../../flight-routing/types.js'
import { budgetRouteReply } from './budget-route-reply.js'

const airport = (iata: string) => ({ id: iata, type: 'airport' as const, name: iata, countryCode: 'CN', iata })
const verification = { status: 'verified' as const, checkedAt: '2026-09-27T12:00:00.000Z', confidence: 1,
  sources: [{ provider: 'fixture' }] }
const edge = (from: string, to: string, fare: number, extras: Record<string, unknown> = {}) => ({
  id: `${from}-${to}`, from: airport(from), to: airport(to), departureDate: '2026-10-10',
  transferType: 'direct' as const, availability: 'verified' as const, verification, warnings: [], reasons: [],
  fare: { amount: fare, currency: 'CNY' }, fareArtifactId: `fare-${from}`, fareOfferId: `offer-${from}`, ...extras })
const score = { airfareSaving: 1, preferredCityMatch: 0, interestMatch: 0, eventMatch: 0, seasonMatch: 0,
  stopoverPlayability: 0, additionalCityValue: 0, routeNovelty: 0, totalTravelTime: 0, transferCount: 0,
  selfTransferRisk: 0, airportChangePenalty: 0, backtrackingPenalty: 0, deadTimePenalty: 0,
  excessiveComplexity: 0, complexity: 0, total: 1 }
const explanation = { scoreBreakdown: [], hardConstraintsSatisfied: ['endpoints'], tradeoffs: [], warnings: [] }
function record(path: Record<string, unknown>, badge = true): ArtifactRecord {
  const payload = routeSetPayloadSchema.parse({ schemaVersion: 1, serviceVersion: 'fixture', algorithmVersion: 'fixture',
    sourceArtifactIds: [], verification, warnings: [], truncated: false, exhausted: true, kind: 'optimized_routes',
    representatives: [{ path, score, badges: badge ? ['cheapest'] : ['balanced'], explanation }],
    paretoFrontierCount: 1, rejectedCandidateCount: 0 })
  return { id: 'route', tripId: 'trip', type: 'route_set', schemaVersion: 1, payload,
    createdAt: verification.checkedAt, updatedAt: verification.checkedAt }
}
const direct = { id: 'direct', nodes: [{ location: airport('PEK'), role: 'origin' },
  { location: airport('NRT'), role: 'destination' }], edges: [edge('PEK', 'NRT', 900)],
  totalFare: { amount: 900, currency: 'CNY' }, transferCount: 0, feasibility: 'feasible', warnings: [] }

describe('controlled DSH budget route reply', () => {
  it('uses only comparable persisted cheapest fare, scope and checked date', () => {
    const zh = budgetRouteReply(record(direct), 'zh')!
    expect(zh).toContain('CNY 900.00')
    expect(zh).toContain('2026-09-27')
    expect(zh).toContain('本次已搜索路线')
    expect(zh).toContain('明确采用航班')
    expect(zh).not.toContain('全网最低价为')
    const en = budgetRouteReply(record(direct), 'en')!
    expect(en).toContain('CNY 900.00')
    expect(en).toContain('not a market-wide lowest fare')
    expect(en).toContain('explicitly select a flight')
  })

  it('explains separate quotes, self-transfer and unknown protection without claiming an all-in ticket', () => {
    const path = { ...direct, id: 'split', nodes: [{ location: airport('PEK'), role: 'origin' },
      { location: airport('ICN'), role: 'stopover' }, { location: airport('NRT'), role: 'destination' }],
      edges: [edge('PEK', 'ICN', 400), edge('ICN', 'NRT', 500, { transferType: 'self' })], transferCount: 1 }
    const reply = budgetRouteReply(record(path), 'en')!
    expect(reply).toContain('requires separate tickets')
    expect(reply).toContain('self-transfer')
    expect(reply).toContain('Baggage handling needs confirmation')
    expect(reply).toContain('Connection protection needs confirmation')
  })

  it('never uses a missing, inconsistent or unbadged fare as a public price', () => {
    expect(budgetRouteReply(record({ ...direct, totalFare: { amount: 800, currency: 'CNY' } }), 'en'))
      .toContain('No comparable fare was obtained')
    expect(budgetRouteReply(record({ ...direct, totalFare: undefined }), 'zh'))
      .toContain('未获得可比票价')
    expect(budgetRouteReply(record({ ...direct, edges: [edge('PEK', 'NRT', 900, { fareOfferId: undefined })] }), 'en'))
      .toContain('No comparable fare was obtained')
    expect(budgetRouteReply(record(direct, false), 'en')).toContain('No comparable fare was obtained')
    expect(budgetRouteReply({ ...record(direct), type: 'flight_search' }, 'en')).toBeUndefined()
  })
})
