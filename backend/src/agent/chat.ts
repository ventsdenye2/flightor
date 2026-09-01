import type { OpenRouterClient } from '../providers/openrouter/client.js'

export type Interest = 'food' | 'culture' | 'nature' | 'shopping' | 'nightlife'
export type TransferPreference = 'any' | 'direct' | 'transfer'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentSlots {
  origin?: string
  destination?: string
  depart_date_from?: string
  depart_date_to?: string
  stay_min?: number
  stay_max?: number
  trip_type?: 'oneway' | 'roundtrip'
  budget_max?: number
  interests?: Interest[]
  transfer_pref?: TransferPreference
}

export interface AgentAirport {
  iata: string
  nameZh: string
  nameEn: string
  cityZh?: string
  cityEn?: string
}

export interface AgentTurnInput {
  messages: AgentMessage[]
  slots?: AgentSlots
}

export interface AgentTurnResult {
  reply: { zh: string; en: string }
  slots: AgentSlots
  ready: boolean
  missing: Array<'origin' | 'destination' | 'depart_date_from'>
  source: 'llm' | 'rules'
  warnings: string[]
}

interface LlmPayload {
  reply?: { zh?: unknown; en?: unknown }
  slots?: unknown
}

const READY_KEYS = ['origin', 'destination', 'depart_date_from'] as const
const INTERESTS: Interest[] = ['food', 'culture', 'nature', 'shopping', 'nightlife']
const TRANSFER_PREFERENCES: TransferPreference[] = ['any', 'direct', 'transfer']
const TRIP_TYPES = ['oneway', 'roundtrip'] as const

const CITY_ALIASES: Record<string, string[]> = {
  SZX: ['深圳', 'shenzhen'],
  CAN: ['广州', 'guangzhou', 'canton'],
  PVG: ['上海', 'shanghai'],
  PEK: ['北京', 'beijing', 'peking'],
  LHR: ['伦敦', 'london'],
  SIN: ['新加坡', 'singapore'],
  KUL: ['吉隆坡', 'kuala lumpur'],
  BKK: ['曼谷', 'bangkok'],
  DOH: ['多哈', 'doha'],
  DXB: ['迪拜', 'dubai'],
  IST: ['伊斯坦布尔', 'istanbul'],
  HEL: ['赫尔辛基', 'helsinki']
}

const INTEREST_PATTERNS: Array<{ pattern: RegExp; value: Interest }> = [
  { pattern: /美食|吃|food/i, value: 'food' },
  { pattern: /文化|博物馆|古迹|历史|culture|museum/i, value: 'culture' },
  { pattern: /自然|风景|海边|山|nature|beach/i, value: 'nature' },
  { pattern: /购物|买|shopping/i, value: 'shopping' },
  { pattern: /夜生活|酒吧|nightlife|bar/i, value: 'nightlife' }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function formatDate(year: number, month: number, day: number): string | undefined {
  const value = new Date(Date.UTC(year, month - 1, day))
  if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day) return undefined
  return value.toISOString().slice(0, 10)
}

function airportAliases(airport: AgentAirport): string[] {
  return [
    airport.iata,
    airport.nameZh,
    airport.nameEn,
    airport.cityZh ?? '',
    airport.cityEn ?? '',
    ...(CITY_ALIASES[airport.iata] ?? [])
  ].filter(Boolean)
}

function findAirportMentions(text: string, airports: AgentAirport[]): Array<{ iata: string; index: number }> {
  const normalized = text.toLowerCase()
  const matches: Array<{ iata: string; index: number }> = []
  for (const airport of airports) {
    const indexes = airportAliases(airport)
      .map(alias => normalized.indexOf(alias.toLowerCase()))
      .filter(index => index >= 0)
    if (indexes.length > 0) matches.push({ iata: airport.iata, index: Math.min(...indexes) })
  }
  return matches.sort((left, right) => left.index - right.index)
}

