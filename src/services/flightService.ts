// src/services/flightService.ts — 航班数据服务
// USE_MOCK=true 时本地生成确定性 Mock 数据；真实模式统一走自建后端。
import type { SearchParams, FlightOption, FlightSegment, HubInfo } from '../types/flight'
import type { SearchResponse, PriceTrendResponse } from '../types/api'
import type { VisaStatus } from '../types/common'
import { findAirport, distanceKm } from '../mocks/airports'
import { USE_MOCK, request } from '../utils/request'
import { toDateString } from '../utils/format'
import { sortByRecommendation } from '../utils/flightRecommendation'

// 与云端共用同一份可达性规则；Mock 不再凭空假设任意两机场之间有直飞。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const connectivity = require('../../cloud/searchProxy/connectivity') as {
  TOPOLOGY_VERSION: string
  canFly: (origin: string, destination: string, date?: string) => boolean
  validateItinerary: (segments: FlightSegment[], opts?: Record<string, unknown>) => { valid: boolean; reasons: string[] }
  edgeCount: () => number
}

/** 兼容现有 UI：非 Mock 即表示由后端提供真实报价。 */
export function hasSerpKey(): boolean {
  return !USE_MOCK
}

// ---------- 确定性伪随机（同一路线结果稳定，便于分享/收藏回放） ----------
function seedOf(str: string): () => number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 10000) / 10000
  }
}

// ---------- Mock 基础数据 ----------
// disc = 该枢纽自行中转相对直飞基准的折扣下限（廉航枢纽更便宜）
const HUBS: Array<{ iata: string; city: string; visaStatus: VisaStatus; visaNote: string; disc: number }> = [
  { iata: 'KUL', city: '吉隆坡', visaStatus: 'free', visaNote: '免签30天', disc: 0.42 },
  { iata: 'BKK', city: '曼谷', visaStatus: 'free', visaNote: '落地签/免签', disc: 0.46 },
  { iata: 'SIN', city: '新加坡', visaStatus: 'conditional', visaNote: '96小时过境免签 VFTF', disc: 0.54 },
  { iata: 'DOH', city: '多哈', visaStatus: 'free', visaNote: '96小时过境免签', disc: 0.55 },
  { iata: 'DXB', city: '迪拜', visaStatus: 'free', visaNote: '免签30天', disc: 0.55 },
  { iata: 'IST', city: '伊斯坦布尔', visaStatus: 'required', visaNote: '需电子签', disc: 0.6 },
  { iata: 'HEL', city: '赫尔辛基', visaStatus: 'required', visaNote: '需申根签证', disc: 0.62 }
]

const LCC = [
  { code: 'TR', name: 'Scoot', aircraft: 'B787-9' },
  { code: 'AK', name: 'AirAsia', aircraft: 'A320neo' },
  { code: 'VZ', name: 'Thai Vietjet', aircraft: 'A321' }
]

const FSC = [
  { code: 'SQ', name: 'Singapore Airlines', aircraft: 'A350-900' },
  { code: 'QR', name: 'Qatar Airways', aircraft: 'B777-300ER' },
  { code: 'TK', name: 'Turkish Airlines', aircraft: 'A330-300' },
  { code: 'EK', name: 'Emirates', aircraft: 'A380-800' },
  { code: 'AY', name: 'Finnair', aircraft: 'A350-900' },
  { code: 'TG', name: 'Thai Airways', aircraft: 'B777-200' },
  { code: 'MH', name: 'Malaysia Airlines', aircraft: 'A350-900' }
]

const HUB_CARRIER: Record<string, typeof FSC[number]> = {
  SIN: FSC[0],
  DOH: FSC[1],
  IST: FSC[2],
  DXB: FSC[3],
  HEL: FSC[4],
  BKK: FSC[5],
  KUL: FSC[6]
}

/** 估算两机场大圆飞行分钟数（约850km/h + 40min 起降余量） */
function estFlightMinutes(a: string, b: string): number {
  const A = findAirport(a)
  const B = findAirport(b)
  if (!A || !B) return 600
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(B.lat - A.lat)
  const dLng = toRad(B.lng - A.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(A.lat)) * Math.cos(toRad(B.lat)) * Math.sin(dLng / 2) ** 2
  const km = 6371 * 2 * Math.asin(Math.sqrt(h))
  return Math.round(km / 850 * 60 + 40)
}

function isoAt(dateStr: string, hour: number, minute: number, dayOffset = 0): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
}

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() + minutes)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
}

