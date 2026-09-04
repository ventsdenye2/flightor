// src/services/routeService.ts — 多城路线规划服务
// 真实模式只请求自建后端；Mock 模式保留小型、确定性的离线演示数据。
import { request, USE_MOCK } from '../utils/request'
import { AIRPORTS, findAirport } from '../mocks/airports'

export interface RouteSlots {
  origin: string | null
  window_from: string | null
  window_to: string | null
  travel_days: number | null
  region: string | null
  visa: string | null
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
  flightNo?: string
  stops?: number
  real?: boolean
}

export interface RouteResult {
  cities: string[]
  citySeq: string[]
  legs: RouteLeg[]
  totalPrice: number
  effCost: number
  nightsSaved: number
  hasReal?: boolean
}

export interface RoutePick {
  kind: 'cheapest' | 'mostCities' | 'mostNights'
  route: RouteResult
}

export interface ConfirmedPick extends RoutePick {
  probed: number
  failed: number
  note: string
}

export interface DirectiveParseResult {
  slots: RouteSlots
  missing: string[]
  conflicts: Array<{ zh: string; en: string }>
  notes: Array<{ zh: string; en: string }>
  source?: 'llm' | 'rules'
  llmError?: string
  warnings?: string[]
}

export interface RoutePlanResponse extends DirectiveParseResult {
  routes: RoutePick[]
  warnings?: string[]
}

export interface ConfirmPicksResponse {
  confirmed: ConfirmedPick[]
  warnings?: string[]
}

const ORIGIN_CODES = new Set(['PVG', 'SHA', 'PEK', 'PKX', 'CAN', 'SZX', 'CTU', 'TFU', 'HKG', 'TPE'])
const EUROPE_CODES = ['CDG', 'AMS', 'FRA', 'MUC', 'ZRH', 'VIE', 'PRG', 'FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'ATH', 'CPH', 'HEL']
const VISA_FREE_CODES = ['BKK', 'KUL', 'SIN', 'HAN', 'SGN', 'DPS', 'IST', 'CJU']
const NUM_ZH: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const EXTRA_CITY_NAMES: Record<string, { zh: string; en: string }> = {
  BUD: { zh: '布达佩斯', en: 'Budapest' },
  BEG: { zh: '贝尔格莱德', en: 'Belgrade' },
  CJU: { zh: '济州岛', en: 'Jeju' }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
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

function parseNum(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  if (NUM_ZH[value] != null) return NUM_ZH[value]
  const match = value.match(/^([一二两三四五六七八九]?)十([一二两三四五六七八九]?)$/)
  return match ? (match[1] ? NUM_ZH[match[1]] : 1) * 10 + (match[2] ? NUM_ZH[match[2]] : 0) : null
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function hash(value: string): number {
  let result = 0
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0
  return result
}

interface Mention {
  iata: string
  index: number
  length: number
}

function mentions(text: string): Mention[] {
  const result: Mention[] = []
  const seen = new Set<string>()
  for (const airport of AIRPORTS) {
    let found: Mention | undefined
    for (const name of [airport.iata, airport.city, airport.enCity]) {
      const index = text.toLowerCase().indexOf(name.toLowerCase())
      if (index >= 0 && (!found || index < found.index)) found = { iata: airport.iata, index, length: name.length }
    }
    if (found && !seen.has(found.iata)) {
      seen.add(found.iata)
      result.push(found)
    }
  }
  return result.sort((left, right) => left.index - right.index)
}

function futureYear(month: number, day: number, today: string): number {
  const year = Number(today.slice(0, 4))
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` < today ? year + 1 : year
}

function dateWindow(text: string, today: string): { from: string; to: string } | undefined {
  const iso = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(match => match[1]!)
  if (iso.length > 0) return { from: iso[0]!, to: iso[1] ?? addDays(iso[0]!, 3) }

  const range = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?\s*(?:到|至|-|~)\s*(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*[号日]?/)
  if (range) {
    const month = Number(range[1])
    const day = Number(range[2])
    const endMonth = range[3] ? Number(range[3]) : month
    const endDay = Number(range[4])
    const year = futureYear(month, day, today)
    const from = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const to = `${year + (endMonth < month ? 1 : 0)}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
    return from <= to ? { from, to } : undefined
  }

  const fuzzy = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*月\s*(初|中旬|中|下旬|底)/)
  if (fuzzy) {
    const month = parseNum(fuzzy[1]!)
    if (!month) return undefined
    const span: Record<string, [number, number]> = { 初: [1, 5], 中旬: [12, 18], 中: [12, 18], 下旬: [22, 28], 底: [25, 28] }
    const [start, end] = span[fuzzy[2]!] ?? [1, 5]
    const year = futureYear(month, start, today)
    return { from: `${year}-${String(month).padStart(2, '0')}-${String(start).padStart(2, '0')}`, to: `${year}-${String(month).padStart(2, '0')}-${String(end).padStart(2, '0')}` }
  }

  const month = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*月/)
  if (month) {
    const value = parseNum(month[1]!)
    if (!value) return undefined
    const year = futureYear(value, 1, today)
    const from = `${year}-${String(value).padStart(2, '0')}-01`
    return { from, to: addDays(from, 6) }
  }
  if (/下周|next\s+week/i.test(text)) {
    const from = addDays(today, 7)
    return { from, to: addDays(from, 6) }
  }
  if (/下个月|next\s+month/i.test(text)) {
    const from = addDays(today, 30)
    return { from, to: addDays(from, 6) }
  }
  return undefined
}

