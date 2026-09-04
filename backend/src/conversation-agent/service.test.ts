import { describe, expect, it } from 'vitest'
import { buildJourneyInput } from './planner-adapter.js'
import { converse } from './service.js'
import { converseRequestSchema, emptyTripState } from './schema.js'

const today = '2026-09-03'

describe('unified conversation agent', () => {
  it('keeps an undecided Japan + Europe request recommendation-driven', async () => {
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，先日本再欧洲，7天，预算2万，文化，欧洲你决定' }]
    }, undefined)

    expect(result.phase).toBe('discover')
    expect(result.state).toMatchObject({
      origin: 'PEK',
      travel_days: 7,
      budget_max: 20_000,
      interests: ['culture'],
      regions: ['japan', 'schengen'],
      destination_mode: 'recommend'
    })
    expect(result.state.required_iatas).toEqual([])
    expect(result.recommendations.length).toBeGreaterThanOrEqual(2)
    expect(result.recommendations.length).toBeLessThanOrEqual(3)
    expect(result.missing).toEqual(['window_from'])
  })

  it.each([
    ['一万五', 15_000],
    ['一万五千', 15_000],
    ['两万三', 23_000],
    ['1万5', 15_000],
    ['1万5千', 15_000],
    ['1.5万', 15_000],
    ['八千', 8_000],
    ['一万零五百', 10_500],
    ['15000', 15_000],
    ['一万多', null]
  ] as const)('parses budget %s as %d', async (amount, expected) => {
    const result = await converse({
      today,
      messages: [{ role: 'user', content: `北京出发，去东京，2026-09-15，玩7天，预算${amount}` }]
    }, undefined)

    expect(result.state.budget_max).toBe(expected)
  })

  it('overwrites a prior budget when the user explicitly changes it', async () => {
    const state = {
      ...emptyTripState(),
      origin: 'PEK',
      window_from: '2026-09-15',
      window_to: '2026-09-21',
      travel_days: 7,
      budget_max: 10_000,
      required_iatas: ['NRT'],
      destination_mode: 'explicit' as const
    }
    const result = await converse({
      today,
      state,
      messages: [{ role: 'user', content: '预算改成一万五' }]
    }, undefined)

    expect(result.state.budget_max).toBe(15_000)
  })

  it('keeps the deterministic precise budget over a coarse LLM value', async () => {
    let calls = 0
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，去东京，2026-09-15，玩7天，预算一万五' }]
    }, {
      chat: async () => {
        calls += 1
        const content = calls === 1
          ? JSON.stringify({ delta: { budget_max: 10_000 } })
          : JSON.stringify({ reply: { zh: '预算已按你的输入保留。', en: 'The budget is kept as provided.' } })
        return { choices: [{ message: { content } }] }
      }
    })

    expect(calls).toBe(2)
    expect(result.source).toBe('llm')
    expect(result.state.budget_max).toBe(15_000)
  })

  it('does not convert a country into a city without recommendation authorization', async () => {
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '我想去日本' }]
    }, undefined)

    expect(result.state.destination_mode).toBe('explicit')
    expect(result.state.required_iatas).not.toContain('NRT')
    expect(result.state.required_iatas).not.toContain('KIX')
  })

  it('recognizes natural city-choice authorization and recommends before a date', async () => {
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，先日本再欧洲，7天，预算2万，文化，欧洲知名城市' }]
    }, undefined)

    expect(result.phase).toBe('discover')
    expect(result.state.destination_mode).toBe('recommend')
    expect(result.state.required_iatas).toEqual([])
    expect(result.recommendations.length).toBeGreaterThanOrEqual(2)
    expect(result.missing).toEqual(['window_from'])
  })

  it('blocks an explicit full-field request with no named destination', async () => {
    const state = {
      ...emptyTripState(),
      origin: 'PEK',
      window_from: '2026-09-15',
      window_to: '2026-09-21',
      travel_days: 7,
      regions: ['japan' as const],
      destination_mode: 'explicit' as const
    }
    const result = await converse({ today, state, messages: [{ role: 'user', content: '继续' }] }, undefined)

    expect(result.phase).toBe('clarify')
    expect(result.missing).toContain('destination')
    expect(result.routes).toEqual([])
    expect(result.reply.zh).toContain('具体城市')
  })

  it('asks for the uncovered region when only one of two explicit regions has a city', async () => {
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，先日本再欧洲，2026-09-15，7天，去东京' }]
    }, undefined)

    expect(result.state.destination_mode).toBe('explicit')
    expect(result.state.required_iatas).toEqual(['NRT'])
    expect(result.missing).toContain('destination')
    expect(result.routes).toEqual([])
    expect(result.reply.zh).toContain('欧洲')
  })

  it('keeps recommendation mode when a user adds a must-visit city', async () => {
    const state = {
      ...emptyTripState(),
      origin: 'PEK',
      window_from: '2026-09-15',
      window_to: '2026-09-21',
      travel_days: 7,
      regions: ['japan' as const],
      destination_mode: 'recommend' as const
    }
    const result = await converse({
      today,
      state,
      messages: [{ role: 'user', content: '把东京加入必去城市' }]
    }, undefined)

    expect(result.state.destination_mode).toBe('recommend')
    expect(result.state.required_iatas).toEqual(['NRT'])
  })

  it('switches recommendation mode only after an explicit recommendation opt-out', async () => {
    const state = {
      ...emptyTripState(),
      origin: 'PEK',
      window_from: '2026-09-15',
      window_to: '2026-09-21',
      travel_days: 7,
      regions: ['japan' as const],
      destination_mode: 'recommend' as const
    }
    const result = await converse({
      today,
      state,
      messages: [{ role: 'user', content: '不需要推荐，只去东京' }]
    }, undefined)

    expect(result.state.destination_mode).toBe('explicit')
    expect(result.state.required_iatas).toEqual(['NRT'])
  })

  it('plans after a date is supplied, while keeping the three blocking fields explicit', async () => {
    const first = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，先日本再欧洲，7天，预算2万，文化，欧洲你决定' }]
    }, undefined)
    const second = await converse({
      today,
      state: first.state,
      messages: [
        { role: 'user', content: '北京出发，先日本再欧洲，7天，预算2万，文化，欧洲你决定' },
        { role: 'assistant', content: first.reply.zh },
        { role: 'user', content: '出发日期是 2026-09-15' }
      ]
    }, undefined)

    expect(second.phase).toBe('plan')
    expect(second.missing).toEqual([])
    expect(second.routes.length).toBeGreaterThan(0)
  })

  it('clears all previous dates when starting a new trip', async () => {
    const state = {
      ...emptyTripState(),
      origin: 'PEK',
      window_from: '2026-10-01',
      window_to: '2026-10-01',
      travel_days: 7
    }
    const result = await converse({
      today,
      newTrip: true,
      state,
      messages: [{ role: 'user', content: '重新规划，上海出发' }]
    }, undefined)

    expect(result.state.origin).toBe('PVG')
    expect(result.state.window_from).toBeNull()
    expect(result.state.window_to).toBeNull()
    expect(result.state.travel_days).toBeNull()
  })

  it('replays all current-trip user turns when a new-trip retry has no state', async () => {
    const result = await converse({
      today,
      newTrip: true,
      messages: [
        { role: 'user', content: '北京出发，去东京' },
        { role: 'assistant', content: '请补充日期。' },
        { role: 'user', content: '2026-09-15，玩7天' }
      ]
    }, undefined)

    expect(result.state).toMatchObject({
      origin: 'PEK',
      required_iatas: ['NRT'],
      window_from: '2026-09-15',
      travel_days: 7
    })
  })

  it('drops turns before the latest reset marker during a new-trip replay', async () => {
    const result = await converse({
      today,
      newTrip: true,
      messages: [
        { role: 'user', content: '上海出发，去巴黎，2026-10-01，玩7天' },
        { role: 'assistant', content: '旧行程回复' },
        { role: 'user', content: '重新规划，北京出发，去东京' },
        { role: 'assistant', content: '请补日期' },
        { role: 'user', content: '出发日期是 2026-09-15，玩7天' }
      ]
    }, undefined)

    expect(result.state).toMatchObject({
      origin: 'PEK',
      required_iatas: ['NRT'],
      window_from: '2026-09-15',
      travel_days: 7
    })
    expect(result.state.required_iatas).not.toContain('CDG')
    expect(result.state.origin).not.toBe('PVG')
  })

  it('falls back to rules when the model fails', async () => {
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，2026-09-15，去东京玩7天' }]
    }, { chat: async () => { throw new Error('offline') } })

    expect(result.source).toBe('rules')
    expect(result.warnings).toContain('llm_fallback')
    expect(result.state).toMatchObject({ origin: 'PEK', required_iatas: ['NRT'], window_from: '2026-09-15', travel_days: 7 })
  })

  it('filters a model-invented city when the user only named Japan', async () => {
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '我想去日本' }]
    }, {
      chat: async () => ({
        choices: [{ message: { content: JSON.stringify({ delta: { required_iatas: ['NRT'], destination_mode: 'explicit' } }) } }]
      })
    })

    expect(result.source).toBe('llm')
    expect(result.state.required_iatas).toEqual([])
  })

  it('falls back when the final model wording names an unverified catalog city', async () => {
    let calls = 0
    const result = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，2026-09-15，去东京玩7天' }]
    }, {
      chat: async () => {
        calls += 1
        const content = calls === 1
          ? JSON.stringify({ delta: {} })
          : JSON.stringify({ reply: { zh: '我建议改去巴黎。', en: 'I recommend Paris.' } })
        return { choices: [{ message: { content } }] }
      }
    })

    expect(calls).toBe(2)
    expect(result.source).toBe('llm')
    expect(result.warnings).toContain('reply_fallback')
    expect(result.reply.zh).not.toContain('巴黎')
  })

  it('merges corrections and exclusions over multiple turns', async () => {
    const first = await converse({
      today,
      messages: [{ role: 'user', content: '北京出发，2026-09-15，去东京玩7天' }]
    }, undefined)
    const result = await converse({
      today,
      state: first.state,
      messages: [{ role: 'user', content: '改成大阪，不去东京' }]
    }, undefined)

    expect(result.state.required_iatas).toEqual(['KIX'])
    expect(result.state.excluded_iatas).toContain('NRT')
  })

  it('strictly rejects unknown request and state fields', () => {
    expect(() => converseRequestSchema.parse({
      today,
      messages: [{ role: 'user', content: '北京出发' }],
      unknown: true
    })).toThrow()
    expect(() => converseRequestSchema.parse({
      today,
      messages: [{ role: 'user', content: '北京出发' }],
      state: { ...emptyTripState(), hidden: 'value' }
    })).toThrow()
    expect(() => converseRequestSchema.parse({
      today,
      messages: [{ role: 'assistant', content: '请告诉我出发地' }]
    })).toThrow()
  })

  it('sanitizes illegal client origin and destination codes before planning', async () => {
    const result = await converse({
      today,
      state: {
        ...emptyTripState(),
        origin: 'XXX',
        window_from: '2026-09-15',
        window_to: '2026-09-21',
        travel_days: 7,
        required_iatas: ['XXX'],
        excluded_iatas: ['ZZZ']
      },
      messages: [{ role: 'user', content: '继续' }]
    }, undefined)

    expect(result.state.origin).toBeNull()
    expect(result.state.required_iatas).toEqual([])
    expect(result.state.excluded_iatas).toEqual([])
    expect(result.missing).toEqual(expect.arrayContaining(['origin', 'destination']))
    expect(result.routes).toEqual([])
  })

  it('keeps few-transfers as a soft preference until JourneyPlanInput exposes one', () => {
    const input = buildJourneyInput({
      ...emptyTripState(),
      origin: 'PEK',
      window_from: '2026-09-15',
      window_to: '2026-09-21',
      travel_days: 7,
      required_iatas: ['NRT'],
      priorities: ['few_transfers']
    })
    expect(input.directOnly).toBe(false)
  })
})
