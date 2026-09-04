/**
 * Deterministic multi-city route planner.
 *
 * This is deliberately provider-free.  Planning uses stable estimates and the
 * confirmation endpoint is the only place where SerpApi is queried.
 */

export interface CityMeta {
  iata: string
  city: string
  enCity: string
  country?: string
  lat: number
  lng: number
}

export interface RouteSlots {
  origin: string | null
  window_from: string | null
  window_to: string | null
  travel_days: number | null
  region: 'schengen' | 'visa_free' | null
  visa: 'schengen' | 'none' | null
  must_visit: string[]
  overnight_pref: boolean
  direct_only: boolean
  budget_max: number | null
  city_target: number | null
}

export interface RouteLeg {
  from: string
  to: string
  date: string
  departTime: string
  arriveTime: string
  crossDay: boolean
  duration: number
  price: number
  airline: string
  flightNo?: string | undefined
  stops?: number | undefined
  real?: boolean | undefined
}

export interface RouteResult {
  cities: string[]
  citySeq: string[]
  legs: RouteLeg[]
  totalPrice: number
  effCost: number
  nightsSaved: number
  hasReal?: boolean | undefined
}

export type RouteKind = 'cheapest' | 'mostCities' | 'mostNights'

export interface RoutePick {
  kind: RouteKind
  route: RouteResult
}

export interface ConfirmedPick extends RoutePick {
  probed: number
  failed: number
  note: string
}

export interface BilingualText {
  zh: string
  en: string
}

export interface DirectiveParseResult {
  slots: RouteSlots
  missing: string[]
  conflicts: BilingualText[]
  notes: BilingualText[]
  source: 'llm' | 'rules'
  warnings: string[]
}

export const SCHENGEN_CITIES: CityMeta[] = [
  { iata: 'CDG', city: '巴黎', enCity: 'Paris', country: '法国', lat: 49.0097, lng: 2.5479 },
  { iata: 'AMS', city: '阿姆斯特丹', enCity: 'Amsterdam', country: '荷兰', lat: 52.3105, lng: 4.7683 },
  { iata: 'FRA', city: '法兰克福', enCity: 'Frankfurt', country: '德国', lat: 50.0379, lng: 8.5622 },
  { iata: 'MUC', city: '慕尼黑', enCity: 'Munich', country: '德国', lat: 48.3538, lng: 11.7861 },
  { iata: 'ZRH', city: '苏黎世', enCity: 'Zurich', country: '瑞士', lat: 47.4582, lng: 8.5556 },
  { iata: 'VIE', city: '维也纳', enCity: 'Vienna', country: '奥地利', lat: 48.1103, lng: 16.5697 },
  { iata: 'PRG', city: '布拉格', enCity: 'Prague', country: '捷克', lat: 50.1008, lng: 14.26 },
  { iata: 'FCO', city: '罗马', enCity: 'Rome', country: '意大利', lat: 41.8003, lng: 12.2389 },
  { iata: 'MXP', city: '米兰', enCity: 'Milan', country: '意大利', lat: 45.6306, lng: 8.7281 },
  { iata: 'BCN', city: '巴塞罗那', enCity: 'Barcelona', country: '西班牙', lat: 41.2974, lng: 2.0833 },
  { iata: 'MAD', city: '马德里', enCity: 'Madrid', country: '西班牙', lat: 40.4983, lng: -3.5676 },
  { iata: 'LIS', city: '里斯本', enCity: 'Lisbon', country: '葡萄牙', lat: 38.7742, lng: -9.1342 },
  { iata: 'ATH', city: '雅典', enCity: 'Athens', country: '希腊', lat: 37.9364, lng: 23.9445 },
  { iata: 'BUD', city: '布达佩斯', enCity: 'Budapest', country: '匈牙利', lat: 47.4372, lng: 19.2556 },
  { iata: 'CPH', city: '哥本哈根', enCity: 'Copenhagen', country: '丹麦', lat: 55.618, lng: 12.656 },
  { iata: 'HEL', city: '赫尔辛基', enCity: 'Helsinki', country: '芬兰', lat: 60.3172, lng: 24.9633 }
]

