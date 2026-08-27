// scripts/test-route-llm.js — LLM 解析回归
// 用法：node scripts/test-route-llm.js          （离线：注入假 LLM 响应，不耗 token）
//       node scripts/test-route-llm.js --live    （实网：读 openrouter.txt 真调一次）
const fs = require('fs')
const path = require('path')

const { parseDirectiveLLM, parseDirectiveSmart } = require('../cloud/routePlanner/llmParse')

const TODAY = '2026-08-24'
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`) }
}

/** 构造假 OpenRouter 响应 */
function fakeLLM(obj) {
  return async () => ({ choices: [{ message: { content: '```json\n' + JSON.stringify(obj) + '\n```' } }] })
}

async function offline() {
  console.log('\n【离线】LLM 输出归一化')

  // 1. 标准 case：中文城市名 → IATA、签证/预算/夜航
  const r1 = await parseDirectiveLLM('k', '9月1到20号之间我有10-20天假期，中间8天出去玩，欧洲尽可能多城市，有申根签，晚上坐飞机早晨到省住宿，深圳出发，预算一万五', TODAY, {
    fetchJson: fakeLLM({
      origin: '深圳', window_from: '2026-09-01', window_to: '2026-09-20', travel_days: 8,
      region: 'schengen', visa: 'schengen', must_visit: [], overnight_pref: true,
      direct_only: false, budget_max: 15000, city_target: null
    })
  })
  check('出发地归一 SZX', r1.slots.origin === 'SZX', String(r1.slots.origin))
  check('窗口/天数', r1.slots.window_from === '2026-09-01' && r1.slots.travel_days === 8)
  check('夜航偏好', r1.slots.overnight_pref === true)
  check('预算 15000', r1.slots.budget_max === 15000)
  check('无缺失无冲突', r1.missing.length === 0 && r1.conflicts.length === 0)
  check('source 标记 llm', r1.source === 'llm')

  // 2. 必去城市中文名 → IATA
  const r2 = await parseDirectiveLLM('k', '十月中旬10天，巴黎和罗马必须去', TODAY, {
    fetchJson: fakeLLM({
      origin: '深圳', window_from: '2026-10-12', window_to: '2026-10-21', travel_days: 10,
      region: 'schengen', visa: 'schengen', must_visit: ['巴黎', '罗马'], overnight_pref: false,
      direct_only: false, budget_max: null, city_target: null
    })
  })
  check('必去城市归一 CDG+FCO', JSON.stringify(r2.slots.must_visit) === JSON.stringify(['CDG', 'FCO']))

  // 3. 无申根签 → 免签池 + notes
  const r3 = await parseDirectiveLLM('k', '没有申根签，10月出国玩8天', TODAY, {
    fetchJson: fakeLLM({
      origin: '深圳', window_from: '2026-10-01', window_to: '2026-10-15', travel_days: 8,
      region: null, visa: 'none', must_visit: ['曼谷'], overnight_pref: false,
      direct_only: false, budget_max: null, city_target: null
    })
  })
  check('签证 none → 区域 visa_free', r3.slots.visa === 'none' && r3.slots.region === 'visa_free')
  check('免签池归一 曼谷=BKK', JSON.stringify(r3.slots.must_visit) === JSON.stringify(['BKK']))
  check('切换提示', r3.notes.length === 1 && /免签/.test(r3.notes[0].zh))

  // 4. 冲突判定复用：城市数超容量
  const r4 = await parseDirectiveLLM('k', '5天想去8个城市', TODAY, {
    fetchJson: fakeLLM({
      origin: '深圳', window_from: '2026-09-01', window_to: '2026-09-06', travel_days: 5,
      region: 'schengen', visa: 'schengen', must_visit: [], overnight_pref: false,
      direct_only: false, budget_max: null, city_target: 8
    })
  })
  check('容量冲突触发', r4.conflicts.length >= 1 && /安排不下/.test(r4.conflicts[0].zh))

  // 5. LLM 返回非法字段 → 归一为 null（不崩）
  const r5 = await parseDirectiveLLM('k', '随便玩玩', TODAY, {
    fetchJson: fakeLLM({ origin: '巴黎', travel_days: -3, window_from: '下个月', budget_max: '很多' })
  })
  check('非法值归一 null', r5.slots.origin === null && r5.slots.travel_days === null && r5.slots.window_from === null && r5.slots.budget_max === null)
  check('缺失字段列出', r5.missing.includes('origin') && r5.missing.includes('window') && r5.missing.includes('travel_days'))

  // 6. LLM 失败回退规则解析
  const r6 = await parseDirectiveSmart('k', '9月1号到9月20号出去玩8天，深圳出发，有申根签', TODAY, {
    fetchJson: async () => { throw new Error('network down') }
  })
  check('失败回退规则解析', r6.source === 'rules' && r6.llmError === 'network down')
  check('回退结果仍有效', r6.slots.origin === 'SZX' && r6.slots.travel_days === 8)

  // 7. 无 key 直接走规则
  const r7 = await parseDirectiveSmart('', '9月1号到9月20号出去玩8天，深圳出发', TODAY)
  check('无 key 走规则', r7.source === 'rules' && r7.llmError === undefined)
}

async function live() {
  console.log('\n【实网】真调 LLM 解析 Case 0 长指令')
  const key = fs.readFileSync(path.join(__dirname, '..', 'openrouter.txt'), 'utf-8').trim()
  const text = '9月1号到9月20号之间我有10-20天的假期，中间有8天可以出去玩，这8天我想去欧洲尽可能多的城市，我有申根签，希望省钱所以晚上坐飞机早晨到，深圳出发'
  const r = await parseDirectiveSmart(key, text, TODAY)
  console.log(`    source=${r.source} slots=${JSON.stringify(r.slots)}`)
  check('来源为 llm', r.source === 'llm', r.llmError)
  if (r.source === 'llm') {
    check('出发地 深圳', r.slots.origin === 'SZX', String(r.slots.origin))
    check('天数 8', r.slots.travel_days === 8, String(r.slots.travel_days))
    check('窗口覆盖 9 月', r.slots.window_from === '2026-09-01' && r.slots.window_to === '2026-09-20', `${r.slots.window_from}~${r.slots.window_to}`)
    check('申根签/夜航偏好', r.slots.visa === 'schengen' && r.slots.overnight_pref === true)
    check('无缺失', r.missing.length === 0, JSON.stringify(r.missing))
  }
}

async function main() {
  await offline()
  if (process.argv.includes('--live')) await live()
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { console.error('崩溃:', e); process.exit(1) })
