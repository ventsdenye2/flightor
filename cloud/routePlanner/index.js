// cloud/routePlanner — 多城路线规划云函数
// action=plan    { text, today } → 智能解析（LLM 带规则兜底）+ 搜索 + 收敛
// action=confirm { picks } → 逐段 SerpApi 真实价格确认
// 环境变量：OPENROUTER_API_KEY / SERPAPI_KEY
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { handle } = require('./handler')

exports.main = async event => handle(event)
