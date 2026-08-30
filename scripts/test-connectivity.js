// 机场可达性索引回归：班期、未知状态、简单路径、闭环和衔接约束
const { createConnectivityIndex } = require('../cloud/searchProxy/connectivity')
const { buildResponse } = require('../cloud/searchProxy/serpapi')

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`) }
}

function segment(origin, destination, departTime, arriveTime, flightNo = `${origin}${destination}`) {
  return { origin, destination, departTime, arriveTime, flightNo, airline: 'Test Air', duration: 60 }
}

console.log('\n【机场可达性索引】')
const index = createConnectivityIndex([
  { origin: 'AAA', destination: 'BBB', operatingDays: [2], validFrom: '2026-01-01', validTo: '2026-12-31', source: 'test' },
  { origin: 'BBB', destination: 'CCC', operatingDays: [2], validFrom: '2026-01-01', validTo: '2026-12-31', source: 'test' },
  { origin: 'BBB', destination: 'AAA', operatingDays: [2], validFrom: '2026-01-01', validTo: '2026-12-31', source: 'test' },
  { origin: 'CCC', destination: 'DDD', operatingDays: [2], validFrom: '2026-01-01', validTo: '2026-12-31', source: 'test' }
])

check('指定执飞日可达', index.routeStatus('AAA', 'BBB', '2026-09-01').status === 'reachable')
check('非执飞日不可达', index.routeStatus('AAA', 'BBB', '2026-09-02').reason === 'not_operating_on_date')
check('索引外机场返回 unknown', index.routeStatus('AAA', 'ZZZ', '2026-09-01').status === 'unknown')
check('索引内无直飞边返回 unreachable', index.routeStatus('AAA', 'CCC', '2026-09-01').status === 'unreachable')

const oneStopPaths = index.findPaths('AAA', 'CCC', '2026-09-01', { maxTransfers: 1 })
check('找到一次中转路径', oneStopPaths.some(path => path.join('>') === 'AAA>BBB>CCC'))
check('路径搜索不产生闭环', oneStopPaths.every(path => new Set(path).size === path.length))
check('中转次数上限生效', index.findPaths('AAA', 'DDD', '2026-09-01', { maxTransfers: 1 }).length === 0)
check('最多两次中转可到达', index.findPaths('AAA', 'DDD', '2026-09-01', { maxTransfers: 2 }).some(path => path.join('>') === 'AAA>BBB>CCC>DDD'))

const validSegments = [
  segment('AAA', 'BBB', '2026-09-01T08:00:00', '2026-09-01T10:00:00'),
  segment('BBB', 'CCC', '2026-09-01T11:30:00', '2026-09-01T13:00:00')
]
check('90 分钟航司联程通过', index.validateItinerary(validSegments, { transferType: 'airline', requireKnown: true }).valid)

const shortConnection = [
  validSegments[0],
  segment('BBB', 'CCC', '2026-09-01T10:30:00', '2026-09-01T12:00:00')
]
check('过短衔接被拒绝', index.validateItinerary(shortConnection, { transferType: 'airline' }).reasons.includes('connection_too_short'))

const longStopover = [
  validSegments[0],
  segment('BBB', 'CCC', '2026-09-03T11:30:00', '2026-09-03T13:00:00')
]
const longStopoverResult = index.validateItinerary(longStopover, { transferType: 'airline' })
check('长中转不会被过滤', longStopoverResult.valid)
check('长中转作为软提示保留', longStopoverResult.warnings.includes('long_layover'))

const cycle = [
  segment('AAA', 'BBB', '2026-09-01T08:00:00', '2026-09-01T10:00:00'),
  segment('BBB', 'AAA', '2026-09-01T11:30:00', '2026-09-01T13:00:00')
]
check('闭环行程被拒绝', index.validateItinerary(cycle).reasons.includes('cycle_or_repeated_airport'))

const tooManyTransfers = [
  segment('AAA', 'BBB', '2026-09-01T08:00:00', '2026-09-01T09:00:00'),
  segment('BBB', 'CCC', '2026-09-01T10:30:00', '2026-09-01T11:30:00'),
  segment('CCC', 'DDD', '2026-09-01T13:00:00', '2026-09-01T14:00:00'),
  segment('DDD', 'EEE', '2026-09-01T15:30:00', '2026-09-01T16:30:00')
]
check('超过两次中转被拒绝', index.validateItinerary(tooManyTransfers).reasons.includes('too_many_transfers'))

index.observeSegments([segment('ZZZ', 'YYY', '2026-09-01T08:00:00', '2026-09-01T09:00:00')])
check('供应商观测可补充日期级拓扑', index.routeStatus('ZZZ', 'YYY', '2026-09-01').status === 'reachable')
check('观测边不会错误扩展到其他日期', index.routeStatus('ZZZ', 'YYY', '2026-09-02').status === 'unreachable')

console.log('\n【供应商结果约束】')
const validOption = {
  id: 'valid', segments: validSegments, totalPrice: 1000, totalDuration: 300,
  airline: 'Test Air', transferType: 'airline'
}
const loopOption = {
  id: 'loop', segments: cycle, totalPrice: 500, totalDuration: 300,
  airline: 'Test Air', transferType: 'airline'
}
const longStopoverOption = {
  id: 'long-stopover', segments: longStopover, totalPrice: 1100, totalDuration: 3300,
  airline: 'Test Air', transferType: 'airline'
}
const response = buildResponse([validOption, loopOption, longStopoverOption], 1, 1, false)
check('供应商异常闭环被过滤', response.airlineTransfer.every(option => option.id !== 'loop'))
check('供应商长中转方案被保留', response.airlineTransfer.some(option => option.id === 'long-stopover'))
check('响应记录拓扑过滤数量', response.metadata.topologyFiltered === 1)

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
