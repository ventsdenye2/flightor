// src/stores/chatStore.ts — 统一需求对话状态
// 所有规划消息都通过 conversationService 发送到同一个后端协议；旧的
// 单目的地/多城分叉字段仅作为未改 UI 的兼容层保留。
import { makeAutoObservable, runInAction } from 'mobx'
import { confirmPicks, type RoutePick } from '../services/routeService'
import {
  converse,
  emptyTripState,
  type ConversationMessage,
  type ConversationResponse,
  type DestinationRecommendation,
  type SuggestedAction,
  type TripState
} from '../services/conversationService'
import { flightStore } from './flightStore'
import type { FlightOption, Interest } from '../types/flight'
import { t } from '../i18n'
import {
  cloneTripState,
  cloneTravelGuide,
  loadChatHistory,
  saveChatHistory,
  sessionSummary,
  sessionHasContent,
  sessionTitle,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_ROUTES,
  MAX_CHAT_TIMELINE,
  type ChatSessionRecord,
  type ConversationTurnSnapshot
} from './chatHistory'

export type { ChatSessionRecord, ConversationTurnSnapshot } from './chatHistory'

/** 旧需求卡片仍由页面引用，统一 Agent 不再生成它。 */
export interface PlanCard {
  key: 'save' | 'comfort' | 'play'
  flight: FlightOption
}

