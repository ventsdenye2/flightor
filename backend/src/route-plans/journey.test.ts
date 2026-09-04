import { describe, expect, it } from 'vitest'
import { planJourney, type JourneyPlanInput } from './journey.js'

const baseInput: JourneyPlanInput = {
  origin: 'SZX',
  windowFrom: '2026-09-01',
  windowTo: '2026-09-20',
  travelDays: 7,
  regions: ['japan', 'schengen'],
  requiredIatas: [],
  excludedIatas: [],
  interests: ['culture'],
  budgetMax: 200_000,
  cityTarget: 6,
  overnightPref: false,
  directOnly: false
}

function input(overrides: Partial<JourneyPlanInput> = {}): JourneyPlanInput {
  return { ...baseInput, ...overrides }
}

describe('cross-region journey planner', () => {
  it('includes every requested region and keeps a seven-day Japan+Europe plan conservative', () => {
    const picks = planJourney(input())
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.length).toBeLessThanOrEqual(3)
    for (const pick of picks) {
      expect(pick.route.cities.length).toBeLessThanOrEqual(3)
      expect(pick.route.cities.some(city => city === 'NRT' || city === 'HND' || city === 'KIX')).toBe(true)
      expect(pick.route.cities.some(city => ['CDG', 'AMS', 'FRA', 'MUC', 'VIE', 'PRG', 'FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'ATH', 'BUD', 'CPH', 'HEL'].includes(city))).toBe(true)
    }
  })

  it('honours required and excluded destinations', () => {
    const picks = planJourney(input({ requiredIatas: ['NRT', 'FCO'], excludedIatas: ['KIX'] }))
    expect(picks.length).toBeGreaterThan(0)
    for (const pick of picks) {
      expect(pick.route.cities).toContain('NRT')
      expect(pick.route.cities).toContain('FCO')
      expect(pick.route.cities).not.toContain('KIX')
    }
  })

  it('keeps an explicit Japan-then-Europe region order', () => {
    const picks = planJourney(input({ regions: ['japan', 'schengen'] }))
    expect(picks.length).toBeGreaterThan(0)
    for (const pick of picks) {
      const regions = pick.route.cities.map(city => ['NRT', 'HND', 'KIX'].includes(city) ? 'japan' : 'schengen')
      const firstEurope = regions.indexOf('schengen')
      expect(firstEurope).toBeGreaterThanOrEqual(0)
      expect(regions.slice(0, firstEurope).every(region => region === 'japan')).toBe(true)
      expect(regions.slice(firstEurope).every(region => region === 'schengen')).toBe(true)
    }
  })

  it('supports a single explicit Tokyo destination as a closed loop', () => {
    const picks = planJourney(input({ regions: ['japan'], requiredIatas: ['NRT'], cityTarget: 1 }))
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every(pick => pick.route.cities.length === 1 && pick.route.cities[0] === 'NRT')).toBe(true)
    expect(picks[0]?.route.citySeq).toEqual(['SZX', 'NRT', 'SZX'])
  })

  it('does not turn an empty region selection into a three-region itinerary', () => {
    const picks = planJourney(input({ regions: [], cityTarget: 6 }))
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every(pick => new Set(pick.route.cities.map(city => {
      if (['NRT', 'HND', 'KIX'].includes(city)) return 'japan'
      if (['CDG', 'AMS', 'FRA', 'MUC', 'VIE', 'PRG', 'FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'ATH', 'BUD', 'CPH', 'HEL'].includes(city)) return 'schengen'
      return 'visa_free'
    })).size === 1)).toBe(true)
  })

  it('keeps a too-low budget as a hard bound', () => {
    expect(planJourney(input({ budgetMax: 2_000 }))).toEqual([])
  })

  it('returns no route when required cities exceed the conservative city capacity', () => {
    expect(planJourney(input({ requiredIatas: ['NRT', 'KIX', 'FCO', 'CDG'] }))).toEqual([])
  })

  it('rejects unsupported required codes and remains deterministic', () => {
    expect(planJourney(input({ requiredIatas: ['AAA'] }))).toEqual([])
    const first = planJourney(input())
    const second = planJourney(input())
    expect(first).toEqual(second)
  })
})
