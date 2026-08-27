// cloud/routePlanner/llmParse.js — LLM 版长指令解析（P2 后续：替换规则解析）
// 策略：LLM 抽取槽位 JSON → 本地校验归一（城市名→IATA、日期合法性）→ 共用 validateSlots 判定缺失/冲突
//       LLM 失败（网络/格式）由调用方回退规则解析，保证可用性
// HTTP 层可注入（opts.fetchJson）：云函数/node 用 fetch，小程序端传 Taro.request
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const { SCHENGEN_CITIES, VISA_FREE_CITIES, ORIGINS, validateSlots, parseDirective } = require('./engine')

function defaultFetchJson(url, init) {
  return fetch(url, init).then(r => {
    if (!r.ok) throw new Error(`OpenRouter HTTP ${r.status}`)
    return r.json()
  })
}

/** 城市词表（喂给 LLM，约束输出用词） */
function cityVocab() {
  const fmt = list => list.map(c => `${c.city}(${c.enCity})`).join('、')
  return [
    `申根候选城市：${fmt(SCHENGEN_CITIES)}`,
    `免签/落地签候选城市：${fmt(VISA_FREE_CITIES)}`,
    `国内出发城市：${fmt(ORIGINS)}`
  ].join('\n')
}

function buildPrompt(text, today) {
  return `你是多城机票路线规划的槽位抽取器。读取用户指令，只输出一个 JSON 对象，不要输出任何其他内容。

今天日期：${today}

${cityVocab()}

输出字段（未知一律 null，禁止猜测）：
{
  "origin": "出发城市中文名或null（必须是国内出发城市之一）",
  "window_from": "YYYY-MM-DD或null（出行窗口起始；早于今天的日期顺延到明年；上旬=1号、中旬=12号、下旬/底=25号）",
  "window_to": "YYYY-MM-DD或null（出行窗口结束）",
  "travel_days": "整数或null（可玩天数；'10-20天假期里抽出N天'取明确的N；只给区间取中值）",
  "region": "schengen|visa_free|null",
  "visa": "schengen|none|null（明确说没有申根签→none）",
  "must_visit": ["必去城市中文名数组，没有则空数组"],
  "overnight_pref": "布尔（想晚上飞/红眼航班/省住宿→true）",
  "direct_only": "布尔（只要直飞/全部直飞→true）",
  "budget_max": "整数元或null（'一万五'=15000，'八千'=8000）",
  "city_target": "整数或null（明确说N个城市→N；'尽可能多/越多越好'→null）"
}

用户指令：${text}`
}

/** 从 LLM 回复里提取 JSON 对象（容忍 markdown 代码块包裹） */
function extractJson(content) {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fence ? fence[1] : content
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in LLM response')
  return JSON.parse(raw.slice(start, end + 1))
}

/** 城市中文名 → IATA（按签证池查找） */
function resolveIata(name, pool) {
  const c = pool.find(x => x.city === name || x.enCity.toLowerCase() === String(name).toLowerCase())
  return c ? c.iata : null
}

/**
 * LLM 解析长指令
 * @param apiKey OpenRouter key
 * @param text 用户指令
 * @param today YYYY-MM-DD
 * @param opts { fetchJson?, model? }
 * @returns 与 parseDirective 同构：{ slots, missing, conflicts, notes, source:'llm' }
 * @throws 网络/格式错误时抛出，由调用方回退规则解析
 */
async function parseDirectiveLLM(apiKey, text, today, opts = {}) {
  const fetchJson = opts.fetchJson || defaultFetchJson
  const model = opts.model || 'openai/gpt-5.6-luna'

  const json = await fetchJson(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: buildPrompt(text, today) }],
      temperature: 0
    })
  })
  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new Error('empty LLM response')
  const raw = extractJson(content)

  // 归一化：城市名 → IATA；类型矫正
  const visa = raw.visa === 'none' ? 'none' : raw.visa === 'schengen' ? 'schengen' : null
  const region = visa === 'none' ? 'visa_free' : raw.region === 'visa_free' ? 'visa_free' : raw.region === 'schengen' ? 'schengen' : null
  const pool = region === 'visa_free' ? VISA_FREE_CITIES : SCHENGEN_CITIES
  const originIata = raw.origin ? resolveIata(raw.origin, ORIGINS) : null
  const mustVisit = (Array.isArray(raw.must_visit) ? raw.must_visit : [])
    .map(n => resolveIata(n, pool))
    .filter(Boolean)

  const slots = {
    origin: originIata,
    window_from: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.window_from || '')) ? raw.window_from : null,
    window_to: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.window_to || '')) ? raw.window_to : null,
    travel_days: Number.isFinite(Number(raw.travel_days)) && Number(raw.travel_days) > 0 ? Number(raw.travel_days) : null,
    region,
    visa,
    must_visit: mustVisit,
    overnight_pref: raw.overnight_pref === true,
    direct_only: raw.direct_only === true,
    budget_max: Number.isFinite(Number(raw.budget_max)) && Number(raw.budget_max) > 0 ? Number(raw.budget_max) : null,
    city_target: Number.isFinite(Number(raw.city_target)) && Number(raw.city_target) > 0 ? Number(raw.city_target) : null
  }

  const { missing, conflicts } = validateSlots(slots)
  const notes = []
  if (visa === 'none') {
    notes.push({
      zh: '没有申根签，候选城市已切换为免签/落地签目的地（曼谷、新加坡、吉隆坡、贝尔格莱德等），欧洲申根城市暂不可达。',
      en: 'Without a Schengen visa, candidates switched to visa-free destinations (Bangkok, Singapore, Kuala Lumpur, Belgrade…). Schengen cities are out of reach.'
    })
  }
  return { slots, missing, conflicts, notes, source: 'llm' }
}

/**
 * 智能解析：有 key 优先 LLM，失败回退规则解析（source 标记来源）
 */
async function parseDirectiveSmart(apiKey, text, today, opts = {}) {
  if (apiKey) {
    try {
      return await parseDirectiveLLM(apiKey, text, today, opts)
    } catch (e) {
      const fallback = parseDirective(text, today)
      return { ...fallback, source: 'rules', llmError: e.message }
    }
  }
  return { ...parseDirective(text, today), source: 'rules' }
}

module.exports = { parseDirectiveLLM, parseDirectiveSmart, buildPrompt }
