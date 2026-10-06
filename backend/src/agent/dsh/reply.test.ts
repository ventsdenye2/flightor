import { describe, expect, it } from 'vitest'
import { publicProseProblems } from '../../travel-guides/finalization.js'

const budget = { amount: 1200, currency: 'CNY', scope: 'trip' }
describe('DSH lightweight public explanation boundary', () => {
  it.each([
    ['zh', '全程预算目标为1200元。1200元只是你设定的整体目标。'],
    ['en', 'The whole-trip budget target is CNY 1200. Your planning target remains CNY 1200.'],
    ['zh', '总预算是1200元。1200元仍是你的预算目标。'],
    ['en', 'The total budget is CNY 1200. CNY 1200 remains your budget target.'],
  ] as const)('keeps a %s short answer target reference in its own field', (locale, text) => {
    expect(publicProseProblems([text], locale, { shortReply: true, budget })).toEqual([])
  })
  it.each([
    ['zh', ['总预算是1200元。', '1200元仍是你的预算目标。'], budget],
    ['en', ['The total budget is CNY 1200.', 'CNY 1200 remains your budget target.'], budget],
    ['zh', ['总预算是1200元。1200元仍是你的预算目标。'], { ...budget, scope: 'day' }],
    ['en', ['The total budget is CNY 1200. CNY 1200 remains your budget target.'], { ...budget, scope: 'day' }],
    ['zh', ['总预算是1200元。1200元仍是你的预算目标中的住宿部分。'], budget],
    ['en', ['The total budget is CNY 1200. CNY 1200 remains your budget target for lodging.'], budget],
  ] as const)('withholds a %s short answer reference without its scoped local target', (locale, fields, scopedBudget) => {
    expect(publicProseProblems([...fields], locale, { shortReply: true, budget: scopedBudget })).toContain('excluded_precise_claim')
  })
  it('withholds the complete r22 B01 explanation with unverified small-expense and spending-share claims', () => {
    const text = '第二天下午安排的是**小石川后乐园**，这项安排和你们的偏好是契合的：\n\n**契合「传统文化」**\n后乐园是江户时代遗留的诸侯庭园，园内以池泉、假山、茶亭构成回游式庭园景致，本身就是江户历史与造园文化的代表，和第一天浅草寺、第二天的神社形成「寺—宫—园」的传统文化主线，没有把行程稀释成现代商业景点。\n\n**契合「轻松步调」**\n它属于庭园散步型景点：园内沿园路慢走、随时可以坐下休息，不需要排队打卡或赶时段，也没有强烈的体力要求。放在明治神宫之后的下午，正好是半天里走路放缓、以内园闲逛为主的一段，符合你们不想赶行程的节奏。\n\n**与前后行程顺**\n上午明治神宫在原宿一带，下午换到后乐园所在的旧城区，傍晚再往谷中银座一带，整体是从神社到庭园再到老街里弄的过渡，动线上不需要来回折返，所以第二天只落在少数几个区域，不会变成整天在路上。\n\n**关于费用**\n只作为参考提示：这一段属于门票类开销，具体票价我没有在场工具核实，你们按当日园方公告准备即可——在全程1200元的总预算下，这类门票是需要留出的小额支出之一，但整体仍以「住宿＋交通为主、小吃代替正餐」来控制。\n\n按你的要求，这里只做解释，不重新生成也不修改现有行程。'
    expect(publicProseProblems([text], 'zh', { shortReply: true, budget })).toContain('budget_guarantee')
  })
  it.each([
    ['en', 'Which day would you like to change?'],
    ['en', 'It matches your cultural interests.'],
    ['zh', '哪一天？'],
    ['zh', '上午参观博物馆，呼应你对历史文化的兴趣。'],
    ['zh', '可以参观 Tokyo National Museum，了解当地文化。'],
    ['en', 'Your current budget is CNY 1200 in total for two days.'],
    ['en', 'Your total budget target is CNY 1200 for the trip; actual costs remain unknown.'],
    ['zh', '两天的总预算是1200元，具体费用还需要核实。'],
    ['zh', '全程预算目标是1200元，实际费用仍待核实。'],
    ['zh', '已确认：预算目标是两天合计1200元人民币，整个行程统一口径，不是每天1200元；原行程不变。'],
    ['en', 'Your total budget is CNY 1200, not CNY 1200 per day.'],
    ['zh', '已为你们排好11月3日至4日的东京两天行程：第一天以浅草寺、仲见世通与浅草小吃为主，第二天走谷中银座老街、根津神社，并以明治神宫收尾，整体步调轻松。全程预算1200元人民币为你们设定的目标（含住宿、交通、餐饮等，属目标而非确认花费）。需要我据此再调整或补充交通细节吗？'],
    ['zh', '已按11月3日至4日为你们排好东京两天：第一天浅草寺、仲见世通与浅草小吃，第二天谷中银座老街、根津神社，并以明治神宫收尾，整体步调轻松。你们设定的全程预算为1200元人民币（涵盖住宿、交通与餐饮等的整体目标，而非每日预算）。需要我再补充交通走法或其他传统体验吗？'],
    ['zh', '全程预算为1200元人民币。'],
    ['en', 'The whole-trip budget is CNY 1200.'],
    ['zh', '预算只是目标，实际费用仍待核实，不承诺未知费用一定够。'],
    ['zh', '已保留总预算目标，费用是否足够仍需核实。'],
    ['en', 'The budget remains a target; actual costs still need checking.'],
    ['zh', '全程预算目标为1200元人民币，门票、餐饮等实际花费请以现场为准，未知费用不作估算。'],
    ['en', 'Your total budget is CNY 1200; consult the venue for ticket prices and dining costs.'],
    ['zh', '全程预算目标为1200元人民币。不能确认门票费用为这个金额。'],
    ['en', 'Your total budget is CNY 1200. Whether ticket costs are this amount has not been confirmed.'],
  ] as const)('preserves relevant %s explanation: %s', (locale, text) => {
    expect(publicProseProblems([text], locale, { shortReply: true, budget })).toEqual([])
  })
  it('allows the authoritative total budget before a terminal sentence period', () => {
    expect(publicProseProblems(['Your total budget is CNY 1200.'], 'en', { shortReply: true, budget })).toEqual([])
  })
  it('allows an exact decimal authoritative amount before a terminal sentence period', () => {
    const decimalBudget = { ...budget, amount: 1200.5 }
    expect(publicProseProblems(['Your total budget is CNY 1200.5.'], 'en', { shortReply: true, budget: decimalBudget })).toEqual([])
  })
  it('does not carry a total budget target into a later sentence negating a daily amount', () => {
    const text = 'Your total budget is CNY 1200. Not CNY 1200 per day.'
    expect(publicProseProblems([text], 'en', { shortReply: true, budget })).toContain('excluded_precise_claim')
  })
  it('does not treat a decimal as the authoritative integer budget', () => {
    expect(publicProseProblems(['Your total budget is CNY 1200.5.'], 'en', { shortReply: true, budget })).toContain('excluded_precise_claim')
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
    ['en', 'Your selected flight departs at 07:30.', 'excluded_precise_claim'],
    ['en', 'The museum is always open.', 'excluded_admission_or_hours'],
    ['zh', '博物馆免费参观。', 'excluded_admission_or_hours'],
    ['en', 'The transfer takes 30 minutes.', 'excluded_precise_claim'],
    ['en', 'The train takes 2 hours.', 'excluded_precise_claim'],
    ['zh', '全程保证在预算内。', 'budget_guarantee'],
    ['en', 'This itinerary is within your budget.', 'budget_guarantee'],
    ['zh', '整体预算仍在既定总额内。', 'budget_guarantee'],
    ['zh', '总费用已控制在预算范围内。', 'budget_guarantee'],
    ['zh', '两天开销不会超出预算上限。', 'budget_guarantee'],
    ['zh', '花费完全符合预算目标。', 'budget_guarantee'],
    ['zh', '这样的安排满足你的预算要求。', 'budget_guarantee'],
    ['zh', '这笔预算肯定足够。', 'budget_guarantee'],
    ['en', 'The cost stays within the allocated total.', 'budget_guarantee'],
    ['en', 'All expenses are below your total budget.', 'budget_guarantee'],
    ['en', 'Your total budget is CNY 1500.', 'excluded_precise_claim'],
    ['en', 'Your total budget is CNY 1200 per day.', 'excluded_precise_claim'],
    ['zh', '总预算是1200元，不是每天1500元。', 'excluded_precise_claim'],
    ['zh', '总预算是1200元，门票不是每天1200元。', 'excluded_precise_claim'],
    ['zh', '总预算是1200元，每天1200元。', 'excluded_precise_claim'],
    ['zh', '不是每天1200元。', 'excluded_precise_claim'],
    ['zh', '全程预算为1200元，虽非每日预算，但实际费用已确认1200元。', 'excluded_precise_claim'],
    ['en', 'The whole-trip budget is CNY 1200 (not a daily budget and not confirmed costs), but actual costs are confirmed at CNY 1200.', 'excluded_precise_claim'],
    ['en', 'The whole-trip budget is CNY 1200 (not confirmed costs, but accommodation costs are confirmed).', 'excluded_precise_claim'],
    ['en', 'The whole-trip budget is CNY 1200 (not only confirmed costs).', 'excluded_precise_claim'],
    ['en', 'Your daily total budget is CNY 1200.', 'excluded_precise_claim'],
    ['zh', '每天的总预算是1200元。', 'excluded_precise_claim'],
    ['en', 'Your daily budget target is CNY 1200 for the trip.', 'excluded_precise_claim'],
    ['en', 'Tickets cost CNY 1200, matching your total budget.', 'excluded_precise_claim'],
    ['zh', '总预算是1200元。门票费用就是这个金额。', 'excluded_precise_claim'],
    ['en', 'Your total budget is CNY 1200. This amount is the actual cost.', 'excluded_precise_claim'],
    ['zh', '全程预算目标是1200元的实际花费。', 'excluded_precise_claim'],
    ['zh', '全程预算目标为1200元人民币。门票费用预计为这个金额。', 'excluded_precise_claim'],
    ['en', 'Your total budget is CNY 1200. Lodging requires that same amount.', 'excluded_precise_claim'],
    ['en', '', 'empty_reply'],
  ] as const)('withholds %s unsafe expression: %s', (locale, text, reason) => {
    expect(publicProseProblems([text], locale, { shortReply: true, budget })).toContain(reason)
  })
})
