// scripts/test-date-cache.js — 验证日期粒度缓存：窗口平移仅补查新日期
// 注入假 fetchJson 计数请求次数，不消耗真实配额
const { search } = require('../cloud/searchProxy/serpapi')

let httpCalls = 0
async function fakeFetchJson(url) {
  httpCalls++
  const date = new URL(url).searchParams.get('outbound_date')
  return {
    best_flights: [
      {
        price: 7500 + httpCalls,
        total_duration: 840,
        flights: [
          {
            flight_number: 'CZ303',
            airline: '中国南方航空',
            departure_airport: { id: 'CAN', time: `${date}T10:00` },
            arrival_airport: { id: 'LHR', time: `${date}T16:00` },
            duration: 840
          }
        ]
      }
    ],
    other_flights: []
  }
}

const baseParams = {
  origin: 'SZX',
  destination: 'LHR',
  originCandidates: ['SZX', 'CAN'],
  destCandidates: ['LHR', 'LGW'],
  stayRange: [7, 14]
}

async function main() {
  // 第一轮：4 天窗口 → 4 次请求
  const r1 = await search('fake-key', { ...baseParams, dateFrom: '2026-10-01', dateTo: '2026-10-04' }, { fetchJson: fakeFetchJson })
  console.log('轮1 窗口10-01~10-04：请求', httpCalls, '次 | fetched =', r1.metadata.fetched, '| cacheHit =', r1.metadata.cacheHit)

  // 第二轮：同窗口重搜 → 应 0 次请求（全命中）
  const r2 = await search('fake-key', { ...baseParams, dateFrom: '2026-10-01', dateTo: '2026-10-04' }, { fetchJson: fakeFetchJson })
  console.log('轮2 同窗口重搜：请求', httpCalls, '次（应仍为 4）| fetched =', r2.metadata.fetched, '| cacheHit =', r2.metadata.cacheHit)

  // 第三轮：窗口平移 2 天（10-03~10-06）→ 仅补查 10-05、10-06 两天
  const r3 = await search('fake-key', { ...baseParams, dateFrom: '2026-10-03', dateTo: '2026-10-06' }, { fetchJson: fakeFetchJson })
  console.log('轮3 窗口平移+2天：新增请求', httpCalls - 4, '次（应 ≤2）| fetched =', r3.metadata.fetched, '| 结果条数 =', r3.direct.length + r3.airlineTransfer.length)

  const ok = httpCalls === 6 && r2.metadata.cacheHit === true && r3.metadata.fetched <= 2 && r3.direct.length + r3.airlineTransfer.length > 0
  console.log(ok ? '✅ 日期粒度缓存验证通过（窗口平移省配额生效）' : '❌ 验证失败')
  process.exit(ok ? 0 : 1)
}

main().catch(e => {
  console.error('❌ 异常：', e.message)
  process.exit(1)
})