export const VISA_FREE_CITIES: CityMeta[] = [
  { iata: 'BKK', city: '曼谷', enCity: 'Bangkok', country: '泰国', lat: 13.69, lng: 100.7501 },
  { iata: 'KUL', city: '吉隆坡', enCity: 'Kuala Lumpur', country: '马来西亚', lat: 2.7456, lng: 101.7099 },
  { iata: 'SIN', city: '新加坡', enCity: 'Singapore', country: '新加坡', lat: 1.3644, lng: 103.9915 },
  { iata: 'HAN', city: '河内', enCity: 'Hanoi', country: '越南', lat: 21.2212, lng: 105.807 },
  { iata: 'SGN', city: '胡志明市', enCity: 'Ho Chi Minh City', country: '越南', lat: 10.8108, lng: 106.6519 },
  { iata: 'DPS', city: '巴厘岛', enCity: 'Bali', country: '印度尼西亚', lat: -8.7482, lng: 115.1672 },
  { iata: 'BEG', city: '贝尔格莱德', enCity: 'Belgrade', country: '塞尔维亚', lat: 44.8182, lng: 20.3091 },
  { iata: 'IST', city: '伊斯坦布尔', enCity: 'Istanbul', country: '土耳其', lat: 41.2753, lng: 28.7519 },
  { iata: 'CJU', city: '济州岛', enCity: 'Jeju', country: '韩国', lat: 33.5113, lng: 126.493 }
]

export const ORIGINS: CityMeta[] = [
  { iata: 'SZX', city: '深圳', enCity: 'Shenzhen', lat: 22.6393, lng: 113.8107 },
  { iata: 'CAN', city: '广州', enCity: 'Guangzhou', lat: 23.3924, lng: 113.2988 },
  { iata: 'PVG', city: '上海', enCity: 'Shanghai', lat: 31.1443, lng: 121.8083 },
  { iata: 'PEK', city: '北京', enCity: 'Beijing', lat: 40.0799, lng: 116.6031 },
  { iata: 'CTU', city: '成都', enCity: 'Chengdu', lat: 30.3125, lng: 104.4419 },
  { iata: 'HKG', city: '香港', enCity: 'Hong Kong', lat: 22.308, lng: 113.9185 }
]

export const NIGHT_START = 20
export const NIGHT_END = 9
export const LODGING_CNY = 400

const NUM_ZH: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
}

function hashStr(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

export function parseNum(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  if (NUM_ZH[value] !== undefined) return NUM_ZH[value]!
  const match = value.match(/^([一二两三四五六七八九]?)十([一二两三四五六七八九]?)$/)
  if (!match) return null
  const tens = match[1] ? NUM_ZH[match[1]]! : 1
  const ones = match[2] ? NUM_ZH[match[2]]! : 0
  return tens * 10 + ones
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isIsoDate(value) ? value : null
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return false
  return new Date(parsed).toISOString().slice(0, 10) === value
}

export function addDays(iso: string, days: number): string {
  const timestamp = Date.parse(`${iso}T00:00:00Z`)
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10)
}

function distKm(a: CityMeta, b: CityMeta): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function isNightLeg(leg: Pick<RouteLeg, 'departTime' | 'arriveTime' | 'crossDay'>): boolean {
  if (!validTime(leg.departTime) || !validTime(leg.arriveTime)) return false
  const dep = Number(leg.departTime.slice(0, 2))
  const arr = Number(leg.arriveTime.slice(0, 2))
  return dep >= NIGHT_START && (arr < NIGHT_END || leg.crossDay)
}

function emptySlots(): RouteSlots {
  return {
    origin: null,
    window_from: null,
    window_to: null,
    travel_days: null,
    region: null,
    visa: null,
    must_visit: [],
    overnight_pref: false,
    direct_only: false,
    budget_max: null,
    city_target: null
  }
}

function dateWindow(text: string, today: string): { from: string; to: string } | null {
  const full = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?\s*(?:到|至|-|~)\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?/)
  const short = full ? null : text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?\s*(?:到|至|-|~)\s*(\d{1,2})\s*[号日]?/)
  let fromMonth: number
  let fromDay: number
  let toMonth: number
  let toDay: number
  if (full) {
    fromMonth = Number(full[1])
    fromDay = Number(full[2])
    toMonth = Number(full[3])
    toDay = Number(full[4])
  } else if (short) {
    fromMonth = Number(short[1])
    fromDay = Number(short[2])
    toMonth = fromMonth
    toDay = Number(short[3])
  } else {
    const fuzzy = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*月\s*(初|中旬|中|底|下旬)/)
    if (!fuzzy) return null
    const month = parseNum(fuzzy[1]!)
    if (!month) return null
    const span: Record<string, [number, number]> = {
      初: [1, 5],
      中: [12, 18],
      中旬: [12, 18],
      底: [25, 28],
      下旬: [22, 28]
    }
    const dates = span[fuzzy[2]!]
    if (!dates) return null
    fromMonth = month
    toMonth = month
    fromDay = dates[0]
    toDay = dates[1]
  }

  const year = Number(today.slice(0, 4))
  let from = toIsoDate(year, fromMonth, fromDay)
  let to = toIsoDate(year, toMonth, toDay)
  if (!from || !to) return null
  if (from < today) {
    from = toIsoDate(year + 1, fromMonth, fromDay)
    to = toIsoDate(year + 1, toMonth, toDay)
  }
  if (!from || !to || from > to) return null
  return { from, to }
}