function parseDate(text: string, today: string): { from?: string; to?: string } {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) {
    const from = formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (from && from >= today) return { from, to: addDays(from, 3) }
  }

  const fullChinese = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (fullChinese) {
    const from = formatDate(Number(fullChinese[1]), Number(fullChinese[2]), Number(fullChinese[3]))
    if (from && from >= today) return { from, to: addDays(from, 3) }
  }

  const monthDay = text.match(/(\d{1,2})\s*月\s*(?:(\d{1,2})\s*[日号]?|([初中末底]))?/)
  if (monthDay) {
    const month = Number(monthDay[1])
    const markerDay = monthDay[3] === '中' ? 15 : monthDay[3] === '末' || monthDay[3] === '底' ? 25 : 1
    const day = monthDay[2] ? Number(monthDay[2]) : markerDay
    const todayYear = Number(today.slice(0, 4))
    let from = formatDate(todayYear, month, day)
    if (from && from < today) from = formatDate(todayYear + 1, month, day)
    if (from) return { from, to: addDays(from, 3) }
  }

  if (/下周|next week/i.test(text)) {
    const from = addDays(today, 7)
    return { from, to: addDays(from, 3) }
  }
  if (/下个月|next month/i.test(text)) {
    const from = addDays(today, 30)
    return { from, to: addDays(from, 4) }
  }
  return {}
}

export function sanitizeSlots(raw: unknown, airports: AgentAirport[], today: string): AgentSlots {
  if (!isRecord(raw)) return {}
  const allowedAirports = new Set(airports.map(airport => airport.iata))
  const result: AgentSlots = {}

  for (const key of ['origin', 'destination'] as const) {
    const value = raw[key]
    if (typeof value === 'string') {
      const iata = value.trim().toUpperCase()
      if (allowedAirports.has(iata)) result[key] = iata
    }
  }
  if (result.origin && result.destination && result.origin === result.destination) delete result.destination

  if (isDateString(raw.depart_date_from) && raw.depart_date_from >= today) result.depart_date_from = raw.depart_date_from
  if (isDateString(raw.depart_date_to) && raw.depart_date_to >= (result.depart_date_from ?? today)) result.depart_date_to = raw.depart_date_to

  for (const key of ['stay_min', 'stay_max'] as const) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 60) result[key] = value
  }
  if (result.stay_min && result.stay_max && result.stay_max < result.stay_min) result.stay_max = result.stay_min

  if (typeof raw.trip_type === 'string' && (TRIP_TYPES as readonly string[]).includes(raw.trip_type)) {
    result.trip_type = raw.trip_type as 'oneway' | 'roundtrip'
  }
  if (typeof raw.budget_max === 'number' && Number.isFinite(raw.budget_max) && raw.budget_max >= 100 && raw.budget_max <= 10_000_000) {
    result.budget_max = Math.round(raw.budget_max)
  }
  if (Array.isArray(raw.interests)) {
    const interests = [...new Set(raw.interests.filter((value): value is Interest => typeof value === 'string' && INTERESTS.includes(value as Interest)))]
    if (interests.length > 0) result.interests = interests
  }
  if (typeof raw.transfer_pref === 'string' && TRANSFER_PREFERENCES.includes(raw.transfer_pref as TransferPreference)) {
    result.transfer_pref = raw.transfer_pref as TransferPreference
  }
  return result
}