function makeSegment(
  carrier: { code: string; name: string; aircraft: string },
  flightNo: number,
  origin: string,
  destination: string,
  departIso: string
): FlightSegment {
  const duration = estFlightMinutes(origin, destination)
  return {
    flightNo: `${carrier.code}${flightNo}`,
    airline: carrier.name,
    origin,
    destination,
    departTime: departIso,
    arriveTime: addMinutes(departIso, duration),
    duration,
    aircraft: carrier.aircraft
  }
}

// ---------- Mock 搜索：单个（出发机场 × 落地机场 × 出发日）组合 ----------
// 全量扫描会反复命中同一组合（搜索+矩阵+点选），结果确定性可缓存
type ComboResult = { direct: FlightOption[]; selfTransfer: FlightOption[]; airlineTransfer: FlightOption[] }
const comboCache = new Map<string, ComboResult>()

function comboSearch(origin: string, destination: string, departDate: string, seedExtra: string): ComboResult {
  const cacheKey = `${origin}|${destination}|${departDate}|${seedExtra}`
  const cached = comboCache.get(cacheKey)
  if (cached) return cached

  const rand = seedOf(`${origin}-${destination}-${departDate}${seedExtra}`)
  // 基准价随航距定价（≈ ¥0.62/公里 + 起步价），再叠加机场/日期浮动；
  // 这样东南亚短程和欧美长程才会拉开合理价差
  const oA = findAirport(origin)
  const dA = findAirport(destination)
  const routeKm = oA && dA ? distanceKm(oA, dA) : 8000
  const basePrice = Math.round((600 + routeKm * 0.62) * (0.85 + rand() * 0.5))
  const comboId = `${origin}-${destination}-${departDate}`

  // 直飞方案：只有拓扑确认指定日期可达时才生成
  const direct: FlightOption[] = []
  const directCarriers = [FSC[0], FSC[5], FSC[2]]
  if (connectivity.canFly(origin, destination, departDate)) {
    for (let i = 0; i < 2; i++) {
      const c = directCarriers[i % directCarriers.length]
      const dep = isoAt(departDate, 9 + i * 7, (i * 25) % 60)
      const seg = makeSegment(c, 100 + Math.round(rand() * 800), origin, destination, dep)
      direct.push({
        id: `direct-${comboId}-${i}`,
        segments: [seg],
        totalPrice: Math.round(basePrice * (1 + rand() * 0.25)),
        totalDuration: seg.duration,
        airline: c.name,
        transferType: 'direct'
      })
    }
  }

  // 自行中转：枚举全部枢纽（不再随机抽样，保证最低价枢纽不被漏算），
  // 每枢纽试两种承运组合（廉航接全服务 / 全服务接廉航）取更低者
  const selfTransfer: FlightOption[] = []
  HUBS.forEach((hub, i) => {
    // 枢纽与起讫点重合时无中转意义，跳过
    if (hub.iata === origin || hub.iata === destination) return
    if (!connectivity.canFly(origin, hub.iata, departDate)) return
    const lcc = LCC[i % LCC.length]
    const fsc = HUB_CARRIER[hub.iata]
    const layover = 480 + Math.round(rand() * 480) // 8-16h 停留
    // 折扣下限由枢纽决定（廉航枢纽如 KUL/BKK 能出更低价）
    const factorA = hub.disc + 0.02 + rand() * 0.08 // 廉航前段
    const factorB = hub.disc + rand() * 0.1 // 全服务前段
    const useB = factorB < factorA
    const first = useB ? fsc : lcc
    const second = useB ? lcc : fsc
    const price = Math.round(basePrice * Math.min(factorA, factorB))

    const dep1 = isoAt(departDate, 20 + (i % 4), (i * 20) % 60)
    const seg1 = makeSegment(first, 101 + i * 10, origin, hub.iata, dep1)
    const dep2 = addMinutes(seg1.arriveTime, layover)
    if (!connectivity.canFly(hub.iata, destination, dep2.slice(0, 10))) return
    const seg2 = makeSegment(second, 300 + i * 21, hub.iata, destination, dep2)
    const hubInfo: HubInfo = {
      iata: hub.iata,
      city: hub.city,
      layoverMinutes: layover,
      visaStatus: hub.visaStatus,
      visaNote: hub.visaNote,
      baggageRecheck: true
    }
    const option: FlightOption = {
      id: `self-${hub.iata}-${comboId}`,
      segments: [seg1, seg2],
      totalPrice: price,
      totalDuration: seg1.duration + layover + seg2.duration,
      airline: `${first.name} + ${second.name}`,
      transferType: 'self',
      hub: hubInfo
    }
    if (connectivity.validateItinerary(option.segments, { transferType: 'self', requireKnown: true }).valid) {
      selfTransfer.push(option)
    }
  })

  // 航司联程：同样枚举全部枢纽
  const airlineTransfer: FlightOption[] = []
  HUBS.forEach((hub, i) => {
    if (hub.iata === origin || hub.iata === destination) return
    if (!connectivity.canFly(origin, hub.iata, departDate)) return
    const fsc = HUB_CARRIER[hub.iata]
    const dep1 = isoAt(departDate, 8 + (i % 5) * 3, (i * 35) % 60)
    const seg1 = makeSegment(fsc, 830 + i * 3, origin, hub.iata, dep1)
    const layover = 90 + Math.round(rand() * 150) // 1.5-4h 衔接
    const dep2 = addMinutes(seg1.arriveTime, layover)
    if (!connectivity.canFly(hub.iata, destination, dep2.slice(0, 10))) return
    const seg2 = makeSegment(fsc, 320 + i * 7, hub.iata, destination, dep2)
    const option: FlightOption = {
      id: `airline-${hub.iata}-${comboId}`,
      segments: [seg1, seg2],
      totalPrice: Math.round(basePrice * (0.75 + rand() * 0.15)),
      totalDuration: seg1.duration + layover + seg2.duration,
      airline: fsc.name,
      transferType: 'airline',
      hub: {
        iata: hub.iata,
        city: hub.city,
        layoverMinutes: layover,
        visaStatus: hub.visaStatus,
        visaNote: hub.visaNote,
        baggageRecheck: false
      }
    }
    if (connectivity.validateItinerary(option.segments, { transferType: 'airline', requireKnown: true }).valid) {
      airlineTransfer.push(option)
    }
  })

  const result: ComboResult = { direct, selfTransfer, airlineTransfer }
  if (comboCache.size > 800) comboCache.clear()
  comboCache.set(cacheKey, result)
  return result
}

