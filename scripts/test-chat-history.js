// scripts/test-chat-history.js — 本地会话缓存纯函数回归
// 不依赖 Taro、网络、登录或任何第三方密钥。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = path.resolve(process.cwd(), 'src', 'stores', 'chatHistoryCore.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.CommonJS
  },
  fileName: sourcePath
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, console }, { filename: sourcePath })

const {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TIMELINE,
  MAX_CHAT_SESSIONS,
  MAX_CHAT_HISTORY_CHARS,
  createEmptyChatSession,
  makeChatHistoryPayload,
  sanitizeHistoryPayload,
  sanitizeTravelGuide
} = module.exports

let passed = 0
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function session(id, now = 1_700_000_000_000) {
  const value = createEmptyChatSession(id, now)
  value.messages = [
    { role: 'user', content: `从北京去东京的行程 ${id}` },
    { role: 'assistant', content: '我会先整理日期和路线。' }
  ]
  value.timeline = [{
    id: `turn-${id}`,
    user: { role: 'user', content: `从北京去东京的行程 ${id}` },
    assistant: { role: 'assistant', content: '我会先整理日期和路线。' },
    recommendations: [],
    suggestedActions: [],
    routes: [],
    warnings: []
  }]
  return value
}

function travelGuide(overrides = {}) {
  const source = { source: 'web', title: 'Tokyo guide', url: 'https://example.com/tokyo', domain: 'example.com' }
  return {
    route: { kind: 'cheapest', cities: ['NRT'], citySeq: ['PEK', 'NRT', 'PEK'] },
    summary: { zh: '东京文化行程摘要', en: 'A culture-first Tokyo itinerary.' },
    days: [{
      day: 1,
      city: { zh: '东京', en: 'Tokyo' },
      cityIata: 'NRT',
      items: [{
        title: { zh: '历史街区漫步', en: 'Historic district walk' },
        description: { zh: '预留半天探索城市文化。', en: 'Leave half a day for city culture.' },
        city: { zh: '东京', en: 'Tokyo' },
        cityIata: 'NRT',
        source: 'web',
        sources: [source]
      }]
    }],
    sources: [source],
    source: 'web',
    warnings: [],
    publication: { version: 1, artifactId: 'guide-artifact-1', tripContextVersion: 1, contentContract: 'limited', evidenceCoverage: 'partial', budgetAssessment: { status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete', notice: '预算尚未完整核算。' }, legacy: false, reply: '已发布攻略。' },
    ...overrides
  }
}

console.log('\n【本地会话缓存】版本与损坏数据')
check('拒绝未知缓存版本', sanitizeHistoryPayload({ version: 999, sessions: [] }).sessions.length === 0)
check('损坏 payload 安全忽略', sanitizeHistoryPayload(null).sessions.length === 0)

console.log('\n【本地会话缓存】限长与摘要')
const long = session('long', 1_700_000_000_000)
long.title = 'message-0'
long.messages = Array.from({ length: MAX_CHAT_MESSAGES + 8 }, (_, index) => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `message-${index}`
}))
long.timeline = Array.from({ length: MAX_CHAT_TIMELINE + 4 }, (_, index) => ({
  id: `turn-${index}`,
  user: { role: 'user', content: `user-${index}` },
  assistant: { role: 'assistant', content: `assistant-${index}` },
  recommendations: [],
  suggestedActions: [],
  routes: [],
  warnings: []
}))
const bounded = makeChatHistoryPayload('long', [long])
check('API messages 限制为 24 条', bounded.sessions[0].messages.length === MAX_CHAT_MESSAGES)
check('timeline 限制为 12 轮', bounded.sessions[0].timeline.length === MAX_CHAT_TIMELINE)
check('标题来自首条用户消息', bounded.sessions[0].title === 'message-0')

const many = Array.from({ length: MAX_CHAT_SESSIONS + 5 }, (_, index) => session(`s-${index}`, 1_700_000_000_000 + index))
const capped = makeChatHistoryPayload('s-24', many)
check('会话最多保留 20 个', capped.sessions.length === MAX_CHAT_SESSIONS)
check('最新会话优先保留', capped.sessions[0].id === 's-24')

