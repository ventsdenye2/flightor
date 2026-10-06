import { describe, expect, it } from 'vitest'
import { publicProseProblems } from './finalization.js'

const budget = { amount: 1200, currency: 'CNY', scope: 'trip' }
describe('authoritative whole-trip budget scope', () => {
  it.each([
    '全程预算目标1200元，不含机票、住宿。',
    '预算是全程总额，机票与住宿另计。',
    '机票已经买好，所以全程预算不包括机票。',
    '住宿费用不计入这次全程预算。',
    'The whole-trip budget target excludes flights and accommodation.',
    'Flights and lodging are outside the whole-trip budget.',
    'Airfare and hotel costs are counted separately.',
    'The whole-trip budget only covers meals and activities.',
    '全程预算不算机票和住宿。', '机票与住宿费用在预算之外。',
    'Flights and accommodation will be paid separately from the whole-trip budget.',
    'The whole-trip budget is for meals and activities only.',
    'The itinerary budget excludes flights.', '行程安排的预算不含机票和住宿。'
  ])('rejects an invented exclusion: %s', text => {
    expect(publicProseProblems([text], /[\u3400-\u9fff]/.test(text) ? 'zh' : 'en', { budget, shortReply: true }))
      .toContain('budget_scope_changed')
  })
  it.each([
    '全程预算目标1200元，机票与住宿费用尚未核实。',
    '已经自购机票，住宿安排尚待确认；全程预算口径保持不变。',
    '全程预算不排除机票和住宿，实际花费尚未确认。',
    '不能把住宿另计，仍保留全程总预算目标。',
    'The whole-trip budget does not exclude airfare or accommodation; costs remain unknown.',
    'Do not count flights separately; the whole-trip budget target remains unchanged.',
    'Airfare and accommodation costs have not been confirmed.',
    '博物馆门票不包含在通票内。', 'Flights are not included in the itinerary because you already have tickets.',
    'The itinerary excludes flights; the whole-trip budget remains unchanged.',
    '全程预算只作为目标记录，实际费用未知。',
    'The budget target covers the whole trip only; costs remain unknown.'
  ])('preserves unknown costs and negated exclusions: %s', text => {
    expect(publicProseProblems([text], /[\u3400-\u9fff]/.test(text) ? 'zh' : 'en', { budget, shortReply: true }))
      .not.toContain('budget_scope_changed')
  })
  it('does not reinterpret an airfare or transport budget as whole-trip scope', () => {
    expect(publicProseProblems(['The transport budget excludes accommodation.'], 'en', {
      budget: { ...budget, scope: 'transport' }, shortReply: true })).not.toContain('budget_scope_changed')
  })
})
