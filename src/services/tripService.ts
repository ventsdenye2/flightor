// src/services/tripService.ts — AI 行程规划服务
// 真实模式走 cloud/tripAgent（OpenRouter）；Mock 模式本地规则生成，离线可用
import { request, USE_MOCK } from '../utils/request'
import { hasLlmKey, chatCompletion, extractJson } from './llm'
import { getHubExperience, getHubVisaNote } from '../mocks/hubs'
import { cityOf } from '../mocks/airports'
import type { FlightOption, SearchParams, Interest } from '../types/flight'

export interface BiText {
  zh: string
  en: string
}

export type TripItemType = 'flight' | 'transit' | 'activity' | 'meal' | 'rest' | 'tip'

export interface TripPlanItem {
  time: string
  type: TripItemType
  title: BiText
  note: BiText
}

export interface TripPlanDay {
  day: number
  date: string
  title: BiText
  items: TripPlanItem[]
}

export interface TripPlan {
  summary: BiText
  days: TripPlanDay[]
  budgetCny: { flights: number; stay: number; activities: number; total: number }
  reminders: BiText[]
}

// ---------- Mock：本地规则生成 ----------
const INTEREST_ACT: Record<Interest, BiText> = {
  food: { zh: '觅食当地美食街区', en: 'Explore local food streets' },
  culture: { zh: '博物馆与老城漫步', en: 'Museums and old town walk' },
  nature: { zh: '城市公园与自然景观', en: 'City parks and nature spots' },
  shopping: { zh: '商圈与集市采买', en: 'Shopping districts and markets' },
  nightlife: { zh: '夜市与观景夜色', en: 'Night markets and city views' }
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function stayDaysOf(params: SearchParams): number {
  if (params.tripType === 'roundtrip' && params.stayRange) {
    return Math.min(5, Math.round((params.stayRange[0] + params.stayRange[1]) / 2))
  }
  return 2
}

function mockTripPlan(flight: FlightOption, params: SearchParams): TripPlan {
  const destZh = cityOf(params.destination, 'zh')
  const destEn = cityOf(params.destination, 'en')
  const dayCount = stayDaysOf(params)
  const days: TripPlanDay[] = []

  // 第1天：航班 + 中转玩法
  const day1: TripPlanItem[] = flight.segments.map(seg => ({
    time: seg.departTime?.slice(11, 16) ?? '',
    type: 'flight' as const,
    title: {
      zh: `${seg.flightNo} ${cityOf(seg.origin, 'zh')}→${cityOf(seg.destination, 'zh')}`,
      en: `${seg.flightNo} ${cityOf(seg.origin, 'en')}→${cityOf(seg.destination, 'en')}`
    },
    note: { zh: seg.airline, en: seg.airline }
  }))
  if (flight.hub && flight.hub.layoverMinutes >= 480) {
    const gZh = getHubExperience(flight.hub.iata, 'zh')
    const gEn = getHubExperience(flight.hub.iata, 'en')
    const actsZh = gZh?.layoverOptions[0]?.activities.slice(0, 2) ?? []
    const actsEn = gEn?.layoverOptions[0]?.activities.slice(0, 2) ?? []
    actsZh.forEach((act, i) => {
      day1.splice(1 + i, 0, {
        time: i === 0 ? '12:00' : '15:00',
        type: 'activity',
        title: { zh: act.title, en: actsEn[i]?.title ?? act.title },
        note: { zh: act.description, en: actsEn[i]?.description ?? act.description }
      })
    })
    day1.splice(1 + actsZh.length, 0, {
      time: '17:00',
      type: 'tip',
      title: { zh: '返回机场', en: 'Back to airport' },
      note: { zh: '国际段建议提前3小时到达', en: 'Arrive 3h before intl departure' }
    })
  }
  days.push({
    day: 1,
    date: params.departDate,
    title: { zh: '出发与中转', en: 'Departure & transit' },
    items: day1
  })

  // 中段：按兴趣安排
  const interests = params.interests.length > 0 ? params.interests : (['culture'] as Interest[])
  for (let i = 2; i <= dayCount - 1; i++) {
    const act = INTEREST_ACT[interests[(i - 2) % interests.length]]
    days.push({
      day: i,
      date: addDays(params.departDate, i - 1),
      title: { zh: `${destZh}游玩`, en: `${destEn} day` },
      items: [
        { time: '10:00', type: 'activity', title: act, note: { zh: '', en: '' } },
        { time: '18:00', type: 'meal', title: { zh: '当地晚餐', en: 'Local dinner' }, note: { zh: '', en: '' } }
      ]
    })
  }

  // 末日：返程/自由活动
  days.push({
    day: dayCount,
    date: addDays(params.departDate, dayCount - 1),
    title: params.tripType === 'roundtrip' ? { zh: '返程', en: 'Return' } : { zh: '自由活动', en: 'Free day' },
    items: [
      {
        time: '10:00',
        type: params.tripType === 'roundtrip' ? 'transit' : 'rest',
        title:
          params.tripType === 'roundtrip'
            ? { zh: '前往机场返程', en: 'Head to airport for return' }
            : { zh: '自由安排', en: 'At leisure' },
        note: { zh: '', en: '' }
      }
    ]
  })

  const stay = (dayCount - 1) * 400
  const activities = dayCount * 150
  const reminders: BiText[] = []
  if (flight.hub) {
    const vZh = getHubVisaNote(flight.hub.iata, 'zh')
    const vEn = getHubVisaNote(flight.hub.iata, 'en')
    if (vZh) reminders.push({ zh: `中转${flight.hub.city}：${vZh}`, en: `Transit ${flight.hub.iata}: ${vEn}` })
  }
  reminders.push({ zh: '自行中转为独立客票，误机风险自担', en: 'Self-transfer tickets are separate; missed connections at your own risk' })

  return {
    summary: {
      zh: `${cityOf(params.origin, 'zh')}出发，${dayCount}天${destZh}行程，含中转安排与预算估算`,
      en: `${dayCount}-day ${destEn} trip from ${cityOf(params.origin, 'en')} with transit plan and budget`
    },
    days,
    budgetCny: { flights: flight.totalPrice, stay, activities, total: flight.totalPrice + stay + activities },
    reminders
  }
}

// ---------- 对外服务 ----------

// 复用云函数纯逻辑（prompt 与 Schema 白名单校验单一来源）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tripAgent = require('../../cloud/tripAgent/agent') as {
  buildPrompt: (input: unknown) => string
  validate: (plan: unknown) => TripPlan | null
}

