// chatHistoryCore — 本地 Agent 会话的版本化数据边界
//
// 这个模块只包含纯函数和类型，故意不依赖 Taro、MobX 或网络服务：
// - rehydrate 时严格收窄未知缓存，损坏数据只会被忽略；
// - 所有数组和文本都有上限，避免本地缓存随对话无限增长；
// - ChatStore 只把这里产出的快照交给 storage wrapper 持久化。
import type {
  CloudArtifactRef,
  CloudTripContextSummary,
  ConversationMessage,
  ConversationPhase,
  ConversationDelivery,
  DestinationRecommendation,
  DestinationRegion,
  DestinationInterest,
  SuggestedAction,
  TripState,
  TravelGuide,
  TravelGuideDay,
  TravelGuideItem,
  TravelGuideRoute,
  TravelGuideSource,
  TravelGuideSourceKind,
  TravelGuidePublication
} from '../services/conversationService'
import type { ConfirmedPick, RouteLeg, RoutePick, RouteResult } from '../services/routeService'
import type { RouteGenerationRunView } from '../services/routeGenerationService'

export const CHAT_HISTORY_VERSION = 1 as const
export const MAX_CHAT_SESSIONS = 20
export const MAX_CHAT_MESSAGES = 24
export const MAX_CHAT_TIMELINE = 12
export const MAX_CHAT_RECOMMENDATIONS = 3
export const MAX_CHAT_ACTIONS = 3
export const MAX_CHAT_ARTIFACT_REFS = 100
export const MAX_CHAT_DELIVERY_GOALS = 64
export const MAX_CHAT_ROUTES = 3
export const MAX_CHAT_ROUTE_LEGS = 8
export const MAX_CHAT_MESSAGE_CHARS = 1_200
export const MAX_CHAT_WARNING_CHARS = 240
export const MAX_CHAT_SUMMARY_CHARS = 96
export const MAX_CHAT_HISTORY_CHARS = 450_000
export const MAX_CHAT_GUIDE_DAYS = 60
export const MAX_CHAT_GUIDE_ITEMS = 4
export const MAX_CHAT_GUIDE_SOURCES = 96
export const MAX_CHAT_GUIDE_SOURCE_CHARS = 180
export const MAX_CHAT_GUIDE_URL_CHARS = 2_048
export const MAX_CHAT_GUIDE_TEXT_CHARS = 96_000

const REGIONS: readonly DestinationRegion[] = ['japan', 'schengen', 'visa_free']
const INTERESTS: readonly DestinationInterest[] = ['culture', 'food', 'nature', 'shopping', 'nightlife']
const PHASES: readonly ConversationPhase[] = ['discover', 'clarify', 'plan']
const PRIORITIES: readonly TripState['priorities'][number][] = ['budget', 'comfort', 'few_transfers', 'culture']
const PACES: readonly TripState['pace'][] = ['relaxed', 'balanced', 'many_cities']
const ROUTE_KINDS: readonly RoutePick['kind'][] = ['cheapest', 'mostCities', 'mostNights']
const LEGACY_GUIDE_MESSAGE = '此前缓存包含旧版攻略内容；预算与攻略正文已隐藏，请重新加载已发布攻略。'

export interface ConversationTurnSnapshot {
  id: string
  user: ConversationMessage
  assistant: ConversationMessage | null
  recommendations: DestinationRecommendation[]
  suggestedActions: SuggestedAction[]
  routes: RoutePick[]
  warnings: string[]
  /** Cloud response metadata; absent on readable legacy v1 turns. */
  tripContextSummary?: CloudTripContextSummary
  artifactRefs?: CloudArtifactRef[]
  stopReason?: string
  delivery?: ConversationDelivery
  routeGeneration?: RouteGenerationRunView
  travelGuide?: TravelGuide
  error?: string
}

export interface ChatSessionRecord {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  summary: string
  messages: ConversationMessage[]
  timeline: ConversationTurnSnapshot[]
  state: TripState
  phase: ConversationPhase
  recommendations: DestinationRecommendation[]
  suggestedActions: SuggestedAction[]
  routes: RoutePick[]
  warnings: string[]
  /** Owner-scoped cloud material; legacy sessions omit these fields. */
  ownerId?: string
  tripId?: string
  conversationId?: string
  artifactRefs: CloudArtifactRef[]
  tripContextSummary?: CloudTripContextSummary
  stopReason?: string
  routeGeneration?: RouteGenerationRunView
  routeGenerationIdempotencyKey?: string
}

export interface PersistedChatHistory {
  version: typeof CHAT_HISTORY_VERSION
  currentSessionId: string
  sessions: ChatSessionRecord[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, max) : null
}

function cleanOptionalText(value: unknown, max: number): string | undefined {
  return cleanText(value, max) ?? undefined
}

function cleanIata(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

function cleanIatas(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  for (const item of value) {
    const iata = cleanIata(item)
    if (iata && !result.includes(iata)) result.push(iata)
    if (result.length >= max) break
  }
  return result
}

function cleanIataSequence(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  for (const item of value) {
    const iata = cleanIata(item)
    if (iata) result.push(iata)
    if (result.length >= max) break
  }
  return result
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value >= min && value <= max ? value : null
}

function integerNumber(value: unknown, min: number, max: number): number | null {
  const number = finiteNumber(value, min, max)
  return number !== null && Number.isInteger(number) ? number : null
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null
}

function cleanStringList(value: unknown, max: number, itemMax: number): string[] | null {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  for (const item of value) {
    const text = cleanText(item, itemMax)
    if (text && !result.includes(text)) result.push(text)
    if (result.length >= max) break
  }
  return result
}

function cleanEnumList<T extends string>(value: unknown, allowed: readonly T[], max: number): T[] | null {
  if (!Array.isArray(value)) return null
  const result: T[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.includes(item as T)) continue
    const entry = item as T
    if (!result.includes(entry)) result.push(entry)
    if (result.length >= max) break
  }
  return result
}

function cleanBilingual(value: unknown, max: number): { zh: string; en: string } | null {
  if (!isRecord(value)) return null
  const zh = cleanText(value.zh, max)
  const en = cleanText(value.en, max)
  return zh && en ? { zh, en } : null
}

function sanitizeMessage(value: unknown): ConversationMessage | null {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant')) return null
  const content = cleanText(value.content, MAX_CHAT_MESSAGE_CHARS)
  return content ? { role: value.role, content } : null
}

