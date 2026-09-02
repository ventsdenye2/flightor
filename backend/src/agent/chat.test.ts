import { describe, expect, it } from 'vitest'
import { parseLocally, runAgentTurn, sanitizeSlots, type AgentAirport } from './chat.js'
import { MVP_AIRPORTS } from '../db/seed-data/mvp-airports.js'
import { buildAirportInsertSql } from '../db/migrations/005_seed_mvp_airports.js'
import { AIRPORTS } from '../../../src/mocks/airports.js'

const airports: AgentAirport[] = [
  { iata: 'PEK', nameZh: '北京首都国际机场', nameEn: 'Beijing Capital International Airport', cityZh: '北京', cityEn: 'Beijing', aliases: ['首都机场', 'peking'] },
  { iata: 'PKX', nameZh: '北京大兴国际机场', nameEn: 'Beijing Daxing International Airport', cityZh: '北京', cityEn: 'Beijing', aliases: ['大兴', 'daxing'] },
  { iata: 'PVG', nameZh: '上海浦东国际机场', nameEn: 'Shanghai Pudong International Airport', cityZh: '上海', cityEn: 'Shanghai', aliases: ['浦东', 'pudong'] },
  { iata: 'SHA', nameZh: '上海虹桥国际机场', nameEn: 'Shanghai Hongqiao International Airport', cityZh: '上海', cityEn: 'Shanghai', aliases: ['虹桥', 'hongqiao'] },
  { iata: 'NRT', nameZh: '东京成田国际机场', nameEn: 'Tokyo Narita International Airport', cityZh: '东京', cityEn: 'Tokyo', aliases: ['成田', 'narita'] },
  { iata: 'HND', nameZh: '东京羽田机场', nameEn: 'Tokyo Haneda Airport', cityZh: '东京', cityEn: 'Tokyo', aliases: ['羽田', 'haneda'] },
  { iata: 'KIX', nameZh: '大阪关西国际机场', nameEn: 'Osaka Kansai International Airport', cityZh: '大阪', cityEn: 'Osaka', aliases: ['关西', 'kansai'] },
  { iata: 'ICN', nameZh: '首尔仁川国际机场', nameEn: 'Seoul Incheon International Airport', cityZh: '首尔', cityEn: 'Seoul', aliases: ['仁川', 'incheon'] },
  { iata: 'CDG', nameZh: '巴黎戴高乐机场', nameEn: 'Paris Charles de Gaulle Airport', cityZh: '巴黎', cityEn: 'Paris', aliases: ['戴高乐', 'charles de gaulle'] },
  { iata: 'LHR', nameZh: '伦敦希思罗机场', nameEn: 'London Heathrow Airport', cityZh: '伦敦', cityEn: 'London', aliases: ['希思罗', 'heathrow'] },
  { iata: 'LGW', nameZh: '伦敦盖特威克机场', nameEn: 'London Gatwick Airport', cityZh: '伦敦', cityEn: 'London', aliases: ['盖特威克', 'gatwick'] },
  { iata: 'JFK', nameZh: '纽约肯尼迪国际机场', nameEn: 'New York JFK International Airport', cityZh: '纽约', cityEn: 'New York', aliases: ['肯尼迪', 'jfk'] },
  { iata: 'LAX', nameZh: '洛杉矶国际机场', nameEn: 'Los Angeles International Airport', cityZh: '洛杉矶', cityEn: 'Los Angeles', aliases: [] },
  { iata: 'SIN', nameZh: '新加坡樟宜机场', nameEn: 'Singapore Changi Airport', cityZh: '新加坡', cityEn: 'Singapore', aliases: ['樟宜', 'changi'] }
]