/** 页面暂未迁移时使用的兼容槽位视图；正式请求不再读取或发送它。 */
export interface ChatSlotsCompat {
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function appendAssistant(messages: ConversationMessage[], content: string): ConversationMessage[] {
  return [...messages, { role: 'assistant' as const, content }].slice(-24)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function newSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatConversationWarning(warning: string, locale: 'zh' | 'en'): string {
  if (warning === 'llm_fallback') return locale === 'zh' ? '部分解析使用了规则兜底。' : 'Part of the request used a rules fallback.'
  if (warning === 'reply_fallback') return locale === 'zh' ? '回复使用了安全的规则兜底。' : 'The reply used a safe rules fallback.'
  if (warning === 'journey_unavailable') return locale === 'zh' ? '路线服务暂时不可用。' : 'The route service is temporarily unavailable.'
  if (warning === 'recommendations_unavailable') return locale === 'zh' ? '目的地推荐暂时不可用。' : 'Destination recommendations are temporarily unavailable.'
  const guideWarningKeys: Record<string, string> = {
    travel_guide_search_unavailable: 'chat.warningGuideSearchUnavailable',
    search_unavailable: 'chat.warningGuideSearchUnavailable',
    travel_guide_search_partial: 'chat.warningGuideSearchPartial',
    search_partial: 'chat.warningGuideSearchPartial',
    travel_guide_search_failed: 'chat.warningGuideSearchFailed',
    search_failed: 'chat.warningGuideSearchFailed',
    travel_guide_catalog_fallback: 'chat.warningGuideCatalogFallback',
    catalog_fallback: 'chat.warningGuideCatalogFallback',
    travel_guide_partial_catalog_fallback: 'chat.warningGuidePartialCatalogFallback',
    partial_catalog_fallback: 'chat.warningGuidePartialCatalogFallback',
    travel_guide_llm_fallback: 'chat.warningGuideLlmFallback',
    guide_llm_fallback: 'chat.warningGuideLlmFallback',
    fallback: 'chat.warningGuideFallback',
    travel_guide_fallback: 'chat.warningGuideFallback'
  }
  const guideKey = guideWarningKeys[warning]
  if (guideKey) return t(guideKey)
  return locale === 'zh' ? `提示：${warning}` : `Notice: ${warning}`
}

/** Pure interaction guard: only the newest turn remains live. */
export function isConversationTurnInteractive(
  turns: ConversationTurnSnapshot[],
  turnId: string,
  busy: boolean
): boolean {
  return !busy && turns.length > 0 && turns[turns.length - 1]?.id === turnId
}

function firstRouteDestination(state: TripState, routes: RoutePick[]): string | undefined {
  const explicit = state.required_iatas[0]
  if (explicit) return explicit
  const route = routes[0]?.route
  return route?.cities.find(iata => iata !== state.origin)
}

function compatibilitySlots(state: TripState, routes: RoutePick[]): ChatSlotsCompat {
  const destination = firstRouteDestination(state, routes)
  const days = state.travel_days ?? undefined
  return {
    origin: state.origin ?? undefined,
    destination,
    depart_date_from: state.window_from ?? undefined,
    depart_date_to: state.window_to ?? undefined,
    stay_min: days,
    stay_max: days,
    trip_type: 'roundtrip',
    budget_max: state.budget_max ?? undefined,
    interests: state.interests as Interest[],
    transfer_pref: 'any'
  }
}

export class ChatStore {
  messages: ConversationMessage[] = []

  /** Ordered turn snapshots used by the page; messages remains API history. */
  timeline: ConversationTurnSnapshot[] = []

  /** Local-only session records. The page subscribes to summaries and loads a full record on demand. */
  sessions: ChatSessionRecord[] = []
  currentSessionId = ''

  /** Unified backend state. The client sends this state back each turn. */
  state: TripState = emptyTripState()
  phase: ConversationResponse['phase'] = 'clarify'
  recommendations: DestinationRecommendation[] = []
  suggestedActions: SuggestedAction[] = []
  routes: RoutePick[] = []
  warnings: string[] = []

  isThinking = false

  /** Compatibility fields referenced by the current page. */
  slots: ChatSlotsCompat = {}
  ready = false
  planCards: PlanCard[] | null = null
  plansLoading = false
  plansError = ''

  /** Route-card compatibility: always mirrors the unified response routes. */
  multiActive = false
  multiDraft = ''
  multiPicks: RoutePick[] | null = null
  multiLoading = false
  multiError = ''
  multiWarnings: string[] = []
  multiConfirming = false

  /** Request generations invalidate late responses after reset or a new turn. */
  private requestGeneration = 0
  private multiConfirmRequestId = 0
  private nextMessageStartsTrip = true

  constructor() {
    makeAutoObservable(this)
    this.hydrateHistory()
  }

  get currentSession(): ChatSessionRecord | undefined {
    return this.sessions.find(session => session.id === this.currentSessionId)
  }

  private hydrateHistory() {
    const persisted = loadChatHistory()
    this.sessions = persisted.sessions
    this.currentSessionId = persisted.currentSessionId || newSessionId()
    const current = this.sessions.find(session => session.id === this.currentSessionId)
    if (current) {
      this.restoreSession(current)
    } else {
      this.clearLiveState()
    }
  }

  private clearLiveState() {
    this.messages = []
    this.timeline = []
    this.state = emptyTripState()
    this.phase = 'clarify'
    this.recommendations = []
    this.suggestedActions = []
    this.routes = []
    this.warnings = []
    this.slots = {}
    this.ready = false
    this.isThinking = false
    this.planCards = null
    this.plansLoading = false
    this.plansError = ''
    this.multiActive = false
    this.multiDraft = ''
    this.multiPicks = null
    this.multiLoading = false
    this.multiError = ''
    this.multiWarnings = []
    this.multiConfirming = false
    this.nextMessageStartsTrip = true
  }

  private restoreSession(session: ChatSessionRecord) {
    this.messages = session.messages.map(message => ({ ...message }))
    this.timeline = session.timeline.map(turn => ({
      ...turn,
      user: { ...turn.user },
      assistant: turn.assistant ? { ...turn.assistant } : null,
      recommendations: [...turn.recommendations],
      suggestedActions: [...turn.suggestedActions],
      routes: [...turn.routes],
      warnings: [...turn.warnings],
      ...(turn.travelGuide ? { travelGuide: cloneTravelGuide(turn.travelGuide) } : {})
    }))
    this.state = cloneTripState(session.state)
    this.phase = session.phase
    this.recommendations = [...session.recommendations]
    this.suggestedActions = [...session.suggestedActions]
    this.routes = [...session.routes]
    this.warnings = [...session.warnings]
    this.multiPicks = this.routes.length > 0 ? this.routes : null
    this.multiWarnings = [...this.warnings]
    this.slots = compatibilitySlots(this.state, this.routes)
    this.ready = this.phase === 'plan'
      && this.state.destination_mode === 'explicit'
      && this.state.required_iatas.length === 1
      && this.routes.length > 0
      && Boolean(this.slots.origin && this.slots.destination && this.slots.depart_date_from)
    this.multiActive = this.routes.length > 0 || this.timeline.length > 0
    this.multiDraft = this.messages.filter(message => message.role === 'user').map(message => message.content).join('\n').slice(-1_000)
    this.multiError = ''
    this.plansError = ''
    this.planCards = null
    this.plansLoading = false
    this.multiLoading = false
    this.multiConfirming = false
    this.isThinking = false
    this.nextMessageStartsTrip = this.messages.length === 0 && this.timeline.length === 0
  }

  private invalidateInFlight() {
    this.requestGeneration += 1
    this.multiConfirmRequestId += 1
    this.isThinking = false
    this.plansLoading = false
    this.multiLoading = false
    this.multiConfirming = false
  }

  private liveSessionSnapshot(dropPending = false): ChatSessionRecord {
    const timeline = this.timeline.map(turn => ({
      ...turn,
      user: { ...turn.user },
      assistant: turn.assistant ? { ...turn.assistant } : null,
      recommendations: [...turn.recommendations],
      suggestedActions: [...turn.suggestedActions],
      routes: [...turn.routes],
      warnings: [...turn.warnings],
      ...(turn.travelGuide ? { travelGuide: cloneTravelGuide(turn.travelGuide) } : {})
    }))
    const messages = this.messages.map(message => ({ ...message }))
    if (dropPending) {
      const pending = timeline[timeline.length - 1]
      if (pending && pending.assistant === null) {
        timeline.pop()
        const lastMessage = messages[messages.length - 1]
        if (lastMessage?.role === 'user' && lastMessage.content === pending.user.content) messages.pop()
      }
    }
    const existing = this.currentSession
    const createdAt = existing?.createdAt ?? Date.now()
    return {
      id: this.currentSessionId,
      createdAt,
      updatedAt: Date.now(),
      title: existing?.title || sessionTitle(messages),
      summary: sessionSummary(messages, timeline),
      messages: messages.slice(-MAX_CHAT_MESSAGES),
      timeline: timeline.slice(-MAX_CHAT_TIMELINE),
      state: cloneTripState(this.state),
      phase: this.phase,
      recommendations: [...this.recommendations].slice(0, 3),
      suggestedActions: [...this.suggestedActions].slice(0, 3),
      routes: [...this.routes].slice(0, MAX_CHAT_ROUTES),
      warnings: [...this.warnings]
    }
  }

  private persistCurrentSession(dropPending = false) {
    const snapshot = this.liveSessionSnapshot(dropPending)
    const rest = this.sessions.filter(session => session.id !== this.currentSessionId)
    this.sessions = sessionHasContent(snapshot)
      ? [snapshot, ...rest].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)).slice(0, 20)
      : rest
    saveChatHistory(this.currentSessionId, this.sessions)
  }