export function sanitizeTripState(value: unknown): TripState | null {
  if (!isRecord(value)) return null
  const interests = cleanEnumList(value.interests, INTERESTS, INTERESTS.length)
  const regions = cleanEnumList(value.regions, REGIONS, REGIONS.length)
  const requiredIatas = cleanIatas(value.required_iatas, 8)
  const excludedIatas = cleanIatas(value.excluded_iatas, 8)
  const priorities = cleanEnumList(value.priorities, PRIORITIES, PRIORITIES.length)
  if (!interests || !regions || !requiredIatas || !excludedIatas || !priorities) return null

  const origin = value.origin === null || value.origin === undefined ? null : cleanIata(value.origin)
  const windowFrom = value.window_from === null || value.window_from === undefined ? null : cleanDate(value.window_from)
  const windowTo = value.window_to === null || value.window_to === undefined ? null : cleanDate(value.window_to)
  const travelDays = value.travel_days === null || value.travel_days === undefined ? null : integerNumber(value.travel_days, 1, 60)
  const budgetMax = value.budget_max === null || value.budget_max === undefined ? null : finiteNumber(value.budget_max, 0, 100_000_000)
  const destinationMode = value.destination_mode === 'recommend' || value.destination_mode === 'explicit'
    ? value.destination_mode
    : null
  const pace = PACES.includes(value.pace as TripState['pace']) ? value.pace as TripState['pace'] : null
  if (value.origin !== null && value.origin !== undefined && origin === null) return null
  if (value.window_from !== null && value.window_from !== undefined && windowFrom === null) return null
  if (value.window_to !== null && value.window_to !== undefined && windowTo === null) return null
  if (value.travel_days !== null && value.travel_days !== undefined && travelDays === null) return null
  if (value.budget_max !== null && value.budget_max !== undefined && budgetMax === null) return null
  if (!destinationMode || !pace) return null

  return {
    origin,
    window_from: windowFrom,
    window_to: windowTo,
    travel_days: travelDays,
    budget_max: budgetMax,
    interests,
    regions,
    required_iatas: requiredIatas,
    excluded_iatas: excludedIatas,
    destination_mode: destinationMode,
    pace,
    priorities
  }
}

function sanitizeRecommendation(value: unknown): DestinationRecommendation | null {
  if (!isRecord(value)) return null
  const iata = cleanIata(value.iata)
  const cityZh = cleanText(value.cityZh, 80)
  const cityEn = cleanText(value.cityEn, 80)
  const region = REGIONS.includes(value.region as DestinationRegion) ? value.region as DestinationRegion : null
  const reason = cleanBilingual(value.reason, 400)
  const suggestedDays = integerNumber(value.suggestedDays, 1, 60)
  if (!iata || !cityZh || !cityEn || !region || !reason || suggestedDays === null) return null
  return { iata, cityZh, cityEn, region, reason, suggestedDays }
}

function sanitizeAction(value: unknown): SuggestedAction | null {
  if (!isRecord(value)) return null
  const id = cleanText(value.id, 64)
  const label = cleanBilingual(value.label, 120)
  const message = cleanText(value.message, MAX_CHAT_MESSAGE_CHARS)
  if (!id || !label || !message) return null
  const kind = value.kind === 'message' || value.kind === 'route_generation' ? value.kind : undefined
  const href = cleanOptionalText(value.href, 240)
  const unavailableReason = cleanOptionalText(value.unavailableReason, 240)
  if (value.disabled !== undefined && typeof value.disabled !== 'boolean') return null
  return {
    id,
    label,
    message,
    ...(kind ? { kind } : {}),
    ...(href ? { href } : {}),
    ...(value.disabled === true ? { disabled: true } : {}),
    ...(unavailableReason ? { unavailableReason } : {})
  }
}

function sanitizeCloudLocation(value: unknown): CloudTripContextSummary['origin'] | null {
  if (!isRecord(value)) return null
  const id = cleanText(value.id, 128)
  const type = value.type === 'city' || value.type === 'airport' ? value.type : null
  const name = cleanText(value.name, 160)
  const countryCode = typeof value.countryCode === 'string' && /^[A-Z]{2}$/.test(value.countryCode)
    ? value.countryCode
    : null
  if (!id || !type || !name || !countryCode) return null
  const iata = value.iata === undefined ? undefined : cleanIata(value.iata)
  const cityCode = value.cityCode === undefined ? undefined : cleanIata(value.cityCode)
  if (value.iata !== undefined && !iata) return null
  if (value.cityCode !== undefined && !cityCode) return null
  const latitude = value.latitude === undefined ? undefined : finiteNumber(value.latitude, -90, 90)
  const longitude = value.longitude === undefined ? undefined : finiteNumber(value.longitude, -180, 180)
  if (value.latitude !== undefined && latitude === null) return null
  if (value.longitude !== undefined && longitude === null) return null
  const timezone = value.timezone === undefined ? undefined : cleanText(value.timezone, 80)
  if (value.timezone !== undefined && !timezone) return null
  return {
    id,
    type,
    name,
    countryCode,
    ...(iata ? { iata } : {}),
    ...(cityCode ? { cityCode } : {}),
    ...(latitude !== undefined && latitude !== null ? { latitude } : {}),
    ...(longitude !== undefined && longitude !== null ? { longitude } : {}),
    ...(timezone ? { timezone } : {})
  }
}

function sanitizeCloudWindow(value: unknown): CloudTripContextSummary['departureWindow'] | null {
  if (!isRecord(value) || (value.precision !== 'exact' && value.precision !== 'approximate')) return null
  const from = value.from === undefined ? undefined : cleanDate(value.from)
  const to = value.to === undefined ? undefined : cleanDate(value.to)
  if (value.from !== undefined && !from) return null
  if (value.to !== undefined && !to) return null
  if (!from && !to) return null
  if (from && to && to < from) return null
  return { ...(from ? { from } : {}), ...(to ? { to } : {}), precision: value.precision }
}

