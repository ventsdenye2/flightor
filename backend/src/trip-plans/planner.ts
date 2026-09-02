import type { OpenRouterClient } from '../providers/openrouter/client.js'
import { z } from 'zod'

const IATA_PATTERN = /^[A-Za-z]{3}$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const iataSchema = z.string().trim().regex(IATA_PATTERN, 'Must be a three-letter IATA code').transform(value => value.toUpperCase())
const dateSchema = z.string().trim().refine(isIsoDate, 'Must be a valid ISO date (YYYY-MM-DD)')

const segmentSchema = z.object({
  // SerpApi can omit these display fields. Preserve the empty value and use a
  // safe bilingual placeholder when rendering a rule/LLM plan.
  flightNo: z.string().trim().max(32),
  airline: z.string().trim().max(80),
  origin: iataSchema,
  destination: iataSchema,
  departTime: z.string().trim().min(1).max(64),
  arriveTime: z.string().trim().min(1).max(64),
  duration: z.number().finite().int().min(1).max(3_000),
  aircraft: z.string().trim().min(1).max(80).optional()
}).strict().superRefine((segment, ctx) => {
  if (segment.origin === segment.destination) {
    ctx.addIssue({ code: 'custom', message: 'Segment origin and destination must differ', path: ['destination'] })
  }
})

const hubSchema = z.object({
  iata: iataSchema,
  city: z.string().trim().min(1).max(100),
  layoverMinutes: z.number().finite().int().min(0).max(4_320),
  visaStatus: z.string().trim().min(1).max(40).optional(),
  visaNote: z.string().trim().max(500).optional(),
  baggageRecheck: z.boolean().default(false)
}).strict()

const activityGuideSchema = z.object({
  icon: z.string().trim().max(16).optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500),
  source: z.string().trim().max(40).optional()
}).strict()

const layoverGuideSchema = z.object({
  duration: z.string().trim().min(1).max(16),
  budget: z.object({
    currency: z.string().trim().min(1).max(8),
    min: z.number().finite().nonnegative().max(1_000_000),
    max: z.number().finite().nonnegative().max(1_000_000)
  }).strict(),
  activities: z.array(activityGuideSchema).max(20)
}).strict().superRefine((guide, ctx) => {
  if (guide.budget.max < guide.budget.min) {
    ctx.addIssue({ code: 'custom', message: 'Layover budget maximum must not be below minimum', path: ['budget', 'max'] })
  }
})

const hubGuideSchema = z.object({
  city: z.string().trim().min(1).max(100),
  visa: z.string().trim().max(500),
  transport: z.string().trim().max(500),
  layoverOptions: z.array(layoverGuideSchema).max(12)
}).strict()

const routeSchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  depart_date: dateSchema,
  stay_days: z.number().finite().int().min(1).max(7),
  budget_max: z.number().finite().nonnegative().max(10_000_000),
  interests: z.array(z.enum(['food', 'culture', 'nature', 'shopping', 'nightlife'])).max(5)
}).strict().superRefine((route, ctx) => {
  if (route.origin === route.destination) {
    ctx.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  }
})

const flightSchema = z.object({
  price: z.number().finite().nonnegative().max(10_000_000),
  segments: z.array(segmentSchema).min(1).max(8),
  hub: hubSchema.nullable()
}).strict()

export const tripPlanRequestSchema = z.object({
  route: routeSchema,
  flight: flightSchema,
  hub_guide: hubGuideSchema.nullable()
}).strict().superRefine((request, ctx) => {
  const { route, flight } = request
  const firstSegment = flight.segments[0]
  const lastSegment = flight.segments[flight.segments.length - 1]
  if (!firstSegment || !lastSegment) return

  if (route.origin !== firstSegment.origin) {
    ctx.addIssue({
      code: 'custom',
      message: 'Route origin must match the first flight segment origin',
      path: ['flight', 'segments', 0, 'origin']
    })
  }
  if (route.destination !== lastSegment.destination) {
    ctx.addIssue({
      code: 'custom',
      message: 'Route destination must match the last flight segment destination',
      path: ['flight', 'segments', flight.segments.length - 1, 'destination']
    })
  }

  for (let index = 1; index < flight.segments.length; index += 1) {
    const previous = flight.segments[index - 1]!
    const current = flight.segments[index]!
    if (previous.destination !== current.origin) {
      ctx.addIssue({
        code: 'custom',
        message: 'Adjacent flight segments must connect at the same airport',
        path: ['flight', 'segments', index, 'origin']
      })
    }
  }

  if (flight.hub) {
    const connectionPoints = new Set<string>()
    for (let index = 1; index < flight.segments.length; index += 1) {
      connectionPoints.add(flight.segments[index - 1]!.destination)
      connectionPoints.add(flight.segments[index]!.origin)
    }
    if (!connectionPoints.has(flight.hub.iata)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Hub must match an adjacent flight connection airport',
        path: ['flight', 'hub', 'iata']
      })
    }
  }
})