function travelDays(text: string): number | null {
  const match = text.match(/(?:其中|有)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*(?:可以)?(?:出去玩|出行|旅行|游玩|玩)/)
    ?? text.match(/玩\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天/)
    ?? text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*days?/i)
  if (match) return parseNum(match[1]!)
  if (/一周|一个星期|one\s+week|a\s+week/i.test(text)) return 7
  const range = text.match(/(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*天/)
  return range ? Math.round((Number(range[1]) + Number(range[2])) / 2) : null
}

function budget(text: string): number | null {
  const direct = text.match(/(?:预算|budget)\s*(\d+(?:\.\d+)?)\s*([万w千k])?/i)
  if (direct) {
    const value = Number(direct[1])
    if (direct[2] === '万' || direct[2]?.toLowerCase() === 'w') return Math.round(value * 10000)
    if (direct[2] === '千' || direct[2]?.toLowerCase() === 'k') return Math.round(value * 1000)
    if (Number.isFinite(value)) return value
  }
  const chinese = text.match(/预算\s*([一二两三四五六七八九十]+)\s*(万|千)/)
  if (chinese) return (parseNum(chinese[1]!) ?? 0) * (chinese[2] === '万' ? 10000 : 1000)
  return null
}

function validate(slots: RouteSlots): { missing: string[]; conflicts: Array<{ zh: string; en: string }> } {
  const missing = [
    ...(!slots.origin ? ['origin'] : []),
    ...(!slots.window_from ? ['window'] : []),
    ...(!slots.travel_days ? ['travel_days'] : [])
  ]
  const conflicts: Array<{ zh: string; en: string }> = []
  if (slots.city_target && slots.travel_days && slots.city_target > slots.travel_days) {
    conflicts.push({
      zh: `${slots.travel_days} 天最多覆盖约 ${slots.travel_days} 个城市，${slots.city_target} 个城市安排不下。建议减少城市数或延长行程。`,
      en: `${slots.travel_days} days can cover about ${slots.travel_days} cities at most. Try fewer cities or more days.`
    })
  }
  if (slots.direct_only && (slots.region === 'schengen' || slots.must_visit.length > 0)) {
    conflicts.push({
      zh: '欧洲城市间航线以中转联程为主，“全部直飞”会大幅减少可行路线。建议接受中转。',
      en: 'Most intra-Europe routes require a connection. Direct-only will rule out most itineraries.'
    })
  }
  return { missing, conflicts }
}

