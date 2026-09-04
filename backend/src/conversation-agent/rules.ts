import type { DestinationRegion } from '../destinations/catalog.js'
import {
  canonicalDestinationIata,
  destinationRegionForIata,
  isSupportedOrigin,
  isSupportedDestinationIata,
  resolveMentions
} from './catalog-adapter.js'
import { parseBudget } from './budget.js'
import { emptyTripState, type TripState } from './schema.js'

export interface RuleParseResult {
  state: TripState
  /** IATAs and regions grounded in the current user turn. */
  evidenceIatas: Set<string>
  evidenceRegions: Set<DestinationRegion>
  recommendRequested: boolean
  explicitDestinationMentioned: boolean
}

interface LocationMention {
  iata: string
  index: number
}

const CITY_ALIASES: Array<{ aliases: string[]; iata: string }> = [
  { aliases: ['北京', 'beijing', 'peking', 'pek'], iata: 'PEK' },
  { aliases: ['上海', 'shanghai', 'pvg'], iata: 'PVG' },
  { aliases: ['深圳', 'shenzhen', 'szx'], iata: 'SZX' },
  { aliases: ['广州', 'guangzhou', 'can'], iata: 'CAN' },
  { aliases: ['成都', 'chengdu', 'ctu'], iata: 'CTU' },
  { aliases: ['香港', 'hong kong', 'hongkong', 'hkg'], iata: 'HKG' },
  { aliases: ['东京', 'tokyo', 'nrt'], iata: 'NRT' },
  { aliases: ['成田', 'narita'], iata: 'NRT' },
  { aliases: ['羽田', 'haneda', 'hnd'], iata: 'HND' },
  { aliases: ['大阪', 'osaka', 'kix'], iata: 'KIX' },
  { aliases: ['首尔', 'seoul', 'icn'], iata: 'ICN' },
  { aliases: ['巴黎', 'paris', 'cdg'], iata: 'CDG' },
  { aliases: ['阿姆斯特丹', 'amsterdam', 'ams'], iata: 'AMS' },
  { aliases: ['法兰克福', 'frankfurt', 'fra'], iata: 'FRA' },
  { aliases: ['慕尼黑', 'munich', 'muc'], iata: 'MUC' },
  { aliases: ['苏黎世', 'zurich', 'zrh'], iata: 'ZRH' },
  { aliases: ['维也纳', 'vienna', 'vie'], iata: 'VIE' },
  { aliases: ['布拉格', 'prague', 'prg'], iata: 'PRG' },
  { aliases: ['罗马', 'rome', 'fco'], iata: 'FCO' },
  { aliases: ['米兰', 'milan', 'mxp'], iata: 'MXP' },
  { aliases: ['巴塞罗那', 'barcelona', 'bcn'], iata: 'BCN' },
  { aliases: ['马德里', 'madrid', 'mad'], iata: 'MAD' },
  { aliases: ['里斯本', 'lisbon', 'lis'], iata: 'LIS' },
  { aliases: ['雅典', 'athens', 'ath'], iata: 'ATH' },
  { aliases: ['布达佩斯', 'budapest', 'bud'], iata: 'BUD' },
  { aliases: ['哥本哈根', 'copenhagen', 'cph'], iata: 'CPH' },
  { aliases: ['赫尔辛基', 'helsinki', 'hel'], iata: 'HEL' },
  { aliases: ['曼谷', 'bangkok', 'bkk'], iata: 'BKK' },
  { aliases: ['吉隆坡', 'kuala lumpur', 'kualalumpur', 'kul'], iata: 'KUL' },
  { aliases: ['新加坡', 'singapore', 'sin'], iata: 'SIN' },
  { aliases: ['河内', 'hanoi', 'han'], iata: 'HAN' },
  { aliases: ['胡志明市', 'ho chi minh', 'hochiminh', 'sgn'], iata: 'SGN' },
  { aliases: ['巴厘岛', 'bali', 'dps'], iata: 'DPS' },
  { aliases: ['贝尔格莱德', 'belgrade', 'beg'], iata: 'BEG' },
  { aliases: ['伊斯坦布尔', 'istanbul', 'ist'], iata: 'IST' },
  { aliases: ['济州岛', 'jeju', 'cju'], iata: 'CJU' },
  { aliases: ['伦敦', 'london', 'lhr'], iata: 'LHR' },
  { aliases: ['纽约', 'new york', 'newyork', 'jfk'], iata: 'JFK' },
  { aliases: ['洛杉矶', 'los angeles', 'losangeles', 'lax'], iata: 'LAX' }
]

