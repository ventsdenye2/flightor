import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { GuideFinalizer, publicProseProblems, sourceRef, validateIntegratedFinalText } from './finalization.js'
import { finalTextSchema, type FinalText } from './finalization-schema.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { admittedResearch, buildGuidePublication, publicationFor, projectGuideRecord } from './publication.js'
import { finalizeGuide, publishIntegratedGuide } from './finalization-service.js'
import { InMemoryArtifactRepository, type ArtifactRecord } from '../artifacts/repository.js'
import { mergeFinalVariant } from './finalization-storage.js'

const sample = JSON.parse(readFileSync(new URL('../../test/fixtures/g1-publication-v1-original-samples.json', import.meta.url), 'utf8')).cases[0].legacy
function fixture(locale: 'zh' | 'en' = 'zh') {
  const record = structuredClone(sample.artifact) as ArtifactRecord
  const guide = travelGuideArtifactPayloadSchema.parse(record.payload)
  const research = admittedResearch(sample.researchArtifacts)
  const text: FinalText = { locale,
    reply: locale === 'zh' ? '已整理好东京文化漫游安排，按每天的主题查看景点。' : 'Your Tokyo cultural itinerary is ready. Explore the visits by daily theme.',
    overview: locale === 'zh' ? '围绕传统文化安排游览，保留轻松节奏，感受东京不同街区的氛围。' : 'Explore traditional culture at a relaxed pace across the planned Tokyo neighborhoods.',
    days: guide.days.map(day => ({ day: day.day, theme: locale === 'zh' ? '街区文化漫游' : 'Neighborhood culture' })),
    activities: guide.days.flatMap(day => day.items).map(item => ({ activityId: item.id,
      name: locale === 'zh' ? '浅草寺 Senso-ji' : 'Senso-ji Temple',
      introduction: locale === 'zh' ? '在寺院周边漫步，欣赏寺院建筑，感受传统街区的氛围。' : 'Walk around the temple, appreciate its architecture and explore the traditional neighborhood.',
      recommendationReason: locale === 'zh' ? '这段安排呼应文化兴趣，也为悠闲游览留出空间。' : 'This visit responds to your interest in culture while allowing a relaxed pace.', sourceRefs: [sourceRef(item)] })) }
  guide.publication = { ...buildGuidePublication(record, guide, research), finalization: { version: 1, variants: {} } }
  record.payload = guide
  return { record, guide, research, text, input: { locale, guide, research, requirements: { message: '我想了解传统文化', excluded: ['shopping'] } } }
}
const response = (text: FinalText) => ({ message: { role: 'assistant' as const, content: JSON.stringify({ text, issues: [] }) } })

