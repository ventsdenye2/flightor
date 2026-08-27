// scripts/test-route-real.js — P2 真实价格探测回归
// 用法：node scripts/test-route-real.js          （离线：注入假 HTTP，不耗配额）
//       node scripts/test-route-real.js --live    （实网：读 serpapi.txt，探测 1 段，耗 1 次配额）
const fs = require('fs')
const path = require('path')

const { parseDirective, searchRoutes, convergeRoutes } = require('../cloud/routePlanner/engine')
const { confirmPickRoute, probeLegs, mapItineraryToLeg } = require('../cloud/routePlanner/probe')

const TODAY = '2026-08-24'
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`) }
}

// SerpApi 单段响应样例（结构对齐官方 google_flights）
function sampleItinerary({ from, to, depTime, arrTime, price, airline = 'LH', no = 'LH123' }) {
  return {
    price,
    total_duration: 95,
    flights: [{
      flight_number: no,
      airline,
      duration: 95,
      departure_airport: { id: from, time: depTime },
      arrival_airport: { id: to, time: arrTime }
    }]
  }
}

async function offline() {
  console.log('\n【离线】映射与逐段确认')

  // 1. itinerary → 引擎段
  const leg = mapItineraryToLeg(
    sampleItinerary({ from: 'ZRH', to: 'MUC', depTime: '2026-09-03 21:40', arrTime: '2026-09-03 23:15', price: 890 }),
    'ZRH', 'MUC', '2026-09-03'
  )
  check('段映射：价格/时刻', leg.price === 890 && leg.departTime === '21:40' && leg.arriveTime === '23:15')
  check('段映射：同日不跨天', leg.crossDay === false)
  const legNight = mapItineraryToLeg(
    sampleItinerary({ from: 'SZX', to: 'ZRH', depTime: '2026-09-01 22:30', arrTime: '2026-09-02 05:40', price: 3200 }),
    'SZX', 'ZRH', '2026-09-01'
  )
  check('段映射：跨天标记', legNight.crossDay === true)

  // 2. 注入假 HTTP 跑 confirmPickRoute
  const slots = parseDirective(
    '9月1号到9月20号之间我有10-20天假期，中间8天出去玩，欧洲尽可能多城市，有申根签，晚上坐飞机早晨到省住宿，深圳出发',
    TODAY
  ).slots
  const routes = searchRoutes(slots)
  check('估算价搜索有结果', routes.length > 0, String(routes.length))
  const picks = convergeRoutes(routes)

  let callCount = 0
  const fakeFetch = async () => {
    callCount++
    return {
      best_flights: [sampleItinerary({
        from: 'X', to: 'Y', price: 1000 + callCount * 10,
        depTime: '2026-09-02 08:00', arrTime: '2026-09-02 10:00'
      })],
      other_flights: []
    }
  }
  const confirmed = await confirmPickRoute('fake-key', picks[0], { fetchJson: fakeFetch })
  check('确认调用次数 = 段数（≤8）', callCount === picks[0].route.legs.length, `调用${callCount}次`)
  check('全部段探测成功', confirmed.probed === picks[0].route.legs.length)
  check('总价用真实价重算', confirmed.route.totalPrice === confirmed.route.legs.reduce((s, l) => s + l.price, 0) && confirmed.route.legs.every(l => l.price >= 1000))
  check('每段带 real 标记', confirmed.route.legs.every(l => l.real === true))
  check('价格说明文案', /实时报价/.test(confirmed.note))

  // 3. 探测失败降级：假 HTTP 抛错 → 保留估算价
  const failingFetch = async () => { throw new Error('quota exceeded') }
  const degraded = await confirmPickRoute('fake-key', picks[0], { fetchJson: failingFetch })
  check('失败降级：0 段真实', degraded.probed === 0)
  check('失败降级：总价回退估算价', degraded.route.totalPrice === picks[0].route.totalPrice)
  check('失败降级：提示估算段数', /估算价/.test(degraded.note))

  // 4. maxCalls 配额上限
  callCount = 0
  await confirmPickRoute('fake-key', picks[0], { fetchJson: fakeFetch, maxCalls: 2 })
  check('maxCalls 生效', callCount <= 2, `调用${callCount}次`)
}

async function live() {
  console.log('\n【实网】真实探测 1 段（耗 1 次 SerpApi 配额）')
  const key = fs.readFileSync(path.join(__dirname, '..', 'serpapi.txt'), 'utf-8').trim()
  const legs = await probeLegs(key, 'SZX', 'ZRH', '2026-09-05')
  check('SZX→ZRH 探测有结果', legs.length > 0, '可能网络/配额问题')
  if (legs.length > 0) {
    const l = legs[0]
    console.log(`    最低价 ¥${l.price} | ${l.airline} | ${l.flightNo} | ${l.departTime}→${l.arriveTime}${l.crossDay ? ' (+1)' : ''} | ${l.stops}次中转`)
    check('真实段字段完整', l.real === true && l.departTime.length === 5 && l.price > 0)
    // 全链路：探测结果注入引擎搜索（legsFn 收到的是城市对象）
    const legsFn = (from, to, date) => (from.iata === 'SZX' && to.iata === 'ZRH' && date === '2026-09-05') ? legs : []
    const slots = parseDirective('9月5号到9月15号，8天，欧洲2个城市，必去苏黎世，深圳出发，有申根签', TODAY).slots
    const routes = searchRoutes(slots, { legsFn })
    const zrRoutes = routes.filter(r => r.legs.some(x => x.real === true))
    check('真实价注入引擎搜索生效', zrRoutes.length > 0, `共${routes.length}条路线`)
  }
}

async function main() {
  await offline()
  if (process.argv.includes('--live')) await live()
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { console.error('崩溃:', e); process.exit(1) })