console.log('\n【本地会话缓存】瞬态请求')
const pending = session('pending')
pending.messages = [{ role: 'user', content: '尚未收到回复' }]
pending.timeline = [{
  id: 'pending-turn',
  user: { role: 'user', content: '尚未收到回复' },
  assistant: null,
  recommendations: [],
  suggestedActions: [],
  routes: [],
  warnings: []
}]
check('未完成请求不作为历史会话恢复', sanitizeHistoryPayload({ version: 1, currentSessionId: 'pending', sessions: [pending] }).sessions.length === 0)
check('当前会话 ID 可独立指向新空会话', sanitizeHistoryPayload({ version: 1, currentSessionId: 'new-session', sessions: [] }).currentSessionId === 'new-session')

console.log('\n【本地会话缓存】攻略轮次与来源边界')
const guideSession = session('guide')
const guide = travelGuide()
guideSession.timeline[0].assistant = { role: 'assistant', content: '旧缓存攻略保证预算 900 元。' }
guideSession.timeline[0].travelGuide = guide
guideSession.timeline[0].delivery = { kind: 'travel_guide', status: 'satisfied', artifactIds: ['guide-artifact-1'], missing: [], warnings: [] }
const guideRestored = sanitizeHistoryPayload({ version: 1, currentSessionId: 'guide', sessions: [guideSession] }).sessions[0]
check('带发布绑定的攻略可随 v1 会话持久化恢复', guideRestored?.timeline[0]?.travelGuide?.summary.en === guide.summary.en
  && guideRestored?.timeline[0]?.travelGuide?.days[0]?.items[0]?.sources[0]?.domain === 'example.com'
  && guideRestored?.timeline[0]?.assistant?.content === '已发布攻略。')

const legacyGuideSession = session('legacy-guide')
legacyGuideSession.timeline[0].travelGuide = travelGuide({ publication: undefined })
const legacyGuideRestored = sanitizeHistoryPayload({ version: 1, currentSessionId: 'legacy-guide', sessions: [legacyGuideSession] }).sessions[0]
check('旧攻略正文注入在本地恢复时被丢弃', legacyGuideRestored != null && legacyGuideRestored.timeline[0]?.travelGuide === undefined)

const legacyReplySession = session('legacy-guide-reply')
legacyReplySession.timeline[0].assistant = { role: 'assistant', content: '预算只要 900 元，保证全程不超支。' }
legacyReplySession.timeline[0].artifactRefs = [{ id: 'guide-artifact-1', type: 'travel_guide', schemaVersion: 1, tripContextVersion: 1, presentationHint: 'travel_guide' }]
const legacyReplyRestored = sanitizeHistoryPayload({ version: 1, currentSessionId: 'legacy-guide-reply', sessions: [legacyReplySession] }).sessions[0]
check('旧攻略关联的助手预算承诺被替换为静态提示', legacyReplyRestored?.timeline[0]?.assistant?.content.includes('预算与攻略正文已隐藏')
  && !legacyReplyRestored?.timeline[0]?.assistant?.content.includes('900'))

const nestedGuideReplySession = session('nested-guide-reply')
nestedGuideReplySession.timeline[0].assistant = { role: 'assistant', content: '预算承诺 100 元。' }
nestedGuideReplySession.timeline[0].delivery = { status: 'partial', artifactIds: [], missing: [], warnings: [], goals: [{ status: 'partial', kind: 'travel_guide', artifactIds: [], missing: [], warnings: [] }] }
const nestedGuideReplyRestored = sanitizeHistoryPayload({ version: 1, currentSessionId: 'nested-guide-reply', sessions: [nestedGuideReplySession] }).sessions[0]
check('聚合 delivery goals 中的失败攻略恢复为安全状态提示', nestedGuideReplyRestored?.timeline[0]?.assistant?.content.includes('尚未完成')
  && !nestedGuideReplyRestored?.timeline[0]?.assistant?.content.includes('100'))