export type TripPlanRequest = z.infer<typeof tripPlanRequestSchema>
export type TripPlanSegment = TripPlanRequest['flight']['segments'][number]
export type TripPlanHub = NonNullable<TripPlanRequest['flight']['hub']>
export type TripPlanHubGuide = NonNullable<TripPlanRequest['hub_guide']>

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
  source: 'llm' | 'rules'
  warnings: string[]
}

const ITEM_TYPES: readonly TripItemType[] = ['flight', 'transit', 'activity', 'meal', 'rest', 'tip']
const INTEREST_ACTIVITIES: Record<string, BiText> = {
  food: { zh: '探索当地美食街区', en: 'Explore local food streets' },
  culture: { zh: '博物馆与老城漫步', en: 'Museums and old-town walk' },
  nature: { zh: '城市公园与自然景观', en: 'City parks and nature spots' },
  shopping: { zh: '商圈与市集逛街', en: 'Shopping districts and markets' },
  nightlife: { zh: '夜市与城市夜景', en: 'Night markets and city views' }
}

interface UnknownRecord {
  [key: string]: unknown
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result.length > 0 && result.length <= max ? result : undefined
}

function bilingual(value: unknown, limits: { zh: number; en: number }): BiText | undefined {
  if (!isRecord(value)) return undefined
  const zh = stringValue(value.zh, limits.zh)
  const en = stringValue(value.en, limits.en)
  return zh && en ? { zh, en } : undefined
}

function bilingualNote(value: unknown, limits: { zh: number; en: number }): BiText | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.zh !== 'string' || typeof value.en !== 'string') return undefined
  const zh = value.zh.trim()
  const en = value.en.trim()
  return zh.length <= limits.zh && en.length <= limits.en ? { zh, en } : undefined
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function timeOf(value: string): string {
  const match = value.match(/(?:T|\s)(\d{2}:\d{2})/)
  return match?.[1] ?? (value.slice(11, 16) || value.slice(0, 16))
}

function dateOf(value: string): string | undefined {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1]
}

function segmentItem(segment: TripPlanSegment): TripPlanItem {
  const crossDay = dateOf(segment.departTime) !== undefined
    && dateOf(segment.arriveTime) !== undefined
    && dateOf(segment.departTime) !== dateOf(segment.arriveTime)
  const flightNoZh = segment.flightNo || '航班'
  const flightNoEn = segment.flightNo || 'Flight'
  const airlineZh = segment.airline || '航空公司待确认'
  const airlineEn = segment.airline || 'Airline pending'
  return {
    time: timeOf(segment.departTime),
    type: 'flight',
    title: { zh: `${flightNoZh} ${segment.origin}→${segment.destination}`, en: `${flightNoEn} ${segment.origin}→${segment.destination}` },
    note: {
      zh: `${airlineZh}${crossDay ? ' · 跨日抵达' : ''}`,
      en: `${airlineEn}${crossDay ? ' · arrives next day' : ''}`
    }
  }
}

function selfTransferReminder(): BiText {
  return {
    zh: '如为自行中转，客票相互独立，误机风险需自行承担',
    en: 'If this is a self-transfer, tickets are separate and missed-connection risk is yours'
  }
}

function reminderKey(value: BiText): string {
  return `${value.zh}\u0000${value.en}`
}

