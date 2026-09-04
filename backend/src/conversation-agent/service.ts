import type { OpenRouterClient } from '../providers/openrouter/client.js'
import {
  canonicalDestinationIata,
  isSupportedDestinationIata,
  isSupportedOrigin,
  recommendFromCatalog
} from './catalog-adapter.js'
import { enrichWithLlm, synthesizeReply } from './llm.js'
import { planFromJourney } from './planner-adapter.js'
import { buildQuestionField, missingDestinationRegions, missingJourneyFields, parseRuleTurn, type RuleParseResult } from './rules.js'
import { emptyTripState, type ConverseRequest, type ConversationMessage, type TripState } from './schema.js'
import type { BilingualText, ConversationResponse, SuggestedAction } from './types.js'
import { buildTravelGuide, hasTravelGuideIntent, type TravelGuideDependencies } from '../travel-guides/index.js'

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isNewTripText(text: string): boolean {
  return /重新规划|重新开始|新的旅行|新旅行|从头开始|清空行程|start\s+over|new\s+trip|plan\s+another/i.test(text)
}

function userMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.filter(message => message.role === 'user')
}

function latestUser(messages: ConversationMessage[]): ConversationMessage | undefined {
  return [...messages].reverse().find(message => message.role === 'user')
}

/**
 * A new-trip request is allowed to contain the earlier user turns again,
 * for example when the first network attempt failed and the client retries.
 * Keep all current-trip user turns, but discard turns before the latest
 * explicit reset marker so an old conversation cannot seed the new state.
 */
function newTripMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const users = userMessages(messages)
  let resetIndex = -1
  users.forEach((message, index) => {
    if (isNewTripText(message.content)) resetIndex = index
  })
  return resetIndex >= 0 ? users.slice(resetIndex) : users
}

function sanitizeClientState(input: TripState, today: string): TripState {
  const required = [...new Set(input.required_iatas)].filter(isSupportedDestinationIata)
  const excluded = [...new Set(input.excluded_iatas)].filter(isSupportedDestinationIata)
  const state: TripState = {
    ...input,
    origin: input.origin && isSupportedOrigin(input.origin) ? input.origin : null,
    interests: [...new Set(input.interests)],
    regions: [...new Set(input.regions)],
    required_iatas: required,
    excluded_iatas: excluded,
    priorities: [...new Set(input.priorities)]
  }
  const excludedCanonical = new Set(state.excluded_iatas.map(canonicalDestinationIata))
  state.required_iatas = state.required_iatas.filter(iata => !excludedCanonical.has(canonicalDestinationIata(iata)))
  if (state.window_from && state.window_from < today) {
    state.window_from = null
    state.window_to = null
  } else if (state.window_to && state.window_to < (state.window_from ?? today)) {
    state.window_to = state.window_from
  }
  return state
}

function parseState(input: ConverseRequest, today: string): {
  state: TripState
  latestRule: RuleParseResult
  messages: ConversationMessage[]
  reset: boolean
} {
  const latest = latestUser(input.messages)
  const reset = input.newTrip === true || Boolean(latest && isNewTripText(latest.content))
  const initial = reset ? emptyTripState() : input.state ? sanitizeClientState(input.state, today) : emptyTripState()
  const messages = reset
    ? newTripMessages(input.messages)
    : input.state
      ? (latest ? [latest] : [])
      : userMessages(input.messages)
  let state = initial
  let latestRule: RuleParseResult = {
    state,
    evidenceIatas: new Set(),
    evidenceRegions: new Set(),
    recommendRequested: false,
    explicitDestinationMentioned: false
  }
  for (const message of messages) {
    latestRule = parseRuleTurn(state, message.content, today)
    state = latestRule.state
  }
  return { state, latestRule, messages, reset }
}

function regionLabel(region: string): string {
  if (region === 'japan') return '日本'
  if (region === 'schengen') return '欧洲'
  if (region === 'visa_free') return '免签候选区域'
  return region
}

