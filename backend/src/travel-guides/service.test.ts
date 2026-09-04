import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../lib/errors.js'
import type { RoutePick } from '../route-plans/engine.js'
import { converse } from '../conversation-agent/service.js'
import { emptyTripState } from '../conversation-agent/schema.js'
import {
  buildTravelGuide,
  GUIDE_CACHE_TTL_SECONDS,
  hasTravelGuideIntent,
  travelGuideSearchCacheKey
} from './service.js'
import type { TravelGuideDependencies, TravelGuideSearchInput } from './types.js'

function routeFor(cities: string[] = ['NRT', 'KIX']): RoutePick {
  const citySeq = ['PEK', ...cities, 'PEK']
  return {
    kind: 'cheapest',
    route: {
      cities,
      citySeq,
      legs: citySeq.slice(0, -1).map((from, index) => ({
        from,
        to: citySeq[index + 1]!,
        date: `2026-10-${String(1 + index * 2).padStart(2, '0')}`,
        departTime: '10:00',
        arriveTime: '13:00',
        crossDay: false,
        duration: 180,
        price: 1_000,
        airline: 'TEST'
      })),
      totalPrice: 3_000,
      effCost: 3_000,
      nightsSaved: 0,
      hasReal: false
    }
  }
}

function webResult(title = 'Tokyo travel guide', url = 'https://example.com/tokyo'): { title: string; snippet: string; url: string; domain: string } {
  return { title, snippet: 'Museums, neighborhoods and local food ideas for a flexible day.', url, domain: 'untrusted.example' }
}

function redisStub() {
  const values = new Map<string, string>()
  const setCalls: Array<{ key: string; mode: string; seconds: number }> = []
  return {
    values,
    setCalls,
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string, mode: 'EX', seconds: number) => {
      values.set(key, value)
      setCalls.push({ key, mode, seconds })
    }
  }
}