/** 出发窗口全量日期（含端点，最多 31 天防止窗口过大） */
function allDates(start: string, end: string, cap = 31): string[] {
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end || start}T00:00:00`)
  const total = Math.min(cap - 1, Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000)))
  const dates: string[] = []
  for (let i = 0; i <= total; i++) {
    const d = new Date(s)
    d.setDate(d.getDate() + i)
    const p = (n: number) => String(n).padStart(2, '0')
    dates.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
  }
  return dates
}

// ---------- 价差矩阵：机场 × 日期 每格最低价 ----------
export interface PriceMatrixData {
  origins: string[]
  dates: string[]
  /** cells[日期行][机场列] = 该组合全类型最低价 */
  cells: number[][]
}

/** 与 mockSearch 同种子，保证矩阵价格与结果列表一致；格内取到达圈最低价。
 * 全量扫描窗口内每一天，展示层只保留最便宜的 6 天（按日期排序） */
export function buildPriceMatrix(params: SearchParams): PriceMatrixData {
  const origins = params.originCandidates?.length ? params.originCandidates : [params.origin]
  const dests = params.destinationCandidates?.length ? params.destinationCandidates : [params.destination]
  const dates = allDates(params.departDate, params.departDateEnd ?? params.departDate)
  const seedExtra = params.stayRange ? `-stay${params.stayRange[0]}-${params.stayRange[1]}` : ''

  const rows = dates.map(date => ({
    date,
    cells: origins.map(o => {
      let min = Infinity
      for (const d of dests) {
        const r = comboSearch(o, d, date, seedExtra)
        const all = [...r.direct, ...r.selfTransfer, ...r.airlineTransfer]
        min = Math.min(min, ...all.map(f => f.totalPrice))
      }
      return min
    })
  }))

  // 展示行：≤6 天全部展示；否则挑行最低价最便宜的 6 天，直接回答“哪天最便宜”
  let show = rows
  if (rows.length > 6) {
    show = [...rows]
      .sort((a, b) => Math.min(...a.cells) - Math.min(...b.cells))
      .slice(0, 6)
      .sort((a, b) => a.date.localeCompare(b.date))
  }
  return { origins, dates: show.map(r => r.date), cells: show.map(r => r.cells) }
}

// ---------- Mock 搜索：出发圈 × 到达圈 × 日期窗口 整体定价 ----------
function mockSearch(params: SearchParams): SearchResponse {
  const origins = params.originCandidates?.length ? params.originCandidates : [params.origin]
  const dests = params.destinationCandidates?.length ? params.destinationCandidates : [params.destination]
  // 全量扫描窗口内每一天（不再采样，避免漏掉低价日）；组合结果由 comboCache 去重
  const dates = allDates(params.departDate, params.departDateEnd ?? params.departDate)
  // 往返时游玩天数区间参与定价种子（不同回程组合 → 不同票价）
  const seedExtra = params.stayRange ? `-stay${params.stayRange[0]}-${params.stayRange[1]}` : ''

  const allDirect: FlightOption[] = []
  const allSelf: FlightOption[] = []
  const allAirline: FlightOption[] = []

  // 遍历出发机场×落地机场×日期组合矩阵
  for (const o of origins) {
    for (const d of dests) {
      for (const date of dates) {
        const r = comboSearch(o, d, date, seedExtra)
        allDirect.push(...r.direct)
        allSelf.push(...r.selfTransfer)
        allAirline.push(...r.airlineTransfer)
      }
    }
  }

  const byPrice = (a: FlightOption, b: FlightOption) => a.totalPrice - b.totalPrice

  // 自行中转：每个 Hub 只保留全局最便宜的组合
  const bestPerHub = new Map<string, FlightOption>()
  for (const f of allSelf) {
    const key = f.hub!.iata
    if (!bestPerHub.has(key) || f.totalPrice < bestPerHub.get(key)!.totalPrice) {
      bestPerHub.set(key, f)
    }
  }

  return {
    direct: allDirect.sort(byPrice).slice(0, 3),
    selfTransfer: sortByRecommendation([...bestPerHub.values()], params.transitCountryPreferences).slice(0, 4),
    airlineTransfer: sortByRecommendation(allAirline, params.transitCountryPreferences).slice(0, 3),
    metadata: {
      searchId: `mock-${Date.now()}`,
      cacheTime: new Date().toISOString(),
      priceDisclaimer: '价格仅供参考，以实际购买为准',
      connectivityVersion: connectivity.TOPOLOGY_VERSION,
      connectivityEdges: connectivity.edgeCount()
    }
  }
}

// ---------- Mock 价格趋势 ----------
function mockPriceTrend(origin: string, destination: string): PriceTrendResponse {
  const rand = seedOf(`trend-${origin}-${destination}`)
  const base = 3000 + Math.round(rand() * 2500)
  const history: PriceTrendResponse['history'] = []
  let min = Infinity
  let minIdx = 0
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    // 周期波动 + 随机噪声
    const price = Math.round(base * (1 + 0.18 * Math.sin((29 - i) / 4.5) + (rand() - 0.5) * 0.16))
    if (price < min) {
      min = price
      minIdx = history.length
    }
    const p = (n: number) => String(n).padStart(2, '0')
    history.push({ date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, price })
  }
  history[minIdx].isLowest = true
  const prices = history.map(h => h.price)
  const current = prices[prices.length - 1]
  const avg30d = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length)
  const max30d = Math.max(...prices)
  const percentile = Math.round(((current - min) / (max30d - min || 1)) * 100)
  const signal = percentile <= 30 ? 'buy' : percentile >= 70 ? 'wait' : 'neutral'

  return {
    route: { origin, destination },
    history,
    statistics: { current, avg30d, min30d: min, max30d, percentile },
    signal,
    bestBookingWindow: { daysBeforeDeparture: [45, 75] }
  }
}

// ---------- 对外服务 ----------
export async function searchFlights(params: SearchParams): Promise<SearchResponse> {
  // 本地仿真数据只由显式构建开关启用。
  if (USE_MOCK) {
    // 模拟网络延迟，保留 loading 体验
    await new Promise(r => setTimeout(r, 600))
    return mockSearch(params)
  }

  // 生产通道：自建后端持有 SerpApi 密钥并缓存结果。
  return request<SearchResponse>({
    url: '/v1/flight-searches',
    method: 'POST',
    data: {
      origin: params.origin,
      origin_candidates: params.originCandidates,
      destination: params.destination,
      destination_candidates: params.destinationCandidates,
      depart_date: params.departDate,
      depart_date_end: params.departDateEnd,
      stay_range: params.stayRange,
      transit_country_preferences: params.transitCountryPreferences,
      currency: 'CNY'
    },
    showLoading: true,
    loadingText: '正在计算最优航线…',
    timeout: 30000, // 实时报价矩阵需多次供应商查询，放宽超时
    retry: 0 // 搜索失败直接降级，避免双倍等待
  })
}

export async function fetchPriceTrend(origin: string, destination: string): Promise<PriceTrendResponse> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 300))
    return mockPriceTrend(origin, destination)
  }
  return request<PriceTrendResponse>({ url: `/price/trend?origin=${origin}&destination=${destination}` })
}

/**
 * 收藏方案的「今日复核价」：以方案ID+今日日期为种子，
 * 围绕收藏价 ±8% 波动（Mock 模拟市场浮动；同一天内结果稳定）
 */
export function currentPriceOf(flightId: string, savedPrice: number): number {
  const rand = seedOf(`track-${flightId}-${toDateString(new Date())}`)
  const delta = (rand() - 0.5) * 0.16
  return Math.round(savedPrice * (1 + delta))
}