function parseTravelDays(text: string): number | null {
  const play = text.match(/(?:其中|有)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*(?:可以)?(?:出去玩|出行|旅行|游玩|玩)/)
  const playReverse = text.match(/玩\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天/)
  const range = text.match(/(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*天\s*(?:的)?假期/)
  const one = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*(?:假期|假|时间)/)
  const monthDays = text.match(/月\s*(?:初|中旬|中|底|下旬)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天/)
  const tail = text.match(/(?:^|[，,。\s号日])(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*$/)
  const comma = text.match(/[，,]\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*[，,。]/)
  const week = /一周|一个星期|一星期|一礼拜/.test(text) ? 7 : null
  const token = play?.[1] ?? playReverse?.[1] ?? one?.[1] ?? monthDays?.[1] ?? tail?.[1] ?? comma?.[1]
  if (token) {
    const value = parseNum(token)
    return value && value > 0 ? value : null
  }
  if (range) {
    const value = Math.round((Number(range[1]) + Number(range[2])) / 2)
    return value > 0 ? value : null
  }
  return week
}

function resolveCity(value: string, pool: CityMeta[]): CityMeta | undefined {
  const normalized = value.trim().toLowerCase()
  return pool.find(city => city.city === value.trim() || city.enCity.toLowerCase() === normalized)
}

function parseMustVisit(text: string, pool: CityMeta[]): string[] {
  const found: string[] = []
  const add = (name: string) => {
    const city = resolveCity(name, pool)
    if (city && !found.includes(city.iata)) found.push(city.iata)
  }
  const pair = text.match(/([\u4e00-\u9fa5]{2,6}?)(?:和|与|、)([\u4e00-\u9fa5]{2,6}?)必须去/)
  if (pair) {
    add(pair[1]!)
    add(pair[2]!)
    return found
  }
  const before = text.match(/([\u4e00-\u9fa5]{2,6}?)(?:必须去|必去)/)
  const after = text.match(/必(?:须)?去([\u4e00-\u9fa5]{2,6})/)
  if (before) add(before[1]!)
  else if (after) add(after[1]!)
  return found
}

function parseBudget(text: string): number | null {
  const arabicWan = text.match(/预算\s*(\d+(?:\.\d+)?)\s*[万w]/i)
  if (arabicWan) return Math.round(Number(arabicWan[1]) * 10_000)
  const zhWan = text.match(/预算\s*([一二两三四五六七八九十]+)\s*万\s*([一二两三四五六七八九]?)(?:千)?/)
  if (zhWan) {
    const wan = parseNum(zhWan[1]!)
    const tail = zhWan[2] ? parseNum(zhWan[2]!) : 0
    return wan ? wan * 10_000 + (tail ?? 0) * 1_000 : null
  }
  const zhQian = text.match(/预算\s*([一二两三四五六七八九十]+)\s*千/)
  if (zhQian) {
    const qian = parseNum(zhQian[1]!)
    return qian ? qian * 1_000 : null
  }
  const plain = text.match(/预算\s*(\d{3,7})(?!\s*[万w])/i)
  return plain ? Number(plain[1]) : null
}

/** Parse the legacy long-form Chinese route directive using only local rules. */
export function parseDirective(text: string, today: string): Omit<DirectiveParseResult, 'source' | 'warnings'> {
  const slots = emptySlots()

  const originMatches = text.matchAll(/([^\s，。！？,]{1,12}?)出发/g)
  for (const match of originMatches) {
    const name = match[1]!
    const city = ORIGINS.find(item => name.includes(item.city) || name.toLowerCase().includes(item.enCity.toLowerCase()))
    if (city) {
      slots.origin = city.iata
      break
    }
  }

  const window = dateWindow(text, today)
  if (window) {
    slots.window_from = window.from
    slots.window_to = window.to
  }
  slots.travel_days = parseTravelDays(text)

  if (/申根/.test(text)) {
    if (/没有申根|无申根|没申根/.test(text)) slots.visa = 'none'
    else slots.visa = 'schengen'
  }
  if (/欧洲/.test(text) && !slots.region) slots.region = 'schengen'
  if (slots.visa === 'schengen') slots.region = 'schengen'
  if (slots.visa === 'none') {
    slots.region = 'visa_free'
  }

  const pool = slots.region === 'visa_free' ? VISA_FREE_CITIES : SCHENGEN_CITIES
  slots.must_visit = parseMustVisit(text, pool)

  if (/晚.*(?:飞|航班|飞机).*(?:早|晨)|夜航|红眼|省.*住宿/.test(text)) slots.overnight_pref = true
  if (/只要直飞|全部(?:要|都)?直飞|都直飞|仅直飞/.test(text)) slots.direct_only = true

  const explicitCity = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*个\s*(?:欧洲)?城市/)
  if (explicitCity) slots.city_target = parseNum(explicitCity[1]!)
  if (/尽可能多|越多越好|多去几个|多城/.test(text)) slots.city_target = null
  slots.budget_max = parseBudget(text)

  const validation = validateSlots(slots)
  const notes: BilingualText[] = []
  if (slots.visa === 'none') notes.push(visaFreeNote())
  return { slots, missing: validation.missing, conflicts: validation.conflicts, notes }
}