/** Strictly bound the compact cloud Trip Context snapshot before persistence. */
export function sanitizeCloudTripContextSummary(value: unknown): CloudTripContextSummary | undefined {
  if (!isRecord(value) || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0 || !Array.isArray(value.interests)) return undefined
  if (typeof value.readyForRouteGeneration !== 'boolean' || !isRecord(value.destinations)) return undefined
  const destinationMode = value.destinations.mode
  if (destinationMode !== 'explicit' && destinationMode !== 'open' && destinationMode !== 'mixed') return undefined
  const required = Array.isArray(value.destinations.required)
    ? value.destinations.required.slice(0, 24).map(sanitizeCloudLocation).filter((item): item is NonNullable<ReturnType<typeof sanitizeCloudLocation>> => item !== null)
    : null
  const preferred = Array.isArray(value.destinations.preferred)
    ? value.destinations.preferred.slice(0, 24).map(sanitizeCloudLocation).filter((item): item is NonNullable<ReturnType<typeof sanitizeCloudLocation>> => item !== null)
    : null
  const excluded = Array.isArray(value.destinations.excluded)
    ? value.destinations.excluded.slice(0, 24).map(sanitizeCloudLocation).filter((item): item is NonNullable<ReturnType<typeof sanitizeCloudLocation>> => item !== null)
    : null
  if (!required || !preferred || !excluded) return undefined
  const interests = cleanStringList(value.interests, 32, 80)
  if (!interests) return undefined
  const origin = value.origin === undefined ? undefined : sanitizeCloudLocation(value.origin)
  if (value.origin !== undefined && !origin) return undefined
  const departureWindow = value.departureWindow === undefined ? undefined : sanitizeCloudWindow(value.departureWindow)
  const returnWindow = value.returnWindow === undefined ? undefined : sanitizeCloudWindow(value.returnWindow)
  if (value.departureWindow !== undefined && !departureWindow) return undefined
  if (value.returnWindow !== undefined && !returnWindow) return undefined
  const travelDays = value.travelDays === undefined ? undefined : integerNumber(value.travelDays, 1, 60)
  if (value.travelDays !== undefined && travelDays === null) return undefined
  let budget: CloudTripContextSummary['budget'] | undefined
  if (value.budget !== undefined) {
    if (!isRecord(value.budget)
      || typeof value.budget.currency !== 'string'
      || !/^[A-Z]{3}$/.test(value.budget.currency)
      || (value.budget.scope !== 'airfare' && value.budget.scope !== 'transport' && value.budget.scope !== 'trip')) return undefined
    const amount = finiteNumber(value.budget.amount, 0, 100_000_000)
    if (amount === null) return undefined
    budget = { amount, currency: value.budget.currency, scope: value.budget.scope }
  }
  return {
    version: value.version,
    ...(origin ? { origin } : {}),
    ...(departureWindow ? { departureWindow } : {}),
    ...(returnWindow ? { returnWindow } : {}),
    ...(travelDays !== undefined && travelDays !== null ? { travelDays } : {}),
    ...(budget ? { budget } : {}),
    destinations: { mode: destinationMode, required, preferred, excluded },
    interests,
    readyForRouteGeneration: value.readyForRouteGeneration
  }
}

function sanitizeArtifactRef(value: unknown): CloudArtifactRef | null {
  if (!isRecord(value)) return null
  const id = cleanText(value.id, 80)
  const type = cleanText(value.type, 80)
  const schemaVersion = integerNumber(value.schemaVersion, 1, 1_000_000)
  const hints = ['flight_cards', 'research_cards', 'activity_cards', 'destination_cards', 'route_preview', 'itinerary_outline', 'travel_guide'] as const
  const presentationHint = hints.includes(value.presentationHint as typeof hints[number]) ? value.presentationHint as typeof hints[number] : null
  if (!id || !type || schemaVersion === null || !presentationHint) return null
  const tripContextVersion = integerNumber(value.tripContextVersion, 0, Number.MAX_SAFE_INTEGER)
  return { id, type, schemaVersion, presentationHint, ...(tripContextVersion !== null ? { tripContextVersion } : {}) }
}

const ROUTE_GENERATION_STATUSES: readonly RouteGenerationRunView['status'][] = ['queued', 'running', 'succeeded', 'failed', 'cancelled']
const ROUTE_GENERATION_STAGES: readonly RouteGenerationRunView['progress']['stage'][] = [
  'queued', 'searching_connections', 'planning_paths', 'optimizing_routes',
  'persisting_artifacts', 'completed', 'failed', 'cancelled'
]

function cleanIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) return null
  return value.trim().slice(0, 64)
}

function sanitizeRouteGenerationRun(value: unknown): RouteGenerationRunView | undefined {
  if (!isRecord(value)) return undefined
  const id = cleanText(value.id, 80)
  const tripId = cleanText(value.tripId, 80)
  const idempotencyKey = cleanText(value.idempotencyKey, 200)
  const contextVersion = integerNumber(value.contextVersion, 0, 1_000_000_000)
  const status = ROUTE_GENERATION_STATUSES.includes(value.status as RouteGenerationRunView['status'])
    ? value.status as RouteGenerationRunView['status']
    : null
  if (!id || !tripId || !idempotencyKey || contextVersion === null || !status || !isRecord(value.progress)) return undefined
  const stage = ROUTE_GENERATION_STAGES.includes(value.progress.stage as RouteGenerationRunView['progress']['stage'])
    ? value.progress.stage as RouteGenerationRunView['progress']['stage']
    : null
  const percent = integerNumber(value.progress.percent, 0, 100)
  const createdAt = cleanIsoTimestamp(value.createdAt)
  const updatedAt = cleanIsoTimestamp(value.updatedAt)
  const warnings = cleanStringList(value.warnings, 40, MAX_CHAT_WARNING_CHARS)
  if (!stage || percent === null || !createdAt || !updatedAt || !warnings) return undefined
  const conversationId = value.conversationId === undefined ? undefined : cleanText(value.conversationId, 80)
  if (value.conversationId !== undefined && !conversationId) return undefined
  const staleValue = value.stale
  if (staleValue !== undefined && typeof staleValue !== 'boolean') return undefined
  const stale = staleValue as boolean | undefined
  const resultArtifactId = value.resultArtifactId === undefined ? undefined : cleanText(value.resultArtifactId, 80)
  if (value.resultArtifactId !== undefined && !resultArtifactId) return undefined
  let error: RouteGenerationRunView['error']
  if (value.error !== undefined) {
    if (!isRecord(value.error)) return undefined
    const code = typeof value.error.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(value.error.code) ? value.error.code : null
    const message = cleanText(value.error.message, 240)
    if (!code || !message) return undefined
    error = { code, message }
  }
  const startedAt = value.startedAt === undefined ? undefined : cleanIsoTimestamp(value.startedAt)
  const finishedAt = value.finishedAt === undefined ? undefined : cleanIsoTimestamp(value.finishedAt)
  if (value.startedAt !== undefined && !startedAt) return undefined
  if (value.finishedAt !== undefined && !finishedAt) return undefined
  return {
    id,
    tripId,
    ...(conversationId ? { conversationId } : {}),
    ...(cleanText(value.goalId, 80) ? { goalId: cleanText(value.goalId, 80)! } : {}),
    ...(cleanText(value.goalRunId, 80) ? { goalRunId: cleanText(value.goalRunId, 80)! } : {}),
    idempotencyKey,
    contextVersion,
    status,
    ...(stale !== undefined ? { stale } : {}),
    progress: { stage, percent },
    ...(resultArtifactId ? { resultArtifactId } : {}),
    ...(error ? { error } : {}),
    warnings,
    createdAt,
    updatedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {})
  }
}