describe('integrated main Agent publication', () => {
  async function application(locale: 'zh' | 'en' = 'zh') {
    const f = fixture(locale)
    const artifacts = new InMemoryArtifactRepository('owner', new Set([f.record.tripId]))
    for (const record of sample.researchArtifacts as ArtifactRecord[]) await artifacts.create({ ...record })
    const record = await artifacts.create({ ...f.record, goalId: undefined, runId: undefined, sourceArtifactIds: [] })
    const input = { ownerId: 'owner', record, artifacts, locale, text: f.text, memoryEnabled: true, assertCurrent: vi.fn(async () => {}) }
    return { ...f, finalizationInput: f.input, artifacts, record, input }
  }
  it.each(['zh', 'en'] as const)('publishes %s with zero additional model calls and preserves the domain payload', async locale => {
    const f = await application(locale)
    const save = vi.spyOn(f.artifacts, 'saveFinalVariant')
    const [a, b] = await Promise.all([publishIntegratedGuide(f.input), publishIntegratedGuide(f.input)])
    expect(a).toEqual(b)
    const variant = publicationFor(a)!.finalization!.variants[locale]!
    expect(variant).toMatchObject({ status: 'accepted', text: f.text, revision: 1,
      observation: { calls: 0, knownCostUsdMicros: 0, unknownCostCalls: 0 } })
    expect((a.payload as any).days).toEqual(f.guide.days)
    expect(publicationFor(a)!.guideContentHash).toBe(publicationFor(f.record)!.guideContentHash)
    await publishIntegratedGuide({ ...f.input, record: a, text: { invented: 'replacement' } })
    expect(save).toHaveBeenCalledTimes(1)
    expect((projectGuideRecord(a, locale).payload as any).publication.status).toBe('accepted')
  })
  it.each(['wrong_locale', 'foreign_prose', 'invented_source', 'identity', 'precise_price', 'precise_time', 'placeholder', 'invalid_schema'] as const)(
    'keeps %s hidden and persists a concrete blocked variant', async failure => {
      const f = await application()
      let text: unknown = structuredClone(f.text)
      const draft = text as FinalText
      if (failure === 'wrong_locale') draft.locale = 'en'
      if (failure === 'foreign_prose') text = { ...fixture('en').text, locale: 'zh' }
      if (failure === 'invented_source') draft.activities[0]!.sourceRefs = ['invented-artifact/finding']
      if (failure === 'identity') draft.activities[0]!.activityId = 'new-activity'
      if (failure === 'precise_price') draft.activities[0]!.introduction = '寺院门票200元，可在寺院周边漫步。'
      if (failure === 'precise_time') draft.overview = '步行15分钟即可到达，游览传统街区。'
      if (failure === 'placeholder') draft.activities[0]!.name = '待核实'
      if (failure === 'invalid_schema') text = { ...draft, accepted: true }
      const saved = await publishIntegratedGuide({ ...f.input, text })
      const variant = publicationFor(saved)!.finalization!.variants.zh!
      expect(variant.status).toBe('blocked'); expect(variant.text).toBeNull()
      expect(variant.issues.length).toBeGreaterThan(0)
      if (failure === 'placeholder') expect(variant.issues[0]!.activityId).toBe(f.text.activities[0]!.activityId)
      expect((projectGuideRecord(saved, 'zh').payload as any).days).toEqual([])
    })
  it.each(['reply', 'overview', 'day_theme', 'name', 'introduction', 'recommendationReason'] as const)(
    'blocks an implicit total-budget guarantee in %s before publishing', async field => {
      const f = await application()
      const claim = '整体预算仍在既定总额内。'
      if (field === 'reply' || field === 'overview') f.text[field] = claim
      else if (field === 'day_theme') f.text.days[0]!.theme = claim
      else f.text.activities[0]![field] = claim
      const saved = await publishIntegratedGuide({ ...f.input, text: f.text })
      const variant = publicationFor(saved)!.finalization!.variants.zh!
      expect(variant).toMatchObject({ status: 'blocked', text: null, observation: { calls: 0 } })
      expect(variant.issues).toContainEqual(expect.objectContaining({ code: 'format', detail: expect.stringContaining('budget_guarantee') }))
      expect((projectGuideRecord(saved, 'zh').payload as any).days).toEqual([])
    })
  it('uses the same material and context gates as legacy, even if accepted text is supplied', async () => {
    const f = fixture()
    const missing = validateIntegratedFinalText({ ...f.input, research: [], accepted: f.text }, f.text)
    expect(missing.issues[0]!.code).toBe('missing_material')
    const item = f.guide.days[0]!.items[0]!
    f.research.find(r => r.id === item.sourceArtifactId)!.findings.find(v => v.id === item.sourceFindingId)!.category = 'practical'
    expect(validateIntegratedFinalText(f.input, f.text).issues[0]!.code).toBe('invalid_plan')
    const other = fixture()
    expect(validateIntegratedFinalText({ ...other.input, requirements: 'x'.repeat(180001) }, other.text).issues[0]!.code).toBe('context_budget')
    expect(validateIntegratedFinalText({ ...other.input, omitted: ['material missing'] }, other.text).status).toBe('blocked')
  })
  it.each([
    ['zh', 'reply', '全程预算目标是1500元，实际费用仍待核实。'],
    ['en', 'reply', 'The whole-trip budget target is CNY 1500; actual costs remain unknown.'],
    ['zh', 'overview', '这份行程按全程1500元预算目标安排，实际花费仍待核实。'],
    ['en', 'overview', 'This itinerary uses the current whole-trip budget of CNY 1500 as a target; affordability remains unverified.'],
    ['en', 'reply', 'The whole-trip budget target is JPY 1500; actual costs remain unknown.']
  ] as const)('allows an exact authoritative trip budget target in %s %s', async (locale, field, content) => {
    const f = await application(locale)
    if (content.includes('JPY')) f.guide.budget = { ...f.guide.budget!, currency: 'JPY' }
    f.text[field] = content
    const checked = validateIntegratedFinalText({ ...f.finalizationInput, guide: f.guide }, f.text)
    expect(checked.status).toBe('accepted')
    expect(checked.issues).toEqual([])
  })
  it('allows the exact trip target with the r12 conditional-spending explanation', () => {
    const overview = '两日行程均为东京市区内的传统文化与当地小吃路线，节奏轻松。第一天以浅草为核心：浅草寺与雷门、仲见世通参拜路线，午后小吃巡礼与可选的传统艺能体验，傍晚在Hoppy Street感受下町串烧氛围。第二天上午在明治神宫的人工森林参道慢走，午后到谷中银座商店街逛老铺小吃，最后到上野阿美横町以多样市场小吃收尾。两天均建议使用Suica／PASMO等交通IC卡或合适的一日券，方便在浅草、原宿、日暮里与上野之间移动。你们设定的全程总预算为1200元人民币（覆盖整趟行程、非每日），此处仅作为规划目标引用，实际花费会因住宿、餐饮与购物选择而不同，未知部分仍属未知。行程中的店铺营业时间与价格会随时间变动，出行前请再行确认。'
    expect(publicProseProblems([overview], 'zh', {
      languageBodies: [overview], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).not.toContain('excluded_precise_claim')
  })
  it('allows the exact trip target with a scoped English variable-spending explanation', () => {
    const content = 'The whole-trip budget target is CNY 1200, and actual costs vary depending on lodging, dining, and shopping choices; unknown portions remain unknown.'
    expect(publicProseProblems([content], 'en', {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).not.toContain('excluded_precise_claim')
  })
  it('preserves decimal points when matching the exact authoritative trip budget', () => {
    const content = 'The whole-trip budget target is CNY 1200.5, not CNY 1200.5 per day.'
    expect(publicProseProblems([content], 'en', {
      languageBodies: [content], budget: { amount: 1200.5, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).not.toContain('excluded_precise_claim')
  })
  it.each([
    ['r15 retained reply', '你给的1200元是整个行程的总目标（不是每天1200元），住宿、交通与餐饮等实际花费需在预算内自行核对，本方案不构成费用或可负担性保证。', 'zh'],
    ['whole-trip target without the budget noun', '全程总预算目标为1200元人民币，不是每天1200元。', 'zh'],
    ['English total target and same-amount negated daily restatement', 'The total trip target is CNY 1200, not CNY 1200 per day; actual costs remain unknown.', 'en'],
  ] as const)('allows %s while keeping the same amount scoped to the trip', (_case, content, locale) => {
    expect(publicProseProblems([content], locale, {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).not.toContain('excluded_precise_claim')
  })
  it.each([
    ['r17 seq95 reply', '已为你们排好11月3日至4日的东京两天行程：第一天以浅草寺、仲见世通与浅草小吃为主，第二天走谷中银座老街、根津神社，并以明治神宫收尾，整体步调轻松。全程预算1200元人民币为你们设定的目标（含住宿、交通、餐饮等，属目标而非确认花费）。需要我据此再调整或补充交通细节吗？'],
    ['r17 seq95 overview', '这是一条围绕传统文化与当地小吃、节奏轻松的两日东京行程。第一天集中在浅草一带：上午从雷门进入浅草寺与仲见世通，慢逛寺院与老街；下午在仲见世通与浅草六区边走边吃传统小吃，也可体验和服散步；傍晚顺路逛合羽桥道具街，感受日本饮食器物文化。第二天走访谷根千（谷中、根津）老街：上午在谷中银座商店街边走边吃古早味小吃，下午看根津神社的千本鸟居并到Kayaba老咖啡馆歇息，傍晚以明治神宫的镇守之森参拜收尾。你们设定的全程预算1200元人民币为目标（涵盖住宿、交通与餐饮等，非每日、亦非已确认花费）。'],
    ['r17 seq129 reply', '已按11月3日至4日为你们排好东京两天：第一天浅草寺、仲见世通与浅草小吃，第二天谷中银座老街、根津神社，并以明治神宫收尾，整体步调轻松。你们设定的全程预算为1200元人民币（涵盖住宿、交通与餐饮等的整体目标，而非每日预算）。需要我再补充交通走法或其他传统体验吗？'],
    ['English whole-trip budget without target label', 'The whole-trip budget is CNY 1200.', false],
    ['Chinese whole-trip budget without target label', '全程预算1200元人民币。', false],
    ['explicit whole-trip total without a target label', '全程预算为1200元人民币。', false],
    ['short reply target with local-spending caveat', '1200元是整趟行程的总预算目标，实际花费以当地为准。', false],
    ['short overview target with local-spending caveat', '1200元为整趟行程的总预算目标，实际支出以当地为准。', false],
    ['full r18 seq114 reply field', '两天的东京轻松版安排已经准备好了（11月3日至4日，传统文化＋当地小吃，节奏放缓）。\n\n第一天集中在浅草下町：上午从雷门进仲见世通，参拜浅草寺、边走边尝现烤仙贝与人形烧；下午安排一场和菓子制作＋抹茶体验，坐着动手、暖身又应季。\n\n第二天以上野—谷中的老街小吃为主：上午逛阿美横丁，现切水果串、干货和街头小吃都适合边走边吃；下午转到谷中银座，从日暮里侧的“夕やけだんだん”台阶下行，老街的惣菜店与和菓子店很适合慢慢试吃。\n\n另外给了一个备选：11月1日至15日新宿御苑正在办菊花坛展，是很有传统味的秋季花展，如果第二天想换个口味，可以用它替换谷中银座的下午，不要两处都排满。\n\n两点提醒：日本不少老铺商店街的店铺有固定休息日，出发前请再确认一次当天营业情况；行程里未包含往返机票（你们已自行购买），1200元是整趟行程的总预算目标，实际花费以当地为准。\n\n要不要我按这个思路再压缩成更省钱的版本，或者换成第一天谷中、第二天浅草？', false],
    ['full r18 seq114 overview field', '这份两天东京行程围绕“传统文化＋当地小吃”，步调刻意放松：第一天走浅草下町，以浅草寺与仲见世通为主线，搭配一场和菓子与抹茶的动手体验；第二天聚焦上野阿美横丁与谷中银座两处老街商店街，以边走边吃的方式感受下町风情，并保留一个新宿御苑菊花坛展作为可选替换。两天节奏都不赶，适合和朋友一起慢慢逛。行程中的活动均为参考性安排，门票、营业时间与预约情况请以官方最新信息为准；1200元为整趟行程的总预算目标，实际支出以当地为准。', false],
    ['local qualifier before a confirmed expense', '1200元是整趟行程的总预算目标，实际花费以当地为准，但住宿费用已确认1200元。', true],
    ['official qualifier before a confirmed ticket price', '门票、营业时间与预约情况请以官方最新信息为准；1200元为整趟行程的总预算目标，但门票票价已确认1200元。', true],
    ['official reference after an affirmed admission amount', '全程预算目标是1200元，门票费用就是这个金额但营业时间请以官方最新信息为准。', true],
    ['official qualifier after an affirmed ticket amount', '全程预算目标1200元，门票费用就是这个金额请以官方最新信息为准。', true],
    ['official qualifier after an affirmed general expense', '全程预算目标1200元，费用作为本次花费以官方最新信息为准。', true],
    ['official reference after an affirmed ticket price', '全程预算目标是1200元，票价就是这个金额不过营业时间请以官方最新信息为准。', true],
    ['official reference before a later affirmed cost', '门票信息请以官方最新信息为准但费用就是这个金额，全程预算目标1200元。', true],
    ['local reference does not negate a preceding affirmed expense', '全程预算目标1200元，实际费用就是这个金额（实际花费以当地为准）。', true],
    ['local reference does not negate an affirmed suffix', '全程预算目标1200元，实际花费以当地为准并已确定为此金额。', true],
    ['local qualifier does not excuse an affirmative daily budget', '1200元是整趟行程的总预算目标，实际花费以当地为准，但这也作为每日预算。', true],
    ['local daily and cost negations', '全程预算目标为1200元（非每日预算、亦非已确认花费）。', false],
    ['negated cost claim in parentheses', 'The whole-trip budget target is CNY 1200 (not confirmed costs).', false],
    ['negated plural cost after predicate', 'The whole-trip budget target is CNY 1200 (actual costs are not confirmed).', false],
    ['negated compound ticket price', 'The whole-trip budget target is CNY 1200 (not confirmed ticket prices).', false],
    ['negated daily amount after a comma', 'The whole-trip budget target is CNY 1200, not CNY 1200 per day.', false],
    ['unnegated certainty follows a negated phrase', 'The whole-trip budget is CNY 1200 (not a daily budget and not confirmed costs), but actual costs are confirmed at CNY 1200.', true],
    ['affirmed cost follows a negated cost with no second amount', 'The whole-trip budget target is CNY 1200 (not confirmed costs, but accommodation costs are confirmed).', true],
    ['affirmed ticket price follows a negated cost', 'The whole-trip budget target is CNY 1200 (not confirmed costs and confirmed ticket prices).', true],
    ['not only does not negate costs', 'The whole-trip budget target is CNY 1200 (not only confirmed costs).', true],
    ['affirmed cost follows a negated cost in Chinese', '全程预算目标为1200元人民币（尚未确认费用，但住宿花费已确认）。', true],
    ['daily affirmation follows a daily negation', '全程预算目标为1200元人民币（非每日预算，但也作为每日预算）。', true],
    ['daily affirmation in a parenthetical', '全程预算目标为1200元人民币（整体目标，也作为每日预算）。', true],
    ['later assertion after “not daily”', '全程预算为1200元，虽非每日预算，但实际费用已确认1200元。', true],
    ['whole-trip costs are not a budget', '全程费用1200元人民币。', true],
    ['daily budget is not a whole-trip budget', '每日预算1200元人民币。', true],
    ['publication budget lacks whole-trip scope', '预算1200元人民币。', true],
  ] as const)('classifies %s with local budget/cost negation', (_case, content, shouldReject) => {
    const result = publicProseProblems([content], content.includes('CNY') || content.startsWith('The') ? 'en' : 'zh', {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })
    if (shouldReject) expect(result).toContain('excluded_precise_claim')
    else expect(result).not.toContain('excluded_precise_claim')
  })
  it('keeps budget guarantees rejected after a local-spending caveat', () => {
    const content = '1200元是整趟行程的总预算目标，实际花费以当地为准，但保证不会超支。'
    expect(publicProseProblems([content], 'zh', {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).toContain('budget_guarantee')
  })
  it.each([
    ['mismatched_amount', { amount: 1300, currency: 'CNY', scope: 'trip' }, '全程预算目标是1500元，实际费用仍待核实。'],
    ['wrong_scope', { amount: 1500, currency: 'CNY', scope: 'airfare' }, '全程预算目标是1500元，实际费用仍待核实。'],
    ['wrong_currency', { amount: 1500, currency: 'JPY', scope: 'trip' }, '全程预算目标是1500元，实际费用仍待核实。'],
    ['cost_claim', { amount: 1500, currency: 'CNY', scope: 'trip' }, '全程预算目标是1500元，门票费用也计入其中。']
  ] as const)('does not allow %s as a budget target exception', async (_case, budget, content) => {
    const f = await application()
    f.guide.budget = { ...f.guide.budget!, ...budget }
    f.text.reply = content
    const checked = validateIntegratedFinalText({ ...f.finalizationInput, guide: f.guide }, f.text)
    expect(checked.status).toBe('blocked')
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: 'format', detail: expect.stringContaining('excluded_precise_claim') }))
  })
  it.each([
    ['same-amount admission price', '全程预算目标为1200元人民币（非每日），门票价格为1200元人民币。'],
    ['verified actual spending', '全程预算目标为1200元人民币（非每日），实际花费已核实为1200元人民币。'],
    ['another amount', '全程预算目标为1200元人民币（非每日），另有住宿花费为300元人民币。'],
    ['daily amount', '全程预算目标为1200元人民币（非每日），另把1200元人民币列为每日金额。'],
    ['daily amount in a different currency', '全程总预算目标为1200元人民币，不是每天1200美元。'],
    ['negated daily amount without a trip target', '不是每天1200元人民币。'],
    ['target amount without whole-trip scope', '总预算目标为1200元人民币。'],
    ['same-amount admission in target clause', '全程总预算目标为1200元人民币，门票价格为1200元人民币。'],
    ['amount with an extra digit', '全程总预算目标为1200元人民币，门票价格为12000元人民币。'],
    ['decimal extension of the target amount', 'The whole-trip budget target is CNY 1200.5, not CNY 1200.5 per day.'],
    ['repeated same amount outside target span', '全程总预算目标为1200元，再将1200元作为独立参考数。'],
    ['positive daily amount in target clause', '全程总预算目标为1200元，其中每天1200元。'],
  ] as const)('keeps %s outside the exact-target allowance', (_case, content) => {
    expect(publicProseProblems([content], 'zh', {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).toContain('excluded_precise_claim')
  })
  it.each(['境内免费开放', '免费入场', '免费进入'])('rejects Chinese free-admission claim %s', content => {
    expect(publicProseProblems([content], 'zh', { languageBodies: [content] })).toContain('excluded_admission_or_hours')
  })
  it.each(['提供免费Wi-Fi', '可领取免费导览资料'])('allows non-admission free item %s', content => {
    expect(publicProseProblems([content], 'zh', { languageBodies: [content] })).not.toContain('excluded_admission_or_hours')
  })
  it.each([
    ['zh', '目前无法确认费用是否在预算内。'],
    ['zh', '这项安排的费用是否符合预算，仍待核实。'],
    ['en', 'I cannot confirm whether the trip will stay within your budget.'],
    ['en', 'Whether the plan fits your budget remains unknown.']
  ] as const)('allows cautious budget uncertainty in %s prose', (locale, content) => {
    expect(publicProseProblems([content], locale, { languageBodies: [content] })).not.toContain('budget_guarantee')
  })
  it('allows a cautious short reply that says budget fit cannot be confirmed', () => {
    const content = 'I cannot confirm it is within the budget.'
    expect(publicProseProblems([content], 'en', { languageBodies: [content], shortReply: true })).not.toContain('budget_guarantee')
  })
  it.each(['USD', 'GBP'])('rejects a %s amount in final prose when the authoritative budget is CNY', currency => {
    const content = `全程预算目标为1200 ${currency}`
    expect(publicProseProblems([content], 'zh', {
      languageBodies: [content],
      budget: { amount: 1200, currency: 'CNY', scope: 'trip' },
      budgetTarget: true
    })).toContain('excluded_precise_claim')
  })
  it.each([
    ['zh', '费用会在预算内。'],
    ['zh', '这项安排符合你的预算目标。'],
    ['en', 'The trip will stay within your budget.'],
    ['en', 'This itinerary fits your budget target.'],
    ['en', 'I cannot confirm the budget is enough; actual costs are within your budget.'],
    ['zh', '不能确认预算足够；实际费用在预算内。']
  ] as const)('still blocks affirmative budget guarantees in %s prose', (locale, content) => {
    expect(publicProseProblems([content], locale, { languageBodies: [content] })).toContain('budget_guarantee')
  })
  it('does not let a variable-cost explanation mask a separate budget guarantee', () => {
    const content = '全程预算目标为1200元人民币（非每日），实际花费会因住宿、餐饮与购物选择而不同，不过实际费用仍会在预算内。'
    expect(publicProseProblems([content], 'zh', {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).toContain('budget_guarantee')
  })
  it.each([
    ['zh', '全程预算目标1200元肯定足够，实际花费以当地为准。'],
    ['zh', '全程预算目标为1200元足够，实际花费以当地为准。'],
    ['en', 'The whole-trip budget target of CNY 1200 is enough, actual costs remain unknown.']
  ] as const)('rejects a %s sufficiency guarantee across the stated target amount', (locale, content) => {
    expect(publicProseProblems([content], locale, {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).toContain('budget_guarantee')
  })
  it.each([
    '全程预算目标1200元，已确认花费以当地为准。',
    '全程预算目标1200元，已核实费用以当地为准。',
    '全程预算目标1200元，已确认票价以官方最新信息为准。',
    '全程预算目标1200元亦是已支付费用以当地为准。',
    '全程预算目标1200元亦是费用以当地为准。'
  ])('does not mask a confirmed or paid cost before a deferral suffix: %s', content => {
    expect(publicProseProblems([content], 'zh', {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).toContain('excluded_precise_claim')
  })
  it.each([
    '已确认全程预算目标1200元，实际花费以当地为准。',
    '已确认全程预算目标1200元（实际花费以当地为准）。',
    '全程预算目标1200元，未确认花费以当地为准。',
    '全程预算目标1200元是否足够尚未确认，实际花费以当地为准。',
    '全程预算目标1200元，门票价格与预约情况请以官方最新信息为准。',
    '全程预算目标1200元，门票、交通费和实际花费以当地为准。'
  ])('preserves target confirmation and cautious cost uncertainty: %s', content => {
    expect(publicProseProblems([content], 'zh', {
      languageBodies: [content], budget: { amount: 1200, currency: 'CNY', scope: 'trip' }, budgetTarget: true
    })).toEqual([])
  })
  it.each(['already_cancelled', 'cancel_before_save', 'trip_changed', 'flight_changed'] as const)('does not save after %s', async failure => {
    const f = await application(), controller = new AbortController()
    const save = vi.spyOn(f.artifacts, 'saveFinalVariant')
    if (failure === 'already_cancelled') controller.abort(new Error('cancelled'))
    let checks = 0
    const assertCurrent = async () => {
      if (++checks !== 3) return
      if (failure === 'cancel_before_save') controller.abort(new Error('cancelled'))
      else throw new Error(failure)
    }
    await expect(publishIntegratedGuide({ ...f.input, signal: controller.signal, assertCurrent })).rejects.toThrow(
      failure.includes('cancel') ? 'cancelled' : failure)
    expect(save).not.toHaveBeenCalled()
    expect(publicationFor((await f.artifacts.get(f.record.id))!)!.finalization!.variants.zh).toBeUndefined()
  })
  it('rejects changed content and owner scope before publication', async () => {
    const f = await application(), save = vi.spyOn(f.artifacts, 'saveFinalVariant')
    const stale = structuredClone(f.record)
    // Recompute the publication hash from its changed domain content as a separate snapshot.
    const changedGuide = travelGuideArtifactPayloadSchema.parse(stale.payload)
    changedGuide.days[0]!.theme = 'changed theme'
    changedGuide.publication = { ...buildGuidePublication(stale, changedGuide, f.research), finalization: { version: 1, variants: {} } }
    stale.payload = changedGuide
    await expect(publishIntegratedGuide({ ...f.input, record: stale })).rejects.toThrow('Guide changed')
    const foreign = new InMemoryArtifactRepository('other', new Set([f.record.tripId]))
    await expect(publishIntegratedGuide({ ...f.input, ownerId: 'other', artifacts: foreign })).rejects.toThrow('Guide was not found')
    expect(save).not.toHaveBeenCalled()
  })
  it('requires hidden publication storage rather than silently returning a legacy record', async () => {
    const f = await application()
    const old = structuredClone(f.record)
    delete (old.payload as any).publication.finalization
    await expect(publishIntegratedGuide({ ...f.input, record: old })).rejects.toThrow('requires a hidden guide draft')
  })
})

describe('bounded finalization', () => {
  it.each(['travel', 'visit'] as const)('allows practical tasks on a %s day without treating them as cultural visits', async kind => {
    const f = fixture(), item = f.guide.days[0]!.items[0]!
    f.guide.days[0]!.kind = kind
    item.category = 'practical'; item.title = 'Airport transfer'
    f.research.find(r => r.id === item.sourceArtifactId)!.findings.find(v => v.id === item.sourceFindingId)!.category = 'practical'
    f.text.activities[0]!.name = '机场转乘'
    f.text.activities[0]!.introduction = '按已选航班的机场办理转乘，沿航站楼指引前往后续航段。'
    f.text.activities[0]!.recommendationReason = '衔接已选航班，为后续行程做好准备。'
    const complete = vi.fn().mockResolvedValue(response(f.text))
    expect((await new GuideFinalizer({ complete }).generate(f.input)).status).toBe('accepted')
    expect(complete).toHaveBeenCalledTimes(1)
    complete.mockResolvedValue({ message: { role: 'assistant', content: JSON.stringify({ text: null,
      issues: [{ activityId: item.id, code: 'invalid_plan', detail: 'This transport guide is presented as the requested cultural attraction.' }] }) } })
    const semantic = await new GuideFinalizer({ complete }).generate(f.input)
    expect(semantic.issues[0]).toMatchObject({ activityId: item.id, code: 'invalid_plan' })
  })
  it.each(['as an AI', '保证不会超支', '门票200元', 'https://invented.example',
    'Here is a complete English translation of the itinerary that repeats all the same details for every day'])('checks forbidden expression in activity name: %s', async name => {
    const f = fixture(); f.text.activities[0]!.name = name
    const complete = vi.fn().mockResolvedValue(response(f.text))
    expect((await new GuideFinalizer({ complete }).generate(f.input)).status).toBe('blocked')
  })
  it('reports the specific partially placeholder activity while keeping normal guides valid', async () => {
    const f = fixture()
    expect(f.text.activities.length).toBeGreaterThan(1)
    const complete = vi.fn().mockResolvedValue(response(f.text))
    expect((await new GuideFinalizer({ complete }).generate(f.input)).status).toBe('accepted')
    const activity = f.text.activities[1]!
    activity.name = '待核实'; activity.introduction = '资料不足。'; activity.recommendationReason = '信息待补充'
    complete.mockResolvedValue(response(f.text))
    const result = await new GuideFinalizer({ complete }).generate(f.input)
    expect(result.status).toBe('blocked')
    expect(result.issues).toContainEqual(expect.objectContaining({ activityId: activity.activityId }))
  })
  it('explicitly retries an English timeout once concurrently, preserves Chinese and failed observations, rejects late writes', async () => {
    const f = fixture(), artifacts = new InMemoryArtifactRepository('owner', new Set([f.record.tripId]))
    const zh = await new GuideFinalizer({ complete: vi.fn().mockResolvedValue(response(f.text)) }).generate(f.input)
    f.guide.publication!.finalization!.variants.zh = zh
    const record = await artifacts.create({ ...f.record, goalId: undefined, runId: undefined, sourceArtifactIds: [] })
    let resolveOld!: (value: ReturnType<typeof response>) => void
    const complete = vi.fn().mockImplementation(() => new Promise<any>(resolve => { resolveOld = resolve }))
    const input = { ownerId: 'owner', record, artifacts, locale: 'en' as const, localization: true,
      finalizer: new GuideFinalizer({ complete }), timeoutMs: 5, assertCurrent: async () => {} }
    const failed = await finalizeGuide(input)
    expect(publicationFor(failed)?.finalization?.variants.en?.issues[0]?.code).toBe('timeout')
    await finalizeGuide({ ...input, record: failed })
    expect(complete).toHaveBeenCalledTimes(1)
    complete.mockResolvedValue(response(fixture('en').text))
    const retry = { ...input, record: failed, retryRevision: 1, timeoutMs: 1000 }
    const [a, b] = await Promise.all([finalizeGuide(retry), finalizeGuide(retry)])
    expect(a).toEqual(b); expect(complete).toHaveBeenCalledTimes(2)
    const variants = publicationFor(a)!.finalization!.variants
    expect(variants.en?.status).toBe('accepted'); expect(variants.zh).toEqual(zh)
    expect((variants.en as any).history[0].observation).toEqual(publicationFor(failed)!.finalization!.variants.en!.observation)
    await finalizeGuide({ ...input, record: a }); await finalizeGuide(retry)
    expect(complete).toHaveBeenCalledTimes(2)
    expect(() => mergeFinalVariant(a, publicationFor(a)!.guideContentHash, 'en', publicationFor(failed)!.finalization!.variants.en!)).toThrow()
    resolveOld(response(fixture('en').text)); await Promise.resolve()
    expect((await artifacts.get(record.id))!.payload).toEqual(a.payload)
  })
  it('bounds explicit failed retries, rejects stale retry tokens and requires revision for material problems', async () => {
    const f = fixture(), artifacts = new InMemoryArtifactRepository('owner', new Set([f.record.tripId]))
    f.guide.publication!.finalization!.variants.zh = await new GuideFinalizer({ complete: vi.fn().mockResolvedValue(response(f.text)) }).generate(f.input)
    const record = await artifacts.create({ ...f.record, goalId: undefined, runId: undefined, sourceArtifactIds: [] })
    const complete = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const input = { ownerId: 'owner', record, artifacts, locale: 'en' as const, localization: true,
      finalizer: new GuideFinalizer({ complete }), assertCurrent: async () => {} }
    await finalizeGuide(input)
    await finalizeGuide({ ...input, retryRevision: 1 })
    await expect(finalizeGuide({ ...input, retryRevision: 1 })).rejects.toThrow('Retry requires')
    const exhausted = await finalizeGuide({ ...input, retryRevision: 2 })
    expect((projectGuideRecord(exhausted, 'en').payload as any).publication).toMatchObject({ failureKind: 'retryable', canRetry: false, revision: 3 })
    expect(publicationFor(exhausted)!.finalization!.variants.en!.history).toHaveLength(2)
    await expect(finalizeGuide({ ...input, retryRevision: 3 })).rejects.toThrow('Retry requires')
    expect(complete).toHaveBeenCalledTimes(3)
    const material = structuredClone(record)
    const issue = { activityId: f.text.activities[0]!.activityId, code: 'invalid_plan' as const, detail: 'Transport cannot replace the requested cultural attraction.' }
    const blocked = { ...publicationFor(exhausted)!.finalization!.variants.en!, revision: 1, history: [], issues: [issue] }
    material.payload = mergeFinalVariant(material, publicationFor(record)!.guideContentHash, 'en', blocked)
    // Storage independently rejects a material failure replacement even if a caller bypasses the service.
    expect(() => mergeFinalVariant(material, publicationFor(material)!.guideContentHash, 'en', { ...blocked, revision: 2 })).toThrow('cannot be retried')
    expect((projectGuideRecord(material, 'en').payload as any).publication).toMatchObject({ failureKind: 'revision_required', canRetry: false })
  })
  it.each(['zh', 'en'] as const)('generates %s from full evidence once using the same client/model with no tools', async locale => {
    const f = fixture(locale)
    const complete = vi.fn(async (messages, model, options) => {
      expect(model).toBe('current-planner-model')
      expect(options.tools).toEqual([]); expect(options.toolChoice).toBe('none')
      expect(options.responseFormat.type).toBe('json_schema')
      const data = JSON.parse(messages[1].content)
      expect(data.requirements.message).toContain('传统文化')
      expect(data.research.length).toBe(f.research.length)
      expect(data.guide.publication).toBeUndefined()
      return response(f.text)
    })
    const result = await new GuideFinalizer({ complete }, 'current-planner-model').generate(f.input)
    expect(result.status).toBe('accepted'); expect(result.observation.calls).toBe(1)
    expect(result.text?.activities[0]?.name).toContain('Senso-ji')
  })
  it.each(['invalid_json', 'internal', 'budget', 'duplicate', 'wrong_locale', 'identity', 'source', 'precise', 'placeholder'])('repairs %s at most once', async failure => {
    const f = fixture()
    const bad = structuredClone(f.text)
    if (failure === 'internal') bad.reply = 'I will now summarize the itinerary.'
    if (failure === 'budget') bad.reply = '保证所有花费都在预算内。'
    if (failure === 'duplicate') bad.reply += ' Here is a complete English translation of the itinerary that repeats all the same details for every day.'
    if (failure === 'wrong_locale') bad.locale = 'en'
    if (failure === 'identity') bad.activities[0]!.activityId = 'replacement'
    if (failure === 'source') bad.activities[0]!.sourceRefs = ['invented']
    if (failure === 'precise') bad.reply = '门票需要200元，步行15分钟到达。'
    if (failure === 'placeholder') bad.activities.forEach(item => { item.name = '待核实'; item.introduction = '资料不足。' })
    const complete = vi.fn().mockResolvedValueOnce(failure === 'invalid_json' ? { message: { role: 'assistant', content: 'oops' } } : response(bad)).mockResolvedValueOnce(response(f.text))
    expect((await new GuideFinalizer({ complete }).generate(f.input)).status).toBe('accepted')
    expect(complete).toHaveBeenCalledTimes(2)
  })
  it('keeps a concrete activity issue without retries for semantic insufficiency', async () => {
    const f = fixture()
    const complete = vi.fn().mockResolvedValue({ message: { role: 'assistant', content: JSON.stringify({ text: null,
      issues: [{ activityId: f.text.activities[0]!.activityId, code: 'conflict', detail: 'The source reports closure on the planned date.' }] }) } })
    const result = await new GuideFinalizer({ complete }).generate(f.input)
    expect(result.status).toBe('blocked'); expect(result.issues[0]?.activityId).toBe(f.text.activities[0]!.activityId)
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('does not call for missing sources, transport as a visit or oversized material', async () => {
    const f = fixture(), complete = vi.fn()
    const finalizer = new GuideFinalizer({ complete })
    expect((await finalizer.generate({ ...f.input, research: [] })).issues[0]?.code).toBe('missing_material')
    const item = f.guide.days[0]!.items[0]!
    f.research.find(r => r.id === item.sourceArtifactId)!.findings.find(v => v.id === item.sourceFindingId)!.category = 'practical'
    expect((await finalizer.generate(f.input)).issues[0]?.code).toBe('invalid_plan')
    const other = fixture()
    expect((await finalizer.generate({ ...other.input, requirements: 'x'.repeat(180001) })).issues[0]?.code).toBe('context_budget')
    expect(complete).not.toHaveBeenCalled()
  })
  it('bounds timeout, cancellation and irreparable JSON without exposing raw output', async () => {
    const f = fixture()
    const never = { complete: vi.fn(() => new Promise<any>(() => {})) }
    expect((await new GuideFinalizer(never).generate({ ...f.input, timeoutMs: 5 })).issues[0]?.code).toBe('timeout')
    const controller = new AbortController(); controller.abort()
    expect((await new GuideFinalizer(never).generate({ ...f.input, signal: controller.signal })).issues[0]?.code).toBe('cancelled')
    const complete = vi.fn().mockResolvedValue({ message: { role: 'assistant', content: 'RAW SECRET DRAFT' } })
    const result = await new GuideFinalizer({ complete }).generate(f.input)
    expect(complete).toHaveBeenCalledTimes(2); expect(result.text).toBeNull()
    expect(JSON.stringify(result)).not.toContain('RAW SECRET')
  })
  it('merges concurrent requests, persists variants and restores without calling; localization shares IDs', async () => {
    const f = fixture()
    const artifacts = new InMemoryArtifactRepository('owner', new Set([f.record.tripId]))
    for (const record of sample.researchArtifacts as ArtifactRecord[]) await artifacts.create({ ...record })
    // Fixture sources include route lineage not needed by this repository-only test.
    const record = await artifacts.create({ ...f.record, goalId: undefined, runId: undefined, sourceArtifactIds: [] })
    const complete = vi.fn().mockResolvedValue(response(f.text))
    const input = { ownerId: 'owner', record, artifacts, locale: 'zh' as const, memoryEnabled: true,
      finalizer: new GuideFinalizer({ complete }), assertCurrent: async () => {} }
    const [a, b] = await Promise.all([finalizeGuide(input), finalizeGuide(input)])
    expect(a).toEqual(b); expect(complete).toHaveBeenCalledTimes(1)
    await finalizeGuide({ ...input, record: (await artifacts.get(record.id))! })
    expect(complete).toHaveBeenCalledTimes(1)
    expect((projectGuideRecord(a, 'en').payload as any).publication.status).toBe('preparing')
    const en = fixture('en').text
    complete.mockImplementation(async messages => { const data = JSON.parse(messages[1].content); expect(data.accepted).toEqual(f.text); expect(data.research).toBeUndefined(); return response(en) })
    const localized = await finalizeGuide({ ...input, record: a, locale: 'en', localization: true })
    expect(publicationFor(localized)?.finalization?.variants.zh?.text).toEqual(f.text)
    expect((projectGuideRecord(localized, 'en').payload as any).days[0].items[0].title).toBe('Senso-ji Temple')
    expect((projectGuideRecord(localized, 'zh').payload as any).days[0].items[0].title).toBe('浅草寺 Senso-ji')
    expect((projectGuideRecord(record).payload as any).days).toEqual([])
    expect((localized.payload as any).days).toEqual(f.guide.days)
    expect(finalTextSchema.parse(en).activities.map(a => a.activityId)).toEqual(f.text.activities.map(a => a.activityId))
  })
  it('rejects stale/foreign content and keeps raw drafts private', async () => {
    const f = fixture(), complete = vi.fn()
    const artifacts = new InMemoryArtifactRepository('other', new Set([f.record.tripId]))
    await expect(finalizeGuide({ ownerId: 'other', record: f.record, artifacts, finalizer: new GuideFinalizer({ complete }),
      locale: 'zh', assertCurrent: async () => { throw new Error('version changed') } })).rejects.toThrow('version changed')
    expect(complete).not.toHaveBeenCalled()
    expect(JSON.stringify(projectGuideRecord(f.record))).not.toContain('planningNote')
    delete f.guide.publication!.finalization
    const legacyEnglish = projectGuideRecord(f.record, 'en').payload as any
    expect(legacyEnglish.days).toEqual([])
    expect(legacyEnglish.publication.reply).toContain('not ready')
  })
})
