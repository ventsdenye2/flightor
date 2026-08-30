// cloud/searchProxy — 搜索代理云函数
// 数据源（SEARCH_PROVIDER 切换，默认 serpapi）：
//   serpapi — SerpApi Google Flights（多机场原生支持，人民币原生返回；免费 250 次/月）
//   duffel  — Duffel offer_requests（live token 需 Stripe 商户验证；test token 为虚拟数据）
// 环境变量：SEARCH_PROVIDER(serpapi|duffel) / SERPAPI_KEY / DUFFEL_TOKEN
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const PROVIDER = process.env.SEARCH_PROVIDER || 'serpapi'
const { search } = require(PROVIDER === 'duffel' ? './duffel' : './serpapi')
const connectivity = require('./connectivity')
const oag = require('./oag')
const OAG_CACHE_TTL = 6 * 60 * 60 * 1000
const oagConnectivityCache = new Map()

function readOagCache(key) {
  const hit = oagConnectivityCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > OAG_CACHE_TTL) {
    oagConnectivityCache.delete(key)
    return null
  }
  return hit.data
}

function writeOagCache(key, data) {
  if (oagConnectivityCache.size >= 200) {
    const oldestKey = oagConnectivityCache.keys().next().value
    oagConnectivityCache.delete(oldestKey)
  }
  oagConnectivityCache.set(key, { at: Date.now(), data })
}

exports.main = async event => {
  // 无需消耗报价配额的预检：返回直飞状态与最多两次中转的简单路径。
  if (event.action === 'connectivity') {
    const { origin, destination, date, max_transfers: maxTransfers } = event
    if (!origin || !destination) return { statusCode: 400, body: { message: 'missing origin/destination' } }
    let oagMetadata = null
    if (event.live === true) {
      if (!date) return { statusCode: 400, body: { message: 'date is required for live OAG connectivity' } }
      const schedulesKey = process.env.OAG_SCHEDULES_KEY
      const connectionsKey = process.env.OAG_CONNECTIONS_KEY || process.env.OAG_FLIGHT_INFO_KEY
      if (!schedulesKey && !connectionsKey) {
        return { statusCode: 500, body: { message: 'missing OAG_SCHEDULES_KEY/OAG_FLIGHT_INFO_KEY' } }
      }
      try {
        const cacheKey = `${String(origin).toUpperCase()}|${String(destination).toUpperCase()}|${date}`
        const cached = readOagCache(cacheKey)
        const [scheduleResult, connectionResult] = cached || await Promise.all([
          schedulesKey ? oag.schedules(
            schedulesKey,
            { origin, destination, dateFrom: date, dateTo: date },
            { path: process.env.OAG_SCHEDULES_PATH || undefined }
          ) : Promise.resolve({ edges: [] }),
          connectionsKey ? oag.connections(
            connectionsKey,
            { origin, destination, dateFrom: date, dateTo: date },
            { path: process.env.OAG_CONNECTIONS_PATH || undefined }
          ) : Promise.resolve({ connections: [] })
        ])
        if (!cached) writeOagCache(cacheKey, [scheduleResult, connectionResult])
        const oagEdges = [
          ...scheduleResult.edges,
          ...connectionResult.connections.flatMap(connection => connection.edges)
        ]
        oagEdges.forEach(connectivity.addEdge)
        oagMetadata = {
          schedules: scheduleResult.edges.length,
          connections: connectionResult.connections.length,
          edgesObserved: oagEdges.length,
          cacheHit: Boolean(cached)
        }
      } catch (err) {
        return { statusCode: 502, body: { message: err.message } }
      }
    }
    const paths = connectivity.findPaths(origin, destination, date, { maxTransfers })
    return {
      origin,
      destination,
      date: date || null,
      direct: connectivity.routeStatus(origin, destination, date),
      paths: paths.slice(0, 50).map(airports => ({ airports, transfers: airports.length - 2 })),
      truncated: paths.length > 50,
      topologyVersion: connectivity.TOPOLOGY_VERSION,
      topologyEdges: connectivity.edgeCount(),
      topologyAirports: connectivity.airportCount(),
      oag: oagMetadata
    }
  }

  if (event.action === 'airport_metadata') {
    const token = process.env.OAG_MASTER_DATA_KEY
    if (!token) return { statusCode: 500, body: { message: 'missing OAG_MASTER_DATA_KEY' } }
    try {
      return await oag.locations(
        token,
        {
          airportCode: event.airport_code,
          countryCode: event.country_code,
          cityCode: event.city_code,
          limit: event.limit
        },
        { path: process.env.OAG_LOCATIONS_PATH || undefined }
      )
    } catch (err) {
      return { statusCode: 502, body: { message: err.message } }
    }
  }

  if (event.action === 'flight_info') {
    const token = process.env.OAG_FLIGHT_INFO_KEY
    if (!token) return { statusCode: 500, body: { message: 'missing OAG_FLIGHT_INFO_KEY' } }
    try {
      return await oag.flightInfo(
        token,
        {
          origin: event.origin,
          destination: event.destination,
          date: event.date,
          carrierCode: event.carrier_code,
          flightNumber: event.flight_number,
          limit: event.limit
        },
        { path: process.env.OAG_FLIGHT_INFO_PATH || undefined }
      )
    } catch (err) {
      return { statusCode: 502, body: { message: err.message } }
    }
  }

  const token = PROVIDER === 'duffel' ? process.env.DUFFEL_TOKEN : process.env.SERPAPI_KEY
  if (!token) return { statusCode: 500, body: { message: `missing token for ${PROVIDER}` } }

  const {
    origin,
    origin_candidates: originCandidates,
    destination,
    destination_candidates: destCandidates,
    depart_date: departDate,
    depart_date_end: departDateEnd,
    stay_range: stayRange
  } = event

  try {
    const data = await search(token, {
      origin,
      destination,
      originCandidates,
      destCandidates,
      dateFrom: departDate,
      dateTo: departDateEnd,
      stayRange
    })
    // 成功：直接返回 SearchResponse 形状（前端 request() 原样消费）
    return data
  } catch (err) {
    // 失败：非 2xx，前端 request() 走 toast 降级
    return { statusCode: 502, body: { message: err.message } }
  }
}
