import { describe, expect, it } from 'vitest'
import { ParetoRouteOptimizer } from './optimizer.js'
import type { CompleteFlightPath, ConnectionEdge } from './types.js'

const verification = { status: 'verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 1, sources: [{ provider: 'golden' }] }
const loc = (iata: string) => ({ id: iata, type: 'airport' as const, name: iata, countryCode: 'CN', iata, ...(iata === 'NRT' ? { cityCode: 'TYO' } : {}) })
const city = (cityCode: string) => ({ id: `city-${cityCode}`, type: 'city' as const, name: cityCode, countryCode: 'CN', cityCode })
const edge = (from: string, to: string, id: string, fare: number, extra: Partial<ConnectionEdge> = {}): ConnectionEdge => ({ id, from: loc(from), to: loc(to), departureDate: '2026-09-10', transferType: 'direct', availability: 'verified', verification, warnings: [], reasons: [], fare: { amount: fare, currency: 'CNY' }, ...extra })
const path = (id: string, via: string, fare: number, extra: Partial<CompleteFlightPath> = {}): CompleteFlightPath => ({
  id, nodes: [{ location: loc('PEK'), role: 'origin' }, { location: loc(via), role: 'stopover' }, { location: loc('CDG'), role: 'destination' }],
  edges: [edge('PEK', via, `${id}-a`, fare), edge(via, 'CDG', `${id}-b`, 0)],
  totalFare: { amount: fare, currency: 'CNY' }, totalDurationMinutes: 600, transferCount: 1, feasibility: 'feasible', warnings: [], ...extra
})

describe('ParetoRouteOptimizer golden world', () => {
  it('deduplicates badges onto one representative and keeps every score normalized', async () => {
    const result = await new ParetoRouteOptimizer().optimize({ paths: [path('a', 'NRT', 100), path('b', 'ICN', 200)], preferredLocations: [loc('NRT')], interestLocations: [loc('NRT')], weights: {}, maxRepresentatives: 10 })
    const first = result.representatives.find(value => value.path.id === 'a')
    expect(first?.badges).toContain('cheapest')
    expect(first?.badges).toContain('best_match')
    for (const representative of result.representatives) for (const value of Object.values(representative.score)) expect(value).toBeGreaterThanOrEqual(-1)
  })

  it('rejects unknown-feasibility candidates and explains conservative unknown facts', async () => {
    const unknown = path('unknown', 'NRT', 100, { feasibility: 'unknown', edges: [edge('PEK', 'NRT', 'unknown-a', 100, { availability: 'unknown' }), edge('NRT', 'CDG', 'unknown-b', 0, { availability: 'unknown' })] })
    const partial = path('partial', 'ICN', 200, { feasibility: 'partial', edges: [edge('PEK', 'ICN', 'partial-a', 200, { availability: 'partial' }), edge('ICN', 'CDG', 'partial-b', 0)] })
    const result = await new ParetoRouteOptimizer().optimize({ paths: [unknown, partial], weights: {}, preferredLocations: [], interestLocations: [], maxRepresentatives: 10 })
    expect(result.rejectedCandidateCount).toBe(1)
    expect(result.representatives[0]!.explanation.warnings.join(' ')).toContain('conservative')
  })

  it('uses lexical path ids to break equal-score ties', async () => {
    const paths = [path('z-path', 'NRT', 100), path('a-path', 'NRT', 100)]
    const result = await new ParetoRouteOptimizer().optimize({ paths, weights: { interestMatch: 0, preferredCityMatch: 0 }, preferredLocations: [], interestLocations: [], maxRepresentatives: 1 })
    expect(result.representatives[0]!.path.id).toBe('a-path')
  })

  it('rejects date-only paths whose next leg departs before the previous leg date', async () => {
    const reverseChronology = path('reverse', 'NRT', 100, {
      feasibility: 'partial',
      edges: [
        edge('PEK', 'NRT', 'monday-leg', 100, { departureDate: '2026-09-14' }),
        edge('NRT', 'CDG', 'sunday-leg', 0, { departureDate: '2026-09-13' })
      ]
    })

    const result = await new ParetoRouteOptimizer().optimize({ paths: [reverseChronology], weights: {}, preferredLocations: [], interestLocations: [], maxRepresentatives: 10 })

    expect(result.representatives).toHaveLength(0)
    expect(result.rejectedCandidateCount).toBe(1)
  })

  it('scores a constituent airport as matching a preferred city', async () => {
    const result = await new ParetoRouteOptimizer().optimize({
      paths: [path('tokyo', 'NRT', 100), path('seoul', 'ICN', 100)],
      weights: {}, preferredLocations: [city('TYO')], interestLocations: [], maxRepresentatives: 10
    })

    const tokyo = result.representatives.find(value => value.path.id === 'tokyo')
    expect(tokyo?.score.preferredCityMatch).toBe(1)
    expect(tokyo?.badges).toContain('best_match')
  })
})
