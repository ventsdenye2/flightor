// cloud/searchProxy/serpapi.js — SerpApi（Google Flights）搜索与结果映射
// 与 duffel.js 同构的适配器：search(apiKey, params) → SearchResponse 形状
// 优势：departure_id/arrival_id 原生支持逗号分隔多机场 → 每次搜索仅消耗「采样日期数」次配额
//      currency=CNY 原生返回人民币，无需汇率换算
// 配额：免费档 250 次/月，单次搜索 ≤4 次调用；进程内缓存 30min + 每日配额守卫
const SERPAPI_BASE = 'https://serpapi.com/search.json'

const MAX_DATES = 4 // 采样日期数 = 每次搜索的配额消耗
const CONCURRENCY = 3 // 实测单次抓取约 10s，并发 3 控制总耗时 <15s
const CACHE_TTL = 30 * 60 * 1000
// 每日调用守卫：免费档 250 次/月 ≈ 8 次/天，付费套餐可通过环境变量调大
const DAILY_QUOTA_CAP = Number(process.env.DAILY_QUOTA_CAP) || 30

// 进程内缓存（云函数实例热复用期间有效）
const cache = new Map()
function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) { cache.delete(key); return null }
  return hit.data
}
function cacheSet(key, data) {
  if (cache.size > 200) cache.clear()
  cache.set(key, { at: Date.now(), data })
}

// 每日配额计数（实例重启清零，防呆不防精确；精确用量以 SerpApi 后台为准）
let quotaDay = ''
let quotaUsed = 0
function quotaTake(n) {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== quotaDay) { quotaDay = today; quotaUsed = 0 }
  if (quotaUsed + n > DAILY_QUOTA_CAP) {
    const err = new Error('daily quota exceeded')
    err.code = 'QUOTA'
    throw err
  }
  quotaUsed += n
  return quotaUsed
}

/** 出发窗口内均匀采样 ≤ MAX_DATES 天 */
function sampleDates(from, to) {
  const start = new Date(from)
  const end = new Date(to || from)
  const days = Math.max(0, Math.round((end - start) / 86400000))
  const n = Math.min(days + 1, MAX_DATES)
  const dates = []
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + Math.round((days * i) / Math.max(1, n - 1)) * 86400000)
    dates.push(d.toISOString().slice(0, 10))
  }
  return [...new Set(dates)]
}

/** 简单并发池 */
async function pool(tasks, size) {
  const results = new Array(tasks.length)
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker))
  return results
}

/** Google Flights 单日查询（多机场一次传入）；type: 1=往返 2=单程 */
async function flightSearch(apiKey, { origins, destinations, date, returnDate }) {
  const qs = new URLSearchParams({
    engine: 'google_flights',
    departure_id: origins.join(','),
    arrival_id: destinations.join(','),
    outbound_date: date,
    currency: 'CNY',
    hl: 'zh-cn',
    gl: 'cn',
    adults: '1',
    type: returnDate ? '1' : '2',
    api_key: apiKey
  })
  if (returnDate) qs.set('return_date', returnDate)
  const res = await fetch(`${SERPAPI_BASE}?${qs}`)
  if (!res.ok) throw new Error(`serpapi ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(`serpapi: ${json.error}`)
  return [...(json.best_flights ?? []), ...(json.other_flights ?? [])]
}

function mapSegment(f) {
  return {
    flightNo: f.flight_number ?? '',
    airline: f.airline ?? '',
    origin: f.departure_airport?.id,
    destination: f.arrival_airport?.id,
    departTime: f.departure_airport?.time,
    arriveTime: f.arrival_airport?.time,
    duration: Number(f.duration) || 0, // Google Flights duration 直接是分钟
    aircraft: f.airplane
  }
}

/** Google Flights itinerary → 前端 FlightOption */
function mapItinerary(it, query) {
  const segments = (it.flights ?? []).map(mapSegment)
  if (segments.length === 0 || !Number(it.price)) return null
  const option = {
    id: `gf-${query.date}-${segments.map(s => s.flightNo).join('-')}-${it.price}`,
    segments,
    totalPrice: Math.round(Number(it.price)), // 已是人民币
    totalDuration: Number(it.total_duration) || segments.reduce((sum, s) => sum + s.duration, 0),
    airline: [...new Set(segments.map(s => s.airline))].join(' + '),
    transferType: segments.length === 1 ? 'direct' : 'airline',
    departDate: query.date,
    deepLink:
      `https://www.google.com/travel/flights?q=flights+from+${query.origins[0]}+to+${query.destinations[0]}+on+${query.date}` +
      (query.returnDate ? `+returning+${query.returnDate}` : '')
  }
  const layover = (it.layovers ?? [])[0]
  if (segments.length > 1 && layover) {
    option.hub = {
      iata: layover.id ?? segments[0].destination,
      city: layover.name ?? '',
      layoverMinutes: Number(layover.duration) || 0
    }
  }
  return option
}

/**
 * 矩阵搜索：多机场原生合并 → 仅按采样日期多次调用（≤ MAX_DATES 次/搜索）
 */
async function search(apiKey, params) {
  const {
    origin, destination,
    originCandidates = [origin],
    destCandidates = [destination],
    dateFrom, dateTo, stayRange
  } = params
  const origins = originCandidates.slice(0, 3)
  const destinations = destCandidates.slice(0, 3)

  const cacheKey = JSON.stringify([origins, destinations, dateFrom, dateTo, stayRange])
  const hit = cacheGet(cacheKey)
  if (hit) return { ...hit, metadata: { ...hit.metadata, cacheHit: true } }

  const dates = sampleDates(dateFrom, dateTo)
  const stayMid = Array.isArray(stayRange) ? Math.round((stayRange[0] + stayRange[1]) / 2) : 0
  quotaTake(dates.length) // 配额守卫：超出日上限直接抛错

  const tasks = dates.map(date => async () => {
    const returnDate = stayMid
      ? new Date(new Date(date).getTime() + stayMid * 86400000).toISOString().slice(0, 10)
      : undefined
    try {
      const flights = await flightSearch(apiKey, { origins, destinations, date, returnDate })
      return flights.map(f => mapItinerary(f, { origins, destinations, date, returnDate })).filter(Boolean)
    } catch (e) {
      return { error: e.message, date }
    }
  })

  const results = await pool(tasks, CONCURRENCY)
  const options = []
  const failures = []
  for (const r of results) {
    if (Array.isArray(r)) options.push(...r)
    else if (r) failures.push(r)
  }
  if (options.length === 0 && failures.length > 0) {
    const err = new Error(failures[0].error)
    err.failures = failures.length
    throw err
  }

  // 去重并按价排序
  const seen = new Set()
  const unique = options.filter(o => {
    const key = `${o.segments.map(s => s.flightNo + s.departTime).join('-')}|${o.totalPrice}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => a.totalPrice - b.totalPrice)

  const data = {
    direct: unique.filter(o => o.transferType === 'direct').slice(0, 20),
    selfTransfer: unique.filter(o => o.transferType === 'self').slice(0, 20),
    airlineTransfer: unique.filter(o => o.transferType === 'airline').slice(0, 20),
    metadata: {
      searchId: `gf-${Date.now()}`,
      cacheTime: new Date().toISOString(),
      priceDisclaimer: 'Google Flights 实时报价（人民币），以实际购买为准',
      provider: 'serpapi',
      scanned: dates.length,
      quotaUsedToday: quotaUsed
    }
  }
  cacheSet(cacheKey, data)
  return data
}

module.exports = { search, flightSearch, sampleDates }
