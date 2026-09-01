import { describe, expect, it } from 'vitest'
import { parseLocally, runAgentTurn, sanitizeSlots, type AgentAirport } from './chat.js'

const airports: AgentAirport[] = [
  { iata: 'SZX', nameZh: '深圳宝安国际机场', nameEn: 'Shenzhen Baoan International Airport' },
  { iata: 'SIN', nameZh: '新加坡樟宜机场', nameEn: 'Singapore Changi Airport' },
  { iata: 'LHR', nameZh: '伦敦希思罗机场', nameEn: 'London Heathrow Airport' }
]

describe('agent chat', () => {
  it('extracts a complete Chinese trip with deterministic rules', () => {
    const slots = parseLocally(
      '2026年9月15日从新加坡去伦敦，玩7天，预算8000，接受中转',
      {},
      airports,
      '2026-09-01'
    )

    expect(slots).toMatchObject({
      origin: 'SIN',
      destination: 'LHR',
      depart_date_from: '2026-09-15',
      depart_date_to: '2026-09-18',
      stay_min: 6,
      stay_max: 8,
      trip_type: 'roundtrip',
      budget_max: 8000,
      transfer_pref: 'transfer'
    })
  })

  it('rejects airports and dates outside server constraints', () => {
    expect(sanitizeSlots({
      origin: 'CDG',
      destination: 'LHR',
      depart_date_from: '2026-08-31'
    }, airports, '2026-09-01')).toEqual({ destination: 'LHR' })
  })

  it('merges validated LLM output over multiple turns', async () => {
    const client = {
      chat: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: { zh: '信息齐了，可以搜索。', en: 'All set. Ready to search.' },
              slots: {
                origin: 'SIN',
                destination: 'LHR',
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
        { role: 'user', content: '我想去伦敦' },
        { role: 'assistant', content: '从哪里出发，什么时候出发？' },
        { role: 'user', content: '从新加坡出发，2026年9月15日' }
      ],
      slots: { destination: 'LHR' }
    }, airports, '2026-09-01')

    expect(result.source).toBe('llm')
    expect(result.ready).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.slots).toMatchObject({ origin: 'SIN', destination: 'LHR', depart_date_from: '2026-09-15' })
    expect(result.slots.budget_max).toBeUndefined()
    expect(result.slots.interests).toBeUndefined()
    expect(result.slots.trip_type).toBeUndefined()
  })

  it('falls back to deterministic parsing when OpenRouter fails', async () => {
    const client = { chat: async (): Promise<Record<string, unknown>> => { throw new Error('offline') } }
    const result = await runAgentTurn(client, {
      messages: [{ role: 'user', content: '2026年9月15日从新加坡去伦敦' }]
    }, airports, '2026-09-01')

    expect(result.source).toBe('rules')
    expect(result.warnings).toEqual(['llm_fallback'])
    expect(result.ready).toBe(true)
    expect(result.slots.origin).toBe('SIN')
    expect(result.slots.destination).toBe('LHR')
  })
})
