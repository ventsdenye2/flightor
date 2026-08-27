// cloud/chatAgent — 需求对话云函数
// 数据源：OpenRouter（默认 openai/gpt-5.6-luna，GUIDE_MODEL 可覆盖）
// 环境变量：OPENROUTER_API_KEY / GUIDE_MODEL(可选)
// 防幻觉：机场表由前端传入，槽位白名单校验；agent 只做需求理解，不检索不报价
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const { chatTurn } = require('./agent')

exports.main = async event => {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return { statusCode: 500, body: { message: 'missing OPENROUTER_API_KEY' } }

  const { messages, slots, airports } = event
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: { message: 'missing messages' } }
  }
  if (!Array.isArray(airports) || airports.length === 0) {
    return { statusCode: 400, body: { message: 'missing airports' } }
  }

  try {
    const { reply, slots: merged, ready, missing } = await chatTurn(
      apiKey,
      { messages, slots: slots || {}, airports },
      process.env.GUIDE_MODEL || 'openai/gpt-5.6-luna'
    )
    return { reply, slots: merged, ready, missing }
  } catch (err) {
    return { statusCode: 502, body: { message: err.message } }
  }
}
