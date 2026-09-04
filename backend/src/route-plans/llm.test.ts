import { describe, expect, it } from 'vitest'
import { parseDirectiveSmart } from './llm.js'

const text = '9月1号到9月20号之间中间8天出去玩，欧洲尽可能多城市，有申根签，晚上坐飞机早晨到，深圳出发，预算一万五'

describe('route planner LLM parsing', () => {
  it('uses the configured OpenRouter options and filters invented facts', async () => {
    let captured: { options?: unknown } | undefined
    const client = {
      chat: async (_messages: unknown[], _model?: string, options?: unknown) => {
        captured = { options }
        return { choices: [{ message: { content: JSON.stringify({
          origin: '深圳', window_from: '2026-09-01', window_to: '2026-09-20', travel_days: 8,
          region: 'schengen', visa: 'schengen', must_visit: [], overnight_pref: true,
          direct_only: false, budget_max: 15000, city_target: null,
          fabricated: 'ignore'
        }) } }] }
      }
    }
    const result = await parseDirectiveSmart(client, text, '2026-08-24')
    expect(result.source).toBe('llm')
    expect(result.warnings).toEqual([])
    expect(result.slots.budget_max).toBe(15000)
    expect(captured?.options).toEqual({ maxTokens: 1000, temperature: 0, reasoning: { effort: 'none', exclude: true } })

    const invented = await parseDirectiveSmart({
      chat: async () => ({ choices: [{ message: { content: JSON.stringify({ origin: '深圳', window_from: '2026-09-01', window_to: '2026-09-20', travel_days: 8, budget_max: 50000, visa: 'schengen', region: 'schengen', must_visit: [], overnight_pref: false, direct_only: false, city_target: null }) } }] })
    }, '去欧洲玩，9月1号到9月20号', '2026-08-24')
    expect(invented.slots.origin).toBe(null)
    expect(invented.slots.travel_days).toBe(null)
    expect(invented.slots.budget_max).toBe(null)
  })

  it('falls back to rules with a stable warning for empty/invalid providers and no key', async () => {
    const invalid = await parseDirectiveSmart({ chat: async () => ({ choices: [{ message: { content: 'not json' } }] }) }, text, '2026-08-24')
    expect(invalid.source).toBe('rules')
    expect(invalid.warnings).toEqual(['llm_fallback'])
    expect(invalid.slots.origin).toBe('SZX')
    const noKey = await parseDirectiveSmart(undefined, text, '2026-08-24')
    expect(noKey.source).toBe('rules')
    expect(noKey.warnings).toEqual(['llm_fallback'])
  })
})
