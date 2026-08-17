// cloud/priceAlert — 降价提醒触发云函数（定时触发器：每日 09:00）
// 职责：遍历订阅记录 → Travelpayouts 查当前低价 → 低于目标价则推送订阅消息
// 环境变量：TRAVELPAYOUTS_TOKEN
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 上线前在微信公众平台申请「价格变动提醒」模板并替换
const TEMPLATE_ID = 'PRICE_ALERT_TMPL_ID'

/** Travelpayouts latest：该 OD 近期一批低价（缓存数据，盯价场景足够）取最低 */
async function currentPrice(origin, destination) {
  const qs = new URLSearchParams({
    origin,
    destination,
    period_type: 'year',
    page: '1',
    limit: '30',
    currency: 'cny',
    token: process.env.TRAVELPAYOUTS_TOKEN
  })
  const res = await fetch(`https://api.travelpayouts.com/v2/prices/latest?${qs}`)
  if (!res.ok) throw new Error(`travelpayouts ${res.status}`)
  const json = await res.json()
  const prices = (json.data ?? []).map(r => Number(r.value)).filter(v => v > 0)
  return prices.length > 0 ? Math.round(Math.min(...prices)) : null
}

exports.main = async () => {
  const { data: alerts } = await db.collection('price_alerts').where({ active: true }).get()
  const results = []

  for (const alert of alerts) {
    try {
      const price = await currentPrice(alert.origin, alert.destination)
      if (price != null && price <= alert.targetPrice) {
        await cloud.openapi.subscribeMessage.send({
          touser: alert.openId,
          templateId: TEMPLATE_ID,
          page: `pages/index/index?origin=${alert.origin}&destination=${alert.destination}`,
          data: {
            thing1: { value: `${alert.origin} → ${alert.destination}` },
            amount2: { value: `¥${price}` },
            amount3: { value: `¥${alert.targetPrice}` }
          }
        })
        // 触发后停用，避免重复打扰
        await db.collection('price_alerts').doc(alert._id).update({ data: { active: false, firedAt: new Date() } })
        results.push({ id: alert._id, fired: true, price })
      } else {
        results.push({ id: alert._id, fired: false, price })
      }
    } catch (err) {
      results.push({ id: alert._id, error: err.message })
    }
    // 控制调用频率，避免触发 Travelpayouts 限流
    await new Promise(r => setTimeout(r, 300))
  }
  return { code: 0, checked: alerts.length, results }
}