/** 旧调用方兼容的纯规则解析；真实路线规划不会在客户端走此解析。 */
export function parseDirective(text: string, today = todayIso()): DirectiveParseResult {
  const slots = emptySlots()
  const found = mentions(text)
  const origin = found.find(item => ORIGIN_CODES.has(item.iata) && (/从|由/.test(text.slice(Math.max(0, item.index - 6), item.index)) || /出发|起飞|from|depart/i.test(text.slice(item.index + item.length, item.index + item.length + 8))))
  slots.origin = (origin ?? found.find(item => ORIGIN_CODES.has(item.iata)))?.iata ?? null
  const window = dateWindow(text, today)
  if (window) {
    slots.window_from = window.from
    slots.window_to = window.to
  }
  slots.travel_days = travelDays(text)
  slots.budget_max = budget(text)
  slots.overnight_pref = /夜航|红眼|省.*住宿|overnight|red-eye/i.test(text)
  slots.direct_only = /只要直飞|全部(?:要|都)?直飞|都直飞|仅直飞|direct\s+only/i.test(text)

  if (/没有申根|无申根|没申根/.test(text)) {
    slots.visa = 'none'
    slots.region = 'visa_free'
  } else if (/申根/.test(text)) {
    slots.visa = 'schengen'
    slots.region = 'schengen'
  } else if (/欧洲|europe/i.test(text)) {
    slots.region = 'schengen'
  }

  const cityCount = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*个\s*(?:欧洲)?城市/)
  if (cityCount) slots.city_target = parseNum(cityCount[1]!)
  if (/尽可能多|越多越好|多去几个|多城|as many|multi[- ]?city/i.test(text)) slots.city_target = null

  const pool = slots.region === 'visa_free' ? VISA_FREE_CODES : EUROPE_CODES
  for (const item of found) {
    const airport = findAirport(item.iata)
    const nearby = text.slice(item.index, item.index + item.length + 6)
    const before = text.slice(Math.max(0, item.index - 6), item.index)
    if (pool.includes(item.iata) && (/必须去|必去/.test(nearby) || /必(?:须)?去/.test(before)) && !slots.must_visit.includes(item.iata)) {
      slots.must_visit.push(item.iata)
    }
    // Keep the local lookup explicit so adding an airport to the mock table is sufficient.
    if (!airport) continue
  }

  const notes: Array<{ zh: string; en: string }> = []
  if (slots.visa === 'none') {
    notes.push({
      zh: '没有申根签，候选城市已切换为免签/落地签目的地（曼谷、新加坡、吉隆坡等）。',
      en: 'Without a Schengen visa, candidates switched to visa-free destinations (Bangkok, Singapore, Kuala Lumpur…).'
    })
  }
  const checked = validate(slots)
  return { slots, ...checked, notes, source: 'rules' }
}

export async function parseDirectiveSmart(text: string, today = todayIso()): Promise<DirectiveParseResult> {
  return parseDirective(text, today)
}

function isNightLeg(leg: RouteLeg): boolean {
  const depart = Number(leg.departTime.slice(0, 2))
  const arrive = Number(leg.arriveTime.slice(0, 2))
  return depart >= 20 && (arrive < 9 || leg.crossDay)
}

function mockLeg(from: string, to: string, date: string, index: number): RouteLeg {
  const value = hash(`${from}|${to}|${date}|${index}`)
  const departHour = 8 + value % 15
  const duration = 90 + value % 390
  const arrival = departHour * 60 + duration
  const crossDay = arrival >= 24 * 60
  const arrivalInDay = arrival % (24 * 60)
  return {
    from,
    to,
    date,
    departTime: `${String(departHour).padStart(2, '0')}:${String(value % 4 * 15).padStart(2, '0')}`,
    arriveTime: `${String(Math.floor(arrivalInDay / 60)).padStart(2, '0')}:${String(arrivalInDay % 60).padStart(2, '0')}`,
    crossDay,
    duration,
    price: 420 + value % 1900,
    airline: ['CA', 'MU', 'SQ', 'QR'][value % 4]!,
    flightNo: `FO${100 + value % 800}`,
    stops: value % 3 === 0 ? 1 : 0,
    real: false
  }
}

function buildRoute(origin: string, cities: string[], date: string, reverse = false): RouteResult {
  const ordered = reverse ? [...cities].reverse() : [...cities]
  const legs: RouteLeg[] = []
  let from = origin
  let currentDate = date
  ordered.forEach((to, index) => {
    legs.push(mockLeg(from, to, currentDate, index))
    from = to
    currentDate = addDays(currentDate, 1)
  })
  legs.push(mockLeg(from, origin, currentDate, ordered.length))
  const totalPrice = legs.reduce((sum, leg) => sum + leg.price, 0)
  const nightsSaved = legs.filter(isNightLeg).length
  return { cities: ordered, citySeq: [origin, ...ordered, origin], legs, totalPrice, effCost: totalPrice - nightsSaved * 400, nightsSaved, hasReal: false }
}