export function validateSlots(slots: RouteSlots): { missing: string[]; conflicts: BilingualText[] } {
  const missing: string[] = []
  const conflicts: BilingualText[] = []
  if (!slots.origin) missing.push('origin')
  if (!slots.window_from || !slots.window_to) missing.push('window')
  if (!slots.travel_days || slots.travel_days <= 0) missing.push('travel_days')

  if (slots.city_target && slots.travel_days && slots.city_target > slots.travel_days) {
    conflicts.push({
      zh: `${slots.travel_days} 天最多覆盖约 ${slots.travel_days} 个城市（每城至少停留 1 天），${slots.city_target} 个城市安排不下。建议减少城市数或延长行程。`,
      en: `${slots.travel_days} days can cover about ${slots.travel_days} cities at most. ${slots.city_target} cities won't fit — try fewer cities or more days.`
    })
  }
  if (slots.direct_only && (slots.region === 'schengen' || slots.must_visit.length > 0)) {
    conflicts.push({
      zh: '欧洲城市间航线以中转联程为主，“全部直飞”会大幅减少可行路线。建议接受中转，或只保留 1-2 个必去城市。',
      en: 'Most intra-Europe routes require a connection. “Direct only” will rule out most itineraries — consider accepting transfers.'
    })
  }
  return { missing, conflicts }
}

function visaFreeNote(): BilingualText {
  return {
    zh: '没有申根签，候选城市已切换为免签/落地签目的地（曼谷、新加坡、吉隆坡、贝尔格莱德等），欧洲申根城市暂不可达。',
    en: 'Without a Schengen visa, candidates switched to visa-free destinations (Bangkok, Singapore, Kuala Lumpur, Belgrade…). Schengen cities are out of reach.'
  }
}

/** Generate a stable estimate for one OD/date. */
export function mockLegs(
  from: CityMeta,
  to: CityMeta,
  date: string,
  legsFn?: (from: CityMeta, to: CityMeta, date: string) => RouteLeg[]
): RouteLeg[] {
  if (legsFn) {
    const injected = legsFn(from, to, date)
    if (Array.isArray(injected) && injected.length > 0) return injected
  }
  const hash = hashStr(`${from.iata}|${to.iata}|${date}`)
  const longHaul = distKm(from, to) > 4_000
  const count = 2 + (hash % 2)
  const result: RouteLeg[] = []
  for (let index = 0; index < count; index += 1) {
    const itemHash = hashStr(`${from.iata}|${to.iata}|${date}|${index}`)
    const departHour = longHaul
      ? (itemHash % 3 === 0 ? 22 + (itemHash % 2) : 9 + (itemHash % 5))
      : 7 + (itemHash % 15)
    const durationHours = longHaul ? 11 + (itemHash % 4) : 1 + (itemHash % 3)
    const base = longHaul ? 2_600 + (itemHash % 2_400) : 220 + (itemHash % 680)
    const price = Math.round(base * (0.9 + (itemHash % 30) / 100))
    const arrivalTotalMinutes = departHour * 60 + durationHours * 60 + (itemHash % 50)
    const crossDay = arrivalTotalMinutes >= 24 * 60
    const arrivalMinutes = crossDay ? arrivalTotalMinutes - 24 * 60 : arrivalTotalMinutes
    result.push({
      from: from.iata,
      to: to.iata,
      date,
      departTime: `${String(departHour).padStart(2, '0')}:${String((itemHash % 4) * 15).padStart(2, '0')}`,
      arriveTime: `${String(Math.floor(arrivalMinutes / 60)).padStart(2, '0')}:${String(arrivalMinutes % 60).padStart(2, '0')}`,
      crossDay,
      duration: durationHours * 60 + (itemHash % 50),
      price,
      airline: longHaul ? 'CA' : ['FR', 'U2', 'LH', 'AF'][itemHash % 4]!
    })
  }
  return result
}

