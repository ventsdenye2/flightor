// cloud/searchProxy/serpapi.js — SerpApi（Google Flights）搜索与结果映射
// 与 duffel.js 同构的适配器：search(apiKey, params) → SearchResponse 形状
// 优势：departure_id/arrival_id 原生支持逗号分隔多机场 → 每次搜索仅消耗「采样日期数」次配额
//      currency=CNY 原生返回人民币，无需汇率换算
// 配额：免费档 250 次/月，单次搜索 ≤4 次调用；日期粒度缓存（窗口平移仅补查新日期）+ 每日配额守卫
// HTTP 层可注入（opts.fetchJson）：云函数默认 node fetch，小程序端传 Taro.request 实现
// 持久层可注入（opts.storage）：小程序端传 Taro 本地缓存，跨会话保留报价快照
const SERPAPI_BASE = 'https://serpapi.com/search.json'

const MAX_DATES = 4 // 采样日期数 = 每次搜索的配额消耗
const CONCURRENCY = 3 // 实测单次抓取约 10s，并发 3 控制总耗时 <15s
const DATE_CACHE_TTL = 6 * 60 * 60 * 1000 // 日期粒度缓存 6h：同航线重复搜索 0 配额
// 每日调用守卫默认值：免费档 250 次/月 ≈ 8 次/天；云函数可用环境变量 DAILY_QUOTA_CAP 调大
// （process 访问带保护：小程序环境无 process 全局）
function defaultQuotaCap() {
  if (typeof process !== 'undefined' && process.env && process.env.DAILY_QUOTA_CAP) {
    return Number(process.env.DAILY_QUOTA_CAP) || 100
  }
  return 100
}

// 默认 HTTP 实现：node 18+ fetch（仅云函数/本地脚本调用，前端不走这里）
async function nodeFetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`serpapi ${res.status}`)
  return res.json()
}

/** 查询串拼接（两端通用，不依赖 URLSearchParams） */
function buildQuery(params) {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== '')
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
}

// 日期粒度缓存：key = OD 对 + 出发日 + 停留天数，value = 该日的方案列表
// 窗口平移时旧日期继续复用，仅新增日期消耗配额
const dateCache = new Map()
function dateKey({ origins, destinations, date, stayMid }) {
  return `${origins.join(',')}|${destinations.join(',')}|${date}|${stayMid}`
}
function dateCacheGet(key) {
  const hit = dateCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > DATE_CACHE_TTL) { dateCache.delete(key); return null }
  return hit.data
}
function dateCacheSet(key, data) {
  if (dateCache.size > 500) {
    // 淘汰最旧条目（容量保护）
    const oldest = [...dateCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100)
    oldest.forEach(([k]) => dateCache.delete(k))
  }
  dateCache.set(key, { at: Date.now(), data })
}