function mockCandidates(slots: RouteSlots): string[] {
  const pool = slots.region === 'visa_free' ? VISA_FREE_CODES : EUROPE_CODES
  const required = slots.must_visit.filter(code => pool.includes(code) && code !== slots.origin)
  const rest = pool.filter(code => code !== slots.origin && !required.includes(code))
  const count = Math.min(slots.city_target ?? 3, Math.max(0, (slots.travel_days ?? 0) - 1), 4)
  return [...required, ...rest].slice(0, Math.max(required.length, count))
}

function uniquePicks(routes: RouteResult[]): RoutePick[] {
  const seen = new Set<string>()
  const picks: RoutePick[] = []
  const add = (kind: RoutePick['kind'], route: RouteResult | undefined) => {
    if (!route) return
    const key = route.cities.join('>')
    if (seen.has(key)) return
    seen.add(key)
    picks.push({ kind, route })
  }
  add('cheapest', [...routes].sort((a, b) => a.effCost - b.effCost)[0])
  add('mostCities', [...routes].sort((a, b) => b.cities.length - a.cities.length || a.effCost - b.effCost)[0])
  add('mostNights', [...routes].sort((a, b) => b.nightsSaved - a.nightsSaved || a.effCost - b.effCost)[0])
  return picks
}

function mockPlan(text: string, today: string): RoutePlanResponse {
  const parsed = parseDirective(text, today)
  if (parsed.missing.length > 0 || parsed.conflicts.length > 0 || !parsed.slots.window_from) return { ...parsed, routes: [], warnings: [] }
  const cities = mockCandidates(parsed.slots)
  if (!parsed.slots.origin || cities.length < 2) return { ...parsed, routes: [], warnings: [] }
  const routes = [
    buildRoute(parsed.slots.origin, cities.slice(0, 2), parsed.slots.window_from),
    buildRoute(parsed.slots.origin, cities.slice(0, Math.min(3, cities.length)), parsed.slots.window_from, true),
    buildRoute(parsed.slots.origin, cities.slice(0, Math.min(3, cities.length)), addDays(parsed.slots.window_from, 2))
  ].filter(route => !parsed.slots.budget_max || route.totalPrice <= parsed.slots.budget_max)
  return { ...parsed, routes: uniquePicks(routes), warnings: [] }
}

function mockConfirm(pick: RoutePick): ConfirmedPick {
  const legs = pick.route.legs.map((leg, index) => ({
    ...leg,
    price: Math.max(1, Math.round(leg.price * (0.94 + hash(`${leg.from}|${leg.to}|${index}`) % 13 / 100))),
    real: true
  }))
  const totalPrice = legs.reduce((sum, leg) => sum + leg.price, 0)
  const nightsSaved = legs.filter(isNightLeg).length
  return {
    kind: pick.kind,
    route: { ...pick.route, legs, totalPrice, effCost: totalPrice - nightsSaved * 400, nightsSaved, hasReal: true },
    probed: legs.length,
    failed: 0,
    note: '演示模式：已生成离线确认价'
  }
}

export function cityByIata(iata: string, locale: 'zh' | 'en'): string {
  const code = iata.toUpperCase()
  const airport = findAirport(code)
  if (airport) return locale === 'zh' ? airport.city : airport.enCity
  const extra = EXTRA_CITY_NAMES[code]
  return extra ? (locale === 'zh' ? extra.zh : extra.en) : iata
}

export async function planRoutes(text: string, today?: string): Promise<RoutePlanResponse> {
  const body: { text: string; today?: string } = { text }
  if (today) body.today = today
  if (USE_MOCK) return mockPlan(text, today ?? todayIso())
  return request<RoutePlanResponse>({ url: '/v1/route-plans', method: 'POST', data: body, retry: 0, timeout: 60000 })
}

export async function confirmPicksDetailed(picks: RoutePick[]): Promise<ConfirmPicksResponse> {
  if (USE_MOCK) return { confirmed: picks.map(mockConfirm), warnings: [] }
  return request<ConfirmPicksResponse>({ url: '/v1/route-plans/confirm', method: 'POST', data: { picks }, retry: 0, timeout: 60000 })
}

export async function confirmPicks(picks: RoutePick[], onWarnings?: (warnings: string[]) => void): Promise<ConfirmedPick[]> {
  const response = await confirmPicksDetailed(picks)
  onWarnings?.(response.warnings ?? [])
  return response.confirmed
}