function pushReminder(reminders: BiText[], value: BiText): void {
  if (!reminders.some(item => reminderKey(item) === reminderKey(value))) reminders.push(value)
}

function selectedLayoverActivities(input: TripPlanRequest): Array<{ title: string; description: string }> {
  const guide = input.hub_guide
  const hub = input.flight.hub
  if (!guide || !hub || hub.layoverMinutes < 480) return []
  const options = guide.layoverOptions
  if (options.length === 0) return []

  const optionWithHours = options.map(option => {
    const hours = Number(option.duration.match(/\d+/)?.[0] ?? 0)
    return { option, hours }
  })
  const suitable = optionWithHours
    .filter(item => item.hours > 0 && item.hours * 60 <= hub.layoverMinutes)
    .sort((left, right) => right.hours - left.hours)[0]
    ?? optionWithHours.sort((left, right) => left.hours - right.hours)[0]
  return suitable?.option.activities.slice(0, 2).map(activity => ({
    title: activity.title,
    description: activity.description
  })) ?? []
}

function canonicalReminders(input: TripPlanRequest): BiText[] {
  const reminders: BiText[] = []
  const hub = input.flight.hub
  if (hub && hub.layoverMinutes >= 480) {
    const visa = input.hub_guide?.visa || hub.visaNote
    if (visa) {
      pushReminder(reminders, {
        zh: `中转${hub.city}：${visa}`,
        en: `Transit ${hub.iata}: supplied note (${visa})`
      })
    }
  }
  if (input.flight.segments.length > 1) pushReminder(reminders, selfTransferReminder())
  if (hub?.baggageRecheck) {
    pushReminder(reminders, {
      zh: '请确认中转是否需要提取并重新托运行李',
      en: 'Check whether bags must be collected and re-checked during transit'
    })
  }
  const hasCrossDaySegment = input.flight.segments.some(segment => (
    dateOf(segment.departTime) !== undefined
      && dateOf(segment.arriveTime) !== undefined
      && dateOf(segment.departTime) !== dateOf(segment.arriveTime)
  ))
  if (hasCrossDaySegment) {
    pushReminder(reminders, {
      zh: '航段跨日抵达，请按当地日期安排行程',
      en: 'A flight arrives on the next day; plan by local dates'
    })
  }
  return reminders
}

function dayTitle(input: TripPlanRequest, day: number): BiText {
  if (day === 1) return { zh: '出发与中转', en: 'Departure & transit' }
  return {
    zh: `${input.route.destination}第${day}天`,
    en: `${input.route.destination} · day ${day}`
  }
}

function fallbackDays(input: TripPlanRequest): TripPlanDay[] {
  const activities = selectedLayoverActivities(input)
  return Array.from({ length: input.route.stay_days }, (_, index) => {
    const day = index + 1
    const items: TripPlanItem[] = day === 1
      ? input.flight.segments.map(segmentItem)
      : []
    if (day === 1 && input.flight.hub && input.flight.hub.layoverMinutes >= 480) {
      const layoverActivities = activities.length > 0
        ? activities
        : [{ title: `探索${input.flight.hub.city}`, description: '长中转可安排短途城市体验，务必预留返机场时间' }]
      layoverActivities.forEach((activity, activityIndex) => {
        items.push({
          time: activityIndex === 0 ? '12:00' : '15:00',
          type: 'activity',
          title: { zh: activity.title, en: `Layover activity in ${input.flight.hub!.city}` },
          note: { zh: activity.description, en: 'Follow the supplied hub guide and leave enough return time' }
        })
      })
      items.push({
        time: '17:00',
        type: 'tip',
        title: { zh: '提前返回机场', en: 'Return to the airport early' },
        note: { zh: '国际航段建议至少提前3小时到达', en: 'Arrive at least 3 hours before an international flight' }
      })
    }
    if (day > 1) {
      const interest = input.route.interests[(day - 2) % Math.max(1, input.route.interests.length)] ?? 'culture'
      const activity = INTEREST_ACTIVITIES[interest] ?? INTEREST_ACTIVITIES.culture!
      items.push({ time: '10:00', type: 'activity', title: activity, note: { zh: '', en: '' } })
      items.push({
        time: '18:00',
        type: 'meal',
        title: { zh: '当地晚餐', en: 'Local dinner' },
        note: { zh: '', en: '' }
      })
    }
    return {
      day,
      date: addDays(input.route.depart_date, day - 1),
      title: dayTitle(input, day),
      items
    }
  })
}

