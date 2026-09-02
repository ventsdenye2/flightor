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
  aliases?: string[]
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

const DEFAULT_AIRPORT_BY_CITY: Record<string, string> = {
  'beijing': 'PEK',
  '北京': 'PEK',
  'shanghai': 'PVG',
  '上海': 'PVG',
  'tokyo': 'NRT',
  '东京': 'NRT',
  'london': 'LHR',
  '伦敦': 'LHR',
  'osaka': 'KIX',
  '大阪': 'KIX',
  'seoul': 'ICN',
  '首尔': 'ICN',
  'paris': 'CDG',
  '巴黎': 'CDG',
  'newyork': 'JFK',
  '纽约': 'JFK',
  'losangeles': 'LAX',
  '洛杉矶': 'LAX',
  'hongkong': 'HKG',
  '香港': 'HKG',
  'taipei': 'TPE',
  '台北': 'TPE'
}

const INTEREST_PATTERNS: Array<{ pattern: RegExp; value: Interest }> = [
  { pattern: /美食|吃|food/i, value: 'food' },
  { pattern: /文化|博物馆|古迹|历史|culture|museum/i, value: 'culture' },
  { pattern: /自然|风景|海边|山|nature|beach/i, value: 'nature' },
  { pattern: /购物|买|shopping/i, value: 'shopping' },
  { pattern: /夜生活|酒吧|nightlife|bar\b/i, value: 'nightlife' }
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

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s·.'-]+/g, '')
}

function airportCityKeys(airport: AgentAirport): string[] {
  return [airport.cityZh, airport.cityEn]
    .filter((value): value is string => Boolean(value))
    .map(normalizeName)
}

function sameCityAirports(leftIata: string, rightIata: string, airports: AgentAirport[]): boolean {
  const left = airports.find(airport => airport.iata === leftIata)
  const right = airports.find(airport => airport.iata === rightIata)
  if (!left || !right) return false
  const leftKeys = new Set(airportCityKeys(left))
  return airportCityKeys(right).some(key => leftKeys.has(key))
}

function buildCityIndex(airports: AgentAirport[]): {
  cityDefaults: Map<string, string>
  cityAirports: Map<string, string[]>
} {
  const cityAirports = new Map<string, string[]>()
  for (const airport of airports) {
    for (const key of new Set(airportCityKeys(airport))) {
      const list = cityAirports.get(key) ?? []
      list.push(airport.iata)
      cityAirports.set(key, list)
    }
  }

  const cityDefaults = new Map<string, string>()
  for (const [key, iatas] of cityAirports) {
    const unique = [...new Set(iatas)]
    if (unique.length === 1) {
      cityDefaults.set(key, unique[0]!)
    } else {
      const configured = DEFAULT_AIRPORT_BY_CITY[key]
      cityDefaults.set(key, configured && unique.includes(configured) ? configured : [...unique].sort()[0]!)
    }
  }

  return { cityDefaults, cityAirports }
}

interface AirportMention {
  iata: string
  index: number
  kind: 'iata' | 'airport' | 'city'
  source: 'raw' | 'compact'
}