function sanitizeLeg(value: unknown): RouteLeg | null {
  if (!isRecord(value)) return null
  const from = cleanIata(value.from)
  const to = cleanIata(value.to)
  const date = cleanDate(value.date)
  const departTime = cleanText(value.departTime, 8)
  const arriveTime = cleanText(value.arriveTime, 8)
  const duration = integerNumber(value.duration, 0, 3_000)
  const price = finiteNumber(value.price, 0, 100_000_000)
  const airline = cleanText(value.airline, 32)
  if (!from || !to || !date || !departTime || !arriveTime || duration === null || price === null || !airline) return null
  if (typeof value.crossDay !== 'boolean') return null
  const stopsValue = value.stops === undefined ? undefined : integerNumber(value.stops, 0, 8)
  if (value.stops !== undefined && stopsValue === null) return null
  const stops = stopsValue === null ? undefined : stopsValue
  const flightNo = value.flightNo === undefined ? undefined : cleanOptionalText(value.flightNo, 32)
  if (value.flightNo !== undefined && !flightNo) return null
  if (value.real !== undefined && typeof value.real !== 'boolean') return null
  return {
    from,
    to,
    date,
    departTime,
    arriveTime,
    crossDay: value.crossDay,
    duration,
    price,
    airline,
    ...(flightNo ? { flightNo } : {}),
    ...(stops !== undefined ? { stops } : {}),
    ...(value.real !== undefined ? { real: value.real } : {})
  }
}

function sanitizeRoute(value: unknown): RouteResult | null {
  if (!isRecord(value)) return null
  const cities = cleanIatas(value.cities, 8)
  const citySeq = cleanIatas(value.citySeq, 10)
  if (!cities || !citySeq || cities.length === 0 || citySeq.length === 0 || !Array.isArray(value.legs)) return null
  const legs = value.legs.slice(0, MAX_CHAT_ROUTE_LEGS).map(sanitizeLeg).filter((leg): leg is RouteLeg => leg !== null)
  if (legs.length === 0) return null
  const totalPrice = finiteNumber(value.totalPrice, 0, 100_000_000)
  const effCost = finiteNumber(value.effCost, -100_000_000, 100_000_000)
  const nightsSaved = integerNumber(value.nightsSaved, 0, 60)
  if (totalPrice === null || effCost === null || nightsSaved === null) return null
  if (value.hasReal !== undefined && typeof value.hasReal !== 'boolean') return null
  return {
    cities,
    citySeq,
    legs,
    totalPrice,
    effCost,
    nightsSaved,
    ...(value.hasReal !== undefined ? { hasReal: value.hasReal } : {})
  }
}

function sanitizePick(value: unknown): RoutePick | null {
  if (!isRecord(value) || !ROUTE_KINDS.includes(value.kind as RoutePick['kind'])) return null
  const route = sanitizeRoute(value.route)
  if (!route) return null
  const pick: RoutePick & Partial<ConfirmedPick> = { kind: value.kind as RoutePick['kind'], route }
  const note = cleanOptionalText(value.note, 320)
  const probedValue = value.probed === undefined ? undefined : integerNumber(value.probed, 0, MAX_CHAT_ROUTE_LEGS)
  const failedValue = value.failed === undefined ? undefined : integerNumber(value.failed, 0, MAX_CHAT_ROUTE_LEGS)
  if (value.note !== undefined && !note) return null
  if (value.probed !== undefined && probedValue === null) return null
  if (value.failed !== undefined && failedValue === null) return null
  const probed = probedValue === null ? undefined : probedValue
  const failed = failedValue === null ? undefined : failedValue
  if (note) pick.note = note
  if (probed !== undefined) pick.probed = probed
  if (failed !== undefined) pick.failed = failed
  return pick
}

function sanitizeWarnings(value: unknown): string[] | null {
  return cleanStringList(value, 12, MAX_CHAT_WARNING_CHARS)
}

function isTravelGuideSourceKind(value: unknown): value is TravelGuideSourceKind {
  return value === 'web' || value === 'catalog' || value === 'rules'
}

interface SafeTravelGuideWebUrl {
  url: string
  hostname: string
}

