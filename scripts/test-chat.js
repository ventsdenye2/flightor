// scripts/test-chat.js — 本地实测 chatAgent 需求对话管线
// 用法：node scripts/test-chat.js
// Key 来源：环境变量 OPENROUTER_API_KEY 或项目根目录 openrouter.txt
const fs = require('fs')
const path = require('path')
const { chatTurn } = require('../cloud/chatAgent/agent')

const apiKey =
  process.env.OPENROUTER_API_KEY ||
  fs.readFileSync(path.join(__dirname, '..', 'openrouter.txt'), 'utf-8').trim()

// 精简机场表（与前端 AIRPORTS 同构，取代表性子集测试）
const airports = [
  { iata: 'SZX', city: '深圳', enCity: 'Shenzhen' },
  { iata: 'CAN', city: '广州', enCity: 'Guangzhou' },
  { iata: 'HKG', city: '香港', enCity: 'Hong Kong' },
  { iata: 'PVG', city: '上海', enCity: 'Shanghai' },
  { iata: 'PEK', city: '北京', enCity: 'Beijing' },
  { iata: 'LHR', city: '伦敦', enCity: 'London' },
  { iata: 'CDG', city: '巴黎', enCity: 'Paris' },
  { iata: 'SIN', city: '新加坡', enCity: 'Singapore' },
  { iata: 'NRT', city: '东京', enCity: 'Tokyo' }
]

async function main() {
  const model = process.env.GUIDE_MODEL || undefined
  let slots = {}
  const messages = []

  // 多轮对话脚本：故意先说残缺需求，测追问与槽位累积
  const turns = [
    '想出去玩一周，预算一万五左右，喜欢吃',
    '去伦敦吧，深圳出发',
    '十月初走，中转可以顺便玩一玩'
  ]

  for (const text of turns) {
    messages.push({ role: 'user', content: text })
    console.log(`\n👤 ${text}`)
    console.time('耗时')
    const res = await chatTurn(apiKey, { messages, slots, airports }, model)
    console.timeEnd('耗时')
    slots = res.slots
    messages.push({ role: 'assistant', content: res.reply.zh })
    console.log(`🤖 ${res.reply.zh}`)
    console.log(`   slots: ${JSON.stringify(res.slots)}`)
    console.log(`   ready: ${res.ready}  missing: ${JSON.stringify(res.missing)}`)
    if (res.usage) console.log(`   tokens: ${res.usage.total_tokens}`)
  }
}

main().catch(err => {
  console.error('测试失败:', err.message)
  process.exit(1)
})
