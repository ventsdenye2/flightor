// scripts/test-agent.js — 本地实测 tripAgent 行程规划管线
// 用法：node scripts/test-agent.js
// Key 来源：环境变量 OPENROUTER_API_KEY 或项目根目录 openrouter.txt
const fs = require('fs')
const path = require('path')
const { planTrip } = require('../cloud/tripAgent/agent')

const apiKey =
  process.env.OPENROUTER_API_KEY ||
  fs.readFileSync(path.join(__dirname, '..', 'openrouter.txt'), 'utf-8').trim()

// 模拟前端传入的事实素材：SZX→LHR 经新加坡自行中转 14h
const input = {
  route: {
    origin: 'SZX',
    destination: 'LHR',
    depart_date: '2026-10-11',
    stay_days: 4,
    budget_max: 10000,
    interests: ['food', 'culture']
  },
  flight: {
    price: 3480,
    segments: [
      { flightNo: 'TR101', airline: '酷航', origin: 'SZX', destination: 'SIN', departTime: '2026-10-11T08:20', arriveTime: '2026-10-11T12:10' },
      { flightNo: 'QF2', airline: '澳洲航空', origin: 'SIN', destination: 'LHR', departTime: '2026-10-12T02:15', arriveTime: '2026-10-12T08:45' }
    ],
    hub: { iata: 'SIN', city: '新加坡', layoverMinutes: 845 }
  },
  hubGuide: {
    city: '新加坡',
    visa: '中国护照过境新加坡满足条件可享 96 小时过境免签（VTF），需持第三国联程机票',
    transport: '樟宜机场至市区地铁约 30 分钟，出租车约 20 分钟',
    layoverOptions: [
      {
        duration: '12h',
        budget: { currency: 'SGD', min: 0, max: 50 },
        activities: [
          { icon: '🌿', title: '星耀樟宜雨漩涡', description: '航站楼内 40 米室内瀑布，免费参观', source: 'official' },
          { icon: '🍜', title: '天天海南鸡饭', description: '牛车水知名摊位，人均 6-8 新元', source: 'backpackers' },
          { icon: '🌃', title: '滨海湾灯光秀', description: '每晚 20:00/21:00 免费灯光表演', source: 'official' }
        ]
      }
    ]
  },
  preferences: {}
}

async function main() {
  console.time('行程生成')
  const { plan, usage, model } = await planTrip(apiKey, input, process.env.GUIDE_MODEL || undefined)
  console.timeEnd('行程生成')
  console.log(`模型 ${model} · ${usage} tokens\n`)
  console.log(`概述: ${plan.summary.zh}`)
  for (const day of plan.days) {
    console.log(`\n第${day.day}天 ${day.date} — ${day.title.zh}`)
    for (const it of day.items) {
      console.log(`  ${it.time} [${it.type}] ${it.title.zh}${it.note.zh ? ' — ' + it.note.zh : ''}`)
    }
  }
  const b = plan.budgetCny
  console.log(`\n预算: 机票¥${b.flights} + 住宿¥${b.stay} + 活动¥${b.activities} = ¥${b.total}`)
  for (const r of plan.reminders) console.log(`提醒: ${r.zh}`)
}

main().catch(e => {
  console.error('失败:', e.message)
  process.exit(1)
})