// 每日配额计数（实例重启清零，防呆不防精确；精确用量以 SerpApi 后台为准）
let quotaDay = ''
let quotaUsed = 0
function quotaTake(n, cap) {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== quotaDay) { quotaDay = today; quotaUsed = 0 }
  if (quotaUsed + n > cap) {
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
async function flightSearch(apiKey, { origins, destinations, date, returnDate }, fetchJson = nodeFetchJson) {
  const qs = buildQuery({
    engine: 'google_flights',
    departure_id: origins.join(','),
    arrival_id: destinations.join(','),
    outbound_date: date,
    return_date: returnDate,
    currency: 'CNY',
    hl: 'zh-cn',
    gl: 'cn',
    adults: '1',
    type: returnDate ? '1' : '2',
    api_key: apiKey
  })
  const json = await fetchJson(`${SERPAPI_BASE}?${qs}`)
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
 * 日期粒度缓存：已缓存日期 0 配额直出，仅对缺失日期发起请求
 * opts.fetchJson：HTTP 实现注入（默认 node fetch）；opts.quotaCap：每日配额上限
 * opts.storage：持久缓存注入 { get():object, set(obj) }，小程序端跨会话生效
 */
async function search(apiKey, params, opts = {}) {
  const fetchJson = opts.fetchJson || nodeFetchJson
  const quotaCap = opts.quotaCap || defaultQuotaCap()
  const storage = opts.storage || null
  const {
    origin, destination,
    originCandidates = [origin],
    destCandidates = [destination],
    dateFrom, dateTo, stayRange
  } = params
  const origins = originCandidates.slice(0, 3)
  const destinations = destCandidates.slice(0, 3)

  // 启动时合并持久层快照进内存（仅一次）
  if (storage && !storageLoaded) {
    storageLoaded = true
    try {
      const persisted = storage.get() || {}
      Object.entries(persisted).forEach(([k, v]) => { if (v && v.at && Array.isArray(v.data)) dateCache.set(k, v) })
    } catch (e) { /* 持久层读取失败不影响主流程 */ }
  }

  const dates = sampleDates(dateFrom, dateTo)
  const stayMid = Array.isArray(stayRange) ? Math.round((stayRange[0] + stayRange[1]) / 2) : 0

  // 逐日期查缓存，分离命中与缺失
  const cachedOptions = []
  const missingDates = []
  for (const date of dates) {
    const hit = dateCacheGet(dateKey({ origins, destinations, date, stayMid }))
    if (hit) cachedOptions.push(...hit)
    else missingDates.push(date)
  }
  if (missingDates.length === 0) {
    return buildResponse(cachedOptions, dates.length, 0, true)
  }

  quotaTake(missingDates.length, quotaCap) // 配额守卫：只计缺失日期数

  const tasks = missingDates.map(date => async () => {
    const returnDate = stayMid
      ? new Date(new Date(date).getTime() + stayMid * 86400000).toISOString().slice(0, 10)
      : undefined
    try {
      const flights = await flightSearch(apiKey, { origins, destinations, date, returnDate }, fetchJson)
      const mapped = flights.map(f => mapItinerary(f, { origins, destinations, date, returnDate })).filter(Boolean)
      dateCacheSet(dateKey({ origins, destinations, date, stayMid }), mapped)
      return mapped
    } catch (e) {
      return { error: e.message, date }
    }
  })

  const results = await pool(tasks, CONCURRENCY)
  const freshOptions = []
  const failures = []
  for (const r of results) {
    if (Array.isArray(r)) freshOptions.push(...r)
    else if (r) failures.push(r)
  }
  const allOptions = [...cachedOptions, ...freshOptions]
  if (allOptions.length === 0 && failures.length > 0) {
    const err = new Error(failures[0].error)
    err.failures = failures.length
    throw err
  }

  const data = buildResponse(allOptions, dates.length, missingDates.length, false)

  // 持久化快照（小程序跨会话）
  if (storage) {
    try {
      const snap = {}
      dateCache.forEach((v, k) => { snap[k] = v })
      storage.set(snap)
    } catch (e) { /* 写入失败静默，不影响本次结果 */ }
  }
  return data
}

/** 汇总：去重、按价排序、分桶截断、附 metadata */
function buildResponse(options, scanned, fetched, fullyCached) {
  const seen = new Set()
  const unique = options.filter(o => {
    const key = `${o.segments.map(s => s.flightNo + s.departTime).join('-')}|${o.totalPrice}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => a.totalPrice - b.totalPrice)
  return {
    direct: unique.filter(o => o.transferType === 'direct').slice(0, 20),
    selfTransfer: unique.filter(o => o.transferType === 'self').slice(0, 20),
    airlineTransfer: unique.filter(o => o.transferType === 'airline').slice(0, 20),
    metadata: {
      searchId: `gf-${Date.now()}`,
      cacheTime: new Date().toISOString(),
      priceDisclaimer: 'Google Flights 实时报价（人民币），以实际购买为准',
      provider: 'serpapi',
      scanned,
      fetched,
      cacheHit: fullyCached,
      quotaUsedToday: quotaUsed
    }
  }
}

// 持久层是否已加载（进程/会话内只读一次）
let storageLoaded = false

module.exports = { search, flightSearch, sampleDates }