for (const status of ['partial', 'failed', 'cancelled', 'pending']) {
  const failedGuideSession = session(`guide-${status}`)
  failedGuideSession.timeline[0].assistant = { role: 'assistant', content: '旧缓存保证预算 900 元。', locale: 'zh' }
  failedGuideSession.timeline[0].travelGuide = guide
  failedGuideSession.timeline[0].delivery = { kind: 'travel_guide', status, artifactIds: [], missing: [], warnings: [] }
  const restored = sanitizeHistoryPayload({ version: 1, sessions: [failedGuideSession] }).sessions[0]?.timeline[0]
  check(`${status}攻略恢复不借旧攻略成功答复或原始预算承诺`, restored?.travelGuide?.publication?.reply === '已发布攻略。'
    && restored?.assistant?.content !== '已发布攻略。' && !restored?.assistant?.content.includes('900')
    && restored?.assistant?.locale === 'zh')
}
const unrelatedGuideSession = session('guide-unrelated')
unrelatedGuideSession.timeline[0].assistant = { role: 'assistant', content: '未验证的成功尾句' }
unrelatedGuideSession.timeline[0].travelGuide = guide
unrelatedGuideSession.timeline[0].delivery = { kind: 'travel_guide', status: 'satisfied', artifactIds: ['other-guide'], missing: [], warnings: [] }
const unrelatedGuideRestored = sanitizeHistoryPayload({ version: 1, sessions: [unrelatedGuideSession] }).sessions[0]
check('成功delivery只可恢复本轮同artifactId的publication答复', unrelatedGuideRestored?.timeline[0]?.assistant?.content.includes('预算与攻略正文已隐藏'))

const englishFailureSession = session('guide-failed-en')
englishFailureSession.timeline[0].assistant = { role: 'assistant', content: 'The old guide is complete with a guaranteed budget of 900.', locale: 'en' }
englishFailureSession.timeline[0].travelGuide = guide
englishFailureSession.timeline[0].delivery = { kind: 'travel_guide', status: 'failed', artifactIds: [], missing: [], warnings: [] }
const englishFailureRestored = sanitizeHistoryPayload({ version: 1, sessions: [englishFailureSession] }).sessions[0]?.timeline[0]
check('英文失败缓存恢复英文状态且保留locale', englishFailureRestored?.assistant?.locale === 'en'
  && englishFailureRestored?.assistant?.content === 'This guide could not be completed. Reopen the trip to check saved results.')
englishFailureSession.timeline[0].delivery.status = 'satisfied'
const englishUnboundRestored = sanitizeHistoryPayload({ version: 1, sessions: [englishFailureSession] }).sessions[0]?.timeline[0]
check('英文缺少归属的缓存恢复英文隐藏提示', englishUnboundRestored?.assistant?.locale === 'en'
  && englishUnboundRestored?.assistant?.content.startsWith('This cache contains an older guide.'))

const aggregateGuideSession = session('guide-aggregate')
aggregateGuideSession.timeline[0].assistant = { role: 'assistant', content: '未验证的成功尾句' }
aggregateGuideSession.timeline[0].travelGuide = guide
aggregateGuideSession.timeline[0].delivery = { status: 'satisfied', artifactIds: ['guide-artifact-1'], missing: [], warnings: [], goals: [guideSession.timeline[0].delivery] }
const aggregateGuideRestored = sanitizeHistoryPayload({ version: 1, sessions: [aggregateGuideSession] }).sessions[0]?.timeline[0]
check('成功聚合delivery与攻略goal共同绑定publication', aggregateGuideRestored?.assistant?.content === '已发布攻略。')
aggregateGuideSession.timeline[0].delivery.artifactIds = []
const unboundAggregateRestored = sanitizeHistoryPayload({ version: 1, sessions: [aggregateGuideSession] }).sessions[0]?.timeline[0]
check('聚合delivery缺少本轮artifact绑定不借嵌套成功答复', unboundAggregateRestored?.assistant?.content.includes('预算与攻略正文已隐藏'))

const spoofedDomainSession = session('spoofed-domain')
const spoofedDomainSource = {
  source: 'web',
  title: 'Tokyo guide',
  url: 'https://Example.com/tokyo',
  domain: 'attacker.example'
}
const spoofedDomainGuide = travelGuide({
  sources: [spoofedDomainSource],
  days: [{
    ...travelGuide().days[0],
    items: [{ ...travelGuide().days[0].items[0], sources: [spoofedDomainSource] }]
  }]
})
spoofedDomainSession.timeline[0].travelGuide = spoofedDomainGuide
const spoofedDomainRestored = sanitizeHistoryPayload({ version: 1, currentSessionId: 'spoofed-domain', sessions: [spoofedDomainSession] }).sessions[0]
check('网页来源域名取 URL 实际 hostname', spoofedDomainRestored?.timeline[0]?.travelGuide?.sources[0]?.domain === 'example.com'
  && spoofedDomainRestored?.timeline[0]?.travelGuide?.days[0]?.items[0]?.sources[0]?.domain === 'example.com')

