// 统一旅行对话服务：正式模式提交一次 turn，再用短请求查询真实进度。
// Mock 模式在本地完成小型、确定性的解析与路线演示，不触发第三方或云函数。
import { request, USE_MOCK, ApiRequestError } from '../utils/request'
import { assertAuthSession, authSnapshot } from '../utils/authSession'
import { parseBudget } from './budgetParser'
import type { RoutePick } from './routeService'

export type DestinationRegion = 'japan' | 'schengen' | 'visa_free'
export type DestinationInterest = 'culture' | 'food' | 'nature' | 'shopping' | 'nightlife'

export interface TripState {
  origin: string | null
  window_from: string | null
  window_to: string | null
  travel_days: number | null
  budget_max: number | null
  interests: DestinationInterest[]
  regions: DestinationRegion[]
  required_iatas: string[]
  excluded_iatas: string[]
  destination_mode: 'explicit' | 'recommend'
  pace: 'relaxed' | 'balanced' | 'many_cities'
  priorities: Array<'budget' | 'comfort' | 'few_transfers' | 'culture'>
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface BilingualText {
  zh: string
  en: string
}

export interface DestinationRecommendation {
  iata: string
  cityZh: string
  cityEn: string
  region: DestinationRegion
  reason: BilingualText
  suggestedDays: number
}

export interface SuggestedAction {
  id: string
  label: BilingualText
  message: string
  /** The server action kind, when this action came from the cloud Planner. */
  kind?: 'message' | 'route_generation'
  /** The server-provided action target. Route generation is not callable yet. */
  href?: string
  disabled?: boolean
  unavailableReason?: string
}

/** The source-labelled itinerary guide returned by the self-hosted backend. */
export interface TravelGuideRoute {
  kind: RoutePick['kind']
  cities: string[]
  citySeq: string[]
}

export type TravelGuideSourceKind = 'web' | 'catalog' | 'rules'

export interface TravelGuideSource {
  source: TravelGuideSourceKind
  title: string
  url: string
  domain: string
}

export interface TravelGuideItem {
  title: BilingualText
  description: BilingualText
  city: BilingualText
  cityIata: string
  source: TravelGuideSourceKind
  sources: TravelGuideSource[]
}

export interface TravelGuideDay {
  day: number
  city: BilingualText
  cityIata: string
  items: TravelGuideItem[]
}

export interface TravelGuide {
  route: TravelGuideRoute
  summary: BilingualText
  days: TravelGuideDay[]
  sources: TravelGuideSource[]
  source: TravelGuideSourceKind
  warnings: string[]
}

/** Canonical location reference returned by the authenticated cloud API. */
export interface CloudLocationRef {
  id: string
  type: 'city' | 'airport'
  name: string
  countryCode: string
  iata?: string
  cityCode?: string
  latitude?: number
  longitude?: number
  timezone?: string
}

export interface CloudDateWindow {
  from?: string
  to?: string
  precision: 'exact' | 'approximate'
}

export interface CloudBudget {
  amount: number
  currency: string
  scope: 'airfare' | 'transport' | 'trip'
}

export interface CloudDestinationIntent {
  mode: 'explicit' | 'open' | 'mixed'
  required: CloudLocationRef[]
  preferred: CloudLocationRef[]
  excluded: CloudLocationRef[]
}

export interface CloudTripContextSummary {
  version: number
  origin?: CloudLocationRef
  departureWindow?: CloudDateWindow
  returnWindow?: CloudDateWindow
  travelDays?: number
  budget?: CloudBudget
  destinations: CloudDestinationIntent
  interests: string[]
  readyForRouteGeneration: boolean
}

/** Exact action shape from POST /v1/agent/converse. */
export interface CloudSuggestedAction {
  id: 'continue_planning' | 'generate_route'
  label: string
  kind: 'message' | 'route_generation'
  href?: string
}

export interface CloudArtifactRef {
  id: string
  type: string
  schemaVersion: number
  tripContextVersion?: number
  presentationHint: 'flight_cards' | 'research_cards' | 'activity_cards' | 'destination_cards' | 'route_preview' | 'itinerary_outline' | 'travel_guide'
}

/** Exact response shape from the authenticated cloud Planner. */
export type ConversationPhase = 'discover' | 'clarify' | 'plan'

/** Durable business outcome, independent of whether the model finished speaking. */
export interface ConversationDelivery {
  status: 'not_requested' | 'pending' | 'satisfied' | 'partial' | 'failed' | 'cancelled'
  goalId?: string
  kind?: string
  artifactIds: string[]
  missing: string[]
  warnings: string[]
  goals?: ConversationDelivery[]
}

export interface ConversationResponse {
  conversationId: string
  tripId: string
  reply: string
  tripContextSummary: CloudTripContextSummary
  artifactRefs: CloudArtifactRef[]
  suggestedActions: CloudSuggestedAction[]
  memoryChanged?: boolean
  warnings: string[]
  stopReason: string
  delivery?: ConversationDelivery
}

/** Exact request shape from the mini-program to POST /v1/agent/turns. */
export interface ConversationRequest {
  tripId: string
  conversationId: string
  message: string
}

export type ConversationTurnStage = 'thinking' | 'updating_trip' | 'searching_flights'
  | 'researching' | 'building_itinerary' | 'finalizing'

/** Transient transport state. Never persisted as messages or business history. */
export interface ConversationTurnProgress {
  connection: 'connecting' | 'running' | 'reconnecting' | 'completed'
  stage?: ConversationTurnStage
  startedAt: number
  lastConfirmedAt?: number
  serverUpdatedAt?: string
  turnId?: string
  tripId?: string
  conversationId?: string
  generationId?: string
}

export interface ConversationArtifactPublication {
  turnId: string
  tripId: string
  conversationId: string
  generationId: string
  artifactRevision: number
  artifactRefs: CloudArtifactRef[]
}

export interface ConversationTurnView {
  turnId: string
  status: 'running' | 'completed' | 'failed'
  stage: ConversationTurnStage
  startedAt: string
  updatedAt: string
  response?: ConversationResponse
  error?: { code: string; message: string }
  tripId?: string
  conversationId?: string
  generationId?: string
  artifactRevision?: number
  artifactRefs?: CloudArtifactRef[]
}

interface ConverseOptions {
  onProgress?: (progress: ConversationTurnProgress) => void
  onArtifacts?: (publication: ConversationArtifactPublication) => void
  /** Session switches invalidate this poll without needing mini-program AbortController. */
  isCurrent?: () => boolean
  startedAt?: number
}

const TURN_POLL_INTERVAL_MS = 2_000
const TURN_REQUEST_TIMEOUT_MS = 10_000
// Covers the server's 300s run limit and final persistence, using short HTTP requests.
const TURN_WAIT_LIMIT_MS = 330_000
const TURN_STAGES: readonly string[] = ['thinking', 'updating_trip', 'searching_flights', 'researching', 'building_itinerary', 'finalizing']

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validTurnView(value: ConversationTurnView, turnId: string): boolean {
  return Boolean(value && value.turnId === turnId
    && ['running', 'completed', 'failed'].includes(value.status)
    && TURN_STAGES.includes(value.stage)
    && validTimestamp(value.startedAt) && validTimestamp(value.updatedAt))
}

type TurnScope = { tripId: string; conversationId: string; generationId?: string }

function validPublication(value: ConversationTurnView, scope: TurnScope): boolean {
  if ((value.tripId !== undefined || value.conversationId !== undefined || value.generationId !== undefined)
    && (value.tripId !== scope.tripId || value.conversationId !== scope.conversationId || value.generationId !== scope.generationId)) return false
  if (value.artifactRevision === undefined && value.artifactRefs === undefined) return true
  return Boolean(scope.generationId && value.tripId === scope.tripId && value.conversationId === scope.conversationId
    && value.generationId === scope.generationId && Number.isSafeInteger(value.artifactRevision) && value.artifactRevision! >= 0
    && Array.isArray(value.artifactRefs) && value.artifactRefs.length <= 24 && value.artifactRefs.every(ref => ref
      && typeof ref.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.id)
      && Number.isSafeInteger(ref.schemaVersion) && ref.schemaVersion > 0
      && Number.isSafeInteger(ref.tripContextVersion) && ref.tripContextVersion! >= 0
      && ((ref.type === 'flight_search' && ref.presentationHint === 'flight_cards')
        || (ref.type === 'travel_guide' && ref.presentationHint === 'travel_guide'))))
}