describe('agent chat', () => {
  it('parses Beijing -> Tokyo as PEK -> NRT by default', () => {
    const slots = parseLocally('北京去东京', {}, airports, '2026-09-01')
    expect(slots).toMatchObject({ origin: 'PEK', destination: 'NRT' })
  })

  it('parses Beijing -> Tokyo Haneda as PEK -> HND', () => {
    const slots = parseLocally('北京去东京羽田', {}, airports, '2026-09-01')
    expect(slots).toMatchObject({ origin: 'PEK', destination: 'HND' })
  })

  it('parses Tokyo -> London as NRT -> LHR by default', () => {
    const slots = parseLocally('东京去伦敦', {}, airports, '2026-09-01')
    expect(slots).toMatchObject({ origin: 'NRT', destination: 'LHR' })
  })

  it('keeps explicit IATA codes HND and LHR', () => {
    const slots = parseLocally('HND 去 LHR', {}, airports, '2026-09-01')
    expect(slots).toMatchObject({ origin: 'HND', destination: 'LHR' })
  })

  it('does not guess Tokyo when user only says Japan', () => {
    const slots = parseLocally('我想去日本', {}, airports, '2026-09-01')
    expect(slots.destination).toBeUndefined()
    expect(slots.origin).toBeUndefined()
  })

  it('never fills origin and destination with two airports from the same city', () => {
    const slots = parseLocally('去羽田', { origin: 'NRT' }, airports, '2026-09-01')
    expect(slots.origin).toBe('NRT')
    expect(slots.destination).toBeUndefined()
  })

  it('fills multi-turn slots from destination-first to complete trip', () => {
    const first = parseLocally('我想去东京', {}, airports, '2026-09-01')
    expect(first).toMatchObject({ destination: 'NRT' })
    const second = parseLocally('从北京出发，2026年9月15日', first, airports, '2026-09-01')
    expect(second).toMatchObject({
      origin: 'PEK',
      destination: 'NRT',
      depart_date_from: '2026-09-15'
    })
    expect(second.depart_date_to).toBe('2026-09-18')
  })

  it('parses Haneda -> London as HND -> LHR', () => {
    const slots = parseLocally('从羽田去伦敦', {}, airports, '2026-09-01')
    expect(slots).toMatchObject({ origin: 'HND', destination: 'LHR' })
  })

  it('filters model-invented budget, interests and trip_type', async () => {
    const client = {
      chat: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: { zh: '信息齐了，可以搜索。', en: 'All set. Ready to search.' },
              slots: {
                origin: 'PEK',
                destination: 'NRT',
                depart_date_from: '2026-09-15',
                budget_max: 99999,
                interests: ['food', 'shopping'],
                trip_type: 'oneway'
              }
            })
          }
        }]
      })
    }

    const result = await runAgentTurn(client, {
      messages: [
        { role: 'user', content: '我想去东京' },
        { role: 'assistant', content: '从哪里出发，什么时候出发？' },
        { role: 'user', content: '从北京出发，2026年9月15日' }
      ],
      slots: { destination: 'NRT' }
    }, airports, '2026-09-01')

    expect(result.source).toBe('llm')
    expect(result.ready).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.slots).toMatchObject({ origin: 'PEK', destination: 'NRT', depart_date_from: '2026-09-15' })
    expect(result.slots.budget_max).toBeUndefined()
    expect(result.slots.interests).toBeUndefined()
    expect(result.slots.trip_type).toBeUndefined()
  })

  it('does not accept a model-invented destination for a country-only request', async () => {
    const client = {
      chat: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: { zh: '已为你填好东京。', en: 'I filled Tokyo for you.' },
              slots: { destination: 'NRT', depart_date_from: '2026-09-15' }
            })
          }
        }]
      })
    }

    const result = await runAgentTurn(client, {
      messages: [{ role: 'user', content: '我想去日本，2026年9月15日' }]
    }, airports, '2026-09-01')

    expect(result.source).toBe('llm')
    expect(result.slots.destination).toBeUndefined()
    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(['origin', 'destination'])
    expect(result.reply.zh).toContain('具体城市或 IATA')
  })

  it('uses the server fallback when an incomplete model reply is too long or misleading', async () => {
    const client = {
      chat: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: { zh: `${'机场列表 '.repeat(80)}日本不支持`, en: 'Japan is unsupported.' },
              slots: {}
            })
          }
        }]
      })
    }

    const result = await runAgentTurn(client, {
      messages: [{ role: 'user', content: '我想去日本' }]
    }, airports, '2026-09-01')

    expect(result.ready).toBe(false)
    expect(result.reply.zh).toContain('具体城市或 IATA')
    expect(result.reply.zh).not.toContain('日本不支持')
    expect(result.reply.en).not.toContain('unsupported')
  })

  it('lets explicit follow-up destinations replace a previous default airport', () => {
    const previous = { origin: 'PEK', destination: 'NRT', depart_date_from: '2026-09-15' }
    expect(parseLocally('目的地是伦敦', previous, airports, '2026-09-01').destination).toBe('LHR')
    expect(parseLocally('改成巴黎', previous, airports, '2026-09-01').destination).toBe('CDG')
    expect(parseLocally('东京羽田', previous, airports, '2026-09-01').destination).toBe('HND')
    expect(parseLocally('HND', previous, airports, '2026-09-01').destination).toBe('HND')
  })

  it('keeps an existing destination while filling an origin in a follow-up', () => {
    expect(parseLocally('从上海出发', { destination: 'NRT' }, airports, '2026-09-01'))
      .toMatchObject({ origin: 'PVG', destination: 'NRT' })
  })

  it('does not infer trip type from stay duration alone', () => {
    expect(parseLocally('去东京玩7天', {}, airports, '2026-09-01'))
      .toMatchObject({ destination: 'NRT', stay_min: 6, stay_max: 8 })
    expect(parseLocally('去东京玩7天', {}, airports, '2026-09-01').trip_type).toBeUndefined()
    expect(parseLocally('去东京一周', {}, airports, '2026-09-01').trip_type).toBeUndefined()
    expect(parseLocally('去东京，明确往返', {}, airports, '2026-09-01').trip_type).toBe('roundtrip')
  })

  it('does not mistake Barcelona or Germany for preference keywords', () => {
    expect(parseLocally('去Barcelona', {}, airports, '2026-09-01').interests).toBeUndefined()
    expect(parseLocally('去Germany', {}, airports, '2026-09-01').transfer_pref).toBeUndefined()
  })

  it('falls back to deterministic parsing when OpenRouter fails', async () => {
    const client = { chat: async (): Promise<Record<string, unknown>> => { throw new Error('offline') } }
    const result = await runAgentTurn(client, {
      messages: [{ role: 'user', content: '2026年9月15日从北京去东京' }]
    }, airports, '2026-09-01')

    expect(result.source).toBe('rules')
    expect(result.warnings).toEqual(['llm_fallback'])
    expect(result.ready).toBe(true)
    expect(result.slots).toMatchObject({ origin: 'PEK', destination: 'NRT', depart_date_from: '2026-09-15' })
  })

  it('rejects expired dates', () => {
    const slots = sanitizeSlots({
      origin: 'PEK',
      destination: 'NRT',
      depart_date_from: '2026-08-31'
    }, airports, '2026-09-01')
    expect(slots).toMatchObject({ origin: 'PEK', destination: 'NRT' })
    expect(slots.depart_date_from).toBeUndefined()
  })

  it('rejects unsupported airport codes', () => {
    const slots = sanitizeSlots({
      origin: 'XXX',
      destination: 'NRT',
      depart_date_from: '2026-09-15'
    }, airports, '2026-09-01')
    expect(slots).toEqual({ destination: 'NRT', depart_date_from: '2026-09-15' })
  })

  it('seed data covers required MVP airports', () => {
    const required = ['PEK', 'PKX', 'PVG', 'SHA', 'NRT', 'HND', 'LHR', 'LGW', 'CDG', 'KIX', 'ICN', 'JFK', 'LAX', 'CTU', 'TFU']
    const iatas = new Set(MVP_AIRPORTS.map(airport => airport.iata))
    for (const iata of required) {
      expect(iatas.has(iata)).toBe(true)
    }
  })

  it('keeps frontend and backend MVP IATA sets aligned and preserves CTU/TFU facts', () => {
    expect(new Set(MVP_AIRPORTS.map(airport => airport.iata))).toEqual(new Set(AIRPORTS.map(airport => airport.iata)))
    const ctu = MVP_AIRPORTS.find(airport => airport.iata === 'CTU')!
    const tfu = MVP_AIRPORTS.find(airport => airport.iata === 'TFU')!
    expect(ctu).toMatchObject({ nameZh: '成都双流国际机场', cityZh: '成都', lat: 30.5785, lng: 103.9471 })
    expect(tfu).toMatchObject({ nameZh: '成都天府国际机场', cityZh: '成都', lat: 30.3125, lng: 104.4419 })
    expect(ctu.aliases).toContain('双流')
    expect(tfu.aliases).toContain('天府')
  })

  it('builds airport seeds with a cities.id foreign key and preserves authority fields', () => {
    const statement = buildAirportInsertSql()
    expect(statement).toContain('select v.iata_code, c.id, v.country_code')
    expect(statement).toContain('join cities c on c.iata_code = v.city_iata')
    expect(statement).toContain('city_id = coalesce(airports.city_id, excluded.city_id)')
    expect(statement).not.toContain('active = excluded.active')
    expect(statement).not.toContain('source_updated_at = excluded.source_updated_at')
  })

})