const unsafeGuideSession = session('unsafe-guide')
const unsafeGuide = travelGuide({
  sources: [{ source: 'web', title: 'Unsafe', url: 'https://user:pass@example.com/private', domain: 'example.com' }]
})
unsafeGuideSession.timeline[0].travelGuide = unsafeGuide
const unsafeRestored = sanitizeHistoryPayload({ version: 1, currentSessionId: 'unsafe-guide', sessions: [unsafeGuideSession] }).sessions[0]
check('带凭据的网页来源只丢弃攻略', unsafeRestored != null && unsafeRestored.timeline[0]?.travelGuide === undefined)

const boundedGuide = travelGuide({
  summary: { zh: 'x'.repeat(10_000), en: 'y'.repeat(10_000) },
  days: Array.from({ length: 65 }, (_, index) => ({
    day: index + 1,
    city: { zh: '东京', en: 'Tokyo' },
    cityIata: 'NRT',
    items: Array.from({ length: 6 }, () => ({
      title: { zh: '标题'.repeat(1_000), en: 'title'.repeat(1_000) },
      description: { zh: '说明'.repeat(2_000), en: 'description'.repeat(2_000) },
      city: { zh: '东京', en: 'Tokyo' },
      cityIata: 'NRT',
      source: 'web',
      sources: [{ source: 'web', title: 'Tokyo guide', url: 'https://example.com/tokyo', domain: 'example.com' }]
    }))
  }))
})
const boundedGuideResult = sanitizeTravelGuide(boundedGuide)
check('攻略天数、每日条目和文本均有上限', boundedGuideResult != null
  && boundedGuideResult.days.length <= 60
  && boundedGuideResult.days.every(day => day.items.length <= 4)
  && JSON.stringify(boundedGuideResult).length < 180_000)

const malformedGuideSession = session('malformed-guide')
malformedGuideSession.timeline[0].travelGuide = { route: {}, days: 'not-an-array' }
const malformedRestored = sanitizeHistoryPayload({ version: 1, currentSessionId: 'malformed-guide', sessions: [malformedGuideSession] }).sessions[0]
check('坏攻略结构只丢弃攻略而保留会话', malformedRestored != null && malformedRestored.timeline[0]?.travelGuide === undefined)
check('旧 v1 无攻略记录仍可恢复', sanitizeHistoryPayload({ version: 1, currentSessionId: 'old', sessions: [session('old')] }).sessions[0]?.timeline.length === 1)

const largeGuideDay = {
  day: 1,
  city: { zh: '东京', en: 'Tokyo' },
  cityIata: 'NRT',
  items: Array.from({ length: 4 }, () => ({
    title: { zh: '标题'.repeat(120), en: 'title'.repeat(120) },
    description: { zh: '说明'.repeat(280), en: 'description'.repeat(280) },
    city: { zh: '东京', en: 'Tokyo' },
    cityIata: 'NRT',
    source: 'web',
    sources: [{ source: 'web', title: 'Tokyo guide', url: 'https://example.com/tokyo', domain: 'example.com' }]
  }))
}
const largeGuideDays = Array.from({ length: 60 }, (_, index) => ({ ...largeGuideDay, day: index + 1 }))
const largeHistory = session('large-history', 1_700_000_000_100)
largeHistory.messages = Array.from({ length: MAX_CHAT_MESSAGES }, (_, index) => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `large message ${index}`
}))
largeHistory.timeline = Array.from({ length: MAX_CHAT_TIMELINE }, (_, index) => ({
  id: `large-turn-${index}`,
  user: { role: 'user', content: `large user ${index}` },
  assistant: { role: 'assistant', content: `large assistant ${index}` },
  recommendations: [],
  suggestedActions: [],
  routes: [],
  warnings: [],
  travelGuide: travelGuide({
    summary: { zh: `摘要${index}`, en: `Summary ${index}` },
    days: largeGuideDays
  })
}))
const largeHistoryPayload = makeChatHistoryPayload('large-history', [largeHistory, session('old-large-history')])
const largeHistoryRestored = sanitizeHistoryPayload(largeHistoryPayload).sessions.find(item => item.id === 'large-history')
check('多轮大攻略最终不超历史硬上限', JSON.stringify(largeHistoryPayload).length <= MAX_CHAT_HISTORY_CHARS)
check('硬裁剪后仍能恢复最近会话/最近轮', largeHistoryRestored != null
  && largeHistoryRestored.timeline.length >= 1
  && largeHistoryRestored.timeline[largeHistoryRestored.timeline.length - 1]?.id === 'large-turn-11')

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