function compactPublication(view: ConversationTurnView): ConversationArtifactPublication {
  return {
    turnId: view.turnId, tripId: view.tripId!, conversationId: view.conversationId!, generationId: view.generationId!,
    artifactRevision: view.artifactRevision!,
    artifactRefs: [...new Map(view.artifactRefs!.map(ref => [ref.id, {
      id: ref.id, type: ref.type, schemaVersion: ref.schemaVersion,
      tripContextVersion: ref.tripContextVersion, presentationHint: ref.presentationHint
    }])).values()]
  }
}

/** Cancellation is acknowledged by the server; it never invents a successful reply. */
export async function cancelConversationTurn(turnId: string, scope: TurnScope): Promise<ConversationTurnView> {
  const revision = authSnapshot().revision
  const view = await request<ConversationTurnView>({
    url: `/v1/agent/turns/${encodeURIComponent(turnId)}/cancel`, method: 'POST',
    retry: 0, showError: false, timeout: TURN_REQUEST_TIMEOUT_MS
  })
  assertAuthSession(revision)
  if (!validTurnView(view, turnId) || view.status === 'running' || !validPublication(view, scope)
    || (view.status === 'completed' && !validTurnResponse(view.response, { ...scope, message: '' }))) {
    throw new Error('INVALID_CONVERSATION_TURN_RESPONSE')
  }
  return view.artifactRefs ? { ...view, artifactRefs: compactPublication(view).artifactRefs } : view
}

function validTurnResponse(value: ConversationResponse | undefined, input: ConversationRequest): value is ConversationResponse {
  return Boolean(value && value.tripId === input.tripId && value.conversationId === input.conversationId
    && typeof value.reply === 'string' && value.tripContextSummary && Array.isArray(value.artifactRefs)
    && Array.isArray(value.suggestedActions) && Array.isArray(value.warnings) && typeof value.stopReason === 'string')
}

