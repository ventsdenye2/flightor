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

exports.main = async event => {
  // 无需消耗报价配额的预检：返回直飞状态与最多两次中转的简单路径。
  if (event.action === 'connectivity') {
    const { origin, destination, date, max_transfers: maxTransfers } = event
    if (!origin || !destination) return { statusCode: 400, body: { message: 'missing origin/destination' } }
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
      topologyAirports: connectivity.airportCount()
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
