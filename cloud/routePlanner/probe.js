// cloud/routePlanner/probe.js — 真实价格探测（P2）
// 职责：对收敛出的推荐路线逐段探测真实报价，替换 mock 价格
// 配额策略：搜索阶段用估算价（0 配额）；只对最终推荐路线的段做单程精确探测
//           单条路线 ≤ 8 段 = ≤ 8 次 SerpApi 调用；探测失败逐段降级为估算价
// 注意：云函数按目录独立部署，不跨目录引用 searchProxy，单点查询内联实现
const { isNightLeg } = require('./engine')

const SERPAPI_BASE = 'https://serpapi.com/search.json'
const PROBE_CONCURRENCY = 3

/** 查询串拼接（不依赖 URLSearchParams） */
function buildQuery(params) {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== '')
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
}

async function nodeFetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`serpapi ${res.status}`)
  return res.json()
}

/** Google Flights 单程单点查询（type=2） */
async function gfOneWay(apiKey, fromIata, toIata, date, fetchJson = nodeFetchJson) {
  const qs = buildQuery({
    engine: 'google_flights',
    departure_id: fromIata,
    arrival_id: toIata,
    outbound_date: date,
    currency: 'CNY',
    hl: 'zh-cn',
    gl: 'cn',
    adults: '1',
    type: '2',
    api_key: apiKey
  })
  const json = await fetchJson(`${SERPAPI_BASE}?${qs}`)
  if (json.error) throw new Error(`serpapi: ${json.error}`)
  return [...(json.best_flights ?? []), ...(json.other_flights ?? [])]
}

/** SerpApi itinerary → 引擎段格式（含真实起降时刻，夜航判定直接生效） */
function mapItineraryToLeg(it, fromIata, toIata, date) {
  const flights = it.flights ?? []
  const price = Math.round(Number(it.price))
  if (flights.length === 0 || !price) return null
  const first = flights[0]
  const last = flights[flights.length - 1]
  const departTime = first.departure_airport?.time || '' // "2026-09-01 22:30"
  const arriveTime = last.arrival_airport?.time || ''
  const crossDay = arriveTime.slice(0, 10) > departTime.slice(0, 10)
  return {
    from: fromIata,
    to: toIata,
    date,
    departTime: departTime.slice(11, 16),
    arriveTime: arriveTime.slice(11, 16),
    crossDay,
    duration: Number(it.total_duration) || 0,
    price,
    airline: [...new Set(flights.map(f => f.airline).filter(Boolean))].join(' + '),
    flightNo: flights.map(f => f.flight_number).filter(Boolean).join(' + '),
    stops: flights.length - 1,
    real: true
  }
}

/**
 * 探测单个 OD+日期的真实航班段
 * @returns 段数组（按价升序，≤3 条）；探测失败返回 []（调用方降级为 mock）
 */
async function probeLegs(apiKey, fromIata, toIata, date, opts = {}) {
  try {
    const flights = await gfOneWay(apiKey, fromIata, toIata, date, opts.fetchJson)
    return flights
      .map(it => mapItineraryToLeg(it, fromIata, toIata, date))
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3)
  } catch (e) {
    return [] // 单段失败不阻断整体，由调用方降级
  }
}

/**
 * 对一条推荐路线做真实价格确认
 * @param apiKey SerpApi key
 * @param pick convergeRoutes 输出的单条推荐（含 legs）
 * @param opts { fetchJson?: 注入 HTTP 实现, maxCalls?: 本次探测配额上限（默认 8） }
 * @returns { route: 重算后的路线（totalPrice/nightsSaved 用真实价）, probed: 真实探测成功的段数, failed: 降级段数 }
 */
async function confirmPickRoute(apiKey, pick, opts = {}) {
  const maxCalls = opts.maxCalls != null ? opts.maxCalls : 8
  const tasks = pick.route.legs.slice(0, maxCalls).map(leg => async () => {
    const real = await probeLegs(apiKey, leg.from, leg.to, leg.date, opts)
    return real[0] || null
  })
  // 简单并发池
  const results = new Array(tasks.length)
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, tasks.length) }, worker))

  let probed = 0
  const realLegs = pick.route.legs.map((leg, i) => {
    if (results[i]) {
      probed++
      return results[i]
    }
    return { ...leg, real: false } // 探测失败保留估算价并标记
  })
  const totalPrice = realLegs.reduce((sum, l) => sum + l.price, 0)
  const nightsSaved = realLegs.filter(isNightLeg).length
  return {
    route: { ...pick.route, legs: realLegs, totalPrice, nightsSaved },
    kind: pick.kind,
    probed,
    failed: realLegs.length - probed,
    note: probed < realLegs.length
      ? `其中 ${realLegs.length - probed} 段为估算价（探测失败）`
      : '全部航段为实时报价'
  }
}

module.exports = { probeLegs, confirmPickRoute, mapItineraryToLeg }
