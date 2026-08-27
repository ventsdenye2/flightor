// cloud/tripAgent — AI 行程规划云函数
// 数据源：OpenRouter（默认 openai/gpt-5.6-luna，实测约23s、编排质量最佳；GUIDE_MODEL 可覆盖）
// 环境变量：OPENROUTER_API_KEY / GUIDE_MODEL(可选)
// 防幻觉：事实素材（航班/签证/攻略）由前端结构化传入，模型只编排不生成事实
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { planTrip } = require('./agent')

exports.main = async event => {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return { statusCode: 500, body: { message: 'missing OPENROUTER_API_KEY' } }

  const { route, flight, hub_guide: hubGuide, preferences } = event
  if (!route || !flight) return { statusCode: 400, body: { message: 'missing route/flight' } }

  try {
    const { plan } = await planTrip(
      apiKey,
      { route, flight, hubGuide: hubGuide ?? null, preferences: preferences ?? {} },
      process.env.GUIDE_MODEL || 'openai/gpt-5.6-luna'
    )
    // 直接返回 TripPlan 形状（前端 request() 原样消费）
    return plan
  } catch (err) {
    return { statusCode: 502, body: { message: err.message } }
  }
}