export function selectPool(slots: RouteSlots, options: {
  poolSize?: number
  allCities?: CityMeta[]
} = {}): CityMeta[] {
  const size = options.poolSize ?? 8
  const defaultSet = slots.visa === 'none' || slots.region === 'visa_free' ? VISA_FREE_CITIES : SCHENGEN_CITIES
  const all = options.allCities ?? defaultSet
  const pool: CityMeta[] = []
  for (const required of slots.must_visit) {
    const city = all.find(item => item.iata === required)
    if (city && !pool.some(item => item.iata === city.iata)) pool.push(city)
  }
  const scored = all
    .filter(city => !pool.some(item => item.iata === city.iata))
    .map(city => ({
      city,
      score: all.reduce((sum, other) => sum + (other.iata === city.iata ? 0 : distKm(city, other)), 0)
    }))
    .sort((left, right) => left.score - right.score)
  for (const item of scored) {
    if (pool.length >= size) break
    pool.push(item.city)
  }
  return pool
}

export interface SearchRouteOptions {
  cities?: CityMeta[]
  allCities?: CityMeta[]
  poolSize?: number
  legsFn?: (from: CityMeta, to: CityMeta, date: string) => RouteLeg[]
  lodgingCny?: number
  /** Allow a deliberate one-destination closed loop (used by journey.ts). */
  allowSingleCity?: boolean
}