function fallbackBudget(input: TripPlanRequest): TripPlan['budgetCny'] {
  const flights = Math.round(input.flight.price)
  const stay = Math.max(0, (input.route.stay_days - 1) * 400)
  const activities = input.route.stay_days * 150
  return { flights, stay, activities, total: flights + stay + activities }
}

function fallbackSummary(input: TripPlanRequest): BiText {
  return {
    zh: `${input.route.origin}出发，${input.route.stay_days}天${input.route.destination}行程，按已选航段安排行程`,
    en: `${input.route.stay_days}-day ${input.route.destination} trip from ${input.route.origin}, arranged around the selected flights`
  }
}

function buildFallbackTripPlanInternal(input: TripPlanRequest, warnings: string[]): TripPlan {
  const budgetCny = fallbackBudget(input)
  const finalWarnings = [...new Set(warnings)]
  if (budgetCny.total > input.route.budget_max && !finalWarnings.includes('budget_exceeded')) finalWarnings.push('budget_exceeded')
  return {
    summary: fallbackSummary(input),
    days: fallbackDays(input),
    budgetCny,
    reminders: canonicalReminders(input),
    source: 'rules',
    warnings: finalWarnings
  }
}

function extractAssistantContent(response: Record<string, unknown>): string {
  const choices = response.choices
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) throw new Error('LLM response had no choices')
  const message = choices[0].message
  if (!isRecord(message) || typeof message.content !== 'string') throw new Error('LLM response had no assistant content')
  return message.content
}

function extractJson(content: string): UnknownRecord {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = fenced ? 0 : content.indexOf('{')
  const end = fenced ? fenced.length : content.lastIndexOf('}') + 1
  const candidate = fenced ?? (start >= 0 && end > start ? content.slice(start, end) : '')
  if (!candidate) throw new Error('LLM response did not contain JSON')
  const parsed: unknown = JSON.parse(candidate)
  if (!isRecord(parsed)) throw new Error('LLM response JSON was not an object')
  return parsed
}

function buildPlannerPrompt(input: TripPlanRequest): string {
  return [
    'You are FlightOR, a bilingual itinerary editor.',
    'Use only the supplied facts. The selected flight segments, airport codes, dates, layover, hub guide, and price are immutable; never invent or alter them.',
    'You may organize the facts and write concise generic activity suggestions matching the interests. Do not invent specific attractions, visa rules, transport facts, or prices.',
    'Return exactly one JSON object and no markdown with this shape:',
    '{"summary":{"zh":"...","en":"..."},"days":[{"day":1,"date":"YYYY-MM-DD","title":{"zh":"...","en":"..."},"items":[{"time":"HH:mm","type":"flight|transit|activity|meal|rest|tip","title":{"zh":"...","en":"..."},"note":{"zh":"...","en":"..."}}]}],"budgetCny":{"flights":0,"stay":0,"activities":0,"total":0},"reminders":[{"zh":"...","en":"..."}]}',
    'Include all selected flight segments as flight items. budgetCny.total is recomputed by the server and budgetCny.flights is ignored in favor of the supplied flight price.',
    `Facts: ${JSON.stringify(input)}`
  ].join('\n')
}

function asFiniteInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000) return fallback
  return Math.round(value)
}

function cleanBudgetEstimate(value: unknown, fallback: number): number {
  const estimate = asFiniteInt(value, fallback)
  // A model commonly emits zero when it omits an estimate. Keep the
  // deterministic server estimate whenever that category should be positive;
  // a one-day stay legitimately has a zero hotel-night estimate.
  return estimate === 0 && fallback > 0 ? fallback : estimate
}