export interface CloudSessionBootstrap {
  tripId: string
  conversationId: string
}

export const emptyTripState = (): TripState => ({
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
})

interface MockDestination {
  iata: string
  cityZh: string
  cityEn: string
  region: DestinationRegion
  suggestedDays: number
  tags: DestinationInterest[]
}

const MOCK_DESTINATIONS: MockDestination[] = [
  { iata: 'NRT', cityZh: '东京', cityEn: 'Tokyo', region: 'japan', suggestedDays: 3, tags: ['culture', 'food', 'shopping'] },
  { iata: 'KIX', cityZh: '大阪', cityEn: 'Osaka', region: 'japan', suggestedDays: 2, tags: ['culture', 'food', 'nightlife'] },
  { iata: 'CDG', cityZh: '巴黎', cityEn: 'Paris', region: 'schengen', suggestedDays: 3, tags: ['culture', 'food', 'shopping'] },
  { iata: 'AMS', cityZh: '阿姆斯特丹', cityEn: 'Amsterdam', region: 'schengen', suggestedDays: 2, tags: ['culture', 'food', 'nature'] },
  { iata: 'FRA', cityZh: '法兰克福', cityEn: 'Frankfurt', region: 'schengen', suggestedDays: 2, tags: ['culture', 'food'] },
  { iata: 'MUC', cityZh: '慕尼黑', cityEn: 'Munich', region: 'schengen', suggestedDays: 2, tags: ['culture', 'nature'] },
  { iata: 'FCO', cityZh: '罗马', cityEn: 'Rome', region: 'schengen', suggestedDays: 3, tags: ['culture', 'food'] },
  { iata: 'BKK', cityZh: '曼谷', cityEn: 'Bangkok', region: 'visa_free', suggestedDays: 3, tags: ['food', 'shopping', 'nightlife'] },
  { iata: 'KUL', cityZh: '吉隆坡', cityEn: 'Kuala Lumpur', region: 'visa_free', suggestedDays: 2, tags: ['food', 'shopping'] },
  { iata: 'SIN', cityZh: '新加坡', cityEn: 'Singapore', region: 'visa_free', suggestedDays: 3, tags: ['food', 'shopping', 'nature'] }
]

const ORIGIN_ALIASES: Array<{ iata: string; aliases: string[] }> = [
  { iata: 'PEK', aliases: ['北京', 'beijing', 'pek'] },
  { iata: 'PVG', aliases: ['上海', 'shanghai', 'pvg'] },
  { iata: 'SZX', aliases: ['深圳', 'shenzhen', 'szx'] },
  { iata: 'CAN', aliases: ['广州', 'guangzhou', 'can'] },
  { iata: 'CTU', aliases: ['成都', 'chengdu', 'ctu'] },
  { iata: 'HKG', aliases: ['香港', 'hong kong', 'hkg'] }
]

const DESTINATION_ALIASES: Array<{ iata: string; aliases: string[] }> = [
  { iata: 'NRT', aliases: ['东京', 'Tokyo', 'NRT', '成田', 'Narita'] },
  { iata: 'KIX', aliases: ['大阪', 'Osaka', 'KIX'] },
  { iata: 'CDG', aliases: ['巴黎', 'Paris', 'CDG'] },
  { iata: 'AMS', aliases: ['阿姆斯特丹', 'Amsterdam', 'AMS'] },
  { iata: 'FRA', aliases: ['法兰克福', 'Frankfurt', 'FRA'] },
  { iata: 'MUC', aliases: ['慕尼黑', 'Munich', 'MUC'] },
  { iata: 'FCO', aliases: ['罗马', 'Rome', 'FCO'] },
  { iata: 'BKK', aliases: ['曼谷', 'Bangkok', 'BKK'] },
  { iata: 'KUL', aliases: ['吉隆坡', 'Kuala Lumpur', 'KUL'] },
  { iata: 'SIN', aliases: ['新加坡', 'Singapore', 'SIN'] }
]

const REGION_PATTERNS: Array<{ pattern: RegExp; region: DestinationRegion }> = [
  { pattern: /日本|japan/i, region: 'japan' },
  { pattern: /欧洲|欧盟|申根|europe|schengen/i, region: 'schengen' },
  { pattern: /东南亚|东亚|免签|落地签|southeast\s+asia|visa[- ]free/i, region: 'visa_free' }
]

const INTEREST_PATTERNS: Array<{ pattern: RegExp; interest: DestinationInterest }> = [
  { pattern: /文化|历史|古迹|博物馆|艺术|culture|history|museum|art/i, interest: 'culture' },
  { pattern: /美食|餐厅|food|cuisine/i, interest: 'food' },
  { pattern: /自然|风景|山|海边|徒步|nature|beach|hiking/i, interest: 'nature' },
  { pattern: /购物|shopping/i, interest: 'shopping' },
  { pattern: /夜生活|酒吧|nightlife|bar\b/i, interest: 'nightlife' }
]