  private syncConversation(result: ConversationResponse, locale: 'zh' | 'en') {
    this.state = result.state
    this.phase = result.phase
    this.recommendations = [...result.recommendations].slice(0, 3)
    this.suggestedActions = [...result.suggestedActions].slice(0, 3)
    this.routes = [...result.routes].slice(0, MAX_CHAT_ROUTES)
    this.warnings = [...(result.warnings ?? [])].slice(-12)
    this.multiPicks = this.routes.length > 0 ? this.routes : null
    this.multiWarnings = this.warnings.map(warning => formatConversationWarning(warning, locale))
    this.slots = compatibilitySlots(this.state, this.routes)
    this.ready = result.phase === 'plan'
      && this.state.destination_mode === 'explicit'
      && this.state.required_iatas.length === 1
      && this.routes.length > 0
      && Boolean(this.slots.origin && this.slots.destination && this.slots.depart_date_from)
    this.multiActive = this.multiActive || this.routes.length > 0
    this.multiError = ''
    this.plansError = ''
    this.planCards = null
  }

  private clearTurnOutput() {
    this.phase = 'clarify'
    this.recommendations = []
    this.suggestedActions = []
    this.routes = []
    this.warnings = []
    this.multiPicks = null
    this.multiWarnings = []
    this.multiError = ''
    this.plansError = ''
    this.planCards = null
    this.ready = false
  }

