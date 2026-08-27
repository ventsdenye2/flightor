// cloud/chatAgent/agent.js — 需求对话 Agent（纯逻辑，不依赖 wx-server-sdk，可本地单测）
// 职责：多轮对话收集出行需求 → 抽取结构化槽位（对齐核心检索系统入参）
// 防幻觉：机场表由前端传入，槽位输出白名单校验；agent 不做检索、不报价格
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const INTERESTS = ['food', 'culture', 'nature', 'shopping', 'nightlife']
const TRANSFER_PREFS = ['any', 'direct', 'transfer']

function buildSystemPrompt(airports, today) {
  const table = airports.map(a => `${a.iata} ${a.city}/${a.enCity}`).join('\n')
  return `你是航班出行需求助手。任务：通过对话收集用户出行需求，抽取结构化槽位。你不搜索航班、不报价格——检索由系统完成。

今天是 ${today}。

可用机场表（IATA 城市，城市→IATA 必须从表中选，表外城市告知暂不支持并推荐最近的支持城市）：
${table}

槽位定义：
- origin: 出发机场 IATA（用户说城市则映射；说"深圳出发"→SZX）
- destination: 目的地机场 IATA
- depart_date_from / depart_date_to: 出发窗口 yyyy-mm-dd（"十月初"→10-01~10-05；"下周"→今天+7~+10；只说月份取该月 1-4 日；不得早于今天）
- stay_min / stay_max: 游玩天数区间（"玩一周"→7,7；"一周左右"→6,8；单程则均为 0）
- trip_type: "oneway" | "roundtrip"（默认 roundtrip）
- budget_max: 预算上限人民币整数（"预算一万"→10000；未提及为 null）
- interests: 数组，只能从 ${JSON.stringify(INTERESTS)} 选（美食→food、文化古迹博物馆→culture、自然风景→nature、购物→shopping、夜生活→nightlife）
- transfer_pref: "direct"（只要直飞）| "transfer"（愿意中转，想顺便玩中转地）| "any"（默认）

严格输出 JSON（不要 markdown 代码块）：
{
  "reply": { "zh": "回复用户(≤60字，确认已理解的+追问缺失的，口语化)", "en": "English reply" },
  "slots": { 仅输出本轮已确认的槽位，不确定的不要输出 },
  "ready": true/false,
  "missing": ["缺失的关键槽位名"]
}

规则：
1. ready=true 的条件：origin、destination、depart_date_from 三项齐全（其余可用默认值）
2. 用户未提及的槽位绝不编造；模糊表述先追问再确认
3. 一次最多追问 2 个问题，优先问 目的地 > 出发地 > 日期
4. 用户改口时用新值覆盖旧值
5. ready=true 时 reply 告知"需求已明确，可以开始搜索"并复述关键参数`
}

function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON in response')
  return JSON.parse(text.slice(start, end + 1))
}

/** 槽位白名单校验：过滤幻觉值 */
function sanitizeSlots(raw, airports, today) {
  const valid = {}
  if (!raw || typeof raw !== 'object') return valid
  const iatas = new Set(airports.map(a => a.iata))

  if (typeof raw.origin === 'string' && iatas.has(raw.origin.toUpperCase())) {
    valid.origin = raw.origin.toUpperCase()
  }
  if (typeof raw.destination === 'string' && iatas.has(raw.destination.toUpperCase())) {
    valid.destination = raw.destination.toUpperCase()
  }
  const dateOk = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today
  if (dateOk(raw.depart_date_from)) valid.depart_date_from = raw.depart_date_from
  if (dateOk(raw.depart_date_to) && (!valid.depart_date_from || raw.depart_date_to >= valid.depart_date_from)) {
    valid.depart_date_to = raw.depart_date_to
  }
  const intOk = (n, min, max) => Number.isFinite(Number(n)) && Number(n) >= min && Number(n) <= max
  if (intOk(raw.stay_min, 0, 60)) valid.stay_min = Math.round(Number(raw.stay_min))
  if (intOk(raw.stay_max, 0, 60)) valid.stay_max = Math.round(Number(raw.stay_max))
  if (intOk(raw.budget_max, 500, 200000)) valid.budget_max = Math.round(Number(raw.budget_max))
  if (raw.trip_type === 'oneway' || raw.trip_type === 'roundtrip') valid.trip_type = raw.trip_type
  if (TRANSFER_PREFS.includes(raw.transfer_pref)) valid.transfer_pref = raw.transfer_pref
  if (Array.isArray(raw.interests)) {
    const list = raw.interests.filter(i => INTERESTS.includes(i))
    if (list.length > 0) valid.interests = list
  }
  return valid
}

/**
 * 需求对话单轮推进
 * @param apiKey OpenRouter key
 * @param input { messages: [{role,content}], slots: 已确认槽位, airports: [{iata,city,enCity}] }
 * @returns { reply: {zh,en}, slots: 合并后槽位, ready, missing }
 */
async function chatTurn(apiKey, input, model = 'openai/gpt-5.6-luna') {
  const { messages, slots = {}, airports = [] } = input
  const today = new Date().toISOString().slice(0, 10)

  const llmMessages = [
    { role: 'system', content: buildSystemPrompt(airports, today) },
    // 已确认槽位作为上下文，避免模型忘记前几轮结论
    { role: 'system', content: `当前已确认槽位：${JSON.stringify(slots)}` },
    ...messages.slice(-12).map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }))
  ]

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: llmMessages,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 800
    })
  })
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`)
  const data = await res.json()
  const content = data.choices && data.choices[0] && data.choices[0].message.content
  if (!content) throw new Error('empty LLM response')

  const parsed = extractJson(content)
  const newSlots = sanitizeSlots(parsed.slots, airports, today)
  const merged = { ...slots, ...newSlots }
  const ready = Boolean(merged.origin && merged.destination && merged.depart_date_from)
  const missing = ['origin', 'destination', 'depart_date_from'].filter(k => !merged[k])

  const reply =
    parsed.reply && typeof parsed.reply.zh === 'string' && typeof parsed.reply.en === 'string'
      ? { zh: parsed.reply.zh.slice(0, 200), en: parsed.reply.en.slice(0, 400) }
      : { zh: '收到，请再补充一下出行信息', en: 'Got it, please share more trip details' }

  return { reply, slots: merged, ready, missing, usage: data.usage }
}

module.exports = { chatTurn, sanitizeSlots, buildSystemPrompt }