const RECOMMEND_PATTERN = /你帮我选|帮我选|你来选|帮我决定|你来决定|你决定|你推荐|推荐|哪里合适|适合的城市|适合城市|知名城市|几个地方|几个城市|城市你看着安排|你看着安排|随便|任选|任意城市|任意|你安排|由你|surprise|recommend|you decide|pick for me|anywhere/i
/** Explicit opt-out is required before leaving an already-authorized recommend mode. */
export const RECOMMEND_OPTOUT_PATTERN = /我自己选|我来选|自己选|我自己决定|我来决定|自己决定|不需要(?:你)?推荐|不用(?:你)?推荐|无需(?:你)?推荐|不要(?:你)?推荐|不想要(?:你)?推荐|只去这些|仅去这些|只安排这些|就去这些|only\s+these|only\s+(?:the\s+)?(?:cities|destinations)\s+(?:i|we)\s+(?:named|listed|picked|chose)|no\s+recommendations?|without\s+(?:city\s+)?recommendations?|(?:do\s+not|don't|does\s+not|doesn't)\s+(?:need|want)\s+(?:any\s+)?(?:city\s+)?recommendations?|i(?:'m| am)\s+(?:choosing|selecting)|i(?:'ll| will)?\s+(?:choose|pick|select)\s+(?:(?:the|my)\s+)?(?:own\s+)?(?:cities|destinations)|i(?:'ll| will)?\s+(?:choose|pick|select)(?!\s+for\s+me)\b|i(?:'ll| will)?\s+(?:choose|pick|select)\s+.+\s+(?:myself|on\s+my\s+own)/i
const NEGATIVE_PATTERN = /不要|不去|别去|排除|避开|不想去|不考虑|不含|exclude|avoid|without/i

/**
 * Keep Mock mode's destination-mode transition aligned with the server
 * state machine. Naming a city after authorization is additive; only an
 * explicit opt-out returns the conversation to an explicit city list.
 */
export function destinationModeForTurn(
  previousMode: TripState['destination_mode'],
  text: string,
  hasNamedDestination: boolean
): TripState['destination_mode'] {
  if (RECOMMEND_OPTOUT_PATTERN.test(text)) return 'explicit'
  if (previousMode === 'recommend') return 'recommend'
  if (RECOMMEND_PATTERN.test(text)) return 'recommend'
  return hasNamedDestination ? 'explicit' : previousMode
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function parseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (digits[value] !== undefined) return digits[value]!
  const tens = value.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (!tens) return null
  return (tens[1] ? digits[tens[1]]! * 10 : 10) + (tens[2] ? digits[tens[2]]! : 0)
}

function findAlias(text: string, aliases: Array<{ iata: string; aliases: string[] }>): Array<{ iata: string; index: number }> {
  const lower = text.toLowerCase()
  const found: Array<{ iata: string; index: number }> = []
  for (const item of aliases) {
    let best = -1
    for (const alias of item.aliases) {
      const index = lower.indexOf(alias.toLowerCase())
      if (index >= 0 && (best < 0 || index < best)) best = index
    }
    if (best >= 0) found.push({ iata: item.iata, index: best })
  }
  return found.sort((left, right) => left.index - right.index)
}