const INTEREST_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /文化|历史|古迹|博物馆|艺术|architecture|culture|history|museum|art/i, value: 'culture' },
  { pattern: /美食|吃|餐厅|food|cuisine/i, value: 'food' },
  { pattern: /自然|风景|山|海边|徒步|nature|beach|hiking/i, value: 'nature' },
  { pattern: /购物|买|shopping/i, value: 'shopping' },
  { pattern: /夜生活|酒吧|nightlife|bar\b/i, value: 'nightlife' },
  { pattern: /温泉|onsen/i, value: 'nature' },
  { pattern: /动漫|二次元|anime/i, value: 'culture' },
  { pattern: /亲子|family/i, value: 'nature' },
  { pattern: /海岛|island/i, value: 'nature' }
]

const REGION_PATTERNS: Array<{ pattern: RegExp; region: DestinationRegion }> = [
  { pattern: /日本|japan/gi, region: 'japan' as DestinationRegion },
  { pattern: /欧洲|欧盟|申根|欧洲大陆|europe|schengen/gi, region: 'schengen' as DestinationRegion },
  { pattern: /东南亚|东亚|免签|落地签|southeast\s+asia|visa[- ]free/gi, region: 'visa_free' as DestinationRegion }
]

const RECOMMEND_PATTERN = /你帮我选|帮我选|你来选|帮我决定|你来决定|你决定|你推荐|推荐|哪里合适|适合的城市|适合城市|知名城市|几个地方|几个城市|推荐几个|安排几个|城市你看着安排|城市你安排|你看着安排|看着安排|随便|任选|任意城市|任意|你安排|由你|surprise|recommend|you decide|pick for me|anywhere|any suitable cities|famous cities|several places|cities you choose/i
const RECOMMEND_OPTOUT_PATTERN = /我自己选|我来选|自己选|我自己决定|我来决定|自己决定|不需要(?:你)?推荐|不用(?:你)?推荐|无需(?:你)?推荐|不要(?:你)?推荐|不想要(?:你)?推荐|只去这些|仅去这些|只安排这些|就去这些|only\s+these|no\s+recommendations?|i(?:'m| am)\s+(?:choosing|selecting)/i
const EXPLICIT_MARKER = /明确|具体|目的地|必去|必须去|想去|要去|去|到|飞往?|visit|go to|destination|must/i
const NEGATIVE_MARKER = /不要|不去|不是|别去|排除|避开|不想去|不考虑|不含|exclude|avoid|without|not\s+(?:visit|go)/i
const CORRECTION_MARKER = /改成|换成|改去|改为|换到|而不是|不是.+[，,：:]|不去.+(?:改|去)|instead|rather than|change(?:d)? to/i

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (digits[value] !== undefined) return digits[value]!
  const match = value.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (!match) return null
  return (match[1] ? digits[match[1]!]! * 10 : 10) + (match[2] ? digits[match[2]!]! : 0)
}

function validDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function futureDate(year: number, month: number, day: number, today: string): string | undefined {
  let date = validDate(year, month, day)
  if (!date) return undefined
  if (date < today) date = validDate(year + 1, month, day)
  return date && date >= today ? date : undefined
}

function lastMatch(text: string, pattern: RegExp): RegExpMatchArray | undefined {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const matches = [...text.matchAll(new RegExp(pattern.source, flags))]
  return matches.at(-1)
}

interface DateDelta {
  from?: string | undefined
  to?: string | undefined
}