  /** Send every planning turn through the unified converse endpoint. */
  async send(text: string, locale: 'zh' | 'en') {
    const content = text.trim()
    if (!content || this.isThinking) return

    const requestId = ++this.requestGeneration
    this.multiConfirmRequestId += 1
    const newTrip = this.nextMessageStartsTrip
    const userMessage: ConversationMessage = { role: 'user', content }
    const requestMessages = [...this.messages, userMessage].slice(-24)
    const requestState = newTrip ? undefined : cloneTripState(this.state)
    this.messages = requestMessages
    const turnId = `turn-${requestId}`
    this.timeline = [...this.timeline, {
      id: turnId,
      user: userMessage,
      assistant: null,
      recommendations: [],
      suggestedActions: [],
      routes: [],
      warnings: []
    }].slice(-MAX_CHAT_TIMELINE)
    this.multiDraft = this.messages.filter(message => message.role === 'user').map(message => message.content).join('\n').slice(-1_000)
    this.clearTurnOutput()
    this.multiActive = true
    this.isThinking = true
    this.multiLoading = true
    this.plansLoading = false
    this.persistCurrentSession()

    try {
      const result = await converse(requestMessages, {
        state: requestState,
        newTrip,
        today: todayIso()
      })
      if (requestId !== this.requestGeneration) return
      runInAction(() => {
        const assistant: ConversationMessage = { role: 'assistant', content: locale === 'zh' ? result.reply.zh : result.reply.en }
        this.messages = appendAssistant(requestMessages, assistant.content)
        this.syncConversation(result, locale)
        const travelGuide = cloneTravelGuide(result.travelGuide)
        this.timeline = this.timeline.map(turn => turn.id === turnId ? {
          ...turn,
          assistant,
          recommendations: [...this.recommendations],
          suggestedActions: [...this.suggestedActions],
          routes: [...this.routes],
          warnings: [...this.warnings],
          ...(travelGuide ? { travelGuide } : {}),
          error: undefined
        } : turn)
        this.nextMessageStartsTrip = false
      })
      this.persistCurrentSession()
    } catch {
      if (requestId !== this.requestGeneration) return
      runInAction(() => {
        const assistant: ConversationMessage = {
          role: 'assistant',
          content: locale === 'zh' ? '刚才走神了，再说一遍？' : 'Sorry, I missed that — could you repeat?'
        }
        this.messages = appendAssistant(requestMessages, assistant.content)
        this.timeline = this.timeline.map(turn => turn.id === turnId ? {
          ...turn,
          assistant,
          error: locale === 'zh' ? '规划失败，请重试' : 'Planning failed, please retry'
        } : turn)
        this.multiError = locale === 'zh' ? '规划失败，请重试' : 'Planning failed, please retry'
        this.plansError = this.multiError
        this.nextMessageStartsTrip = false
      })
      this.persistCurrentSession()
    } finally {
      if (requestId === this.requestGeneration) {
        runInAction(() => {
          this.isThinking = false
          this.multiLoading = false
          this.plansLoading = false
        })
      }
    }
  }

  /**
   * Kept for the existing page's CTA. Unified responses already contain the
   * route picks, so convergence is local and never invokes a second planner.
   */
  async converge(_locale: 'zh' | 'en') {
    if (this.routes.length > 0) this.multiPicks = this.routes
  }

  /** Compatibility alias for callers that used the old multi-route method. */
  async planMulti(text: string, locale: 'zh' | 'en') {
    await this.send(text, locale)
  }

