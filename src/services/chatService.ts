// src/services/chatService.ts — 需求对话服务
// 真实模式统一走自建后端；Mock 模式保留本地规则，便于无网络演示。
import { request, USE_MOCK } from '../utils/request'
import { AIRPORTS } from '../mocks/airports'
import { daysFromNow, toDateString } from '../utils/format'
import type { Interest } from '../types/flight'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** agent 抽取的需求槽位（对齐核心检索系统入参） */
export interface ChatSlots {
  origin?: string
  destination?: string
  depart_date_from?: string
  depart_date_to?: string
  stay_min?: number
  stay_max?: number
  trip_type?: 'oneway' | 'roundtrip'
  budget_max?: number
  interests?: Interest[]
  transfer_pref?: 'any' | 'direct' | 'transfer'
}

export interface ChatTurnResult {
  reply: { zh: string; en: string }
  slots: ChatSlots
  ready: boolean
  missing: string[]
  source?: 'llm' | 'rules'
  warnings?: string[]
}

// ---------- Mock：本地规则解析 ----------

const INTEREST_KEYWORDS: Array<{ re: RegExp; key: Interest }> = [
  { re: /美食|吃|food/i, key: 'food' },
  { re: /文化|博物馆|古迹|历史|culture|museum/i, key: 'culture' },
  { re: /自然|风景|海边|山|nature|beach/i, key: 'nature' },
  { re: /购物|买|shopping/i, key: 'shopping' },
  { re: /夜生活|酒吧|nightlife|bar\b/i, key: 'nightlife' }
]

/** 在文本中按城市名/IATA 找机场，返回出现位置排序的候选 */
function findAirportsInText(text: string): Array<{ iata: string; index: number }> {
  const found: Array<{ iata: string; index: number }> = []
  const seen = new Set<string>()
  for (const a of AIRPORTS) {
    const keys = [a.city, a.enCity, a.iata]
    for (const k of keys) {
      const idx = text.toLowerCase().indexOf(k.toLowerCase())
      if (idx >= 0 && !seen.has(a.iata)) {
        // 同城多机场只取第一个（主机场在表中靠前）
        const cityTaken = found.some(f => {
          const fa = AIRPORTS.find(x => x.iata === f.iata)
          return fa?.city === a.city
        })
        if (!cityTaken) {
          found.push({ iata: a.iata, index: idx })
          seen.add(a.iata)
        }
        break
      }
    }
  }
  return found.sort((x, y) => x.index - y.index)
}