function cleanItem(value: unknown): TripPlanItem | undefined {
  if (!isRecord(value)) return undefined
  const time = stringValue(value.time, 32)
  const type = typeof value.type === 'string' && (ITEM_TYPES as readonly string[]).includes(value.type)
    ? value.type as TripItemType
    : undefined
  const title = bilingual(value.title, { zh: 120, en: 240 })
  const note = value.note === undefined ? { zh: '', en: '' } : bilingualNote(value.note, { zh: 240, en: 480 })
  return time && type && title && note ? { time, type, title, note } : undefined
}

function cleanLlmDays(raw: unknown, input: TripPlanRequest): TripPlanDay[] {
  if (!Array.isArray(raw)) return []
  const result = new Map<number, TripPlanDay>()
  for (const value of raw) {
    if (!isRecord(value)) continue
    const day = typeof value.day === 'number' && Number.isInteger(value.day) ? value.day : NaN
    if (!Number.isInteger(day) || day < 1 || day > input.route.stay_days || result.has(day)) continue
    const title = bilingual(value.title, { zh: 120, en: 240 })
    const items = Array.isArray(value.items)
      ? value.items.map(cleanItem).filter((item): item is TripPlanItem => Boolean(item)).slice(0, 24)
      : []
    if (!title || items.length === 0) continue
    result.set(day, {
      day,
      date: addDays(input.route.depart_date, day - 1),
      title,
      items
    })
  }
  return [...result.values()].sort((left, right) => left.day - right.day)
}

function mergeCanonicalFlightItems(days: TripPlanDay[], input: TripPlanRequest): TripPlanDay[] {
  const fallback = fallbackDays(input)
  const byDay = new Map(days.map(day => [day.day, day]))
  const merged = fallback.map(base => {
    const current = byDay.get(base.day)
    if (!current) return base
    if (base.day !== 1) return current
    return {
      ...current,
      date: base.date,
      items: [...input.flight.segments.map(segmentItem), ...current.items.filter(item => item.type !== 'flight')].slice(0, 24)
    }
  })
  return merged
}

function cleanLlmPlan(raw: UnknownRecord, input: TripPlanRequest): TripPlan | undefined {
  const summary = bilingual(raw.summary, { zh: 160, en: 320 })
  const llmDays = cleanLlmDays(raw.days, input)
  if (!summary || llmDays.length === 0) return undefined
  const days = mergeCanonicalFlightItems(llmDays, input)

  const fallbackBudget = fallbackBudgetOf(input)
  const rawBudget = isRecord(raw.budgetCny) ? raw.budgetCny : {}
  const stay = cleanBudgetEstimate(rawBudget.stay, fallbackBudget.stay)
  const activities = cleanBudgetEstimate(rawBudget.activities, fallbackBudget.activities)
  const flights = fallbackBudget.flights
  // Reminders can carry visa, transport, or safety claims. They are facts,
  // not prose, so never accept model-authored reminders; only server-derived
  // reminders from the request materials are returned.
  const reminders = canonicalReminders(input)
  const warnings: string[] = []
  if (flights + stay + activities > input.route.budget_max) warnings.push('budget_exceeded')
  return {
    summary,
    days,
    budgetCny: { flights, stay, activities, total: flights + stay + activities },
    reminders,
    source: 'llm',
    warnings
  }
}

function fallbackBudgetOf(input: TripPlanRequest): TripPlan['budgetCny'] {
  return fallbackBudget(input)
}

export async function runTripPlanner(
  client: Pick<OpenRouterClient, 'chat'>,
  input: TripPlanRequest
): Promise<TripPlan> {
  try {
    const response = await client.chat([
      { role: 'system', content: 'You edit bilingual travel itineraries. Facts supplied by the server are immutable.' },
      { role: 'user', content: buildPlannerPrompt(input) }
    ], undefined, {
      maxTokens: 1_700,
      temperature: 0.2,
      reasoning: { effort: 'none', exclude: true }
    })
    const plan = cleanLlmPlan(extractJson(extractAssistantContent(response)), input)
    if (plan) return plan
  } catch {
    // Provider outages and malformed model output are intentionally non-fatal.
  }
  return buildFallbackTripPlanInternal(input, ['llm_fallback'])
}

export function buildFallbackTripPlan(input: TripPlanRequest, warnings: string[] = []): TripPlan {
  return buildFallbackTripPlanInternal(input, warnings)
}
