import { describe, expect, it } from 'vitest'
import { publicProseProblems } from '../../travel-guides/finalization.js'

const budget = { amount: 1200, currency: 'CNY', scope: 'trip' }
describe('DSH lightweight public explanation boundary', () => {
  it.each([
    ['en', 'Which day would you like to change?'],
    ['en', 'It matches your cultural interests.'],
    ['zh', '哪一天？'],
    ['zh', '上午参观博物馆，呼应你对历史文化的兴趣。'],
    ['zh', '可以参观 Tokyo National Museum，了解当地文化。'],
    ['en', 'Your current budget is CNY 1200 in total for two days.'],
    ['zh', '两天的总预算是1200元，具体费用还需要核实。'],
  ] as const)('preserves relevant %s explanation: %s', (locale, text) => {
    expect(publicProseProblems([text], locale, { shortReply: true, budget })).toEqual([])
  })
  it.each([
    ['zh', 'It matches your cultural interests.', 'language'],
    ['zh', '好的。It matches your cultural interests.', 'language'],
    ['en', '上午参观博物馆是为了呼应你的历史文化兴趣。', 'language'],
    ['en', 'DEBUG: I called commit_travel_guide with this JSON.', 'internal_metadata'],
    ['en', 'The artifactId is 019543fa-6698-71ca-9f76-7f8fd5d92331.', 'internal_identity'],
    ['en', 'The current destination is city:TYO.', 'internal_identity'],
    ['en', 'The tool returned from get_trip_artifacts.', 'internal_metadata'],
    ['zh', '内部推理完成，接下来调用工具。', 'internal_metadata'],
    ['en', '<think>I should explain the tool result.</think>', 'internal_metadata'],
    ['en', 'Admission costs CNY 50.', 'excluded_precise_claim'],
    ['en', 'It is USD 10.', 'excluded_precise_claim'],
    ['zh', '门票为50元。', 'excluded_precise_claim'],
    ['en', 'The museum opens at 9.', 'excluded_precise_claim'],
    ['en', 'The museum is always open.', 'excluded_admission_or_hours'],
    ['zh', '博物馆免费参观。', 'excluded_admission_or_hours'],
    ['en', 'The transfer takes 30 minutes.', 'excluded_precise_claim'],
    ['en', 'The train takes 2 hours.', 'excluded_precise_claim'],
    ['zh', '全程保证在预算内。', 'budget_guarantee'],
    ['en', 'This itinerary is within your budget.', 'budget_guarantee'],
    ['en', 'Your total budget is CNY 1500.', 'excluded_precise_claim'],
    ['en', 'Your total budget is CNY 1200 per day.', 'excluded_precise_claim'],
    ['en', 'Tickets cost CNY 1200, matching your total budget.', 'excluded_precise_claim'],
    ['en', '', 'empty_reply'],
  ] as const)('withholds %s unsafe expression: %s', (locale, text, reason) => {
    expect(publicProseProblems([text], locale, { shortReply: true, budget })).toContain(reason)
  })
})