export function searchRoutes(slots: RouteSlots, options: SearchRouteOptions = {}): RouteResult[] {
  if (!slots.origin || !slots.window_from || !slots.window_to || !slots.travel_days) return []
  const cities = options.cities ?? selectPool(slots, options)
  if (cities.length === 0) return []
  const lodging = options.lodgingCny ?? LODGING_CNY
  const originIata = slots.origin
  const origin = ORIGINS.find(item => item.iata === slots.origin) ?? {
    iata: slots.origin,
    city: slots.origin,
    enCity: slots.origin,
    lat: 22.6,
    lng: 113.8
  }
  const legCache = new Map<string, RouteLeg[]>()
  const legsFor = (from: CityMeta, to: CityMeta, date: string) => {
    const key = `${from.iata}|${to.iata}|${date}`
    const cached = legCache.get(key)
    if (cached) return cached
    const legs = mockLegs(from, to, date, options.legsFn)
    legCache.set(key, legs)
    return legs
  }
  const bestLeg = (from: CityMeta, to: CityMeta, date: string): RouteLeg | null => {
    const legs = legsFor(from, to, date)
    if (legs.length === 0) return null
    return legs.reduce((best, leg) => {
      if (!best) return leg
      const score = leg.price - (slots.overnight_pref && isNightLeg(leg) ? lodging : 0)
      const bestScore = best.price - (slots.overnight_pref && isNightLeg(best) ? lodging : 0)
      return score < bestScore ? leg : best
    }, null as RouteLeg | null)
  }

  const stayOptions = slots.overnight_pref ? [1, 2] : [2, 1]
  const maxCities = Math.min(slots.city_target || 6, slots.travel_days - 1, cities.length, 6)
  const minimumCities = options.allowSingleCity ? 1 : 2
  if (maxCities < minimumCities) return []
  const results: RouteResult[] = []
  const bestByCount = new Map<number, number>()
  const keep = 60

  const recordSolution = (visited: string[], legs: RouteLeg[], cost: number) => {
    if (slots.must_visit.length > 0 && !slots.must_visit.every(city => visited.includes(city))) return
    const lastCity = cities.find(city => city.iata === visited[visited.length - 1])
    if (!lastCity) return
    const lastLeg = legs[legs.length - 1]
    if (!lastLeg) return
    const returnDate = addDays(lastLeg.date, 1)
    const returnLeg = bestLeg(lastCity, origin, returnDate)
    if (!returnLeg) return
    const totalLegs = [...legs, returnLeg]
    const totalPrice = cost + returnLeg.price
    if (slots.budget_max && totalPrice > slots.budget_max) return
    const nightsSaved = totalLegs.filter(isNightLeg).length
    const effCost = totalPrice - nightsSaved * (slots.overnight_pref ? lodging : 0)
    const count = visited.length
    const hasReal = totalLegs.some(leg => leg.real === true)
    if (!hasReal) {
      const best = bestByCount.get(count)
      if (best !== undefined && effCost >= best && results.length >= keep) return
      if (best === undefined || effCost < best) bestByCount.set(count, effCost)
    }
    results.push({
      cities: [...visited],
      citySeq: [originIata, ...visited, originIata],
      legs: totalLegs,
      totalPrice,
      effCost,
      nightsSaved,
      hasReal
    })
    if (results.length > keep * 2) {
      results.sort((left, right) => left.effCost - right.effCost)
      const real = results.filter(item => item.hasReal)
      const estimates = results.filter(item => !item.hasReal).slice(0, Math.max(0, keep - real.length))
      results.length = 0
      results.push(...real, ...estimates)
    }
  }

  const dfs = (
    current: CityMeta,
    currentDate: string,
    nightsUsed: number,
    visited: string[],
    legs: RouteLeg[],
    cost: number
  ): void => {
    if (visited.length >= minimumCities) recordSolution(visited, legs, cost)
    if (visited.length >= maxCities) return
    if (nightsUsed + 1 > slots.travel_days! - 1) return
    for (const next of cities) {
      if (visited.includes(next.iata)) continue
      const mustLeft = slots.must_visit.filter(city => !visited.includes(city) && city !== next.iata).length
      const isMust = slots.must_visit.includes(next.iata)
      for (const stay of stayOptions) {
        if (nightsUsed + stay > slots.travel_days! - 1) continue
        if (slots.must_visit.length > 0 && !isMust && nightsUsed + stay + mustLeft > slots.travel_days! - 1) continue
        const departDate = addDays(currentDate, stay)
        if (departDate > slots.window_to!) continue
        const leg = bestLeg(current, next, departDate)
        if (!leg) continue
        const newCost = cost + leg.price
        if (slots.budget_max && newCost > slots.budget_max) continue
        const targetCount = visited.length + 1
        const hasRealSoFar = leg.real === true || legs.some(item => item.real === true)
        const best = bestByCount.get(targetCount)
        if (!hasRealSoFar && best !== undefined && newCost > best * 1.15) continue
        dfs(next, departDate, nightsUsed + stay, [...visited, next.iata], [...legs, leg], newCost)
      }
    }
  }

  const entryDates: string[] = []
  for (const offset of [0, 2, 5]) {
    const date = addDays(slots.window_from, offset)
    if (date <= slots.window_to && !entryDates.includes(date)) entryDates.push(date)
  }
  for (const entry of cities) {
    for (const date of entryDates) {
      const leg = bestLeg(origin, entry, date)
      if (!leg) continue
      if (slots.budget_max && leg.price > slots.budget_max) continue
      dfs(entry, date, 0, [entry.iata], [leg], leg.price)
    }
  }
  results.sort((left, right) => left.effCost - right.effCost)
  results.sort((left, right) => Number(right.hasReal) - Number(left.hasReal))
  return results.slice(0, keep)
}

export function convergeRoutes(routes: RouteResult[]): RoutePick[] {
  if (routes.length === 0) return []
  const picked: RoutePick[] = []
  const seen = new Set<string>()
  const keyOf = (route: RouteResult) => route.cities.join('>')
  const cheapest = routes.find(route => route.cities.length >= 4) ?? routes[0]
  if (!cheapest) return []
  picked.push({ kind: 'cheapest', route: cheapest })
  seen.add(keyOf(cheapest))

  const mostCities = [...routes]
    .sort((left, right) => right.cities.length - left.cities.length || left.effCost - right.effCost)
    .find(route => !seen.has(keyOf(route)))
  if (mostCities) {
    picked.push({ kind: 'mostCities', route: mostCities })
    seen.add(keyOf(mostCities))
  }

  const mostNights = [...routes]
    .filter(route => route.nightsSaved > 0)
    .sort((left, right) => right.nightsSaved - left.nightsSaved || left.effCost - right.effCost)
    .find(route => !seen.has(keyOf(route)))
  if (mostNights) picked.push({ kind: 'mostNights', route: mostNights })
  return picked
}