function sanitizeTravelGuideWebUrl(value: unknown): SafeTravelGuideWebUrl | null {
  const url = cleanText(value, MAX_CHAT_GUIDE_URL_CHARS)
  if (!url) return null
  // The mini-program runtime and the tiny VM used by the pure-cache test do
  // not always expose the browser URL constructor. Keep a conservative
  // parser fallback so the same policy is enforced in both environments.
  if (typeof URL !== 'function') {
    const match = url.match(/^https?:\/\/(\[[^\]]+\]|[^/?#]+)(?:[/?#]|$)/i)
    if (!match || !match[1] || match[1].includes('@')) return null
    const authority = match[1]
    let hostname = authority
    if (authority.startsWith('[')) {
      const closing = authority.indexOf(']')
      const suffix = closing >= 0 ? authority.slice(closing + 1) : ''
      const literal = closing >= 0 ? authority.slice(1, closing) : ''
      if (closing < 0
        || !literal.includes(':')
        || !/^[0-9A-Fa-f:.]+$/.test(literal)
        || (suffix && !/^:\d+$/.test(suffix))) return null
      hostname = authority.slice(0, closing + 1)
    } else {
      const colon = authority.lastIndexOf(':')
      if (colon >= 0) {
        const port = authority.slice(colon + 1)
        if (!/^\d+$/.test(port) || Number(port) > 65_535) return null
        hostname = authority.slice(0, colon)
      }
      if (!hostname || !/^[A-Za-z0-9.-]+$/.test(hostname)) return null
      const labels = hostname.split('.')
      if (labels.some(label => !label || label.startsWith('-') || label.endsWith('-'))) return null
    }
    return hostname ? { url, hostname: hostname.toLowerCase() } : null
  }
  try {
    const parsed = new URL(url)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return null
    const hostname = parsed.hostname.trim().toLowerCase()
    return hostname ? { url, hostname } : null
  } catch {
    return null
  }
}

function sanitizeTravelGuideSource(value: unknown): TravelGuideSource | null {
  if (!isRecord(value) || !isTravelGuideSourceKind(value.source) || typeof value.url !== 'string') return null
  const title = cleanText(value.title, MAX_CHAT_GUIDE_SOURCE_CHARS)
  if (!title) return null
  if (value.source === 'web') {
    const safeUrl = sanitizeTravelGuideWebUrl(value.url)
    return safeUrl ? { source: 'web', title, url: safeUrl.url, domain: safeUrl.hostname } : null
  }
  const domain = cleanText(value.domain, MAX_CHAT_GUIDE_SOURCE_CHARS)
  if (!domain) return null
  // Catalog/rules entries are provenance labels only. Never persist a value that
  // could accidentally become a clickable external link in a future renderer.
  return { source: value.source, title, url: '', domain }
}

function sanitizeTravelGuideRoute(value: unknown): TravelGuideRoute | null {
  if (!isRecord(value) || !ROUTE_KINDS.includes(value.kind as RoutePick['kind'])) return null
  const cities = cleanIatas(value.cities, 8)
  const citySeq = cleanIataSequence(value.citySeq, 10)
  if (!cities || !citySeq || cities.length === 0 || citySeq.length === 0) return null
  return { kind: value.kind as RoutePick['kind'], cities, citySeq }
}

function sanitizeTravelGuideItem(value: unknown): TravelGuideItem | null {
  if (!isRecord(value) || !isTravelGuideSourceKind(value.source)) return null
  const title = cleanBilingual(value.title, 320)
  const description = cleanBilingual(value.description, 600)
  const city = cleanBilingual(value.city, 120)
  const cityIata = cleanIata(value.cityIata)
  if (!title || !description || !city || !cityIata || !Array.isArray(value.sources)) return null
  const rawSources = value.sources.slice(0, 4)
  if (rawSources.length === 0) return null
  const sources: TravelGuideSource[] = []
  for (const rawSource of rawSources) {
    const source = sanitizeTravelGuideSource(rawSource)
    if (!source) return null
    sources.push(source)
  }
  return { title, description, city, cityIata, source: value.source, sources }
}

function sanitizeTravelGuideDay(value: unknown): TravelGuideDay | null {
  if (!isRecord(value)) return null
  const day = integerNumber(value.day, 1, MAX_CHAT_GUIDE_DAYS)
  const city = cleanBilingual(value.city, 120)
  const cityIata = cleanIata(value.cityIata)
  if (day === null || !city || !cityIata || !Array.isArray(value.items)) return null
  const rawItems = value.items.slice(0, MAX_CHAT_GUIDE_ITEMS)
  if (rawItems.length === 0) return null
  const items: TravelGuideItem[] = []
  for (const rawItem of rawItems) {
    const item = sanitizeTravelGuideItem(rawItem)
    if (!item) return null
    items.push(item)
  }
  return { day, city, cityIata, items }
}

function sanitizeTravelGuidePublication(value: unknown): TravelGuidePublication | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.artifactId !== 'string' || !value.artifactId.trim()
    || !Number.isInteger(value.tripContextVersion) || Number(value.tripContextVersion) < 0
    || value.contentContract !== 'limited'
    || (value.evidenceCoverage !== 'partial' && value.evidenceCoverage !== 'unknown')
    || !isRecord(value.budgetAssessment) || value.budgetAssessment.status !== 'undetermined'
    || value.budgetAssessment.knownSubtotal !== null || value.budgetAssessment.scopeCoverage !== 'incomplete'
    || typeof value.budgetAssessment.notice !== 'string' || !value.budgetAssessment.notice.trim()
    || typeof value.legacy !== 'boolean' || typeof value.reply !== 'string' || !value.reply.trim()) return null
  return {
    version: 1,
    artifactId: value.artifactId.trim().slice(0, 160),
    tripContextVersion: Number(value.tripContextVersion),
    contentContract: 'limited',
    evidenceCoverage: value.evidenceCoverage,
    budgetAssessment: { status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete', notice: value.budgetAssessment.notice.trim().slice(0, 600) },
    legacy: value.legacy,
    reply: value.reply.trim().slice(0, MAX_CHAT_MESSAGE_CHARS)
  }
}

function hasGuideDelivery(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind === 'travel_guide') return true
  return Array.isArray(value.goals) && value.goals.some(goal => hasGuideDelivery(goal))
}

function travelGuideSourceCount(guide: TravelGuide): number {
  return guide.sources.length + guide.days.reduce(
    (count, day) => count + day.items.reduce((itemCount, item) => itemCount + item.sources.length, 0),
    0
  )
}

function travelGuideTextSize(guide: TravelGuide): number {
  let size = guide.summary.zh.length + guide.summary.en.length
  size += guide.warnings.reduce((total, warning) => total + warning.length, 0)
  for (const city of guide.route.cities) size += city.length
  for (const city of guide.route.citySeq) size += city.length
  const addSource = (source: TravelGuideSource) => {
    size += source.title.length + source.url.length + source.domain.length
  }
  guide.sources.forEach(addSource)
  for (const day of guide.days) {
    size += day.city.zh.length + day.city.en.length + day.cityIata.length
    for (const item of day.items) {
      size += item.title.zh.length + item.title.en.length
      size += item.description.zh.length + item.description.en.length
      size += item.city.zh.length + item.city.en.length + item.cityIata.length
      item.sources.forEach(addSource)
    }
  }
  return size
}

function fitTravelGuide(guide: TravelGuide): TravelGuide | undefined {
  let days = guide.days.slice(0, MAX_CHAT_GUIDE_DAYS)
  let sources = guide.sources.slice(0, MAX_CHAT_GUIDE_SOURCES)
  let bounded: TravelGuide = { ...guide, days, sources }
  while (travelGuideSourceCount(bounded) > MAX_CHAT_GUIDE_SOURCES && sources.length > 0) {
    sources = sources.slice(0, -1)
    bounded = { ...bounded, sources }
  }
  // A 60-day guide can still be too large for mini-program storage. Keep the
  // beginning of the guide (the useful compact summary and earliest days) while
  // enforcing both aggregate text and source-reference budgets.
  while ((travelGuideSourceCount(bounded) > MAX_CHAT_GUIDE_SOURCES
    || travelGuideTextSize(bounded) > MAX_CHAT_GUIDE_TEXT_CHARS) && days.length > 1) {
    days = days.slice(0, -1)
    bounded = { ...bounded, days }
  }
  while (travelGuideTextSize(bounded) > MAX_CHAT_GUIDE_TEXT_CHARS && sources.length > 0) {
    sources = sources.slice(0, -1)
    bounded = { ...bounded, sources }
  }
  if (days.length === 0
    || travelGuideSourceCount(bounded) > MAX_CHAT_GUIDE_SOURCES
    || travelGuideTextSize(bounded) > MAX_CHAT_GUIDE_TEXT_CHARS) return undefined
  return bounded
}