function parseDate(text: string, today: string): { from: string; to: string } | undefined {
  const isoMatches = [...text.matchAll(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g)]
  const iso = isoMatches.length > 0 ? isoMatches[isoMatches.length - 1]?.[0] : undefined
  if (iso) {
    const from = iso.replace(/\//g, '-').replace(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/, '$1-$2-$3')
      .split('-').map((value, index) => index === 0 ? value : value.padStart(2, '0')).join('-')
    if (validDate(from) && from >= today) return { from, to: from }
  }
  const monthDay = text.match(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (monthDay) {
    const month = Number(monthDay[1])
    const day = Number(monthDay[2])
    const year = Number(today.slice(0, 4)) + (`${today.slice(0, 4)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` < today ? 1 : 0)
    const from = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (validDate(from) && from >= today) return { from, to: from }
  }
  if (/下周|next\s+week/i.test(text)) {
    const from = addDays(today, 7)
    return { from, to: from }
  }
  return undefined
}

function parseDays(text: string): number | null {
  if (/一周|一个星期|一星期|one\s+week/i.test(text)) return 7
  const match = text.match(/(?<!\d)(\d{1,2}|[一二两三四五六七八九十]+)\s*天/) ?? text.match(/(?:for|stay)\s*(\d{1,2})\s*days?/i)
  if (!match) return null
  const days = parseNumber(match[1]!)
  return days && days >= 1 && days <= 60 ? days : null
}

function recommendationFor(destination: MockDestination, interests: DestinationInterest[]): DestinationRecommendation {
  const matched = interests.filter(interest => destination.tags.includes(interest))
  const zhReason = matched.length > 0 ? `匹配${matched.join('、')}偏好，建议至少停留 ${destination.suggestedDays} 天。` : `来自${destination.region}目录，建议至少停留 ${destination.suggestedDays} 天。`
  const enReason = matched.length > 0 ? `Matches your ${matched.join(', ')} preference; plan at least ${destination.suggestedDays} days.` : `A directory option; plan at least ${destination.suggestedDays} days.`
  return {
    iata: destination.iata,
    cityZh: destination.cityZh,
    cityEn: destination.cityEn,
    region: destination.region,
    reason: { zh: zhReason, en: enReason },
    suggestedDays: destination.suggestedDays
  }
}

function mockRecommendations(state: TripState): DestinationRecommendation[] {
  const regions = state.regions.length > 0 ? new Set(state.regions) : new Set<DestinationRegion>(['japan', 'schengen', 'visa_free'])
  const excluded = new Set(state.excluded_iatas)
  const required = new Set(state.required_iatas)
  return MOCK_DESTINATIONS
    .filter(destination => regions.has(destination.region) && !excluded.has(destination.iata) && !required.has(destination.iata))
    .sort((left, right) => {
      const leftScore = state.interests.reduce((score, interest) => score + (left.tags.includes(interest) ? 1 : 0), 0)
      const rightScore = state.interests.reduce((score, interest) => score + (right.tags.includes(interest) ? 1 : 0), 0)
      return rightScore - leftScore || left.iata.localeCompare(right.iata)
    })
    .slice(0, 3)
    .map(destination => recommendationFor(destination, state.interests))
}

function parseMockTurn(previous: TripState, text: string, today: string): TripState {
  const state: TripState = {
    ...previous,
    interests: [...previous.interests],
    regions: [...previous.regions],
    required_iatas: [...previous.required_iatas],
    excluded_iatas: [...previous.excluded_iatas],
    priorities: [...previous.priorities]
  }
  const locations = findAlias(text, [...ORIGIN_ALIASES, ...DESTINATION_ALIASES])
  const originMention = locations.find(location => {
    const after = text.slice(location.index, location.index + 12)
    const before = text.slice(Math.max(0, location.index - 8), location.index)
    return /从|由|出发|from|depart/i.test(after) || /从|由|from|depart/i.test(before)
  })
  if (originMention && ORIGIN_ALIASES.some(item => item.iata === originMention.iata)) state.origin = originMention.iata
  const destinationLocations = locations.filter(location => DESTINATION_ALIASES.some(item => item.iata === location.iata))
  const explicitDestinations = destinationLocations.filter(location => !NEGATIVE_PATTERN.test(text.slice(Math.max(0, location.index - 4), location.index + 10)))
  const excluded = destinationLocations.filter(location => NEGATIVE_PATTERN.test(text.slice(Math.max(0, location.index - 4), location.index + 10))).map(location => location.iata)
  state.excluded_iatas = unique([...state.excluded_iatas, ...excluded])
  const named = explicitDestinations.map(location => location.iata).filter(iata => iata !== state.origin)
  if (named.length > 0) {
    const correction = /改成|换成|改去|改为|换到|而不是|instead|rather than|change/i.test(text)
    state.required_iatas = correction ? unique(named) : unique([...state.required_iatas, ...named])
  }
  const regions = REGION_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.region)
  if (regions.length > 0) state.regions = unique([...state.regions, ...regions])
  const interests = INTEREST_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.interest)
  if (interests.length > 0) state.interests = unique([...state.interests, ...interests])
  const dates = parseDate(text, today)
  if (dates) {
    state.window_from = dates.from
    state.window_to = dates.to
  }
  const days = parseDays(text)
  if (days) state.travel_days = days
  const budget = parseBudget(text)
  if (budget) state.budget_max = budget
  if (/慢节奏|轻松|不赶|悠闲|relaxed|slow/i.test(text)) state.pace = 'relaxed'
  if (/多城|尽可能多|多去几个|many\s+cities/i.test(text)) state.pace = 'many_cities'
  if (/少中转|少转机|少换乘|few\s+transfers/i.test(text)) state.priorities = unique([...state.priorities, 'few_transfers'])
  if (/舒适|舒服|comfort/i.test(text)) state.priorities = unique([...state.priorities, 'comfort'])
  if (/省钱|便宜|cheap|budget/i.test(text)) state.priorities = unique([...state.priorities, 'budget'])
  if (/文化|历史|博物馆|culture|history/i.test(text)) state.priorities = unique([...state.priorities, 'culture'])
  state.destination_mode = destinationModeForTurn(previous.destination_mode, text, named.length > 0)
  if (state.destination_mode === 'recommend' && RECOMMEND_PATTERN.test(text) && named.length === 0) {
    state.required_iatas = []
  }
  state.required_iatas = state.required_iatas.filter(iata => !state.excluded_iatas.includes(iata))
  return state
}

