import type {
  ChatMessage,
  ChatOptions,
  OpenRouterClient
} from '../providers/openrouter/client.js'
import {
  ORIGINS,
  SCHENGEN_CITIES,
  VISA_FREE_CITIES,
  parseDirective,
  validateSlots
} from './engine.js'
import type { BilingualText, DirectiveParseResult, RouteSlots } from './engine.js'

export interface RoutePlannerChatClient {
  chat(messages: ChatMessage[], model?: string, options?: ChatOptions): Promise<Record<string, unknown>>
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function cityVocab(): string {
  const format = (cities: typeof SCHENGEN_CITIES) => cities.map(city => `${city.city}(${city.enCity})`).join('、')
  return [
    `申根候选城市：${format(SCHENGEN_CITIES)}`,
    `免签/落地签候选城市：${format(VISA_FREE_CITIES)}`,
    `国内出发城市：${format(ORIGINS)}`
  ].join('\n')
}

export function buildRoutePlanPrompt(text: string, today: string): string {
  return `你是多城机票路线规划的槽位抽取器。读取用户原文，只输出一个 JSON 对象，不要输出任何其他内容。

今天日期：${today}

${cityVocab()}

只提取用户明确表达的约束；未知一律 null/[]/false，绝不猜测出发地、预算、签证、日期、天数或必去城市。不要生成航班、价格或路线。

输出字段：
{
  "origin": "出发城市中文名或null（必须是国内出发城市之一）",
  "window_from": "YYYY-MM-DD或null（早于今天的日期顺延到明年）",
  "window_to": "YYYY-MM-DD或null",
  "travel_days": "整数或null（只给区间取中值）",
  "region": "schengen|visa_free|null",
  "visa": "schengen|none|null（明确说没有申根签才是none）",
  "must_visit": ["原文明确说必须去的候选城市中文名"],
  "overnight_pref": "布尔（想晚上飞/红眼航班/省住宿才为true）",
  "direct_only": "布尔（只要直飞/全部直飞才为true）",
  "budget_max": "整数元或null",
  "city_target": "整数或null（明确说N个城市；尽可能多则null）"
}

用户原文：${text}`
}

function extractJson(content: string): JsonRecord {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fence?.[1] ?? content
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('invalid route planner response')
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
  const object = record(parsed)
  if (!object) throw new Error('invalid route planner response')
  return object
}

function resolveCity(value: unknown, pool: typeof SCHENGEN_CITIES) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return pool.find(city => city.city === value.trim() || city.enCity.toLowerCase() === normalized || city.iata === value.trim().toUpperCase())
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function positiveBudget(value: unknown): number | null {
  const parsed = positiveInteger(value)
  return parsed && parsed <= 10_000_000 ? parsed : null
}

function rawIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : null
}

function hasDateEvidence(text: string, value: string): boolean {
  if (text.includes(value)) return true
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  return new RegExp(`${month}\\s*月\\s*${day}\\s*[号日]?`).test(text)
}

function hasOriginEvidence(text: string, city: { city: string; enCity: string }): boolean {
  const origin = new RegExp(`${city.city}|${city.enCity}`, 'i').test(text)
  return origin && /出发|出发地|from|depart/i.test(text)
}

function hasTravelDaysEvidence(text: string, days: number): boolean {
  const numeral = String(days)
  if (new RegExp(`${numeral}\\s*天`).test(text)) return true
  return (days === 7 && /一周|一星期|一个星期|一礼拜/.test(text))
}

function hasRegionEvidence(text: string, region: 'schengen' | 'visa_free'): boolean {
  return region === 'schengen'
    ? /欧洲|申根/.test(text)
    : /免签|落地签|东南亚|东亚/.test(text)
}