function mockParse(text: string, prev: ChatSlots): ChatSlots {
  const slots: ChatSlots = { ...prev }

  // 城市：「从X」→出发，「去/到X」→目的地；无方向词按出现顺序补位
  const mentions = findAirportsInText(text)
  for (const m of mentions) {
    const before = text.slice(Math.max(0, m.index - 2), m.index)
    if (/从|由/.test(before)) slots.origin = m.iata
    else if (/去|到|飞|想看/.test(before)) slots.destination = m.iata
  }
  const unassigned = mentions.filter(m => m.iata !== slots.origin && m.iata !== slots.destination)
  for (const m of unassigned) {
    if (!slots.destination) slots.destination = m.iata
    else if (!slots.origin) slots.origin = m.iata
  }

  // 天数：「玩N天」「N天」
  const stay = text.match(/玩?\s*(\d{1,2})\s*天/) || text.match(/(\d{1,2})\s*days?/i)
  if (stay) {
    const n = Number(stay[1])
    if (n >= 1 && n <= 60) {
      slots.stay_min = Math.max(1, n - 1)
      slots.stay_max = n + 1
    }
  }
  if (/一周|一个星期/.test(text)) {
    slots.stay_min = 6
    slots.stay_max = 8
  }
  if (/单程/.test(text)) slots.trip_type = 'oneway'
  if (/往返|来回|round[ -]?trip/i.test(text)) slots.trip_type = 'roundtrip'

  // 预算：「预算N」「N元/块」「Nk/千/万」
  const budgetWan = text.match(/(\d+(?:\.\d+)?)\s*万/)
  const budgetK = text.match(/(\d+(?:\.\d+)?)\s*[k千]/i)
  const budgetYuan = text.match(/(?:预算|budget)\D{0,4}(\d{3,6})/i) || text.match(/(\d{3,6})\s*(?:元|块)/)
  if (budgetWan) slots.budget_max = Math.round(Number(budgetWan[1]) * 10000)
  else if (budgetK) slots.budget_max = Math.round(Number(budgetK[1]) * 1000)
  else if (budgetYuan) slots.budget_max = Number(budgetYuan[1])

  // 日期：「N月」「N月N日」「下周」「下个月」
  const today = new Date()
  const md = text.match(/(\d{1,2})\s*月\s*(\d{1,2})?\s*[日号]?/)
  if (md) {
    const month = Number(md[1])
    const day = md[2] ? Number(md[2]) : 1
    if (month >= 1 && month <= 12) {
      const year = month < today.getMonth() + 1 ? today.getFullYear() + 1 : today.getFullYear()
      const from = new Date(year, month - 1, day)
      if (from.getTime() > today.getTime()) {
        slots.depart_date_from = toDateString(from)
        const to = new Date(from)
        to.setDate(to.getDate() + 3)
        slots.depart_date_to = toDateString(to)
      }
    }
  }
  if (/下周|next week/i.test(text)) {
    slots.depart_date_from = daysFromNow(7)
    slots.depart_date_to = daysFromNow(10)
  }
  if (/下个月|next month/i.test(text)) {
    slots.depart_date_from = daysFromNow(30)
    slots.depart_date_to = daysFromNow(34)
  }

  // 兴趣与中转偏好
  const interests = INTEREST_KEYWORDS.filter(k => k.re.test(text)).map(k => k.key)
  if (interests.length > 0) slots.interests = interests
  if (/直飞/.test(text)) slots.transfer_pref = 'direct'
  if (/中转|顺便玩|stopover/i.test(text)) slots.transfer_pref = 'transfer'

  return slots
}

function cityLabel(iata: string, en: boolean): string {
  const a = AIRPORTS.find(x => x.iata === iata)
  return a ? (en ? a.enCity : a.city) : iata
}

function mockReply(slots: ChatSlots, ready: boolean, missing: string[]): { zh: string; en: string } {
  if (ready) {
    const o = cityLabel(slots.origin!, false)
    const d = cityLabel(slots.destination!, false)
    const oe = cityLabel(slots.origin!, true)
    const de = cityLabel(slots.destination!, true)
    return {
      zh: `需求已明确：${o} → ${d}，${slots.depart_date_from} 出发${slots.budget_max ? `，预算 ¥${slots.budget_max}` : ''}。可以开始搜索了！`,
      en: `All set: ${oe} → ${de}, departing ${slots.depart_date_from}${slots.budget_max ? `, budget ¥${slots.budget_max}` : ''}. Ready to search!`
    }
  }
  const ASK_ZH: Record<string, string> = {
    origin: '从哪个城市出发',
    destination: '想去哪儿',
    depart_date_from: '大概什么时候出发'
  }
  const ASK_EN: Record<string, string> = {
    origin: 'which city you depart from',
    destination: 'where you want to go',
    depart_date_from: 'when you plan to leave'
  }
  const asks = missing.slice(0, 2)
  return {
    zh: `好的～再告诉我${asks.map(k => ASK_ZH[k]).join('、')}？`,
    en: `Got it — could you tell me ${asks.map(k => ASK_EN[k]).join(' and ')}?`
  }
}

// ---------- 服务入口 ----------

const READY_KEYS: Array<keyof ChatSlots> = ['origin', 'destination', 'depart_date_from']

export async function talkToAgent(messages: ChatMessage[], slots: ChatSlots): Promise<ChatTurnResult> {
  // Mock：本地规则解析兼容离线演示。
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 500))
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    const merged = mockParse(lastUser?.content ?? '', slots)
    const missing = READY_KEYS.filter(k => !merged[k])
    const ready = missing.length === 0
    return { reply: mockReply(merged, ready, missing), slots: merged, ready, missing }
  }

  // 真实模式：对话、OpenRouter 密钥和机场白名单均由自建后端管理。
  return request<ChatTurnResult>({
    url: '/v1/agent/chat',
    method: 'POST',
    data: {
      messages: messages.slice(-12),
      slots
    },
    retry: 0,
    timeout: 60000
  })
}