function findAirportMentions(
  text: string,
  airports: AgentAirport[],
  cityDefaults: Map<string, string>
): AirportMention[] {
  const normalized = text.toLowerCase()
  const compactText = normalized.replace(/[\s·.'-]+/g, '')
  const mentions: AirportMention[] = []
  const seen = new Set<string>()
  const qualifiedCityKeys = new Set<string>()

  const addMention = (iata: string, index: number, kind: AirportMention['kind'], source: AirportMention['source']): void => {
    const key = `${iata}:${index}:${kind}:${source}`
    if (seen.has(key)) return
    seen.add(key)
    mentions.push({ iata, index, kind, source })
  }

  const markQualified = (airport: AgentAirport): void => {
    for (const key of airportCityKeys(airport)) qualifiedCityKeys.add(key)
  }

  for (const airport of airports) {
    const code = airport.iata.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${code}\\b`, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(normalized)) !== null) {
      addMention(airport.iata, match.index, 'iata', 'raw')
      markQualified(airport)
    }
  }

  for (const airport of airports) {
    const aliases = [airport.nameZh, airport.nameEn, ...(airport.aliases ?? [])].filter(Boolean)
    for (const alias of aliases) {
      const rawAlias = alias.toLowerCase()
      let index = normalized.indexOf(rawAlias)
      let source: AirportMention['source'] = 'raw'
      if (index < 0) {
        const compactAlias = normalizeName(alias)
        if (compactAlias) {
          index = compactText.indexOf(compactAlias)
          source = 'compact'
        }
      }
      if (index >= 0) {
        addMention(airport.iata, index, 'airport', source)
        markQualified(airport)
      }
    }
  }

  for (const [cityKey, defaultIata] of cityDefaults) {
    if (qualifiedCityKeys.has(cityKey)) continue
    let index = normalized.indexOf(cityKey)
    let source: AirportMention['source'] = 'raw'
    if (index < 0) {
      const compactKey = normalizeName(cityKey)
      if (compactKey) {
        index = compactText.indexOf(compactKey)
        source = 'compact'
      }
    }
    if (index >= 0) addMention(defaultIata, index, 'city', source)
  }

  const kindPriority: Record<AirportMention['kind'], number> = { iata: 0, airport: 1, city: 2 }
  return mentions.sort((left, right) => left.index - right.index || kindPriority[left.kind] - kindPriority[right.kind])
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
  if (result.origin && result.destination && (result.origin === result.destination || sameCityAirports(result.origin, result.destination, airports))) delete result.destination

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
  const sanitizedPrevious = sanitizeSlots(previous, airports, today)
  return sanitizeSlots({ ...sanitizedPrevious, ...parseLocalDelta(text, sanitizedPrevious, airports, today) }, airports, today)
}

function lastMatchIndex(value: string, pattern: RegExp): number {
  let last = -1
  for (const match of value.matchAll(pattern)) {
    if (match.index !== undefined) last = match.index
  }
  return last
}

function mentionSlot(mention: AirportMention, normalized: string, compactText: string): 'origin' | 'destination' | undefined {
  const sourceText = mention.source === 'compact' ? compactText : normalized
  const before = sourceText.slice(Math.max(0, mention.index - 32), mention.index)
  const originIndex = lastMatchIndex(before, /(?:从|由|出发|depart(?:ing)?\s+from|from\b)/gi)
  const destinationIndex = lastMatchIndex(before, /(?:去|到|飞往?|目的地|改成?|换到|to\b)/gi)
  if (originIndex < 0 && destinationIndex < 0) return undefined
  return originIndex > destinationIndex ? 'origin' : 'destination'
}

function parseLocalDelta(text: string, previous: AgentSlots, airports: AgentAirport[], today: string): AgentSlots {
  const { cityDefaults } = buildCityIndex(airports)
  const mentions = findAirportMentions(text, airports, cityDefaults)
  const normalized = text.toLowerCase()
  const compactText = normalized.replace(/[\s·.'-]+/g, '')
  const delta: AgentSlots = {}
  const assigned = new Set<string>()

  // Explicit direction markers always win, including when an airport alias is
  // embedded in a city phrase such as “去东京羽田” or “目的地是巴黎”.
  for (const mention of mentions) {
    const slot = mentionSlot(mention, normalized, compactText)
    if (!slot) continue
    delta[slot] = mention.iata
    assigned.add(`${mention.iata}:${mention.index}`)
  }

  // Fill an unmarked second location by order, but never overwrite a slot
  // that was already confirmed in an earlier turn.
  const unassigned = mentions.filter(mention => !assigned.has(`${mention.iata}:${mention.index}`))
  for (const mention of unassigned) {
    if (!delta.origin && !previous.origin) delta.origin = mention.iata
    else if (!delta.destination && !previous.destination) delta.destination = mention.iata
  }

  // A single unmarked airport/city is a common answer to a follow-up question.
  // With a complete route it refines/replaces the destination; when only one
  // side exists it fills the missing side without destroying the other side.
  const uniqueIatas = [...new Set(mentions.map(mention => mention.iata))]
  if (uniqueIatas.length === 1 && !delta.origin && !delta.destination) {
    const iata = uniqueIatas[0]!
    if (previous.origin && previous.destination) delta.destination = iata
    else if (previous.origin && !previous.destination) delta.destination = iata
    else if (!previous.origin && previous.destination) delta.origin = iata
    else delta.origin = iata
  }

  // If the sentence contains an unmarked origin before an explicitly marked
  // destination, keep the natural left-to-right interpretation and allow an
  // existing origin to be corrected as well.
  if (!delta.origin && delta.destination) {
    const destinationIndex = mentions.find(mention => mention.iata === delta.destination && mentionSlot(mention, normalized, compactText) === 'destination')?.index
    const originCandidate = unassigned.find(mention => destinationIndex !== undefined && mention.index < destinationIndex)
    if (originCandidate) delta.origin = originCandidate.iata
  }

  const date = parseDate(text, today)
  if (date.from) delta.depart_date_from = date.from
  if (date.to) delta.depart_date_to = date.to

  const stay = text.match(/(?:玩|待|停留)?\s*(\d{1,2})\s*天/) ?? text.match(/(\d{1,2})\s*days?/i)
  if (stay) {
    const days = Number(stay[1])
    if (days >= 1 && days <= 60) {
      delta.stay_min = Math.max(1, days - 1)
      delta.stay_max = days + 1
    }
  } else if (/一周|一个星期|one week/i.test(text)) {
    delta.stay_min = 6
    delta.stay_max = 8
  }
  if (/单程|one[ -]?way/i.test(text)) delta.trip_type = 'oneway'
  if (/往返|来回|round[ -]?trip/i.test(text)) delta.trip_type = 'roundtrip'

  const budgetWan = text.match(/(\d+(?:\.\d+)?)\s*万/)
  const budgetK = text.match(/(\d+(?:\.\d+)?)\s*[k千]/i)
  const budgetPlain = text.match(/(?:预算|budget)\D{0,6}(\d{3,7})/i) ?? text.match(/(\d{3,7})\s*(?:元|块|cny|rmb)/i)
  if (budgetWan) delta.budget_max = Math.round(Number(budgetWan[1]) * 10_000)
  else if (budgetK) delta.budget_max = Math.round(Number(budgetK[1]) * 1_000)
  else if (budgetPlain) delta.budget_max = Number(budgetPlain[1])

  const interests = INTEREST_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.value)
  if (interests.length > 0) delta.interests = interests
  if (/不要中转|只要直飞|仅直飞|直飞|direct/i.test(text)) delta.transfer_pref = 'direct'
  else if (/接受中转|可以中转|中转|stopover|transfer/i.test(text)) delta.transfer_pref = 'transfer'
  else if (/不限中转|都可以|\bany\b/i.test(text)) delta.transfer_pref = 'any'

  return sanitizeSlots(delta, airports, today)
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
  const zh: Record<string, string> = { origin: '从哪个城市或机场出发', destination: '想去哪个具体城市或机场', depart_date_from: '计划什么时候出发' }
  const en: Record<string, string> = { origin: 'your departure city or airport', destination: 'your destination city or airport', depart_date_from: 'your departure date' }
  return {
    zh: `还需要确认：${missing.slice(0, 2).map(key => zh[key]).join('、')}。${missing.includes('destination') ? '请告诉我具体城市或 IATA（例如：东京、NRT），不要只给国家。' : ''}`,
    en: `I still need ${missing.slice(0, 2).map(key => en[key]).join(' and ')}.${missing.includes('destination') ? ' Please tell me a specific city or IATA code (e.g., Tokyo, NRT), not just a country.' : ''}`
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
    `Only use airport codes from this server-controlled list: ${JSON.stringify(vocabulary)}. Do not enumerate supported airports in replies. If a required city is missing, ask for a specific city or IATA code. If the user only names a country, ask for a city; do not guess a default city.`,
    'Return exactly one JSON object and no markdown:',
    '{"reply":{"zh":"简短自然的中文回复","en":"concise English reply"},"slots":{"origin":"IATA","destination":"IATA","depart_date_from":"YYYY-MM-DD","depart_date_to":"YYYY-MM-DD","stay_min":7,"stay_max":9,"trip_type":"oneway|roundtrip","budget_max":8000,"interests":["food|culture|nature|shopping|nightlife"],"transfer_pref":"any|direct|transfer"}}',
    'Omit unknown slot fields. Keep replies under 120 Chinese characters / 240 English characters. Ask for at most two missing required fields: origin, destination, departure date.'
  ].join('\n')
}

function validReply(payload: LlmPayload): AgentTurnResult['reply'] | undefined {
  const reply = payload.reply
  if (!reply || typeof reply.zh !== 'string' || typeof reply.en !== 'string') return undefined
  const zh = reply.zh.trim()
  const en = reply.en.trim()
  if (zh.length > 120 || en.length > 240) return undefined
  return zh && en ? { zh, en } : undefined
}

function airportEvidence(messages: AgentMessage[], airports: AgentAirport[]): Set<string> {
  const userText = messages
    .filter(message => message.role === 'user')
    .map(message => message.content)
    .join('\n')
  if (!userText) return new Set<string>()
  const { cityDefaults } = buildCityIndex(airports)
  return new Set(findAirportMentions(userText, airports, cityDefaults).map(mention => mention.iata))
}

function groundedLlmSlots(
  slots: AgentSlots,
  latestEvidence: Set<string>,
  conversationEvidence: Set<string>,
  previous: AgentSlots
): AgentSlots {
  const grounded: AgentSlots = {}
  // Location slots are accepted from the model only when the user's messages
  // contain the exact city/airport/IATA evidence. A server whitelist alone is
  // not enough: “Japan” must not silently become Tokyo/NRT.
  // A new location in the latest turn may replace a previous slot. If the
  // latest turn contains no location, do not let an older mention resurrect a
  // different confirmed slot; an unfilled slot may still use earlier history.
  if (slots.origin && (latestEvidence.has(slots.origin) || (!previous.origin && conversationEvidence.has(slots.origin)))) {
    grounded.origin = slots.origin
  }
  if (slots.destination && (latestEvidence.has(slots.destination) || (!previous.destination && conversationEvidence.has(slots.destination)))) {
    grounded.destination = slots.destination
  }
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
  const localDelta = parseLocalDelta(latestUser?.content ?? '', previous, airports, today)
  const localSlots = sanitizeSlots({ ...previous, ...localDelta }, airports, today)
  const latestEvidence = airportEvidence(latestUser ? [latestUser] : [], airports)
  const conversationEvidence = airportEvidence(input.messages, airports)
  let slots = localSlots
  let reply: AgentTurnResult['reply'] | undefined
  let source: AgentTurnResult['source'] = 'rules'
  const warnings: string[] = []

  try {
    const response = await client.chat([
      { role: 'system', content: buildSystemPrompt(airports, today) },
      { role: 'system', content: `Previously confirmed slots: ${JSON.stringify(previous)}` },
      ...input.messages.slice(-12).map(message => ({ role: message.role, content: message.content.slice(0, 500) }))
    ], undefined, {
      maxTokens: 600,
      temperature: 0.1,
      reasoning: { effort: 'none', exclude: true }
    })
    const payload = extractJson(extractAssistantContent(response))
    const llmSlots = groundedLlmSlots(
      sanitizeSlots(payload.slots, airports, today),
      latestEvidence,
      conversationEvidence,
      previous
    )
    // Deterministically recognized codes/dates win over model output; the model fills
    // phrasing that rules cannot understand, but cannot overturn explicit facts.
    slots = sanitizeSlots({ ...previous, ...llmSlots, ...localDelta }, airports, today)
    reply = validReply(payload)
    source = 'llm'
  } catch {
    warnings.push('llm_fallback')
  }

  const missing = READY_KEYS.filter(key => !slots[key])
  return {
    reply: missing.length === 0 && reply ? reply : fallbackReply(slots, missing, airports),
    slots,
    ready: missing.length === 0,
    missing,
    source,
    warnings
  }
}
