import { describe, expect, it } from 'vitest'
import {
  runTripPlanner,
  tripPlanRequestSchema,
  type TripPlanRequest
} from './planner.js'

const baseRequest: TripPlanRequest = tripPlanRequestSchema.parse({
  route: {
    origin: 'pek',
    destination: 'LHR',
    depart_date: '2026-09-15',
    stay_days: 3,
    budget_max: 8_000,
    interests: ['culture', 'food']
  },
  flight: {
    price: 2_300,
    segments: [{
      flightNo: 'CA937',
      airline: 'Air China',
      origin: 'PEK',
      destination: 'LHR',
      departTime: '2026-09-15T13:00:00+08:00',
      arriveTime: '2026-09-15T18:00:00+01:00',
      duration: 660
    }],
    hub: null
  },
  hub_guide: null
})

function llmClient(payload: unknown) {
  return {
    chat: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }]
    })
  }
}

describe('trip planner', () => {
  it('returns a deterministic bilingual rules plan when the provider fails', async () => {
    const result = await runTripPlanner({ chat: async () => { throw new Error('offline') } }, baseRequest)
    expect(result.source).toBe('rules')
    expect(result.warnings).toContain('llm_fallback')
    expect(result.days).toHaveLength(3)
    expect(result.summary.zh).toContain('PEK')
    expect(result.summary.en).toContain('LHR')
  })

  it('cleans a valid model plan and preserves requested flight facts', async () => {
    const result = await runTripPlanner(llmClient({
      summary: { zh: '伦敦文化之旅', en: 'London culture trip' },
      days: [{
        day: 1,
        date: '2099-01-01',
        title: { zh: '错误日期也会被规范', en: 'Canonical date wins' },
        items: [
          { time: '13:00', type: 'flight', title: { zh: '篡改航班', en: 'Hacked flight' }, note: { zh: 'x', en: 'x' } },
          { time: '20:00', type: 'meal', title: { zh: '晚餐', en: 'Dinner' }, note: { zh: '', en: '' }, ignored: true },
          { time: '20:30', type: 'unknown', title: { zh: '丢弃', en: 'Drop' }, note: { zh: '', en: '' } }
        ]
      }],
      budgetCny: { flights: 99, stay: 1_000, activities: 500, total: 1 },
      reminders: [{ zh: '提前值机', en: 'Check in early' }, { zh: '非法', en: 3 }]
    }), baseRequest)
    expect(result.source).toBe('llm')
    expect(result.days).toHaveLength(3)
    expect(result.days[0]?.date).toBe('2026-09-15')
    expect(result.days[0]?.items[0]?.title.zh).toContain('CA937')
    expect(result.days[0]?.items.some(item => item.title.zh === '篡改航班')).toBe(false)
    expect(result.days[0]?.items.some(item => item.type === 'meal')).toBe(true)
    expect(result.budgetCny).toEqual({ flights: 2_300, stay: 1_000, activities: 500, total: 3_800 })
    expect(result.reminders).toHaveLength(0)
  })

  it('falls back for invalid JSON', async () => {
    const result = await runTripPlanner({
      chat: async () => ({ choices: [{ message: { content: 'not json' } }] })
    }, baseRequest)
    expect(result.source).toBe('rules')
    expect(result.warnings).toEqual(expect.arrayContaining(['llm_fallback']))
    expect(result.budgetCny.flights).toBe(2_300)
  })

  it('recomputes total from the request price and cleaned estimates', async () => {
    const result = await runTripPlanner(llmClient({
      summary: { zh: '计划', en: 'Plan' },
      days: [{ day: 1, title: { zh: '出发', en: 'Departure' }, items: [{ time: '13:00', type: 'rest', title: { zh: '休息', en: 'Rest' }, note: { zh: '', en: '' } }] }],
      budgetCny: { flights: 999_999, stay: 1_234, activities: 567, total: 999_999_999 }
    }), baseRequest)
    expect(result.budgetCny).toEqual({ flights: 2_300, stay: 1_234, activities: 567, total: 4_101 })
  })

  it('restores positive fallback estimates when the model emits zero or invalid costs', async () => {
    const result = await runTripPlanner(llmClient({
      summary: { zh: '计划', en: 'Plan' },
      days: [{ day: 1, title: { zh: '出发', en: 'Departure' }, items: [{ time: '13:00', type: 'rest', title: { zh: '休息', en: 'Rest' }, note: { zh: '', en: '' } }] }],
      budgetCny: { flights: 0, stay: 0, activities: 0, total: 0 }
    }), baseRequest)
    expect(result.budgetCny).toEqual({ flights: 2_300, stay: 800, activities: 450, total: 3_550 })

    const oneDay = tripPlanRequestSchema.parse({
      ...baseRequest,
      route: { ...baseRequest.route, stay_days: 1 }
    })
    const oneDayResult = await runTripPlanner(llmClient({
      summary: { zh: '一天', en: 'One day' },
      days: [{ day: 1, title: { zh: '出发', en: 'Departure' }, items: [{ time: '13:00', type: 'rest', title: { zh: '休息', en: 'Rest' }, note: { zh: '', en: '' } }] }],
      budgetCny: { stay: 0, activities: 0 }
    }), oneDay)
    expect(oneDayResult.budgetCny).toEqual({ flights: 2_300, stay: 0, activities: 150, total: 2_450 })
  })

  it('enforces strict request boundaries', () => {
    expect(() => tripPlanRequestSchema.parse({ ...baseRequest, extra: true })).toThrow()
    expect(() => tripPlanRequestSchema.parse({ ...baseRequest, route: { ...baseRequest.route, stay_days: 0 } })).toThrow()
    expect(() => tripPlanRequestSchema.parse({ ...baseRequest, route: { ...baseRequest.route, stay_days: 8 } })).toThrow()
    expect(() => tripPlanRequestSchema.parse({ ...baseRequest, route: { ...baseRequest.route, origin: 'PEK', destination: 'pek' } })).toThrow()
    expect(() => tripPlanRequestSchema.parse({ ...baseRequest, route: { ...baseRequest.route, depart_date: '2026-02-30' } })).toThrow()
    expect(() => tripPlanRequestSchema.parse({ ...baseRequest, flight: { ...baseRequest.flight, price: -1 } })).toThrow()
    expect(() => tripPlanRequestSchema.parse({ ...baseRequest, flight: { ...baseRequest.flight, segments: [] } })).toThrow()
  })

  it('enforces route endpoints, segment continuity, and hub topology', () => {
    expect(() => tripPlanRequestSchema.parse({
      ...baseRequest,
      route: { ...baseRequest.route, origin: 'HND' }
    })).toThrow()
    expect(() => tripPlanRequestSchema.parse({
      ...baseRequest,
      route: { ...baseRequest.route, destination: 'CDG' }
    })).toThrow()

    const disconnected = {
      ...baseRequest,
      flight: {
        ...baseRequest.flight,
        segments: [
          baseRequest.flight.segments[0]!,
          {
            ...baseRequest.flight.segments[0]!,
            flightNo: 'BA1',
            origin: 'CDG',
            destination: 'LHR'
          }
        ]
      }
    }
    expect(() => tripPlanRequestSchema.parse(disconnected)).toThrow()
    expect(() => tripPlanRequestSchema.parse({
      ...baseRequest,
      flight: {
        ...baseRequest.flight,
        hub: { iata: 'SIN', city: 'Singapore', layoverMinutes: 600, baggageRecheck: true }
      }
    })).toThrow()
  })

  it('drops model-invented visa and transport reminders', async () => {
    const result = await runTripPlanner(llmClient({
      summary: { zh: '计划', en: 'Plan' },
      days: [{ day: 1, title: { zh: '出发', en: 'Departure' }, items: [{ time: '13:00', type: 'rest', title: { zh: '休息', en: 'Rest' }, note: { zh: '', en: '' } }] }],
      reminders: [
        { zh: '免签且无需交通签证', en: 'Visa-free and no transit visa required' },
        { zh: '机场地铁20分钟', en: 'Airport metro takes 20 minutes' }
      ]
    }), baseRequest)
    expect(result.source).toBe('llm')
    expect(result.reminders).toEqual([])
  })

  it('uses safe bilingual placeholders for missing flight display fields', async () => {
    const request = tripPlanRequestSchema.parse({
      ...baseRequest,
      flight: {
        ...baseRequest.flight,
        segments: [{ ...baseRequest.flight.segments[0]!, flightNo: '', airline: '' }]
      }
    })
    const result = await runTripPlanner({ chat: async () => { throw new Error('offline') } }, request)
    const item = result.days[0]?.items[0]
    expect(item?.title.zh).toContain('航班')
    expect(item?.title.en).toContain('Flight')
    expect(item?.note.zh).toContain('航空公司待确认')
    expect(item?.note.en).toContain('Airline pending')
  })

  it('handles a cross-day long self-transfer with factual reminders', async () => {
    const request = tripPlanRequestSchema.parse({
      ...baseRequest,
      route: { ...baseRequest.route, depart_date: '2026-12-31', stay_days: 1 },
      flight: {
        ...baseRequest.flight,
        segments: [
          { ...baseRequest.flight.segments[0]!, flightNo: 'CA100', destination: 'SIN', arriveTime: '2027-01-01T01:00:00+08:00', duration: 360 },
          { flightNo: 'SQ200', airline: 'Singapore Airlines', origin: 'SIN', destination: 'LHR', departTime: '2027-01-01T10:00:00+08:00', arriveTime: '2027-01-01T17:00:00+00:00', duration: 840 }
        ],
        hub: { iata: 'SIN', city: 'Singapore', layoverMinutes: 540, baggageRecheck: true }
      },
      hub_guide: {
        city: 'Singapore',
        visa: 'Check transit conditions',
        transport: 'MRT',
        layoverOptions: [{
          duration: '8h',
          budget: { currency: 'SGD', min: 30, max: 80 },
          activities: [{ title: 'Jewel Changi Waterfall', description: 'Airport attraction', icon: '🌿', source: 'official' }]
        }]
      }
    })
    const result = await runTripPlanner({ chat: async () => { throw new Error('offline') } }, request)
    expect(result.days[0]?.date).toBe('2026-12-31')
    expect(result.days[0]?.items.map(item => item.title.zh).join('|')).toContain('CA100')
    expect(result.reminders.some(item => item.zh.includes('自行中转'))).toBe(true)
    expect(result.reminders.some(item => item.zh.includes('跨日'))).toBe(true)
    expect(result.reminders.some(item => item.zh.includes('Singapore'))).toBe(true)
    expect(result.days[0]?.items.some(item => item.type === 'activity')).toBe(true)
  })
})
