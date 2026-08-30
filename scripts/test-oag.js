const oag = require('../cloud/searchProxy/oag')

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`) }
}

console.log('\n【OAG 数据映射】')
const schedule = {
  departure: { airport: 'SZX' },
  arrival: { airport: 'SIN' },
  effectivePeriod: { startDate: '2026-09-01', endDate: '2026-10-31' },
  legDaysOfOperation: ['monday', 'wednesday', 'friday'],
  carrier: 'SQ',
  flightNumber: '857'
}
const edge = oag.scheduleToEdge(schedule)
check('Schedules 映射机场对', edge.origin === 'SZX' && edge.destination === 'SIN')
check('Schedules 映射有效期', edge.validFrom === '2026-09-01' && edge.validTo === '2026-10-31')
check('Schedules 映射执飞星期', edge.operatingDays.join(',') === '1,3,5')

const connection = oag.connectionToRecord({
  connectionId: 'oag-1',
  effectivePeriod: { startDate: '2026-09-01', endDate: '2026-10-31' },
  daysOfOperation: ['tuesday'],
  connectionTime: 185,
  mctStatus: 'II',
  isSelfConnection: false,
  legs: [
    { departure: { airport: 'SZX' }, arrival: { airport: 'SIN' } },
    { departure: { airport: 'SIN' }, arrival: { airport: 'LHR' } }
  ]
})
check('Connections 映射中转点', connection.via.join(',') === 'SIN')
check('Connections 映射 MCT 相关信息', connection.connectionTime === 185 && connection.mctStatus === 'II')
check('Connections 生成两条拓扑边', connection.edges.length === 2)

const location = oag.normalizeLocation({
  code: { iata: 'LHR', icao: 'EGLL' },
  type: 'AIRPORT',
  name: 'LONDON HEATHROW APT',
  place: {
    city: { code: 'LON', name: 'LONDON' },
    country: { code: 'GB', name: 'UNITED KINGDOM' },
    latitude: { decimalDegrees: 51.47 },
    longitude: { decimalDegrees: -0.4543 }
  },
  timezone: { code: { iata: '01' }, standardUtcVariation: '+0000' }
})
check('Master Data 映射国家城市机场层级', location.iata === 'LHR' && location.cityCode === 'LON' && location.countryCode === 'GB')
check('Master Data 映射坐标和时区', location.latitude === 51.47 && location.timezone === '01')

console.log('\n【OAG 请求协议】')
let captured = null
const fakeFetch = async (url, init) => {
  captured = { url, init }
  return { data: [schedule], paging: { totalCount: 1 } }
}

async function run() {
  const result = await oag.schedules('test-secret', {
    origin: 'SZX', destination: 'SIN', dateFrom: '2026-09-01', dateTo: '2026-09-01'
  }, { fetchJson: fakeFetch })
  check('Schedules 使用正确端点', captured.url.startsWith('https://api.oag.com/flights?'))
  check('请求参数不包含密钥', !captured.url.includes('test-secret'))
  check('密钥仅通过 Subscription-Key 请求头发送', captured.init.headers['Subscription-Key'] === 'test-secret')
  check('Schedules 响应生成拓扑边', result.edges.length === 1)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