function addDays(today: string, days: number): string {
  const value = new Date(`${today}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function fieldQuestion(field: string | undefined, today: string, state?: TripState): BilingualText {
  switch (field) {
    case 'origin':
      return { zh: '请先告诉我从哪个城市或机场出发？', en: 'Which city or airport will you depart from?' }
    case 'window_from':
      return { zh: `大致哪一天出发？给我一个具体日期（如 ${addDays(today, 7)}）就可以。`, en: `What is your departure date? A specific date such as ${addDays(today, 7)} is enough.` }
    case 'travel_days':
      return { zh: '准备玩几天？', en: 'How many days will the trip last?' }
    case 'destination': {
      const regions = state ? missingDestinationRegions(state) : []
      const suffix = regions.length > 0
        ? `请告诉我${regions.map(regionLabel).join('、')}的具体城市；也可以说“城市你看着安排”，授权我从目录推荐。`
        : '请告诉我具体目的地城市；如果希望我来安排，请说“城市你看着安排”。'
      return { zh: suffix, en: regions.length > 0
        ? `Which city should I use for ${regions.map(regionLabel).join(' and ')}? Or say “you choose the cities” to authorize catalog recommendations.`
        : 'Which destination city should I use? Or say “you choose the cities” to authorize catalog recommendations.' }
    }
    default:
      return { zh: '还想补充什么旅行偏好？', en: 'What else would you like to add to the trip?' }
  }
}

function recommendationSummary(state: TripState, count: number): BilingualText {
  const region = state.regions.length > 0 ? state.regions.join('、') : '你的偏好'
  return {
    zh: `我先按${region}和兴趣整理了 ${count} 个目的地建议；你可以先选方向，再补充出发日期。`,
    en: `I found ${count} destination ideas based on ${region} and your interests. Pick a direction, then add the departure date.`
  }
}

function buildReply(state: TripState, missing: string[], recommendationsCount: number, routesCount: number, today: string): BilingualText {
  if (missing.length > 0) {
    const question = fieldQuestion(buildQuestionField(state), today, state)
    if (recommendationsCount > 0) {
      const summary = recommendationSummary(state, recommendationsCount)
      return {
        zh: `${summary.zh}${question.zh}`,
        en: `${summary.en} ${question.en}`
      }
    }
    return question
  }
  if (routesCount > 0) {
    const destinationText = state.required_iatas.length > 0
      ? `已按 ${state.required_iatas.join('、')} 的要求`
      : '已按你的偏好'
    return {
      zh: `${destinationText}生成了 ${routesCount} 条路线，航班与价格请在确认步骤再实时核实。`,
      en: `I generated ${routesCount} route options ${state.required_iatas.length > 0 ? `for ${state.required_iatas.join(', ')}` : 'from your preferences'}. Verify live flights and prices at confirmation.`
    }
  }
  return {
    zh: '行程条件已齐，但当前没有找到符合约束的路线；可以放宽预算、天数或目的地限制。',
    en: 'The trip requirements are complete, but no route matched them. Consider relaxing the budget, duration, or destination constraints.'
  }
}

function action(id: string, zh: string, en: string, message: string): SuggestedAction {
  return { id, label: { zh, en }, message }
}

function buildSuggestedActions(
  state: TripState,
  missing: string[],
  recommendationsCount: number,
  routesCount: number,
  today: string,
  guideRequested = false
): SuggestedAction[] {
  const actions: SuggestedAction[] = []
  const field = buildQuestionField(state)
  if (field === 'origin') actions.push(action('provide-origin', '填写出发地', 'Add origin', '从北京出发'))
  else if (field === 'window_from') {
    const suggestedDate = addDays(today, 7)
    actions.push(action('provide-date', '填写出发日期', 'Add departure date', `出发日期是 ${suggestedDate}`))
  }
  else if (field === 'travel_days') actions.push(action('provide-days', '填写旅行天数', 'Add trip length', '我计划玩 7 天'))
  else if (field === 'destination') {
    const regions = missingDestinationRegions(state)
    const regionText = regions.length > 0 ? regions.map(regionLabel).join('、') : '目的地'
    actions.push(action('authorize-destination-recommendations', '授权推荐城市', 'Authorize city recommendations', `${regionText}城市你看着安排`))
  }
  if (state.destination_mode === 'recommend' && recommendationsCount > 0) {
    actions.push(action('choose-recommendation', '按推荐安排', 'Use recommendations', '按你推荐的目的地安排'))
  }
  if (routesCount > 0) {
    actions.push(action('review-routes', '看看路线差异', 'Compare routes', '请解释这几条路线的差异'))
    if (!guideRequested) {
      actions.push(action('generate-travel-guide', '生成游玩攻略', 'Generate travel guide', '生成这条路线的游玩攻略'))
    }
  }
  // `missing` is intentionally read here to make it explicit that actions
  // are driven only by the current client-supplied state.
  void missing
  return actions.slice(0, 3)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export async function converse(
  input: ConverseRequest,
  client: Pick<OpenRouterClient, 'chat'> | undefined,
  dependencies: { travelGuide?: TravelGuideDependencies } = {}
): Promise<ConversationResponse> {
  const today = input.today ?? utcToday()
  const parsed = parseState(input, today)
  const llm = await enrichWithLlm(client, parsed.messages, parsed.state, parsed.latestRule, today)
  // Apply the same catalog/origin boundary after extraction as for client
  // state.  This is defense in depth for future model adapters.
  const state = sanitizeClientState(llm.state, today)
  const missing = missingJourneyFields(state)
  let recommendations = [] as ConversationResponse['recommendations']
  const warnings = [...llm.warnings]

  // Recommendations are useful before an exact date and are authorized only
  // when the user asked the agent to choose.  A country-only mention stays
  // out of required_iatas and does not silently switch into recommendation
  // mode; catalog cards are suggestions, not hidden choices.
  if (state.destination_mode === 'recommend') {
    try {
      recommendations = recommendFromCatalog(state)
    } catch {
      warnings.push('recommendations_unavailable')
    }
  }

  let routes: ConversationResponse['routes'] = []
  if (missing.length === 0) {
    try {
      routes = await planFromJourney(state)
    } catch {
      warnings.push('journey_unavailable')
    }
  }

  // Web research is deliberately opt-in per turn.  A generic route request
  // only receives a suggested action; it never spends SerpApi quota.  The
  // first deterministic route is the sole source of guide destinations.
  const latestText = latestUser(input.messages)?.content ?? ''
  const guideRequested = hasTravelGuideIntent(latestText)
  let travelGuide: ConversationResponse['travelGuide']
  if (guideRequested && routes.length > 0) {
    try {
      travelGuide = await buildTravelGuide({
        route: routes[0]!,
        travelDays: state.travel_days!,
        interests: state.interests
      }, dependencies.travelGuide)
      warnings.push(...travelGuide.warnings)
    } catch {
      // Guide failures are non-blocking: the route response remains usable.
      warnings.push('travel_guide_fallback')
    }
  }
  const phase: ConversationResponse['phase'] = missing.length === 0
    ? 'plan'
    : recommendations.length > 0
      ? 'discover'
      : 'clarify'
  const deterministicReply = buildReply(state, missing, recommendations.length, routes.length, today)
  let reply = deterministicReply
  if (client) {
    if (llm.source === 'llm') {
      const synthesized = await synthesizeReply(client, { state, recommendations, routes, missing })
      if (synthesized) reply = synthesized
      else warnings.push('reply_fallback')
    } else {
      // The extraction call itself failed, so the deterministic reply is also
      // the final wording fallback.  A configured provider failure is exposed
      // separately from the no-key fast path below.
      warnings.push('reply_fallback')
    }
  }
  if (travelGuide) {
    reply = {
      zh: `${reply.zh} 已按第一条路线生成 ${travelGuide.days.length} 天游玩攻略。`,
      en: `${reply.en} A ${travelGuide.days.length}-day guide is attached for the first route.`
    }
  }
  const response: ConversationResponse = {
    phase,
    reply,
    state,
    recommendations,
    routes,
    missing,
    suggestedActions: buildSuggestedActions(state, missing, recommendations.length, routes.length, today, guideRequested),
    source: llm.source,
    warnings: unique(warnings)
  }
  if (travelGuide) response.travelGuide = travelGuide
  return response
}

/** Descriptive alias for callers that prefer the turn-oriented name. */
export const runConversationTurn = converse

export { emptyTripState, tripStateSchema, converseRequestSchema } from './schema.js'
export type { TripState, ConverseRequest } from './schema.js'