/** Strictly rehydrate one backend guide; invalid guide data never invalidates its session. */
export function sanitizeTravelGuide(value: unknown): TravelGuide | undefined {
  if (!isRecord(value) || !Array.isArray(value.days) || !Array.isArray(value.sources)) return undefined
  const publication = sanitizeTravelGuidePublication(value.publication)
  // Local history is untrusted input. A structurally valid old guide without
  // a server publication is deliberately discarded before any prose can be
  // rendered; route and flight snapshots live in their own fields.
  if (!publication) return undefined
  const route = sanitizeTravelGuideRoute(value.route)
  const summary = cleanBilingual(value.summary, 800)
  const source = isTravelGuideSourceKind(value.source) ? value.source : null
  const warnings = sanitizeWarnings(value.warnings)
  if (!route || !summary || !source || !warnings) return undefined

  const rawDays = value.days.slice(0, MAX_CHAT_GUIDE_DAYS)
  const days: TravelGuideDay[] = []
  const seenDays = new Set<number>()
  for (const rawDay of rawDays) {
    const day = sanitizeTravelGuideDay(rawDay)
    if (!day || seenDays.has(day.day)) return undefined
    seenDays.add(day.day)
    days.push(day)
  }
  if (days.length === 0) return undefined

  const sources: TravelGuideSource[] = []
  for (const rawSource of value.sources.slice(0, MAX_CHAT_GUIDE_SOURCES)) {
    const sourceValue = sanitizeTravelGuideSource(rawSource)
    if (!sourceValue) return undefined
    sources.push(sourceValue)
  }
  return fitTravelGuide({ route, summary, days, sources, source, warnings, publication })
}

export function cloneTravelGuide(guide: TravelGuide | undefined): TravelGuide | undefined {
  if (!guide) return undefined
  return {
    route: { ...guide.route, cities: [...guide.route.cities], citySeq: [...guide.route.citySeq] },
    summary: { ...guide.summary },
    days: guide.days.map(day => ({
      ...day,
      city: { ...day.city },
      items: day.items.map(item => ({
        ...item,
        title: { ...item.title },
        description: { ...item.description },
        city: { ...item.city },
        sources: item.sources.map(source => ({ ...source }))
      }))
    })),
    sources: guide.sources.map(source => ({ ...source })),
    source: guide.source,
    warnings: [...guide.warnings],
    ...(guide.publication ? { publication: { ...guide.publication, budgetAssessment: { ...guide.publication.budgetAssessment } } } : {})
  }
}

function sanitizeTurn(value: unknown, fallbackId: string): ConversationTurnSnapshot | null {
  if (!isRecord(value)) return null
  const user = sanitizeMessage(value.user)
  if (!user || user.role !== 'user') return null
  let assistant: ConversationMessage | null = null
  if (value.assistant !== null && value.assistant !== undefined) {
    assistant = sanitizeMessage(value.assistant)
    if (!assistant || assistant.role !== 'assistant') return null
  }
  if (!Array.isArray(value.recommendations) || !Array.isArray(value.suggestedActions) || !Array.isArray(value.routes)) return null
  const recommendations = value.recommendations.slice(0, MAX_CHAT_RECOMMENDATIONS).map(sanitizeRecommendation).filter((item): item is DestinationRecommendation => item !== null)
  const suggestedActions = value.suggestedActions.slice(0, MAX_CHAT_ACTIONS).map(sanitizeAction).filter((item): item is SuggestedAction => item !== null)
  const routes = value.routes.slice(0, MAX_CHAT_ROUTES).map(sanitizePick).filter((item): item is RoutePick => item !== null)
  const warnings = sanitizeWarnings(value.warnings)
  if (!warnings) return null
  const tripContextSummary = value.tripContextSummary === undefined
    ? undefined
    : sanitizeCloudTripContextSummary(value.tripContextSummary)
  if (value.tripContextSummary !== undefined && !tripContextSummary) return null
  const artifactRefs = value.artifactRefs === undefined
    ? undefined
    : Array.isArray(value.artifactRefs)
      ? value.artifactRefs.slice(0, MAX_CHAT_ARTIFACT_REFS).map(sanitizeArtifactRef).filter((item): item is CloudArtifactRef => item !== null)
      : null
  if (artifactRefs === null) return null
  const travelGuide = value.travelGuide === undefined ? undefined : sanitizeTravelGuide(value.travelGuide)
  const guideReferenced = Boolean(value.travelGuide !== undefined || artifactRefs?.some(ref => ref.type === 'travel_guide') || hasGuideDelivery(value.delivery))
  // A cached assistant reply may contain old free-form budget guarantees. For
  // any guide-associated turn, use only the trusted published reply or a
  // static notice; user messages and unrelated turns remain untouched.
  if (guideReferenced && assistant) assistant = { role: 'assistant', content: travelGuide?.publication?.reply ?? LEGACY_GUIDE_MESSAGE }
  const id = cleanText(value.id, 80) ?? fallbackId
  const error = cleanOptionalText(value.error, 240)
  const delivery = sanitizeDelivery(value.delivery)
  return {
    id,
    user,
    assistant,
    recommendations,
    suggestedActions,
    routes,
    warnings,
    ...(tripContextSummary ? { tripContextSummary } : {}),
    ...(artifactRefs ? { artifactRefs } : {}),
    ...(typeof value.stopReason === 'string' && value.stopReason.trim() ? { stopReason: value.stopReason.trim().slice(0, 80) } : {}),
    ...(delivery ? { delivery } : {}),
    ...(travelGuide ? { travelGuide } : {}),
    ...(error ? { error } : {})
  }
}

function sanitizeDelivery(value: unknown, includeGoals = true): ConversationDelivery | undefined {
  if (!isRecord(value) || !['not_requested', 'pending', 'satisfied', 'partial', 'failed', 'cancelled'].includes(String(value.status))) return
  const strings = (input: unknown, count: number) => Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string').slice(0, count).map(item => item.slice(0, 240)) : []
  return {
    status: value.status as ConversationDelivery['status'],
    ...(typeof value.goalId === 'string' ? { goalId: value.goalId.slice(0, 80) } : {}),
    ...(typeof value.kind === 'string' ? { kind: value.kind.slice(0, 80) } : {}),
    artifactIds: strings(value.artifactIds, MAX_CHAT_ARTIFACT_REFS), missing: strings(value.missing, 40), warnings: strings(value.warnings, 40),
    ...(includeGoals && Array.isArray(value.goals) ? { goals: value.goals.slice(0, MAX_CHAT_DELIVERY_GOALS).map(goal => sanitizeDelivery(goal, false)).filter((goal): goal is ConversationDelivery => Boolean(goal)) } : {})
  }
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const timestamp = integerNumber(value, 0, 9_999_999_999_999)
  return timestamp ?? fallback
}

