// scripts/test-search.js — 本地实测 searchProxy 搜索管线
// 用法：node scripts/test-search.js [serpapi|duffel]（默认 serpapi）
// 说明：读取项目根目录 <provider>.txt 的 key
const fs = require('fs')
const path = require('path')

const provider = process.argv[2] === 'duffel' ? 'duffel' : 'serpapi'
const { search } = require(`../cloud/searchProxy/${provider}`)
const token = fs.readFileSync(path.join(__dirname, '..', `${provider}.txt`), 'utf-8').trim()

async function main() {
  const params = {
    origin: 'SZX',
    destination: 'LHR',
    originCandidates: ['SZX', 'CAN'],
    destCandidates: ['LHR', 'LGW'],
    dateFrom: '2026-09-01',
    dateTo: '2026-09-07',
    stayRange: [5, 9]
  }

  console.time(`首次搜索(${provider})`)
  const res = await search(token, params)
  console.timeEnd(`首次搜索(${provider})`)

  const all = [...res.direct, ...res.selfTransfer, ...res.airlineTransfer]
  console.log(`\n结果：直飞 ${res.direct.length} / 联程 ${res.airlineTransfer.length} / 自行中转 ${res.selfTransfer.length}`)
  console.log(`metadata: ${JSON.stringify(res.metadata)}`)

  for (const o of all.slice(0, 5)) {
    const segs = o.segments.map(s => `${s.flightNo} ${s.origin}→${s.destination}`).join(' + ')
    console.log(`  ¥${o.totalPrice} | ${o.airline} | ${segs} | ${o.departDate} | ${o.totalDuration}min`)
  }
  if (all[0]?.hub) console.log(`  首个联程方案 hub: ${JSON.stringify(all[0].hub)}`)

  console.time('缓存命中')
  const res2 = await search(token, params)
  console.timeEnd('缓存命中')
  console.log(`缓存标记 cacheHit=${res2.metadata.cacheHit === true}`)
}

main().catch(e => {
  console.error('失败:', e.message)
  process.exit(1)
})
