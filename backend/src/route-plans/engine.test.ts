import { describe, expect, it } from 'vitest'
import { convergeRoutes, parseDirective, searchRoutes } from './engine.js'

const today = '2026-08-24'

describe('deterministic route planner', () => {
  it('preserves the standard multi-city directive semantics', () => {
    const parsed = parseDirective('9月1号到9月20号之间有10-20天假期，其中8天可以出去玩，去欧洲尽可能多的城市，有申根签，晚上坐飞机早晨到省住宿，深圳出发，预算一万五', today)
    expect(parsed.slots).toMatchObject({
      origin: 'SZX',
      window_from: '2026-09-01',
      window_to: '2026-09-20',
      travel_days: 8,
      region: 'schengen',
      visa: 'schengen',
      overnight_pref: true,
      budget_max: 15000,
      city_target: null
    })
    expect(parsed.missing).toEqual([])
    expect(parsed.conflicts).toEqual([])
    const picks = convergeRoutes(searchRoutes(parsed.slots))
    expect(picks.length).toBeGreaterThanOrEqual(2)
    expect(picks.length).toBeLessThanOrEqual(3)
    expect(picks[0]?.route.citySeq[0]).toBe('SZX')
    expect(picks[0]?.route.citySeq.at(-1)).toBe('SZX')
  })

  it('honours required cities and switches to visa-free candidates', () => {
    const required = parseDirective('十月中旬10天，巴黎和罗马必须去，有申根签，深圳出发', today)
    expect(required.slots.must_visit).toEqual(['CDG', 'FCO'])
    expect(convergeRoutes(searchRoutes(required.slots)).every(p => p.route.cities.includes('CDG') && p.route.cities.includes('FCO'))).toBe(true)

    const visaFree = parseDirective('没有申根签，10月出国玩8天，多去几个地方，深圳出发，10月1号到10月15号', today)
    expect(visaFree.slots).toMatchObject({ visa: 'none', region: 'visa_free' })
    expect(visaFree.notes[0]?.zh).toContain('免签')
    const visaFreeIata = new Set(['BKK', 'KUL', 'SIN', 'HAN', 'SGN', 'DPS', 'BEG', 'IST', 'CJU'])
    expect(searchRoutes(visaFree.slots).every(route => route.cities.every(city => visaFreeIata.has(city)))).toBe(true)
  })

  it('reports missing fields and explicit conflicts', () => {
    const missing = parseDirective('九月想出去玩，便宜点', today)
    expect(missing.missing).toEqual(expect.arrayContaining(['origin', 'window', 'travel_days']))
    const conflict = parseDirective('5天假期想去欧洲8个城市，全部要直飞，深圳出发，9月1号到9月10号', today)
    expect(conflict.conflicts.some(item => item.zh.includes('安排不下'))).toBe(true)
    expect(conflict.conflicts.some(item => item.zh.includes('直飞'))).toBe(true)
  })

  it('parses Chinese budget numbers and applies the hard budget bound', () => {
    expect(parseDirective('预算八千', today).slots.budget_max).toBe(8000)
    const low = parseDirective('9月1号到9月10号，8天，去欧洲4个城市，预算2000，深圳出发，有申根签', today)
    expect(searchRoutes(low.slots).every(route => route.totalPrice <= 2000)).toBe(true)
  })
})