function routeFor(state: TripState, recommendations: DestinationRecommendation[]): RoutePick[] {
  if (!state.origin || !state.window_from || !state.travel_days) return []
  const requested = state.required_iatas.length > 0 ? state.required_iatas : recommendations.map(item => item.iata)
  const cities = unique(requested).filter(iata => iata !== state.origin).slice(0, state.pace === 'many_cities' ? 3 : 1)
  if (cities.length === 0) return []
  const legs = cities.map((to, index) => ({
    from: index === 0 ? state.origin! : cities[index - 1]!,
    to,
    date: addDays(state.window_from!, index),
    departTime: '09:00',
    arriveTime: '13:00',
    crossDay: false,
    duration: 240,
    price: 1_280 + index * 320,
    airline: 'FO',
    flightNo: `FO${100 + index}`,
    stops: 0,
    real: false
  }))
  const last = cities[cities.length - 1]!
  legs.push({
    from: last,
    to: state.origin,
    date: addDays(state.window_from, cities.length),
    departTime: '16:00',
    arriveTime: '20:00',
    crossDay: false,
    duration: 240,
    price: 1_380,
    airline: 'FO',
    flightNo: `FO${100 + cities.length}`,
    stops: 0,
    real: false
  })
  const totalPrice = legs.reduce((sum, leg) => sum + leg.price, 0)
  return [{
    kind: 'cheapest',
    route: {
      cities,
      citySeq: [state.origin, ...cities, state.origin],
      legs,
      totalPrice,
      effCost: totalPrice,
      nightsSaved: 0,
      hasReal: false
    }
  }]
}

function regionLabel(region: DestinationRegion): string {
  if (region === 'japan') return '日本'
  if (region === 'schengen') return '欧洲'
  return '免签候选区域'
}

function mockMissing(state: TripState): string[] {
  const missing = [
    ...(!state.origin ? ['origin'] : []),
    ...(!state.window_from ? ['window_from'] : []),
    ...(!state.travel_days ? ['travel_days'] : [])
  ]
  if (state.destination_mode === 'explicit') {
    const requiredRegions = new Set(state.required_iatas.flatMap(iata => {
      const destination = MOCK_DESTINATIONS.find(item => item.iata === iata)
      return destination ? [destination.region] : []
    }))
    const uncovered = state.required_iatas.length === 0
      || state.regions.some(region => !requiredRegions.has(region))
    if (uncovered) missing.push('destination')
  }
  return missing
}

function mockReply(state: TripState, missing: string[], recommendationCount: number, routeCount: number, today: string): BilingualText {
  if (missing.length > 0) {
    if (recommendationCount > 0) {
      const ask = missing[0] === 'window_from'
        ? `大致哪一天出发？例如 ${addDays(today, 7)}。`
        : missing[0] === 'travel_days' ? '准备玩几天？' : '请告诉我从哪个城市或机场出发？'
      return {
        zh: `我先整理了 ${recommendationCount} 个目录目的地建议；${ask}`,
        en: `I found ${recommendationCount} directory destinations. ${missing[0] === 'window_from' ? `What is your departure date, for example ${addDays(today, 7)}?` : missing[0] === 'travel_days' ? 'How many days will the trip last?' : 'Which city or airport will you depart from?'}`
      }
    }
    const destination = missing[0] === 'destination'
    return destination
      ? { zh: `请告诉我具体目的地城市；如果希望我来安排，请说“城市你看着安排”。`, en: 'Which destination city should I use? Or say “you choose the cities” to authorize recommendations.' }
      : missing[0] === 'origin'
        ? { zh: '请先告诉我从哪个城市或机场出发？', en: 'Which city or airport will you depart from?' }
        : missing[0] === 'travel_days'
          ? { zh: '准备玩几天？', en: 'How many days will the trip last?' }
          : { zh: `大致哪一天出发？例如 ${addDays(today, 7)}。`, en: `What is your departure date, for example ${addDays(today, 7)}?` }
  }
  if (routeCount > 0) return {
    zh: `已按你的约束生成 ${routeCount} 条路线；航班与价格请在确认时实时核实。`,
    en: `I generated ${routeCount} route option. Verify live flights and prices during confirmation.`
  }
  return { zh: '当前条件没有匹配路线，可以放宽预算、天数或目的地限制。', en: 'No route matched these constraints. Try relaxing the budget, duration, or destinations.' }
}

function action(id: string, zh: string, en: string, message: string): SuggestedAction {
  return { id, label: { zh, en }, message }
}

function mockActions(state: TripState, missing: string[], recommendationCount: number, routeCount: number, today: string): SuggestedAction[] {
  const actions: SuggestedAction[] = []
  const field = missing[0]
  if (field === 'origin') actions.push(action('provide-origin', '填写出发地', 'Add origin', '从北京出发'))
  if (field === 'window_from') actions.push(action('provide-date', '填写出发日期', 'Add departure date', `出发日期是 ${addDays(today, 7)}`))
  if (field === 'travel_days') actions.push(action('provide-days', '填写旅行天数', 'Add trip length', '我计划玩 7 天'))
  if (field === 'destination') {
    const region = state.regions[0] ? regionLabel(state.regions[0]) : '目的地'
    actions.push(action('authorize-destination-recommendations', '授权推荐城市', 'Authorize recommendations', `${region}城市你看着安排`))
  }
  if (state.destination_mode === 'recommend' && recommendationCount > 0) actions.push(action('choose-recommendation', '按推荐安排', 'Use recommendations', '按你推荐的目的地安排'))
  if (routeCount > 0) actions.push(action('review-routes', '看看路线差异', 'Compare routes', '请解释这条路线的差异'))
  return actions.slice(0, 3)
}

