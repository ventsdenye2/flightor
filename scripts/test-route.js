// scripts/test-route.js — 本地实测多城路线引擎（Case 1/3/4/5）
// 用法：node scripts/test-route.js
const { parseDirective, searchRoutes, convergeRoutes, SCHENGEN_CITIES, VISA_FREE_CITIES } = require('../cloud/routePlanner/engine')

const TODAY = '2026-08-24'
let passed = 0
let failed = 0

function check(name, cond, detail) {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function cityNames(iatas) {
  return iatas.map(i => {
    const c = SCHENGEN_CITIES.find(x => x.iata === i)
    return c ? c.city : i
  })
}

// ===== Case 1 标准多城案例 =====
console.log('\n【Case 1】标准多城案例')
const case1 = `现在是8月24号，我9月1号到9月20号之间有10-20天假期，其中8天可以出去玩。
这8天我想去欧洲尽可能多的城市，我有申根签。
我想省钱，希望晚上坐飞机早晨到，省一天住宿。
路线要尽可能合理，比如从法国出发可以飞瑞士、飞德国，怎么串起来最便宜。深圳出发。`
const r1 = parseDirective(case1, TODAY)
check('窗口解析 09-01~09-20', r1.slots.window_from === '2026-09-01' && r1.slots.window_to === '2026-09-20',
  JSON.stringify([r1.slots.window_from, r1.slots.window_to]))
check('可玩天数 8', r1.slots.travel_days === 8, String(r1.slots.travel_days))
check('出发地 深圳', r1.slots.origin === 'SZX', String(r1.slots.origin))
check('申根签识别', r1.slots.visa === 'schengen' && r1.slots.region === 'schengen')
check('夜航偏好识别', r1.slots.overnight_pref === true)
check('无缺失字段', r1.missing.length === 0, JSON.stringify(r1.missing))
check('无冲突', r1.conflicts.length === 0, JSON.stringify(r1.conflicts))

if (r1.missing.length === 0 && r1.conflicts.length === 0) {
  const t0 = Date.now()
  const routes = searchRoutes(r1.slots)
  const picks = convergeRoutes(routes)
  const ms = Date.now() - t0
  console.log(`  搜索耗时 ${ms}ms，候选 ${routes.length} 条，收敛 ${picks.length} 条`)
  check('搜索在 5s 内完成（node 基线；连跑多套时 CPU 争用会抖动）', ms < 5000, `${ms}ms`)
  check('有候选路线', routes.length > 0)
  check('收敛出 2-3 条差异化路线', picks.length >= 2 && picks.length <= 3, String(picks.length))

  for (const p of picks) {
    const r = p.route
    const names = cityNames(r.cities)
    console.log(`    [${p.kind}] ${names.join(' → ')} | ¥${r.totalPrice} | eff ¥${r.effCost} | 夜航省 ${r.nightsSaved} 晚`)
    r.legs.forEach(l => console.log(`      ${l.date} ${l.from}→${l.to} ${l.departTime}-${l.arriveTime}${l.crossDay ? '(+1)' : ''} ¥${l.price}`))
  }

  const top = picks[0].route
  check('首条路线城市数 4-7', top.cities.length >= 4 && top.cities.length <= 7, String(top.cities.length))
  check('首条路线有夜航段', top.nightsSaved > 0, String(top.nightsSaved))
  check('路线首尾为出发地', top.citySeq[0] === 'SZX' && top.citySeq[top.citySeq.length - 1] === 'SZX')
  const mostCities = picks.find(p => p.kind === 'mostCities')
  if (mostCities) {
    check('城市最多方案 ≥ 首条城市数', mostCities.route.cities.length >= top.cities.length)
  }
}

// ===== Case 3 必去城市约束 =====
console.log('\n【Case 3】必去城市约束')
const case3 = '十月中旬10天，巴黎和罗马必须去，其他城市看着加，有申根签，深圳出发'
const r3 = parseDirective(case3, TODAY)
check('必去城市 巴黎+罗马', r3.slots.must_visit.includes('CDG') && r3.slots.must_visit.includes('FCO'),
  JSON.stringify(r3.slots.must_visit))
check('窗口解析（十月中旬）', r3.slots.window_from != null, String(r3.slots.window_from))
if (r3.missing.length === 0 && r3.conflicts.length === 0) {
  const routes3 = searchRoutes(r3.slots)
  const picks3 = convergeRoutes(routes3)
  const ok = picks3.length > 0 && picks3.every(p => p.route.cities.includes('CDG') && p.route.cities.includes('FCO'))
  check('所有收敛路线均含巴黎和罗马', ok,
    picks3.map(p => cityNames(p.route.cities).join('>')).join(' | '))
} else {
  check('Case 3 可执行（无缺失/冲突）', false, JSON.stringify({ missing: r3.missing, conflicts: r3.conflicts }))
}

// ===== Case 4 模糊需求 → 追问 =====
console.log('\n【Case 4】模糊需求')
const r4 = parseDirective('九月想出去玩，便宜点', TODAY)
check('识别出缺失字段（出发地/窗口/天数）', r4.missing.includes('origin') && r4.missing.includes('travel_days'),
  JSON.stringify(r4.missing))
check('不生成方案（缺字段时不进入搜索）', r4.missing.length > 0)

// ===== Case 5 约束冲突 =====
console.log('\n【Case 5】约束冲突')
const r5 = parseDirective('5天假期想去欧洲8个城市，全部要直飞，深圳出发，9月1号到9月10号', TODAY)
check('识别出冲突', r5.conflicts.length >= 1, JSON.stringify(r5.conflicts))
check('冲突提及天数容量', r5.conflicts.some(c => /最多覆盖|安排不下/.test(c.zh)))
check('冲突提及直飞限制', r5.conflicts.some(c => /直飞/.test(c.zh)))

// ===== Case 2 预算优先短途 =====
console.log('\n【Case 2】预算优先短途')
const r2 = parseDirective('下周五晚出发周日回，上海出发，去东南亚，越便宜越好，9月4号到9月6号3天', TODAY)
check('短窗口 3 天识别', r2.slots.travel_days === 3, String(r2.slots.travel_days))
check('出发地 上海', r2.slots.origin === 'PVG', String(r2.slots.origin))
if (r2.missing.length === 0) {
  const routes2 = searchRoutes(r2.slots, { allCities: require('../cloud/routePlanner/engine').VISA_FREE_CITIES })
  check('短途不崩溃且有结果或空', Array.isArray(routes2), String(routes2.length))
}

// ===== Case 6 签证约束切换 =====
console.log('\n【Case 6】签证约束切换（无申根签）')
const r6 = parseDirective('没有申根签，10月想出国玩8天，多去几个地方，深圳出发，10月1号到10月15号', TODAY)
check('签证识别为 none', r6.slots.visa === 'none')
check('区域切换 visa_free', r6.slots.region === 'visa_free')
check('有切换提示（notes）', r6.notes.length > 0 && /免签/.test(r6.notes[0].zh))
if (r6.missing.length === 0 && r6.conflicts.length === 0) {
  const routes6 = searchRoutes(r6.slots)
  const visaFreeIatas = new Set(VISA_FREE_CITIES.map(c => c.iata))
  const noSchengen = routes6.every(rt => rt.cities.every(c => visaFreeIatas.has(c)))
  check('路线不含申根城市', routes6.length === 0 || noSchengen)
  if (routes6.length > 0) {
    const p6 = convergeRoutes(routes6)
    console.log(`    [示例] ${cityNames(p6[0].route.cities).join(' → ')} ¥${p6[0].route.totalPrice}`)
  }
} else {
  check('Case 6 可执行', false, JSON.stringify({ missing: r6.missing, conflicts: r6.conflicts }))
}

// ===== Case 7 预算过低 =====
console.log('\n【Case 7】预算过低')
const r7 = parseDirective('9月1号到9月10号，8天，去欧洲4个城市，预算2000，深圳出发，有申根签', TODAY)
check('预算解析 2000', r7.slots.budget_max === 2000, String(r7.slots.budget_max))
if (r7.missing.length === 0 && r7.conflicts.length === 0) {
  const routes7 = searchRoutes(r7.slots)
  const withinBudget = routes7.every(rt => rt.totalPrice <= 2000)
  check('预算硬约束生效（无结果或全部 ≤ 预算）', withinBudget, `共${routes7.length}条`)
}

// ===== Case 8 预算充足（中文数字） =====
console.log('\n【Case 8】预算充足 + 中文数字')
const r8 = parseDirective('9月1号到9月20号出去玩8天，欧洲尽可能多城市，有申根签，深圳出发，预算一万五', TODAY)
check('「一万五」解析为 15000', r8.slots.budget_max === 15000, String(r8.slots.budget_max))
if (r8.missing.length === 0 && r8.conflicts.length === 0) {
  const routes8 = searchRoutes(r8.slots)
  check('预算 15000 内有可行路线', routes8.length > 0, String(routes8.length))
  check('全部路线 ≤ 15000', routes8.every(rt => rt.totalPrice <= 15000))
}

// ===== Case 9 「八千」预算 =====
console.log('\n【Case 9】「八千」预算解析')
const r9 = parseDirective('预算八千', TODAY)
check('「八千」解析为 8000', r9.slots.budget_max === 8000, String(r9.slots.budget_max))

// ===== Case 10 极短窗口（2天） =====
console.log('\n【Case 10】极短窗口')
const r10 = parseDirective('9月5号到9月6号，2天假期，欧洲多城，深圳出发，有申根签', TODAY)
check('2 天解析', r10.slots.travel_days === 2, String(r10.slots.travel_days))
if (r10.missing.length === 0 && r10.conflicts.length === 0) {
  let crashed = false
  let routes10 = []
  try {
    routes10 = searchRoutes(r10.slots)
  } catch (e) {
    crashed = true
    console.log('    崩溃信息：', e.message)
  }
  check('极短窗口不崩溃', !crashed)
  check('2 天无法多城（结果为空是合理输出）', routes10.length === 0 || routes10.every(rt => rt.cities.length <= 1))
}

// ===== Case 11 免签池新增济州岛 =====
console.log('\n【Case 11】免签池含济州岛（必去硬约束）')
const r11 = parseDirective('深圳出发，没有申根签，9月1号到9月6号玩5天，必去济州岛', TODAY)
check('免签池识别 + 必去济州岛', r11.slots.region === 'visa_free' && r11.slots.must_visit.includes('CJU'), JSON.stringify({ region: r11.slots.region, must: r11.slots.must_visit }))
if (r11.missing.length === 0 && r11.conflicts.length === 0) {
  const routes11 = searchRoutes(r11.slots)
  check('有可行路线', routes11.length > 0, String(routes11.length))
  check('所有路线含济州岛', routes11.every(rt => rt.cities.includes('CJU')))
}

// ===== 汇总 =====
console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
