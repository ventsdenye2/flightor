import { describe, expect, it } from 'vitest'
import { publicProseProblems } from '../../travel-guides/finalization.js'
import { submittedPresentationProblems } from './presentation-problems.js'

const budget = { amount: 1200, currency: 'CNY', scope: 'trip' }
const submission = () => ({
  days: [{ items: [{ activityKey: 'submitted' }, { activityKey: 'protected' }] }],
  text: { reply: '东京文化散步安排已整理。',
    overview: '你给的1200元是整个行程的总目标（不是每天1200元），住宿、交通与餐饮等实际花费需在预算内自行核对，本方案不构成费用或可负担性保证。',
    days: [{ theme: '文化散步' }], activities: [{ activityKey: 'submitted', name: '谷中散步',
      introduction: '沿街观察传统商铺与街区风貌。', recommendationReason: '适合你喜欢文化与轻松散步的偏好。' }] }
})

describe('DSH submitted publication diagnostics', () => {
  it('keeps the original r15 budget wording and points only to another rejected field', () => {
    const input = submission()
    input.text.activities[0]!.introduction = '沿街散步需要15分钟，可观察传统商铺。'
    const rejected = publicProseProblems([input.text.overview, input.text.activities[0]!.introduction], 'zh', { budget, budgetTarget: true })
    expect(submittedPresentationProblems(input, 'zh', budget, rejected)).toEqual([
      { code: 'excluded_precise_claim', fieldPath: 'days.0.items.0.text.introduction' }
    ])
  })
  it('does not manufacture failures from a short theme, name or a rule that did not reject the publication', () => {
    const input = submission()
    input.text.activities[0]!.introduction = '沿街散步需要15分钟。'
    expect(submittedPresentationProblems(input, 'zh', budget, [])).toEqual([])
    expect(submittedPresentationProblems(input, 'zh', budget, ['budget_guarantee'])).toEqual([])
    expect(submittedPresentationProblems(input, 'en', budget, ['language'])).toEqual([{ code: 'language', fieldPath: 'text' }])
  })
  it('does not attribute inherited activities or ignored protected themes to submitted edit fields', () => {
    const input = submission()
    input.text.days[0]!.theme = '门票40元'
    input.text.activities[0]!.activityKey = 'unmatched'
    input.text.activities[0]!.introduction = '沿街散步需要15分钟。'
    expect(submittedPresentationProblems(input, 'zh', budget, ['excluded_precise_claim'], { includeDayThemes: false })).toEqual([])
  })
  it('points affordability feedback to submitted claims while preserving a target and snack preference', () => {
    const input = submission()
    input.text.reply = '全程预算1200元会相当紧张，住宿与交通是主要开销。'
    input.text.activities[0]!.introduction = '门票是需要留出的小额支出之一。'
    input.text.activities[0]!.recommendationReason = '你喜欢当地小吃，适合边逛老街边品尝。'
    const rejected = publicProseProblems([input.text.reply, input.text.overview, input.text.activities[0]!.introduction], 'zh', { budget, budgetTarget: true })
    expect(rejected).toContain('budget_guarantee')
    expect(submittedPresentationProblems(input, 'zh', budget, rejected)).toEqual([
      { code: 'budget_guarantee', fieldPath: 'text.reply' },
      { code: 'budget_guarantee', fieldPath: 'days.0.items.0.text.introduction' }
    ])
  })
})
