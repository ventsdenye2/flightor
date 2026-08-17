// cloud/searchProxy/duffel.js — Duffel 搜索与结果映射（纯逻辑，不依赖 wx-server-sdk，可本地单测）
// 说明：Duffel offer_request = 单航线×单日查询；前端的「机场圈×日期窗口」矩阵
//      在此拆为受控并发的多次调用（cap 12、并发 4、进程内缓存 30min）
const DUFFEL_BASE = 'https://api.duffel.com'
const DUFFEL_VERSION = 'v2'

// 组合爆炸控制：矩阵最多 8 个 offer_request（实测单请求数秒，控制云端总耗时 <15s）
const MAX_REQUESTS = 8
const MAX_DATES = 4
const CONCURRENCY = 6
const SUPPLIER_TIMEOUT = 4000
const CACHE_TTL = 30 * 60 * 1000

// Duffel 返回航司定价货币，前端统一展示人民币 → 静态汇率换算（约值，价格仅供参考）
const CNY_RATE = {
  CNY: 1, USD: 7.1, EUR: 7.8, GBP: 9.1, HKD: 0.91, SGD: 5.3, JPY: 0.048,
  KRW: 0.0052, AUD: 4.7, NZD: 4.2, THB: 0.2, MYR: 1.5, AED: 1.93, QAR: 1.95,
  SAR: 1.89, TRY: 0.21, VND: 0.00028, IDR: 0.00044, PHP: 0.12, CAD: 5.2
}
const toCny = (amount, currency) => Math.round(Number(amount) * (CNY_RATE[currency] ?? 7.1))

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

/** ISO8601 时长（PT13H30M）→ 分钟 */
function isoDurationToMin(iso) {
  if (!iso) return 0
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso)
  if (!m) return 0
  return (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)
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

/** 单次 offer_request（含 429/5xx 一次退避重试） */
async function offerRequest(token, { origin, destination, date, returnDate, cabin = 'economy' }) {
  const slices = [{ origin, destination, departure_date: date }]
  if (returnDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate })
  const body = {
    data: {
      slices,
      passengers: [{ type: 'adult' }],
      cabin_class: cabin,
      max_connections: 2
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      `${DUFFEL_BASE}/air/offer_requests?return_offers=true&supplier_timeout=${SUPPLIER_TIMEOUT}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Duffel-Version': DUFFEL_VERSION,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip'
        },
        body: JSON.stringify(body)
      }
    )
    if (res.ok) return (await res.json()).data
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise(r => setTimeout(r, 1200))
      continue
    }
    throw new Error(`duffel ${res.status}`)
  }
  throw new Error('duffel retry exhausted')
}

function mapSegment(s) {
  const carrier = s.marketing_carrier?.iata_code ?? s.operating_carrier?.iata_code ?? ''
  return {
    flightNo: `${carrier}${s.marketing_carrier_flight_number ?? ''}`,
    airline: s.operating_carrier?.name ?? s.marketing_carrier?.name ?? carrier,
    origin: s.origin?.iata_code,
    destination: s.destination?.iata_code,
    departTime: s.departing_at,
    arriveTime: s.arriving_at,
    duration: isoDurationToMin(s.duration),
    aircraft: s.aircraft?.name
  }
}

/** Duffel offer → 前端 FlightOption；outbound 取 slices[0]，回程价已含在总价中 */
function mapOffer(offer, query) {
  const outbound = offer.slices?.[0]
  if (!outbound || (outbound.segments ?? []).length === 0) return null
  const segments = outbound.segments.map(mapSegment)
  const transferType = segments.length === 1 ? 'direct' : 'airline' // Duffel 均为航司联程票，无虚拟中转
  const option = {
    id: `duffel-${offer.id}`,
    segments,
    totalPrice: toCny(offer.total_amount, offer.total_currency),
    totalDuration: isoDurationToMin(outbound.duration) || segments.reduce((sum, s) => sum + s.duration, 0),
    airline: offer.owner?.name ?? segments[0].airline,
    transferType,
    departDate: query.date,
    originUsed: query.origin,
    destinationUsed: query.destination,
    deepLink:
      `https://www.google.com/travel/flights?q=flights+from+${query.origin}+to+${query.destination}+on+${query.date}` +
      (query.returnDate ? `+returning+${query.returnDate}` : '')
  }
  if (segments.length > 1) {
    const first = outbound.segments[0]
    const second = outbound.segments[1]
    option.hub = {
      iata: first.destination?.iata_code,
      city: first.destination?.city_name ?? first.destination?.iata_city_code ?? '',
      layoverMinutes: Math.round((new Date(second.departing_at) - new Date(first.arriving_at)) / 60000)
    }
  }
  return option
}

/**
 * 矩阵搜索：originCandidates × destCandidates × 采样日期
 * 主机场对优先，超出 MAX_REQUESTS 的组合截断
 */
async function searchMatrix(token, params) {
  const {
    origin, destination,
    originCandidates = [origin],
    destCandidates = [destination],
    dateFrom, dateTo, stayRange
  } = params

  const dates = sampleDates(dateFrom, dateTo)
  const combos = []
  originCandidates.slice(0, 3).forEach((o, oi) => {
    destCandidates.slice(0, 3).forEach((d, di) => {
      if (o === d) return
      dates.forEach((date, ti) => combos.push({ origin: o, destination: d, date, rank: oi + di + ti * 0.1 }))
    })
  })
  combos.sort((a, b) => a.rank - b.rank)
  const picked = combos.slice(0, MAX_REQUESTS)

  const stayMid = Array.isArray(stayRange) ? Math.round((stayRange[0] + stayRange[1]) / 2) : 0
  const tasks = picked.map(q => async () => {
    const returnDate = stayMid
      ? new Date(new Date(q.date).getTime() + stayMid * 86400000).toISOString().slice(0, 10)
      : undefined
    try {
      const data = await offerRequest(token, { ...q, returnDate })
      return (data.offers ?? [])
        .map(o => mapOffer(o, { ...q, returnDate }))
        .filter(Boolean)
    } catch (e) {
      return { error: e.message, query: q }
    }
  })

  const results = await pool(tasks, CONCURRENCY)
  const options = []
  const failures = []
  for (const r of results) {
    if (Array.isArray(r)) options.push(...r)
    else if (r) failures.push(r)
  }
  return { options, failures, scanned: picked.length, combos: combos.length }
}

/** 对外：执行搜索（带缓存），返回 SearchResponse 形状 */
async function search(token, params) {
  const cacheKey = JSON.stringify([
    params.origin, params.destination, params.originCandidates, params.destCandidates,
    params.dateFrom, params.dateTo, params.stayRange
  ])
  const hit = cacheGet(cacheKey)
  if (hit) return { ...hit, metadata: { ...hit.metadata, cacheHit: true } }

  const { options, failures, scanned, combos } = await searchMatrix(token, params)
  if (options.length === 0 && failures.length > 0) {
    const err = new Error(failures[0].error)
    err.failures = failures.length
    throw err
  }

  // 去重（同航司+同航段组合+同日期）并按价排序
  const seen = new Set()
  const unique = options.filter(o => {
    const key = `${o.airline}|${o.segments.map(s => s.flightNo + s.departTime).join('-')}|${o.totalPrice}`
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
      searchId: `duffel-${Date.now()}`,
      cacheTime: new Date().toISOString(),
      priceDisclaimer: '实时报价按约值汇率换算为人民币，以实际购买为准',
      scanned,
      combos
    }
  }
  cacheSet(cacheKey, data)
  return data
}

module.exports = { search, offerRequest, sampleDates, isoDurationToMin, toCny }