  /** Existing flight-card action remains unchanged; it does not plan or quote. */
  pickPlan(flight: FlightOption) {
    flightStore.select(flight)
  }

  /** Confirm exactly the route card the user clicked, then merge it in place. */
  async confirmMulti(kind: RoutePick['kind'], locale: 'zh' | 'en' = 'zh') {
    const picks = this.multiPicks ?? (this.routes.length > 0 ? this.routes : null)
    if (!picks || this.multiConfirming) return
    const targetPick = picks.find(pick => pick.kind === kind)
    if (!targetPick) return

    const requestId = this.requestGeneration
    const confirmRequestId = ++this.multiConfirmRequestId
    const isCurrent = () => requestId === this.requestGeneration && confirmRequestId === this.multiConfirmRequestId
    this.multiConfirming = true
    this.multiError = ''
    try {
      const confirmed = await confirmPicks([targetPick], quoteWarnings => {
        if (!isCurrent()) return
        runInAction(() => {
          this.warnings = unique([...this.warnings, ...quoteWarnings])
          this.multiWarnings = this.warnings.map(warning => formatConversationWarning(warning, locale))
          this.timeline = this.timeline.map((turn, index) => index === this.timeline.length - 1
            ? { ...turn, warnings: unique([...turn.warnings, ...quoteWarnings]) }
            : turn)
        })
        this.persistCurrentSession()
      })
      if (!isCurrent()) return
      const confirmedPick = confirmed.find(pick => pick.kind === kind)
      if (!confirmedPick) return
      runInAction(() => {
        const merge = (current: RoutePick[]) => current.map(pick => pick.kind === kind ? confirmedPick : pick)
        this.routes = merge(this.routes)
        this.multiPicks = this.routes
        this.timeline = this.timeline.map((turn, index) => index === this.timeline.length - 1
          ? { ...turn, routes: merge(turn.routes), error: undefined }
          : turn)
      })
      this.persistCurrentSession()
    } catch {
      if (isCurrent()) {
        runInAction(() => {
          this.multiError = locale === 'zh' ? '确认报价失败，请重试' : 'Quote confirmation failed, please retry'
          this.timeline = this.timeline.map((turn, index) => index === this.timeline.length - 1
            ? { ...turn, error: this.multiError }
            : turn)
        })
        this.persistCurrentSession()
      }
    } finally {
      if (isCurrent()) {
        runInAction(() => {
          this.multiConfirming = false
        })
      }
    }
  }

  /** Start a new local session without removing previous conversations. */
  reset() {
    this.persistCurrentSession(true)
    this.invalidateInFlight()
    this.currentSessionId = newSessionId()
    this.clearLiveState()
    saveChatHistory(this.currentSessionId, this.sessions)
  }

  /** Switch to a stored session; late responses from the previous one are invalidated. */
  switchSession(sessionId: string) {
    if (sessionId === this.currentSessionId) return
    const target = this.sessions.find(session => session.id === sessionId)
    if (!target) return
    this.persistCurrentSession(true)
    this.invalidateInFlight()
    const restored = this.sessions.find(session => session.id === sessionId)
    if (!restored) return
    this.currentSessionId = restored.id
    this.restoreSession(restored)
    saveChatHistory(this.currentSessionId, this.sessions)
  }

  /** Delete one stored session. Deleting the current one opens the newest remaining session. */
  deleteSession(sessionId: string) {
    if (!this.sessions.some(session => session.id === sessionId)) return
    this.persistCurrentSession(true)
    this.invalidateInFlight()
    const deletingCurrent = sessionId === this.currentSessionId
    this.sessions = this.sessions.filter(session => session.id !== sessionId)
    if (deletingCurrent) {
      const next = this.sessions[0]
      if (next) {
        this.currentSessionId = next.id
        this.restoreSession(next)
      } else {
        this.currentSessionId = newSessionId()
        this.clearLiveState()
      }
    }
    saveChatHistory(this.currentSessionId, this.sessions)
  }
}

export const chatStore = new ChatStore()
