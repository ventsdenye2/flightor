// scripts/query-trip.js — 一次性真实票价查询（复用 routePlanner 的 SerpApi 探测通道）
// 用法：node scripts/query-trip.js
const fs = require('fs')
const path = require('path')
const { probeLegs } = require('../cloud/routePlanner/probe')

const key = fs.readFileSync(path.join(__dirname, '../serpapi.txt'), 'utf-8').trim()

const LEGS = [
  { from: 'HKG,SZX,CAN', to: 'CJU', date: '2026-08-26', label: '去程 深港穗→济州岛 8/26' },
  { from: 'HKG,SZX,CAN', to: 'CJU', date: '2026-08-27', label: '去程 深港穗→济州岛 8/27' },
  { from: 'HKG,SZX,CAN', to: 'CJU', date: '2026-08-28', label: '去程 深港穗→济州岛 8/28' },
  { from: 'CJU', to: 'PVG,SHA', date: '2026-08-31', label: '回程 济州岛→上海两机场 8/31' },
  { from: 'CJU', to: 'PVG,SHA', date: '2026-09-01', label: '回程 济州岛→上海两机场 9/1' }
]

async function main() {
  for (const leg of LEGS) {
    console.log(`\n【${leg.label}】`)
    try {
      const res = await probeLegs(key, leg.from, leg.to, leg.date)
      if (res.length === 0) {
        console.log('  无结果（无直飞/中转报价或查询失败）')
        continue
      }
      for (const l of res) {
        console.log(`  ${l.from}→${l.to}  ${l.departTime}→${l.arriveTime}${l.crossDay ? '(+1)' : ''}  ¥${l.price}  ${l.airline} ${l.flightNo || ''}  ${l.stops === 0 ? '直飞' : l.stops + '次中转'}  ${Math.floor(l.duration / 60)}h${l.duration % 60}m`)
      }
    } catch (e) {
      console.log('  查询失败：', e.message)
    }
  }
}

main()
