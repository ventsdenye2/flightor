// scripts/test-route-cloud.js — routePlanner 云函数 handler 冒烟测试（本地，不发网络请求）
// 用法：node scripts/test-route-cloud.js
const { handle, handlePlan, handleConfirm } = require('../cloud/routePlanner/handler')

const TODAY = '2026-08-24'
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`) }
}

const CASE0 = '9月1号到9月20号之间我有10-20天的假期，中间有8天可以出去玩，这8天我想去欧洲尽可能多的城市，我有申根签，希望省钱所以晚上坐飞机早晨到，深圳出发'

async function main() {
  console.log('\n【plan】规则路径（无 OpenRouter key）')
  const r1 = await handlePlan({ text: CASE0, today: TODAY }, {})
  check('source=rules', r1.source === 'rules', String(r1.source))
  check('无缺失', r1.missing.length === 0, JSON.stringify(r1.missing))
  check('收敛出 2-3 条路线', r1.routes.length >= 2 && r1.routes.length <= 3, String(r1.routes.length))

  console.log('\n【plan】模糊需求 → 追问')
  const r2 = await handlePlan({ text: '想去欧洲玩', today: TODAY }, {})
  check('routes 为空', r2.routes.length === 0)
  check('missing 非空', r2.missing.length > 0, JSON.stringify(r2.missing))

  console.log('\n【plan】参数校验')
  const r3 = await handlePlan({ today: TODAY }, {})
  check('缺 text 返回 400', r3.statusCode === 400)

  console.log('\n【confirm】无 SerpApi key 降级')
  const picks = r1.routes
  const r4 = await handleConfirm({ picks }, {})
  check('降级返回估算价', r4.confirmed.length === picks.length && r4.confirmed.every(c => c.note === '当前为估算价'))

  console.log('\n【confirm】参数校验')
  const r5 = await handleConfirm({}, {})
  check('缺 picks 返回 400', r5.statusCode === 400)

  console.log('\n【handle】动作路由')
  const r6 = await handle({ action: 'plan', text: CASE0, today: TODAY })
  check('plan 路由正常', Array.isArray(r6.routes))
  const r7 = await handle({ action: 'xxx' })
  check('未知 action 返回 400', r7.statusCode === 400)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { console.error('崩溃:', e); process.exit(1) })