export function sessionTitle(messages: ConversationMessage[]): string {
  const first = messages.find(message => message.role === 'user')
  return first?.content.trim().slice(0, 40) ?? ''
}

export function sessionSummary(messages: ConversationMessage[], timeline: ConversationTurnSnapshot[]): string {
  const latestAssistant = [...timeline].reverse().find(turn => turn.assistant?.content)?.assistant?.content
  const fallback = [...messages].reverse().find(message => message.role === 'user')?.content
  return (latestAssistant ?? fallback ?? '').trim().slice(0, MAX_CHAT_SUMMARY_CHARS)
}

function removePendingTurn(messages: ConversationMessage[], timeline: ConversationTurnSnapshot[]): {
  messages: ConversationMessage[]
  timeline: ConversationTurnSnapshot[]
} {
  const nextTimeline = [...timeline]
  const pending = nextTimeline[nextTimeline.length - 1]
  // A missing final reply does not invalidate already committed business results.
  if (!pending || pending.assistant !== null || pending.artifactRefs?.length) return { messages, timeline }
  nextTimeline.pop()
  const nextMessages = [...messages]
  const lastMessage = nextMessages[nextMessages.length - 1]
  if (lastMessage?.role === 'user' && lastMessage.content === pending.user.content) nextMessages.pop()
  return { messages: nextMessages, timeline: nextTimeline }
}

export function sanitizeChatSession(value: unknown, now = Date.now()): ChatSessionRecord | null {
  if (!isRecord(value) || !Array.isArray(value.messages) || !Array.isArray(value.timeline)) return null
  const id = cleanText(value.id, 80)
  const state = sanitizeTripState(value.state)
  if (!id || !state) return null

  const ownerId = cleanText(value.ownerId, 160)
  const tripId = cleanText(value.tripId, 80)
  const conversationId = cleanText(value.conversationId, 80)
  const artifactRefs = Array.isArray(value.artifactRefs)
    ? value.artifactRefs.slice(0, MAX_CHAT_ARTIFACT_REFS).map(sanitizeArtifactRef).filter((item): item is CloudArtifactRef => item !== null)
    : []
  const tripContextSummary = value.tripContextSummary === undefined
    ? undefined
    : sanitizeCloudTripContextSummary(value.tripContextSummary)
  if (value.tripContextSummary !== undefined && !tripContextSummary) return null
  const routeGeneration = value.routeGeneration === undefined ? undefined : sanitizeRouteGenerationRun(value.routeGeneration)
  if (value.routeGeneration !== undefined && !routeGeneration) return null
  const routeGenerationIdempotencyKey = value.routeGenerationIdempotencyKey === undefined
    ? undefined
    : cleanText(value.routeGenerationIdempotencyKey, 200)
  if (value.routeGenerationIdempotencyKey !== undefined && !routeGenerationIdempotencyKey) return null

  const messages = value.messages.slice(-MAX_CHAT_MESSAGES).map(sanitizeMessage).filter((item): item is ConversationMessage => item !== null)
  const timeline = value.timeline.slice(-MAX_CHAT_TIMELINE).map((item, index) => sanitizeTurn(item, `turn-restored-${index}`)).filter((item): item is ConversationTurnSnapshot => item !== null)
  const settled = removePendingTurn(messages, timeline)
  if (settled.messages.length === 0 && settled.timeline.length === 0 && !(ownerId && tripId && conversationId)) return null

  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations.slice(0, MAX_CHAT_RECOMMENDATIONS).map(sanitizeRecommendation).filter((item): item is DestinationRecommendation => item !== null)
    : []
  const suggestedActions = Array.isArray(value.suggestedActions)
    ? value.suggestedActions.slice(0, MAX_CHAT_ACTIONS).map(sanitizeAction).filter((item): item is SuggestedAction => item !== null)
    : []
  const routes = Array.isArray(value.routes)
    ? value.routes.slice(0, MAX_CHAT_ROUTES).map(sanitizePick).filter((item): item is RoutePick => item !== null)
    : []
  const warnings = sanitizeWarnings(value.warnings) ?? []
  const createdAt = normalizeTimestamp(value.createdAt, now)
  const updatedAt = normalizeTimestamp(value.updatedAt, createdAt)
  const phase = PHASES.includes(value.phase as ConversationPhase) ? value.phase as ConversationPhase : 'clarify'
  const persistedTitle = cleanText(value.title, 40)
  return {
    id,
    createdAt,
    updatedAt,
    title: persistedTitle ?? sessionTitle(settled.messages),
    summary: sessionSummary(settled.messages, settled.timeline),
    messages: settled.messages,
    timeline: settled.timeline,
    state,
    phase,
    recommendations,
    suggestedActions,
    routes,
    warnings,
    ...(ownerId ? { ownerId } : {}),
    ...(tripId ? { tripId } : {}),
    ...(conversationId ? { conversationId } : {}),
    artifactRefs,
    ...(tripContextSummary ? { tripContextSummary } : {}),
    ...(typeof value.stopReason === 'string' && value.stopReason.trim() ? { stopReason: value.stopReason.trim().slice(0, 80) } : {}),
    ...(routeGeneration ? { routeGeneration } : {}),
    ...(routeGenerationIdempotencyKey ? { routeGenerationIdempotencyKey } : {})
  }
}

export function createEmptyChatSession(id: string, now = Date.now()): ChatSessionRecord {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    title: '',
    summary: '',
    messages: [],
    timeline: [],
    state: {
      origin: null,
      window_from: null,
      window_to: null,
      travel_days: null,
      budget_max: null,
      interests: [],
      regions: [],
      required_iatas: [],
      excluded_iatas: [],
      destination_mode: 'explicit',
      pace: 'balanced',
      priorities: []
    },
    phase: 'clarify',
    recommendations: [],
    suggestedActions: [],
    routes: [],
    warnings: [],
    artifactRefs: []
  }
}

export function sanitizeHistoryPayload(value: unknown, now = Date.now()): PersistedChatHistory {
  if (!isRecord(value) || value.version !== CHAT_HISTORY_VERSION || !Array.isArray(value.sessions)) {
    return { version: CHAT_HISTORY_VERSION, currentSessionId: '', sessions: [] }
  }
  const sessions = value.sessions
    .slice(0, MAX_CHAT_SESSIONS * 2)
    .map(item => sanitizeChatSession(item, now))
    .filter((item): item is ChatSessionRecord => item !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_CHAT_SESSIONS)
  const requestedCurrent = cleanText(value.currentSessionId, 80) ?? ''
  const currentSessionId = requestedCurrent || (sessions[0]?.id ?? '')
  return { version: CHAT_HISTORY_VERSION, currentSessionId, sessions }
}