/** 事实素材组装（直连与云函数两条通道共用同一形状） */
function factsOf(flight: FlightOption, params: SearchParams) {
  const guide = flight.hub ? getHubExperience(flight.hub.iata, 'zh') : undefined
  return {
    route: {
      origin: params.origin,
      destination: params.destination,
      depart_date: params.departDate,
      stay_days: stayDaysOf(params),
      budget_max: params.budgetRange[1],
      interests: params.interests
    },
    flight: {
      price: flight.totalPrice,
      segments: flight.segments,
      hub: flight.hub ?? null
    },
    hub_guide: guide
      ? {
          city: guide.city,
          visa: guide.transitVisa,
          transport: guide.transportFromAirport,
          layoverOptions: guide.layoverOptions
        }
      : null
  }
}

export async function planTrip(flight: FlightOption, params: SearchParams): Promise<TripPlan> {
  // ① key 已注入：OpenRouter 直连生成（事实素材同构云函数，模型只编排不生成事实）
  if (hasLlmKey()) {
    const facts = factsOf(flight, params)
    const content = await chatCompletion(
      [
        {
          role: 'user',
          content: tripAgent.buildPrompt({
            route: facts.route,
            flight: facts.flight,
            hubGuide: facts.hub_guide,
            preferences: {}
          })
        }
      ],
      { temperature: 0.4, maxTokens: 4000 }
    )
    const plan = tripAgent.validate(extractJson(content))
    if (!plan) throw new Error('plan validation failed')
    return plan
  }

  // ② 无 key 且 mock：本地规则生成
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 800))
    return mockTripPlan(flight, params)
  }

  // ③ 生产通道：云函数（事实素材整体传入）
  return request<TripPlan>({
    url: '/trip/plan',
    method: 'POST',
    data: factsOf(flight, params),
    timeout: 60000, // LLM 生成较慢，放宽超时
    retry: 0
  })
}