describe('travel guide service', () => {
  it('detects explicit guide intent while keeping ordinary planning neutral', () => {
    expect(hasTravelGuideIntent('帮我安排每天怎么玩和景点')).toBe(true)
    expect(hasTravelGuideIntent('请给我生成机票路线')).toBe(false)
  })

  it('passes only catalog fields to research and filters unsafe source URLs', async () => {
    let received: TravelGuideSearchInput | undefined
    const research = {
      searchTravelGuide: vi.fn(async (input: TravelGuideSearchInput) => {
        received = input
        return [
          webResult(),
          webResult('javascript result', 'javascript:alert(1)'),
          webResult('data result', 'data:text/plain,unsafe'),
          webResult('second', 'https://second.example/guide')
        ]
      })
    }
    const result = await buildTravelGuide({ route: routeFor(['NRT']), travelDays: 5, interests: ['culture'] }, { research })
    expect(received).toMatchObject({ cityIata: 'NRT', travelDays: 5, interests: ['culture'] })
    expect(received && 'query' in received).toBe(false)
    expect(result.sources.every(source => source.source === 'web' ? /^https?:$/.test(new URL(source.url).protocol) : true)).toBe(true)
    expect(result.sources.some(source => source.url.startsWith('javascript:'))).toBe(false)
    expect(result.sources.some(source => source.url.startsWith('data:'))).toBe(false)
  })

  it('caches normalized per-city search results for twelve hours', async () => {
    const redis = redisStub()
    const research = { searchTravelGuide: vi.fn(async () => [webResult()]) }
    const deps: TravelGuideDependencies = { research, redis }
    await buildTravelGuide({ route: routeFor(['NRT']), travelDays: 5, interests: ['food'] }, deps)
    await buildTravelGuide({ route: routeFor(['NRT']), travelDays: 5, interests: ['food'] }, deps)
    expect(research.searchTravelGuide).toHaveBeenCalledTimes(1)
    expect(redis.setCalls[0]).toMatchObject({ mode: 'EX', seconds: GUIDE_CACHE_TTL_SECONDS })
    expect(travelGuideSearchCacheKey({ cityIata: 'NRT', interests: ['food'], travelDays: 5 })).not.toContain('food')
  })

  it('keeps partial web results and fills failed cities from the catalog', async () => {
    const research = {
      searchTravelGuide: vi.fn(async ({ cityIata }: TravelGuideSearchInput) => {
        if (cityIata === 'KIX') throw new Error('temporary provider failure')
        return [webResult()]
      })
    }
    const result = await buildTravelGuide({ route: routeFor(), travelDays: 6, interests: ['culture'] }, { research })
    expect(result.source).toBe('web')
    expect(result.warnings).toContain('travel_guide_search_partial')
    expect(result.warnings).toContain('travel_guide_partial_catalog_fallback')
    expect(result.days.some(day => day.cityIata === 'KIX' && day.items.some(item => item.source === 'catalog'))).toBe(true)
  })

  it('degrades to clearly-labelled catalog guidance when SerpApi has no key', async () => {
    const research = {
      searchTravelGuide: vi.fn(async () => {
        throw new AppError('PROVIDER_NOT_CONFIGURED', 'not configured', 503)
      })
    }
    const result = await buildTravelGuide({ route: routeFor(['NRT']), travelDays: 4, interests: [] }, { research })
    expect(result.source).toBe('catalog')
    expect(result.warnings).toContain('travel_guide_search_failed')
    expect(result.warnings).toContain('travel_guide_catalog_fallback')
    expect(result.days[0]?.items.every(item => item.source === 'catalog')).toBe(true)
  })

  it('rejects model-invented cities or unsupported claims and keeps deterministic output', async () => {
    const llm = {
      chat: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify({
          summary: { zh: '东京攻略', en: 'Tokyo guide' },
          days: [{
            day: 1,
            cityIata: 'CDG',
            items: [{
              title: { zh: '巴黎', en: 'Paris' },
              description: { zh: '营业时间 09:00', en: 'Open 09:00' },
              cityIata: 'CDG',
              sourceIndexes: [0],
              evidence: 'Museums'
            }]
          }]
        }) } }]
      }))
    }
    const result = await buildTravelGuide({ route: routeFor(['NRT']), travelDays: 4, interests: ['culture'] }, {
      research: { searchTravelGuide: vi.fn(async () => [webResult()]) },
      llm
    })
    expect(result.warnings).toContain('travel_guide_llm_fallback')
    expect(result.days.some(day => day.items.some(item => item.cityIata === 'CDG'))).toBe(false)
    expect(result.days.every(day => day.cityIata === 'NRT')).toBe(true)
  })

  it('does not search for an ordinary route, but searches after an explicit guide request', async () => {
    const state = {
      ...emptyTripState(),
      origin: 'PEK',
      window_from: '2026-10-01',
      window_to: '2026-10-08',
      travel_days: 7,
      regions: ['japan' as const],
      required_iatas: ['NRT'],
      destination_mode: 'explicit' as const
    }
    const research = { searchTravelGuide: vi.fn(async () => [webResult()]) }
    const deps: TravelGuideDependencies = { research }
    const ordinary = await converse({ today: '2026-09-04', state, messages: [{ role: 'user', content: '继续' }] }, undefined, { travelGuide: deps })
    expect(ordinary.routes.length).toBeGreaterThan(0)
    expect(research.searchTravelGuide).not.toHaveBeenCalled()
    expect(ordinary.suggestedActions.some(item => item.id === 'generate-travel-guide')).toBe(true)

    const guided = await converse({ today: '2026-09-04', state, messages: [{ role: 'user', content: '请安排每天怎么玩和景点' }] }, undefined, { travelGuide: deps })
    expect(guided.travelGuide).toBeDefined()
    expect(research.searchTravelGuide).toHaveBeenCalled()
  })
})