function historyPayloadSize(currentSessionId: string, sessions: ChatSessionRecord[]): number {
  return JSON.stringify({ version: CHAT_HISTORY_VERSION, currentSessionId, sessions }).length
}

function withoutTravelGuide(turn: ConversationTurnSnapshot): ConversationTurnSnapshot {
  const next = { ...turn }
  delete next.travelGuide
  return next
}

function trimOldestTimelineTurn(session: ChatSessionRecord): ChatSessionRecord {
  if (session.timeline.length <= 1) return session
  const timeline = session.timeline.slice(1)
  const messageCount = Math.max(1, Math.min(MAX_CHAT_MESSAGES, timeline.length * 2))
  const messages = session.messages.slice(-messageCount)
  return { ...session, messages, timeline, summary: sessionSummary(messages, timeline) }
}

function trimOldestTravelGuide(session: ChatSessionRecord): ChatSessionRecord | null {
  const index = session.timeline.findIndex(turn => turn.travelGuide !== undefined)
  if (index < 0) return null
  const timeline = session.timeline.map((turn, turnIndex) => turnIndex === index ? withoutTravelGuide(turn) : turn)
  return { ...session, timeline, summary: sessionSummary(session.messages, timeline) }
}

function minimalHistorySession(session: ChatSessionRecord): ChatSessionRecord {
  const latest = session.timeline[session.timeline.length - 1]
  const timeline = latest
    ? [{
        ...withoutTravelGuide(latest),
        recommendations: [],
        suggestedActions: [],
        routes: [],
        warnings: []
      }]
    : []
  const messages = latest
    ? [
        { ...latest.user },
        ...(latest.assistant ? [{ ...latest.assistant }] : [])
      ]
    : session.messages.slice(-2)
  return {
    ...session,
    messages,
    timeline,
    summary: sessionSummary(messages, timeline),
    recommendations: [],
    suggestedActions: [],
    routes: [],
    warnings: []
  }
}

export function makeChatHistoryPayload(currentSessionId: string, sourceSessions: ChatSessionRecord[], now = Date.now()): PersistedChatHistory {
  const sessions = sourceSessions
    .map(session => sanitizeChatSession(session, now))
    .filter((item): item is ChatSessionRecord => item !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_CHAT_SESSIONS)
  const persistedCurrent = cleanText(currentSessionId, 80) ?? ''
  let bounded = sessions
  const requestedCurrent = persistedCurrent || (bounded[0]?.id ?? '')

  // Evict old sessions first, but keep an explicitly selected current session
  // even when it is not the newest one. This is the cheapest way to make room
  // for a large guide without losing the session the user is looking at.
  while (historyPayloadSize(requestedCurrent, bounded) > MAX_CHAT_HISTORY_CHARS && bounded.length > 1) {
    let removeIndex = bounded.length - 1
    for (let index = bounded.length - 1; index >= 0; index--) {
      if (bounded[index].id !== requestedCurrent) {
        removeIndex = index
        break
      }
    }
    bounded = bounded.filter((_, index) => index !== removeIndex)
  }

  // If one retained session is still too large, remove its oldest turns while
  // preserving the most recent assistant turn and its state snapshot.
  while (historyPayloadSize(requestedCurrent, bounded) > MAX_CHAT_HISTORY_CHARS) {
    let trimIndex = -1
    for (let index = bounded.length - 1; index >= 0; index--) {
      if (bounded[index].timeline.length > 1) {
        trimIndex = index
        break
      }
    }
    if (trimIndex < 0) break
    bounded = bounded.map((session, index) => index === trimIndex ? trimOldestTimelineTurn(session) : session)
  }

  // A single guide can be valid on its own but still make the whole cache too
  // large when many turns contain one. Drop complete oldest guide attachments,
  // never a half-shaped object, until the cache fits.
  while (historyPayloadSize(requestedCurrent, bounded) > MAX_CHAT_HISTORY_CHARS) {
    let trimIndex = -1
    for (let index = bounded.length - 1; index >= 0; index--) {
      if (bounded[index].timeline.some(turn => turn.travelGuide !== undefined)) {
        trimIndex = index
        break
      }
    }
    if (trimIndex < 0) break
    const trimmed = trimOldestTravelGuide(bounded[trimIndex])
    if (!trimmed) break
    bounded = bounded.map((session, index) => index === trimIndex ? trimmed : session)
  }

  let payload: PersistedChatHistory = {
    version: CHAT_HISTORY_VERSION,
    currentSessionId: requestedCurrent,
    sessions: bounded
  }
  if (historyPayloadSize(payload.currentSessionId, payload.sessions) > MAX_CHAT_HISTORY_CHARS) {
    // The remaining fields are all individually bounded, so this fallback is
    // normally unnecessary. It is an absolute last line of defence for future
    // schema additions: keep one valid latest-turn snapshot rather than emit a
    // truncated JSON object that cannot be rehydrated.
    const selected = bounded.find(session => session.id === persistedCurrent) ?? bounded[0]
    const minimal = selected ? sanitizeChatSession(minimalHistorySession(selected), now) : null
    const fallbackSessions = minimal ? [minimal] : []
    payload = {
      version: CHAT_HISTORY_VERSION,
      currentSessionId: persistedCurrent || (fallbackSessions[0]?.id ?? ''),
      sessions: fallbackSessions
    }
  }

  // Keep the hard invariant explicit even if a future change makes the
  // fallback itself unexpectedly large.
  if (historyPayloadSize(payload.currentSessionId, payload.sessions) > MAX_CHAT_HISTORY_CHARS) {
    return { version: CHAT_HISTORY_VERSION, currentSessionId: '', sessions: [] }
  }
  return payload
}

export function sessionHasContent(session: Pick<ChatSessionRecord, 'messages' | 'timeline'> & Partial<Pick<ChatSessionRecord, 'artifactRefs'>>): boolean {
  return session.messages.length > 0 || session.timeline.length > 0 || (session.artifactRefs?.length ?? 0) > 0
}

export function cloneTripState(state: TripState): TripState {
  return {
    ...state,
    interests: [...state.interests],
    regions: [...state.regions],
    required_iatas: [...state.required_iatas],
    excluded_iatas: [...state.excluded_iatas],
    priorities: [...state.priorities]
  }
}