function mockLocation(iata: string): CloudLocationRef {
  const item = MOCK_DESTINATIONS.find(destination => destination.iata === iata)
  const origin = ORIGIN_ALIASES.find(candidate => candidate.iata === iata)
  const name = item?.cityEn ?? origin?.iata ?? iata
  const countryCode = item?.region === 'japan' ? 'JP' : item?.region === 'schengen' ? 'FR' : 'CN'
  return {
    id: `airport:${iata}`,
    type: 'airport',
    name,
    countryCode,
    iata,
    cityCode: iata
  }
}

function mockTripContextSummary(state: TripState): CloudTripContextSummary {
  const toLocations = (items: string[]) => items.map(mockLocation)
  const destinationMode: CloudDestinationIntent['mode'] = state.destination_mode === 'recommend' ? 'open' : 'explicit'
  return {
    version: 0,
    ...(state.origin ? { origin: mockLocation(state.origin) } : {}),
    ...(state.window_from ? {
      departureWindow: {
        from: state.window_from,
        ...(state.window_to ? { to: state.window_to } : {}),
        precision: state.window_from === state.window_to ? 'exact' : 'approximate'
      } as CloudDateWindow
    } : {}),
    ...(state.travel_days ? { travelDays: state.travel_days } : {}),
    ...(state.budget_max ? { budget: { amount: state.budget_max, currency: 'CNY', scope: 'trip' } } : {}),
    destinations: {
      mode: destinationMode,
      required: toLocations(state.required_iatas),
      preferred: [],
      excluded: toLocations(state.excluded_iatas)
    },
    interests: [...state.interests],
    // Mock mode has no route-generation worker, so field completeness must not
    // be presented as an actionable capability.
    readyForRouteGeneration: false
  }
}

const MOCK_CONVERSATION_STATES = new Map<string, TripState>()

async function mockConverse(input: ConversationRequest): Promise<ConversationResponse> {
  await new Promise(resolve => setTimeout(resolve, 20))
  const previous = MOCK_CONVERSATION_STATES.get(input.conversationId) ?? emptyTripState()
  const state = parseMockTurn(previous, input.message, todayIso())
  MOCK_CONVERSATION_STATES.set(input.conversationId, state)
  const missing = mockMissing(state)
  const recommendations = state.destination_mode === 'recommend' ? mockRecommendations(state) : []
  const routes = missing.length === 0 ? routeFor(state, recommendations) : []
  const legacyReply = mockReply(state, missing, recommendations.length, routes.length, todayIso())
  const suggestedActions: CloudSuggestedAction[] = missing.length > 0
    ? [{ id: 'continue_planning', label: 'Continue planning', kind: 'message' }]
    : []
  return {
    conversationId: input.conversationId,
    tripId: input.tripId,
    reply: legacyReply.zh,
    tripContextSummary: mockTripContextSummary(state),
    // The real endpoint owns all structured artifacts. Mock mode deliberately
    // does not manufacture legacy recommendation/route objects for the client.
    artifactRefs: [],
    suggestedActions,
    warnings: missing.length > 0 ? [] : ['route_generation_unavailable'],
    stopReason: missing.length > 0 ? 'needs_user_input' : 'completed'
  }
}

