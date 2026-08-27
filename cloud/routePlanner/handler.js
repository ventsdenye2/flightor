// cloud/routePlanner/handler.js — 云函数动作路由（纯逻辑，可本地测试）
// action=plan     智能解析 → 搜索 → 收敛（估算价，0 配额）
// action=confirm  对选中路线逐段真实价格确认（消耗 SerpApi 配额）
const { parseDirective, searchRoutes, convergeRoutes } = require('./engine')
const { confirmPickRoute } = require('./probe')
const { parseDirectiveSmart } = require('./llmParse')

/**
 * 端到端规划
 * @param event { text, today }
 * @param env { OPENROUTER_API_KEY? }
 */
async function handlePlan(event, env = {}) {
  const { text, today } = event
  if (!text || !today) return { statusCode: 400, body: { message: 'missing text/today' } }

  let parsed
  try {
    parsed = await parseDirectiveSmart(env.OPENROUTER_API_KEY || '', text, today)
  } catch (e) {
    // smart 内部已有规则兜底，这里防极端异常
    parsed = { ...parseDirective(text, today), source: 'rules', llmError: e.message }
  }

  if (parsed.missing.length > 0 || parsed.conflicts.length > 0) {
    return { ...parsed, routes: [] }
  }
  const routes = searchRoutes(parsed.slots)
  return { ...parsed, routes: convergeRoutes(routes) }
}

/**
 * 真实价格确认
 * @param event { picks: [{kind, route}] }
 * @param env { SERPAPI_KEY? }
 */
async function handleConfirm(event, env = {}) {
  const picks = event.picks
  if (!Array.isArray(picks) || picks.length === 0) {
    return { statusCode: 400, body: { message: 'missing picks' } }
  }
  if (!env.SERPAPI_KEY) {
    // 无 key 降级：原样返回估算价
    return { confirmed: picks.map(p => ({ ...p, probed: 0, failed: p.route.legs.length, note: '当前为估算价' })) }
  }
  const confirmed = []
  for (const pick of picks) {
    confirmed.push(await confirmPickRoute(env.SERPAPI_KEY, pick))
  }
  return { confirmed }
}

exports.handle = async event => {
  const env = typeof process !== 'undefined' && process.env ? process.env : {}
  if (event.action === 'plan') return handlePlan(event, env)
  if (event.action === 'confirm') return handleConfirm(event, env)
  return { statusCode: 400, body: { message: `unknown action: ${event.action}` } }
}
exports.handlePlan = handlePlan
exports.handleConfirm = handleConfirm