export function parseLocally(text: string, previous: AgentSlots, airports: AgentAirport[], today: string): AgentSlots {
  const result: AgentSlots = { ...sanitizeSlots(previous, airports, today) }
  const mentions = findAirportMentions(text, airports)
  for (const mention of mentions) {
    const before = text.slice(Math.max(0, mention.index - 8), mention.index).toLowerCase()
    if (/(?:从|由|depart(?:ing)?\s+from|from)\s*$/.test(before)) result.origin = mention.iata
    else if (/(?:去|到|飞往?|目的地|to)\s*$/.test(before)) result.destination = mention.iata
  }
  for (const mention of mentions) {
    if (mention.iata === result.origin || mention.iata === result.destination) continue
    if (!result.origin) result.origin = mention.iata
    else if (!result.destination) result.destination = mention.iata
  }
  if (!result.origin && !previous.origin && mentions.length >= 2) result.origin = mentions[0]!.iata
  if (!result.destination && mentions.length >= 2) result.destination = mentions[1]!.iata
  if (result.origin && result.destination && result.origin === result.destination) delete result.destination

  const date = parseDate(text, today)
  if (date.from) result.depart_date_from = date.from
  if (date.to) result.depart_date_to = date.to

  const stay = text.match(/(?:玩|待|停留)?\s*(\d{1,2})\s*天/) ?? text.match(/(\d{1,2})\s*days?/i)
  if (stay) {
    const days = Number(stay[1])
    if (days >= 1 && days <= 60) {
      result.stay_min = Math.max(1, days - 1)
      result.stay_max = days + 1
      result.trip_type = 'roundtrip'
    }
  } else if (/一周|一个星期|one week/i.test(text)) {
    result.stay_min = 6
    result.stay_max = 8
    result.trip_type = 'roundtrip'
  }
  if (/单程|one[ -]?way/i.test(text)) result.trip_type = 'oneway'
  if (/往返|来回|round[ -]?trip/i.test(text)) result.trip_type = 'roundtrip'

  const budgetWan = text.match(/(\d+(?:\.\d+)?)\s*万/)
  const budgetK = text.match(/(\d+(?:\.\d+)?)\s*[k千]/i)
  const budgetPlain = text.match(/(?:预算|budget)\D{0,6}(\d{3,7})/i) ?? text.match(/(\d{3,7})\s*(?:元|块|cny|rmb)/i)
  if (budgetWan) result.budget_max = Math.round(Number(budgetWan[1]) * 10_000)
  else if (budgetK) result.budget_max = Math.round(Number(budgetK[1]) * 1_000)
  else if (budgetPlain) result.budget_max = Number(budgetPlain[1])

  const interests = INTEREST_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.value)
  if (interests.length > 0) result.interests = interests
  if (/不要中转|只要直飞|仅直飞|直飞|direct/i.test(text)) result.transfer_pref = 'direct'
  else if (/接受中转|可以中转|中转|stopover|transfer/i.test(text)) result.transfer_pref = 'transfer'
  else if (/不限中转|都可以|any/i.test(text)) result.transfer_pref = 'any'

  return sanitizeSlots(result, airports, today)
}

function airportLabel(iata: string, airports: AgentAirport[], english: boolean): string {
  const airport = airports.find(item => item.iata === iata)
  if (!airport) return iata
  return english ? (airport.cityEn || airport.nameEn) : (airport.cityZh || airport.nameZh)
}

function fallbackReply(slots: AgentSlots, missing: AgentTurnResult['missing'], airports: AgentAirport[]): AgentTurnResult['reply'] {
  if (missing.length === 0) {
    const originZh = airportLabel(slots.origin!, airports, false)
    const destinationZh = airportLabel(slots.destination!, airports, false)
    const originEn = airportLabel(slots.origin!, airports, true)
    const destinationEn = airportLabel(slots.destination!, airports, true)
    return {
      zh: `需求已明确：${originZh} → ${destinationZh}，${slots.depart_date_from} 出发${slots.budget_max ? `，预算 ¥${slots.budget_max}` : ''}。可以开始筛选机票了。`,
      en: `All set: ${originEn} → ${destinationEn}, departing ${slots.depart_date_from}${slots.budget_max ? `, budget ¥${slots.budget_max}` : ''}. Ready to search flights.`
    }
  }
  const zh: Record<string, string> = { origin: '从哪个城市出发', destination: '想去哪里', depart_date_from: '计划什么时候出发' }
  const en: Record<string, string> = { origin: 'your departure city', destination: 'your destination', depart_date_from: 'your departure date' }
  return {
    zh: `还需要确认：${missing.slice(0, 2).map(key => zh[key]).join('、')}。`,
    en: `I still need ${missing.slice(0, 2).map(key => en[key]).join(' and ')}.`
  }
}

function extractJson(content: string): LlmPayload {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)
  if (!candidate) throw new Error('LLM response did not contain JSON')
  const parsed: unknown = JSON.parse(candidate)
  if (!isRecord(parsed)) throw new Error('LLM response JSON was not an object')
  return parsed as LlmPayload
}