function randomUuid(): string {
  const hex = () => Math.floor(Math.random() * 0x1_0000).toString(16).padStart(4, '0')
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`
}

interface TripCreateResponse { trip: { id: string } }
interface ConversationCreateResponse { conversation: { id: string; tripId?: string; trip_id?: string } }

/** Create the owner-scoped cloud resources used by a new planning session. */
export async function bootstrapCloudSession(): Promise<CloudSessionBootstrap> {
  if (USE_MOCK) {
    return { tripId: randomUuid(), conversationId: randomUuid() }
  }
  const trip = await request<TripCreateResponse>({
    url: '/v1/trips',
    method: 'POST',
    data: {},
    retry: 0,
    timeout: 15_000
  })
  const tripId = trip.trip?.id
  if (!tripId) throw new Error('INVALID_TRIP_BOOTSTRAP_RESPONSE')
  const conversation = await request<ConversationCreateResponse>({
    url: '/v1/conversations',
    method: 'POST',
    data: { trip_id: tripId },
    retry: 0,
    timeout: 15_000
  })
  const conversationId = conversation.conversation?.id
  if (!conversationId) throw new Error('INVALID_CONVERSATION_BOOTSTRAP_RESPONSE')
  return { tripId, conversationId }
}

/**
 * Send exactly one new message to the authenticated Planner. In particular,
 * local history, legacy state, and previous messages never enter this body.
 */
export async function converse(input: ConversationRequest, options: ConverseOptions = {}): Promise<ConversationResponse> {
  const message = input.message.trim()
  if (!input.tripId || !input.conversationId || !message) throw new Error('INVALID_CONVERSATION_REQUEST')
  const body: ConversationRequest = {
    tripId: input.tripId,
    conversationId: input.conversationId,
    message
  }
  if (USE_MOCK) return mockConverse(body)
  const revision = authSnapshot().revision
  const startedAt = options.startedAt ?? Date.now()
  // Preparation time appears in the UI, but the server gets its full run allowance.
  const deadline = Date.now() + TURN_WAIT_LIMIT_MS
  let progress: ConversationTurnProgress = { connection: 'connecting', startedAt }
  const assertCurrent = () => {
    assertAuthSession(revision)
    if (options.isCurrent && !options.isCurrent()) throw new Error('STALE_CONVERSATION_TURN')
  }
  const assertBeforeRequest = () => {
    assertCurrent()
    if (Date.now() >= deadline) throw new Error('CONVERSATION_TURN_TIMEOUT')
  }
  const publish = (next: ConversationTurnProgress) => {
    assertCurrent()
    progress = next
    options.onProgress?.({ ...next })
  }
  assertBeforeRequest()
  publish(progress)
  // A timed-out POST is ambiguous: never retry it or submit a second message.
  const accepted = await request<{ turnId: string; status: 'running'; startedAt: string; tripId?: string; conversationId?: string; generationId?: string }>({
    url: '/v1/agent/turns',
    method: 'POST',
    data: body as unknown as Record<string, unknown>,
    retry: 0,
    showError: false,
    timeout: TURN_REQUEST_TIMEOUT_MS
  })
  assertCurrent()
  if (!accepted || typeof accepted.turnId !== 'string' || !accepted.turnId || accepted.turnId.length > 200
    || accepted.status !== 'running' || !validTimestamp(accepted.startedAt)
    || ((accepted.tripId !== undefined || accepted.conversationId !== undefined || accepted.generationId !== undefined)
      && (accepted.tripId !== body.tripId || accepted.conversationId !== body.conversationId
        || typeof accepted.generationId !== 'string' || !accepted.generationId || accepted.generationId.length > 200))) {
    throw new Error('INVALID_CONVERSATION_TURN_RESPONSE')
  }
  const turnId = accepted.turnId
  const scope = { tripId: body.tripId, conversationId: body.conversationId, generationId: accepted.generationId }
  let artifactRevision = -1
  let latestServerUpdatedAt = ''
  publish({ ...progress, turnId, ...scope })
  while (true) {
    assertBeforeRequest()
    let view: ConversationTurnView | undefined
    let received = false
    try {
      view = await request<ConversationTurnView>({
        url: `/v1/agent/turns/${encodeURIComponent(turnId)}`,
        method: 'GET',
        retry: 0,
        showError: false,
        timeout: Math.min(TURN_REQUEST_TIMEOUT_MS, deadline - Date.now())
      })
      received = true
    } catch (error) {
      assertCurrent()
      if (error instanceof ApiRequestError && error.status === 404) throw new Error('CONVERSATION_TURN_NOT_FOUND')
      if ((error instanceof ApiRequestError && error.status < 500)
        || (error as Error)?.message === 'AUTH_REQUIRED' || (error as Error)?.message === 'AUTH_SESSION_CHANGED') throw error
      // The last successful GET remains the only source of server activity and heartbeat.
      publish({ ...progress, connection: 'reconnecting' })
    }
    assertCurrent()
    if (received) {
      if (!view || !validTurnView(view, turnId) || !validPublication(view, scope)
        || ((view.tripId !== undefined || view.conversationId !== undefined || view.generationId !== undefined)
          && (view.tripId !== scope.tripId || view.conversationId !== scope.conversationId || view.generationId !== scope.generationId))) {
        throw new Error('INVALID_CONVERSATION_TURN_RESPONSE')
      }
      // Revisions are authoritative snapshots, including removals after a Trip change.
      if (view.artifactRevision !== undefined && view.artifactRevision < artifactRevision) {
        await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(TURN_POLL_INTERVAL_MS, deadline - Date.now()))))
        continue
      }
      if (view.artifactRevision !== undefined && view.artifactRevision > artifactRevision) {
        artifactRevision = view.artifactRevision
        assertCurrent()
        options.onArtifacts?.(compactPublication(view))
      }
      if (view.updatedAt < latestServerUpdatedAt) {
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(TURN_POLL_INTERVAL_MS, deadline - Date.now())))
        continue
      }
      latestServerUpdatedAt = view.updatedAt
      if (view.status === 'failed') {
        const code = typeof view.error?.code === 'string' ? view.error.code : 'CONVERSATION_TURN_FAILED'
        throw Object.assign(new Error(code), { code })
      }
      if (view.status === 'completed') {
        if (!validTurnResponse(view.response, body)) throw new Error('INVALID_CONVERSATION_TURN_RESPONSE')
        publish({ ...progress, connection: 'completed', stage: view.stage, lastConfirmedAt: Date.now(), serverUpdatedAt: view.updatedAt })
        return view.response
      }
      publish({ ...progress, connection: 'running', stage: view.stage, lastConfirmedAt: Date.now(), serverUpdatedAt: view.updatedAt })
    }
    assertBeforeRequest()
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(TURN_POLL_INTERVAL_MS, deadline - Date.now())))
  }
}

export const converseTurn = converse