function parseDates(text: string, today: string): DateDelta {
  const isoRange = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b\s*(?:到|至|[-~])\s*(?:(20\d{2})[-/.])?(\d{1,2})[-/.](\d{1,2})\b/)
  if (isoRange) {
    const year = Number(isoRange[1])
    const from = futureDate(year, Number(isoRange[2]), Number(isoRange[3]), today)
    const to = futureDate(Number(isoRange[4] ?? year), Number(isoRange[5]), Number(isoRange[6]), today)
    if (from && to && from <= to) return { from, to }
  }

  const chineseRange = text.match(/(?:(20\d{2})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:到|至|[-~])\s*(?:(20\d{2})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (chineseRange) {
    const defaultYear = Number(today.slice(0, 4))
    const from = futureDate(Number(chineseRange[1] ?? defaultYear), Number(chineseRange[2]), Number(chineseRange[3]), today)
    const to = futureDate(Number(chineseRange[4] ?? chineseRange[1] ?? defaultYear), Number(chineseRange[5]), Number(chineseRange[6]), today)
    if (from && to && from <= to) return { from, to }
  }

  const iso = lastMatch(text, /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (iso) {
    const from = futureDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), today)
    if (from) return { from, to: from }
  }
  const full = lastMatch(text, /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (full) {
    const from = futureDate(Number(full[1]), Number(full[2]), Number(full[3]), today)
    if (from) return { from, to: from }
  }
  const monthDay = lastMatch(text, /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (monthDay) {
    const from = futureDate(Number(today.slice(0, 4)), Number(monthDay[1]), Number(monthDay[2]), today)
    if (from) return { from, to: from }
  }
  if (/明天|tomorrow/i.test(text)) {
    const from = addDays(today, 1)
    return { from, to: from }
  }
  if (/下周|next\s+week/i.test(text)) {
    const from = addDays(today, 7)
    return { from, to: from }
  }
  return {}
}

function parseDays(text: string): number | null {
  if (/一周|一个星期|一星期|一礼拜|one\s+week/i.test(text)) return 7
  const match = text.match(/(?<!\d)(\d{1,2}|[一二两三四五六七八九十]+)\s*天(?:的假期|旅行|出行|行程|时间|假)?/)
    ?? text.match(/(?:for|玩|stay)\s*(\d{1,2})\s*days?/i)
  if (!match) return null
  const value = parseChineseNumber(match[1]!)
  return value && value >= 1 && value <= 60 ? value : null
}

function fallbackLocations(text: string): LocationMention[] {
  const lower = text.toLowerCase()
  const result: LocationMention[] = []
  for (const item of CITY_ALIASES) {
    for (const alias of item.aliases) {
      const needle = alias.toLowerCase()
      let from = lower.indexOf(needle)
      while (from >= 0) {
        result.push({ iata: item.iata, index: from })
        from = lower.indexOf(needle, from + Math.max(1, needle.length))
      }
    }
  }
  return result.sort((left, right) => left.index - right.index || left.iata.localeCompare(right.iata))
}

function currentSentence(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('，', index), text.lastIndexOf(',', index), text.lastIndexOf(';', index), text.lastIndexOf('。', index), text.lastIndexOf('!', index), text.lastIndexOf('！', index))
  const endCandidates = ['，', ',', ';', '。', '!', '！'].map(value => text.indexOf(value, index)).filter(value => value >= 0)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : text.length
  return text.slice(start + 1, end)
}

function isExcluded(text: string, mention: LocationMention): boolean {
  const sentence = currentSentence(text, mention.index)
  return NEGATIVE_MARKER.test(sentence)
}

function locationMentions(text: string): LocationMention[] {
  const resolved = resolveMentions(text)
  const fallback = fallbackLocations(text)
  const airportAliasIatas = fallback
    .filter(item => (item.iata === 'HND' && /羽田|haneda/i.test(text)) || (item.iata === 'NRT' && /成田|narita/i.test(text)))
    .map(item => item.iata)
  const airportAliasCanonical = new Set(airportAliasIatas.map(canonicalDestinationIata))
  const resolvedMentions = resolved.mentions.filter(item => !airportAliasCanonical.has(canonicalDestinationIata(item.iata)) || airportAliasIatas.includes(item.iata))
  const resolvedCanonical = new Set(resolvedMentions.map(item => canonicalDestinationIata(item.iata)))
  const fallbackIatas = new Set(fallback.map(item => item.iata))
  const all = [
    ...resolvedMentions,
    ...fallback.filter(item => {
      if (fallbackIatas.has(item.iata) && resolved.iatas.includes(item.iata)) return false
      if (airportAliasCanonical.has(canonicalDestinationIata(item.iata)) && !airportAliasIatas.includes(item.iata)) return false
      return !resolvedCanonical.has(canonicalDestinationIata(item.iata))
    })
  ]
  const seen = new Set<string>()
  return all
    .filter(item => item.index >= 0)
    .filter(item => isSupportedDestinationIata(item.iata) || isSupportedOrigin(item.iata))
    .sort((left, right) => left.index - right.index)
    .filter(item => {
      const key = `${item.iata}:${item.index}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function regionMentions(text: string, resolverRegions: DestinationRegion[]): DestinationRegion[] {
  const found: Array<{ index: number; region: DestinationRegion }> = []
  for (const item of REGION_PATTERNS) {
    for (const match of text.matchAll(item.pattern)) {
      found.push({ index: match.index ?? Number.MAX_SAFE_INTEGER, region: item.region })
    }
  }
  found.sort((left, right) => left.index - right.index)
  const ordered = unique(found.map(item => item.region))
  for (const region of resolverRegions) if (!ordered.includes(region)) ordered.push(region)
  return ordered
}

function parsePriorities(text: string): string[] {
  const result: string[] = []
  if (/便宜|省钱|低价|预算|cheap|budget/i.test(text)) result.push('budget')
  if (/舒适|舒服|酒店好|商务|comfort/i.test(text)) result.push('comfort')
  if (/少中转|少转机|少换乘|直飞|few\s+transfers|nonstop/i.test(text)) result.push('few_transfers')
  if (/文化|历史|博物馆|culture|history/i.test(text)) result.push('culture')
  return result
}

function parsePace(text: string): TripState['pace'] | undefined {
  if (/慢节奏|轻松|不赶|悠闲|relaxed|slow/i.test(text)) return 'relaxed'
  if (/多城|尽可能多|多去几个|密集|many\s+cities|fast[- ]paced/i.test(text)) return 'many_cities'
  if (/均衡|平衡|适中|balanced/i.test(text)) return 'balanced'
  return undefined
}

function applyState(base: TripState, input: {
  origin?: string | undefined
  dates?: DateDelta | undefined
  travelDays?: number | null | undefined
  budget?: number | null | undefined
  interests?: string[] | undefined
  regions?: DestinationRegion[] | undefined
  required?: string[] | undefined
  excluded?: string[] | undefined
  mode?: TripState['destination_mode'] | undefined
  pace?: TripState['pace'] | undefined
  priorities?: string[] | undefined
  replaceRequired?: boolean | undefined
  replaceRegions?: boolean | undefined
}): TripState {
  const state: TripState = {
    ...base,
    interests: [...base.interests],
    regions: [...base.regions],
    required_iatas: [...base.required_iatas],
    excluded_iatas: [...base.excluded_iatas],
    priorities: [...base.priorities]
  }
  if (input.origin) state.origin = input.origin
  if (input.dates?.from) {
    state.window_from = input.dates.from
    state.window_to = input.dates.to ?? input.dates.from
  }
  if (input.travelDays !== undefined && input.travelDays !== null) state.travel_days = input.travelDays
  if (input.budget !== undefined && input.budget !== null) state.budget_max = input.budget
  if (input.interests && input.interests.length > 0) state.interests = unique([...state.interests, ...input.interests]) as TripState['interests']
  if (input.regions && input.regions.length > 0) {
    state.regions = input.replaceRegions ? [...input.regions] : unique([...state.regions, ...input.regions])
  }
  if (input.replaceRequired && input.required && input.required.length > 0) state.required_iatas = [...input.required]
  else if (input.required && input.required.length > 0) state.required_iatas = unique([...state.required_iatas, ...input.required])
  if (input.excluded && input.excluded.length > 0) state.excluded_iatas = unique([...state.excluded_iatas, ...input.excluded])
  const excludedCanonical = new Set(state.excluded_iatas.map(canonicalDestinationIata))
  state.required_iatas = state.required_iatas.filter(iata => !excludedCanonical.has(canonicalDestinationIata(iata)))
  if (input.mode) state.destination_mode = input.mode
  if (input.pace) state.pace = input.pace
  if (input.priorities && input.priorities.length > 0) state.priorities = unique([...state.priorities, ...input.priorities]) as TripState['priorities']
  return state
}

export function parseRuleTurn(previous: TripState | undefined, text: string, today: string, reset = false): RuleParseResult {
  const base = reset ? emptyTripState() : previous ?? emptyTripState()
  const resolver = resolveMentions(text)
  const mentions = locationMentions(text)
  const nonExcluded = mentions.filter(mention => !isExcluded(text, mention))
  const excluded = unique(mentions.filter(mention => isExcluded(text, mention)).map(item => item.iata))
    .filter(isSupportedDestinationIata)
  const orderedIatas = unique(nonExcluded.map(item => item.iata)).filter(isSupportedDestinationIata)

  const fromMarker = /(?:从|由|出发地|出发(?!日期)|depart(?:ing)?\s+from|from)/i.test(text)
  const toMarker = /(?:去|到|飞往?|目的地|想去|visit|go\s+to|destination|must)/i.test(text)
  let origin: string | undefined
  let required = orderedIatas
  const explicitOriginIndex = nonExcluded.find(item => {
    const sentence = currentSentence(text, item.index)
    return /(?:从|由|出发地|出发(?!日期)|from|depart)/i.test(sentence) && item.index <= (sentence.indexOf('出发') >= 0 ? text.indexOf('出发', item.index) + 2 : text.length)
  })
  if (fromMarker && explicitOriginIndex) origin = explicitOriginIndex.iata
  else if (fromMarker && orderedIatas.length > 0) origin = orderedIatas[0]

  const directionIndex = text.search(/去|到|飞往?|目的地|想去|visit|go\s+to|destination|must/i)
  if (!origin && toMarker && orderedIatas.length > 1 && directionIndex > 0) {
    const beforeDirection = nonExcluded.find(item => item.index < directionIndex)
    if (beforeDirection) origin = beforeDirection.iata
  }
  if (origin) {
    required = orderedIatas.filter(iata => iata !== origin && isSupportedDestinationIata(iata))
  } else {
    // A bare city is an explicit destination candidate.  Origin recognition
    // requires a direction marker (for example “北京出发” or “from Beijing”),
    // so a country-only mention still cannot become a guessed city.
    required = orderedIatas.filter(isSupportedDestinationIata)
  }

  const dates = parseDates(text, today)
  const travelDays = parseDays(text)
  const budget = parseBudget(text)
  const interests = unique(INTEREST_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.value))
  const regions = regionMentions(text, resolver.regions as DestinationRegion[])
  const priorities = parsePriorities(text)
  const pace = parsePace(text)
  const recommendRequested = RECOMMEND_PATTERN.test(text)
  const recommendOptOut = RECOMMEND_OPTOUT_PATTERN.test(text)
  const explicitDestinationMentioned = required.length > 0 && (toMarker || !fromMarker || EXPLICIT_MARKER.test(text))
  const correction = CORRECTION_MARKER.test(text)
  // Once the user has authorized catalog recommendations, naming an
  // additional must-visit city is additive.  Only an explicit opt-out can
  // switch the conversation back to a fully explicit destination list.
  const mode = recommendOptOut
    ? 'explicit'
    : base.destination_mode === 'recommend'
      ? 'recommend'
      : recommendRequested
        ? 'recommend'
        : explicitDestinationMentioned
          ? 'explicit'
          : undefined

  const state = applyState(base, {
    origin,
    dates,
    travelDays,
    budget,
    interests,
    regions,
    required,
    excluded,
    mode,
    pace,
    priorities,
    replaceRequired: correction && required.length > 0,
    replaceRegions: correction && regions.length > 0
  })
  if (recommendRequested && required.length === 0) state.required_iatas = []
  return {
    state,
    evidenceIatas: new Set(orderedIatas),
    evidenceRegions: new Set(regions),
    recommendRequested,
    explicitDestinationMentioned
  }
}

export function buildQuestionField(state: TripState): 'origin' | 'window_from' | 'travel_days' | 'destination' | undefined {
  if (!state.origin) return 'origin'
  if (!state.window_from) return 'window_from'
  if (!state.travel_days) return 'travel_days'
  if (state.destination_mode === 'explicit' && (state.required_iatas.length === 0 || missingDestinationRegions(state).length > 0)) return 'destination'
  return undefined
}

/**
 * Explicit mode is never allowed to silently pick a city.  When more than one
 * region is requested, every region must also have a named catalog city.
 */
export function missingDestinationRegions(state: TripState): DestinationRegion[] {
  if (state.destination_mode !== 'explicit') return []
  if (state.required_iatas.length === 0) return [...state.regions]
  if (state.regions.length === 0) return []
  const covered = new Set(state.required_iatas.map(destinationRegionForIata).filter((region): region is DestinationRegion => region !== undefined))
  return state.regions.filter(region => !covered.has(region))
}

export function missingJourneyFields(state: TripState): string[] {
  const missing: string[] = []
  if (!state.origin) missing.push('origin')
  if (!state.window_from) missing.push('window_from')
  if (!state.travel_days) missing.push('travel_days')
  if (state.destination_mode === 'explicit' && (state.required_iatas.length === 0 || missingDestinationRegions(state).length > 0)) {
    missing.push('destination')
  }
  return missing
}
