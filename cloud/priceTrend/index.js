// cloud/priceTrend — 价格趋势云函数
// 数据源：Travelpayouts month-matrix（当月逐日最低价，Aviasales 缓存数据）
// 环境变量：TRAVELPAYOUTS_TOKEN
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const TP_BASE = 'https://api.travelpayouts.com'

/** 拉取当月逐日低价（currency=cny 直接返回人民币） */
async function monthMatrix(origin, destination, month) {
  const qs = new URLSearchParams({
    origin,
    destination,
    month, // yyyy-mm-01
    currency: 'cny',
    token: process.env.TRAVELPAYOUTS_TOKEN
  })
  const res = await fetch(`${TP_BASE}/v2/prices/month-matrix?${qs}`)
  if (!res.ok) throw new Error(`travelpayouts ${res.status}`)
  const json = await res.json()
  return json.data ?? []
}

exports.main = async event => {
  const { origin, destination, current_price: currentPrice } = event
  try {
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const rows = await monthMatrix(origin, destination, month)
    if (rows.length === 0) return { statusCode: 404, body: { message: 'no data' } }

    // 逐日历史（真实数据，替代 Amadeus 版的分位点估算）
    const history = rows
      .filter(r => r.depart_date && Number(r.value) > 0)
      .map(r => ({ date: r.depart_date, price: Math.round(Number(r.value)) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    if (history.length === 0) return { statusCode: 404, body: { message: 'no data' } }

    const prices = history.map(h => h.price)
    const min30d = Math.min(...prices)
    const max30d = Math.max(...prices)
    const avg30d = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length)
    history.find(h => h.price === min30d).isLowest = true

    // 当前价：优先用搜索页带入的实时价，否则取最近日期价
    const current = Number(currentPrice) || history[0].price
    const percentile = Math.round(((current - min30d) / (max30d - min30d || 1)) * 100)
    const signal = percentile <= 30 ? 'buy' : percentile >= 70 ? 'wait' : 'neutral'

    // 直接返回 PriceTrendResponse 形状（前端 request() 原样消费）
    return {
      route: { origin, destination },
      history,
      statistics: { current, avg30d, min30d, max30d, percentile },
      signal,
      bestBookingWindow: { daysBeforeDeparture: [45, 75] }
    }
  } catch (err) {
    return { statusCode: 502, body: { message: err.message } }
  }
}
