// cloud/tripAgent/agent.js — 行程规划 Agent（纯逻辑，不依赖 wx-server-sdk，可本地单测）
// 原则：模型只做编排与文案，不生成事实——航班/签证/交通/攻略活动全部来自入参素材
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const ITEM_TYPES = ['flight', 'transit', 'activity', 'meal', 'rest', 'tip']

function buildPrompt(input) {
  return `你是航班行程规划助手。仅依据下方「事实数据」编排行程，不得编造航班、价格、签证、交通信息；活动只能从「中转玩法素材」选用或做通用安排（城市漫步、当地美食等），不得编造具体景点价格。

严格输出 JSON（不要 markdown 代码块），结构：
{
  "summary": { "zh": "一句话行程概述(≤40字)", "en": "English summary" },
  "days": [
    {
      "day": 1,
      "date": "yyyy-mm-dd",
      "title": { "zh": "当日主题(≤10字)", "en": "Day theme" },
      "items": [
        { "time": "HH:mm", "type": "${ITEM_TYPES.join('" | "')}",
          "title": { "zh": "≤16字", "en": "..." },
          "note": { "zh": "补充说明≤30字，可空串", "en": "..." } }
      ]
    }
  ],
  "budgetCny": { "flights": 整数, "stay": 整数, "activities": 整数, "total": 整数 },
  "reminders": [ { "zh": "≤40字", "en": "..." } ]
}

编排要求：
1. 第1天从出发航班开始按时间排布；中转停留≥8小时且素材有玩法时，安排1-2个出港活动并加入「提前3小时回机场」提醒（type=tip）
2. 目的地天数按游玩天数排布，主题贴合兴趣偏好
3. budgetCny 为整数人民币估算：flights 用给定票价；stay/activities 必须按目的地一般消费水平给出非零估算（宁可保守不可缺省）；total=各项之和且≤预算上限
4. 双语字段完整；days≤7，更长行程的中段合并为一条自由活动
5. reminders 必须包含签证要点（若素材提供）

事实数据：
${JSON.stringify(input, null, 2)}`
}

/** Schema 白名单校验：清洗非法项，双语齐全才保留 */
function validate(plan) {
  const bil = v => v && typeof v.zh === 'string' && typeof v.en === 'string'
  if (!plan || !bil(plan.summary) || !Array.isArray(plan.days)) return null

  const days = plan.days
    .map(d => {
      if (!bil(d.title) || !Array.isArray(d.items)) return null
      const items = d.items.filter(
        it => ITEM_TYPES.includes(it.type) && bil(it.title) && bil(it.note ?? { zh: '', en: '' })
      )
      return items.length > 0 ? { day: d.day, date: d.date ?? '', title: d.title, items } : null
    })
    .filter(Boolean)
  if (days.length === 0) return null

  const b = plan.budgetCny ?? {}
  const budgetCny = {
    flights: Math.round(Number(b.flights) || 0),
    stay: Math.round(Number(b.stay) || 0),
    activities: Math.round(Number(b.activities) || 0),
    total: Math.round(Number(b.total) || 0)
  }
  if (!budgetCny.total) budgetCny.total = budgetCny.flights + budgetCny.stay + budgetCny.activities

  const reminders = (Array.isArray(plan.reminders) ? plan.reminders : []).filter(bil)
  return { summary: plan.summary, days, budgetCny, reminders }
}

/**
 * 行程规划：单次 LLM 调用 + 结构化校验
 * input: { route, flight, hubGuide, preferences } — 全部为可信事实数据
 */
async function planTrip(apiKey, input, model = 'openai/gpt-5.6-luna') {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildPrompt(input) }]
    })
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content ?? ''
  const plan = validate(JSON.parse(content))
  if (!plan) throw new Error('plan validation failed')
  return { plan, usage: json.usage?.total_tokens ?? 0, model }
}

module.exports = { planTrip, buildPrompt, validate }