function extractAssistantContent(response: Record<string, unknown>): string {
  const choices = response.choices
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) throw new Error('LLM response had no choices')
  const message = choices[0].message
  if (!isRecord(message) || typeof message.content !== 'string') throw new Error('LLM response had no assistant content')
  return message.content
}

function buildSystemPrompt(airports: AgentAirport[], today: string): string {
  const vocabulary = airports.map(airport => ({
    iata: airport.iata,
    zh: airport.cityZh || airport.nameZh,
    en: airport.cityEn || airport.nameEn
  }))
  return [
    'You are FlightOR, a bilingual travel requirement agent.',
    'Extract and update trip requirements over multiple turns. Do not invent flight availability, prices, visa rules, or airport codes.',
    `Today is ${today}. Never return a past departure date.`,
    `Only use airport codes from this server-controlled list: ${JSON.stringify(vocabulary)}.`,
    'Return exactly one JSON object and no markdown:',
    '{"reply":{"zh":"简短自然的中文回复","en":"concise English reply"},"slots":{"origin":"IATA","destination":"IATA","depart_date_from":"YYYY-MM-DD","depart_date_to":"YYYY-MM-DD","stay_min":7,"stay_max":9,"trip_type":"oneway|roundtrip","budget_max":8000,"interests":["food|culture|nature|shopping|nightlife"],"transfer_pref":"any|direct|transfer"}}',
    'Omit unknown slot fields. Keep replies under 120 Chinese characters / 240 English characters. Ask for at most two missing required fields: origin, destination, departure date.'
  ].join('\n')
}

function validReply(payload: LlmPayload): AgentTurnResult['reply'] | undefined {
  const reply = payload.reply
  if (!reply || typeof reply.zh !== 'string' || typeof reply.en !== 'string') return undefined
  const zh = reply.zh.trim().slice(0, 200)
  const en = reply.en.trim().slice(0, 400)
  return zh && en ? { zh, en } : undefined
}

function groundedLlmSlots(slots: AgentSlots): AgentSlots {
  const grounded: AgentSlots = {}
  // Optional preferences are deliberately excluded here. They are accepted only
  // when deterministic parsing finds explicit evidence in the user's text, which
  // prevents free models from filling example/default values that were never said.
  if (slots.origin) grounded.origin = slots.origin
  if (slots.destination) grounded.destination = slots.destination
  if (slots.depart_date_from) grounded.depart_date_from = slots.depart_date_from
  if (slots.depart_date_to) grounded.depart_date_to = slots.depart_date_to
  return grounded
}

export async function runAgentTurn(
  client: Pick<OpenRouterClient, 'chat'>,
  input: AgentTurnInput,
  airports: AgentAirport[],
  today: string
): Promise<AgentTurnResult> {
  const previous = sanitizeSlots(input.slots, airports, today)
  const latestUser = [...input.messages].reverse().find(message => message.role === 'user')
  const localSlots = parseLocally(latestUser?.content ?? '', previous, airports, today)
  let slots = localSlots
  let reply: AgentTurnResult['reply'] | undefined
  let source: AgentTurnResult['source'] = 'rules'
  const warnings: string[] = []

  try {
    const response = await client.chat([
      { role: 'system', content: buildSystemPrompt(airports, today) },
      { role: 'system', content: `Previously confirmed slots: ${JSON.stringify(previous)}` },
      ...input.messages.slice(-12).map(message => ({ role: message.role, content: message.content.slice(0, 500) }))
    ])
    const payload = extractJson(extractAssistantContent(response))
    const llmSlots = groundedLlmSlots(sanitizeSlots(payload.slots, airports, today))
    // Deterministically recognized codes/dates win over model output; the model fills
    // phrasing that rules cannot understand, but cannot overturn explicit facts.
    slots = sanitizeSlots({ ...previous, ...llmSlots, ...localSlots }, airports, today)
    reply = validReply(payload)
    source = 'llm'
  } catch {
    warnings.push('llm_fallback')
  }

  const missing = READY_KEYS.filter(key => !slots[key])
  return {
    reply: reply ?? fallbackReply(slots, missing, airports),
    slots,
    ready: missing.length === 0,
    missing,
    source,
    warnings
  }
}