function normalizeSlots(raw: JsonRecord, text: string, today: string): RouteSlots {
  // Rules are the source of truth whenever they recognize a phrase.  Model
  // values may only fill a field when the same fact has textual evidence.
  const rules = parseDirective(text, today).slots
  const modelVisa = raw.visa === 'none' || raw.visa === 'schengen' ? raw.visa : null
  const modelRegion = raw.region === 'visa_free' || raw.region === 'schengen' ? raw.region : null
  const effectiveVisa = rules.visa ?? (modelVisa === 'none' && /没有申根|无申根|没申根/.test(text) ? 'none' : modelVisa === 'schengen' && /申根/.test(text) ? 'schengen' : null)
  const effectiveRegion = rules.region
    ?? (modelRegion && hasRegionEvidence(text, modelRegion) ? modelRegion : effectiveVisa === 'none' ? 'visa_free' : null)
  const pool = effectiveRegion === 'visa_free' ? VISA_FREE_CITIES : SCHENGEN_CITIES

  const modelOrigin = resolveCity(raw.origin, ORIGINS)
  const origin = rules.origin ?? (modelOrigin && hasOriginEvidence(text, modelOrigin) ? modelOrigin.iata : null)

  const modelFrom = rawIsoDate(raw.window_from)
  const modelTo = rawIsoDate(raw.window_to)
  const modelWindow = modelFrom && modelTo && modelFrom <= modelTo && modelFrom >= today
    && hasDateEvidence(text, modelFrom) && hasDateEvidence(text, modelTo)
    ? { from: modelFrom, to: modelTo }
    : null

  const modelTravelDays = positiveInteger(raw.travel_days)
  const travelDays = rules.travel_days ?? (modelTravelDays && hasTravelDaysEvidence(text, modelTravelDays) ? modelTravelDays : null)

  const modelMustVisit = Array.isArray(raw.must_visit)
    ? raw.must_visit.map(value => resolveCity(value, pool)?.iata).filter((value): value is string => Boolean(value))
    : []
  const explicitMust = modelMustVisit.filter(iata => {
    const city = pool.find(item => item.iata === iata)
    return city !== undefined && text.includes(city.city) && /必须去|必去|must|must-visit/i.test(text)
  })
  const mustVisit = rules.must_visit.length > 0 ? rules.must_visit : [...new Set(explicitMust)]

  const modelBudget = positiveBudget(raw.budget_max)
  const budget = rules.budget_max ?? (modelBudget !== null && /预算|budget/i.test(text) ? modelBudget : null)
  const modelCityTarget = positiveInteger(raw.city_target)
  const cityTarget = rules.city_target ?? (modelCityTarget !== null && new RegExp(`${modelCityTarget}\\s*个\\s*(?:欧洲)?城市`).test(text) ? modelCityTarget : null)
  const overnight = rules.overnight_pref || (raw.overnight_pref === true && /夜航|红眼|省.*住宿|晚上.*飞|晚上.*航班/i.test(text))
  const directOnly = rules.direct_only || (raw.direct_only === true && /直飞|nonstop|direct/i.test(text))

  return {
    origin,
    window_from: rules.window_from ?? modelWindow?.from ?? null,
    window_to: rules.window_to ?? modelWindow?.to ?? null,
    travel_days: travelDays,
    region: effectiveRegion,
    visa: effectiveVisa,
    must_visit: mustVisit,
    overnight_pref: overnight,
    direct_only: directOnly,
    budget_max: budget,
    city_target: cityTarget
  }
}

function visaFreeNote(): BilingualText {
  return {
    zh: '没有申根签，候选城市已切换为免签/落地签目的地（曼谷、新加坡、吉隆坡、贝尔格莱德等），欧洲申根城市暂不可达。',
    en: 'Without a Schengen visa, candidates switched to visa-free destinations (Bangkok, Singapore, Kuala Lumpur, Belgrade…). Schengen cities are out of reach.'
  }
}

/** Parse one OpenRouter response after local evidence-constrained normalization. */
export async function parseDirectiveLLM(
  client: RoutePlannerChatClient | OpenRouterClient,
  text: string,
  today: string
): Promise<DirectiveParseResult> {
  const messages: ChatMessage[] = [{ role: 'user', content: buildRoutePlanPrompt(text, today) }]
  const options: ChatOptions = {
    maxTokens: 1_000,
    temperature: 0,
    reasoning: { effort: 'none', exclude: true }
  }
  const response = await client.chat(messages, undefined, options)
  const root = record(response)
  const choices = Array.isArray(root?.choices) ? root.choices : []
  const first = record(choices[0])
  const message = record(first?.message)
  const content = typeof message?.content === 'string' ? message.content : ''
  if (!content) throw new Error('empty route planner response')
  const raw = extractJson(content)
  const slots = normalizeSlots(raw, text, today)
  const validation = validateSlots(slots)
  return {
    slots,
    missing: validation.missing,
    conflicts: validation.conflicts,
    notes: slots.visa === 'none' ? [visaFreeNote()] : [],
    source: 'llm',
    warnings: []
  }
}

/** Use the model when configured; never expose provider failure details. */
export async function parseDirectiveSmart(
  client: RoutePlannerChatClient | OpenRouterClient | undefined,
  text: string,
  today: string
): Promise<DirectiveParseResult> {
  const fallback = parseDirective(text, today)
  if (!client) {
    return { ...fallback, source: 'rules', warnings: ['llm_fallback'] }
  }
  try {
    return await parseDirectiveLLM(client, text, today)
  } catch {
    return { ...fallback, source: 'rules', warnings: ['llm_fallback'] }
  }
}
