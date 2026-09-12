// src/stores/chatStore.ts — 统一需求对话状态
// 所有规划消息都通过 conversationService 发送到同一个后端协议；旧的
// 单目的地/多城分叉字段仅作为未改 UI 的兼容层保留。
import { makeAutoObservable, runInAction } from 'mobx'
import { confirmPicks, type RoutePick } from '../services/routeService'
import {
  converse,
  bootstrapCloudSession,
  emptyTripState,
  type ConversationMessage,
  type ConversationResponse,
  type ConversationDelivery,
  type ConversationTurnProgress,
  type CloudArtifactRef,
  type CloudTripContextSummary,
  type DestinationRecommendation,
  type SuggestedAction,
  type TripState
} from '../services/conversationService'
import type { FlightOption, Interest } from '../types/flight'
import { getCloudWorkspace, type CloudWorkspace } from '../services/workspaceService'
import { t } from '../i18n'
import {
  cloneTripState,
  cloneTravelGuide,
  loadChatHistory,
  registerCloudChatHistoryClearHandler,
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
import { USE_MOCK, ApiRequestError } from '../utils/request'
import { registerUserSessionClearHandler, userStore } from './userStore'
import {
  cancelRouteGenerationRun,
  createRouteGenerationRun,
  getRouteGenerationRun,
  isRouteGenerationTerminal,
  makeRouteGenerationIdempotencyKey,
  type RouteGenerationRunView
} from '../services/routeGenerationService'

export type { ChatSessionRecord, ConversationTurnSnapshot } from './chatHistory'

type ChatSessionChangeHandler = (sessionId: string, ownerId?: string) => void
const chatSessionChangeHandlers = new Set<ChatSessionChangeHandler>()

/** Feature stores use this to drop owner/session-bound views on workspace changes. */
export function registerChatSessionChangeHandler(handler: ChatSessionChangeHandler): () => void {
  chatSessionChangeHandlers.add(handler)
  return () => chatSessionChangeHandlers.delete(handler)
}

function notifyChatSessionChanged(sessionId: string, ownerId?: string): void {
  for (const handler of chatSessionChangeHandlers) handler(sessionId, ownerId)
}

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

/** Correlate business identities across local and server message IDs; never inspect prose. */
function deliveryIdentity(delivery: ConversationDelivery | undefined): string | undefined {
  const ids = [delivery?.goalId, ...(delivery?.goals?.map(goal => goal.goalId) ?? [])]
    .filter((id): id is string => Boolean(id))
  return ids.length ? [...new Set(ids)].sort().join('|') : undefined
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
  if (warning === 'route_generation_unavailable') return locale === 'zh' ? '生成路线功能暂未开放。' : 'Route generation is not available yet.'
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

  /** Legacy presentation slots retained for the not-yet-migrated Plan view. */
  state: TripState = emptyTripState()
  phase: 'discover' | 'clarify' | 'plan' = 'clarify'
  recommendations: DestinationRecommendation[] = []
  suggestedActions: SuggestedAction[] = []
  routes: RoutePick[] = []
  warnings: string[] = []

  /** Authoritative cloud response metadata. Never synthesized from legacy state. */
  tripContextSummary: CloudTripContextSummary | undefined
  artifactRefs: CloudArtifactRef[] = []
  stopReason = ''
  tripId = ''
  conversationId = ''
  routeGeneration: RouteGenerationRunView | undefined
  routeGenerationIdempotencyKey = ''
  routeGenerationLoading = false
  routeGenerationError = ''
  turnProgress: ConversationTurnProgress | undefined = undefined

  get isThinking(): boolean { return this.activeSendRequestId !== undefined }

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
  /** Send occupancy spans owner/session preparation and is independent of restored UI state. */
  private activeSendRequestId: number | undefined = undefined
  private multiConfirmRequestId = 0
  private activeOwnerId = ''
  private routeGenerationRequestId = 0
  private workspaceSyncRequestId = 0

  constructor() {
    makeAutoObservable(this)
    registerCloudChatHistoryClearHandler(ownerId => this.clearOwnerMaterial(ownerId))
    registerUserSessionClearHandler(ownerId => {
      if (ownerId) this.clearOwnerMaterial(ownerId)
    })
    this.hydrateHistory()
  }

  get currentSession(): ChatSessionRecord | undefined {
    return this.sessions.find(session => session.id === this.currentSessionId)
  }

  private hydrateHistory() {
    this.activeOwnerId = userStore.profile?.uid ?? ''
    const persisted = loadChatHistory(this.activeOwnerId || undefined)
    this.sessions = persisted.sessions
    this.currentSessionId = persisted.currentSessionId || newSessionId()
    const current = this.sessions.find(session => session.id === this.currentSessionId)
    if (current) {
      this.restoreSession(current)
    } else {
      this.clearLiveState()
    }
  }

  private clearOwnerMaterial(ownerId: string) {
    if (this.activeOwnerId !== ownerId) return
    this.invalidateInFlight()
    this.activeOwnerId = ''
    const persisted = loadChatHistory()
    this.sessions = persisted.sessions
    this.currentSessionId = persisted.currentSessionId || newSessionId()
    const current = this.sessions.find(session => session.id === this.currentSessionId)
    if (current) this.restoreSession(current)
    else this.clearLiveState()
    notifyChatSessionChanged(this.currentSessionId)
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
    this.tripContextSummary = undefined
    this.artifactRefs = []
    this.stopReason = ''
    this.tripId = ''
    this.conversationId = ''
    this.routeGeneration = undefined
    this.routeGenerationIdempotencyKey = ''
    this.routeGenerationLoading = false
    this.routeGenerationError = ''
    this.slots = {}
    this.ready = false
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
      ...(turn.tripContextSummary ? { tripContextSummary: turn.tripContextSummary } : {}),
      ...(turn.artifactRefs ? { artifactRefs: turn.artifactRefs.map(ref => ({ ...ref })) } : {}),
      ...(turn.stopReason ? { stopReason: turn.stopReason } : {}),
      ...(turn.travelGuide ? { travelGuide: cloneTravelGuide(turn.travelGuide) } : {})
    }))
    this.state = cloneTripState(session.state)
    this.phase = session.phase
    this.recommendations = [...session.recommendations]
    this.suggestedActions = [...session.suggestedActions]
    this.routes = [...session.routes]
    this.warnings = [...session.warnings]
    this.tripContextSummary = session.tripContextSummary
    this.artifactRefs = session.artifactRefs.map(ref => ({ ...ref }))
    this.stopReason = session.stopReason ?? ''
    this.tripId = session.tripId ?? ''
    this.conversationId = session.conversationId ?? ''
    this.routeGeneration = session.routeGeneration ? { ...session.routeGeneration, progress: { ...session.routeGeneration.progress }, warnings: [...session.routeGeneration.warnings], ...(session.routeGeneration.error ? { error: { ...session.routeGeneration.error } } : {}) } : undefined
    this.routeGenerationIdempotencyKey = session.routeGenerationIdempotencyKey ?? session.routeGeneration?.idempotencyKey ?? ''
    this.routeGenerationLoading = false
    this.routeGenerationError = ''
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
  }

  private invalidateInFlight() {
    this.requestGeneration += 1
    this.routeGenerationRequestId += 1
    this.workspaceSyncRequestId += 1
    this.multiConfirmRequestId += 1
    this.activeSendRequestId = undefined
    this.turnProgress = undefined
    this.plansLoading = false
    this.multiLoading = false
    this.multiConfirming = false
    this.routeGenerationLoading = false
    this.routeGenerationError = ''
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
      ...(turn.tripContextSummary ? { tripContextSummary: turn.tripContextSummary } : {}),
      ...(turn.artifactRefs ? { artifactRefs: turn.artifactRefs.map(ref => ({ ...ref })) } : {}),
      ...(turn.stopReason ? { stopReason: turn.stopReason } : {}),
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
      warnings: [...this.warnings],
      ...(this.activeOwnerId ? { ownerId: this.activeOwnerId } : {}),
      ...(this.tripId ? { tripId: this.tripId } : {}),
      ...(this.conversationId ? { conversationId: this.conversationId } : {}),
      artifactRefs: this.artifactRefs.map(ref => ({ ...ref })),
      ...(this.tripContextSummary ? { tripContextSummary: this.tripContextSummary } : {}),
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      ...(this.routeGeneration ? {
        routeGeneration: {
          ...this.routeGeneration,
          progress: { ...this.routeGeneration.progress },
          warnings: [...this.routeGeneration.warnings],
          ...(this.routeGeneration.error ? { error: { ...this.routeGeneration.error } } : {})
        }
      } : {}),
      ...(this.routeGenerationIdempotencyKey ? { routeGenerationIdempotencyKey: this.routeGenerationIdempotencyKey } : {})
    }
  }

  private persistCurrentSession(dropPending = false) {
    const snapshot = this.liveSessionSnapshot(dropPending)
    const rest = this.sessions.filter(session => session.id !== this.currentSessionId)
    this.sessions = sessionHasContent(snapshot)
      ? [snapshot, ...rest].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)).slice(0, 20)
      : rest
    saveChatHistory(this.currentSessionId, this.sessions, this.activeOwnerId || undefined)
  }

  private syncConversation(result: ConversationResponse, locale: 'zh' | 'en') {
    // The cloud response is authoritative. Do not turn its compact summary or
    // Artifact references into the legacy client-owned route/state objects.
    this.tripContextSummary = result.tripContextSummary
    const existingRefs = new Map(this.artifactRefs.map(ref => [ref.id, ref]))
    for (const ref of result.artifactRefs) existingRefs.set(ref.id, { ...ref })
    this.artifactRefs = [...existingRefs.values()].slice(-100)
    this.stopReason = result.stopReason
    this.suggestedActions = result.suggestedActions.map(action => this.presentSuggestedAction(action, locale)).slice(0, 3)
    this.warnings = [...(result.warnings ?? [])].slice(-12)
    this.multiPicks = null
    this.multiWarnings = this.warnings.map(warning => formatConversationWarning(warning, locale))
    this.multiError = ''
    this.plansError = ''
    this.planCards = null
    this.ready = false
  }

  private presentSuggestedAction(action: ConversationResponse['suggestedActions'][number], _locale: 'zh' | 'en'): SuggestedAction {
    const isRouteGeneration = action.id === 'generate_route' || action.kind === 'route_generation'
    const label = isRouteGeneration
      ? { zh: '生成路线', en: 'Generate route' }
      : { zh: action.label, en: action.label }
    return {
      id: action.id,
      label,
      // The old Plan view expects a message field. A route action is handled by
      // activateSuggestedAction and must never be routed as a fake chat turn.
      message: isRouteGeneration ? '' : action.label,
      kind: action.kind,
      ...(action.href ? { href: action.href } : {})
    }
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

  private activateOwner(ownerId: string) {
    if (ownerId === this.activeOwnerId) return
    this.activeOwnerId = ownerId
    const persisted = loadChatHistory(ownerId || undefined)
    this.sessions = persisted.sessions
    this.currentSessionId = persisted.currentSessionId || newSessionId()
    const current = this.sessions.find(session => session.id === this.currentSessionId)
    if (current) this.restoreSession(current)
    else this.clearLiveState()
  }

  private ownerForRequest(): string | undefined {
    if (userStore.profile?.uid) return userStore.profile.uid
    return USE_MOCK ? 'mock-local' : undefined
  }

  get requiresLogin(): boolean { return !this.ownerForRequest() }

  /** Ensure the current local session has an owner-scoped cloud Trip/Conversation. */
  private async ensureCloudSession(ownerId: string, requestId: number): Promise<void> {
    this.activateOwner(ownerId)
    const current = this.currentSession
    if (current?.ownerId === ownerId && this.tripId && this.conversationId) return

    // A legacy session may remain visible, but it is never promoted to a cloud
    // conversation and its messages are never replayed.
    if (current && sessionHasContent(current)) {
      this.persistCurrentSession(true)
      this.currentSessionId = newSessionId()
      this.clearLiveState()
    }
    // Capture the session only after legacy migration/new-session setup has
    // settled. The migration branch intentionally changes currentSessionId.
    const sessionIdAtBootstrapStart = this.currentSessionId
    const bootstrap = await bootstrapCloudSession()
    // A bootstrap can outlive logout, reset, a session switch, or a newer
    // message. Never let that late response reattach cloud IDs to the now
    // inactive local session.
    if (requestId !== this.requestGeneration
      || this.currentSessionId !== sessionIdAtBootstrapStart
      || this.activeOwnerId !== ownerId
      || this.ownerForRequest() !== ownerId) {
      throw new Error('STALE_CLOUD_SESSION_BOOTSTRAP')
    }
    this.activeOwnerId = ownerId
    this.tripId = bootstrap.tripId
    this.conversationId = bootstrap.conversationId
    this.artifactRefs = []
    this.tripContextSummary = undefined
    this.stopReason = ''
  }

  private transportError(error: unknown, locale: 'zh' | 'en'): string {
    const code = error instanceof Error ? error.message : ''
    if (code === 'AUTH_REQUIRED' || code === 'AUTH_SESSION_CHANGED' || (error instanceof ApiRequestError && error.status === 401)) return locale === 'zh' ? '请登录后继续规划，输入内容已保留。' : 'Sign in to continue planning. Your message is preserved.'
    if (code === 'INVALID_TRIP_BOOTSTRAP_RESPONSE' || code === 'INVALID_CONVERSATION_BOOTSTRAP_RESPONSE') {
      return locale === 'zh' ? '云端会话初始化失败，请重试。' : 'Cloud session setup failed. Please try again.'
    }
    if (code === 'CONVERSATION_TURN_NOT_FOUND') {
      return locale === 'zh' ? '本次处理状态已失效，服务可能已重启。请从行程重新打开，查看已保存的结果后再继续对话。' : 'This request status is no longer available. The service may have restarted. Reopen your trip to check saved results before continuing the conversation.'
    }
    if (code === 'CONVERSATION_TURN_TIMEOUT' || code === 'AGENT_TURN_TIMEOUT') {
      return locale === 'zh' ? '本次处理等待超时。请从行程重新打开，查看已保存的结果后再继续对话。' : 'This request took too long. Reopen your trip to check saved results before continuing the conversation.'
    }
    return locale === 'zh' ? '规划服务暂时不可用，请重试。' : 'Planning service is unavailable. Please try again.'
  }

  /** Prepare the same owner-scoped Trip/Conversation used by chat for a product action. */
  async prepareCloudSession(locale: 'zh' | 'en'): Promise<{ tripId: string; conversationId: string }> {
    const ownerId = this.ownerForRequest()
    if (!ownerId) throw new Error(this.transportError(new Error('AUTH_REQUIRED'), locale))
    const requestId = ++this.requestGeneration
    await this.ensureCloudSession(ownerId, requestId)
    if (requestId !== this.requestGeneration || !this.tripId || !this.conversationId) {
      throw new Error('STALE_CLOUD_SESSION_BOOTSTRAP')
    }
    return { tripId: this.tripId, conversationId: this.conversationId }
  }

  /** Attach a server-created immutable Artifact ref without copying its payload into history. */
  addArtifactRef(ref: CloudArtifactRef): void {
    const refs = new Map(this.artifactRefs.map(value => [value.id, value]))
    refs.set(ref.id, { ...ref })
    this.artifactRefs = [...refs.values()].slice(-100)
    this.persistCurrentSession()
  }

  /** Submit every planning turn once and follow its server-confirmed progress. */
  async send(text: string, locale: 'zh' | 'en'): Promise<boolean> {
    const content = text.trim()
    if (!content || this.isThinking) return false

    const requestId = ++this.requestGeneration
    this.workspaceSyncRequestId += 1
    this.multiConfirmRequestId += 1
    const ownerId = this.ownerForRequest()
    if (!ownerId) {
      const error = new Error('AUTH_REQUIRED')
      this.multiError = this.transportError(error, locale)
      this.plansError = this.multiError
      return false
    }

    this.activeSendRequestId = requestId
    const sessionRevision = userStore.sessionRevision
    const startedAt = Date.now()
    this.turnProgress = { connection: 'connecting', startedAt }
    this.multiLoading = true
    this.plansLoading = false
    let turnId: string | undefined
    const isCurrent = () => requestId === this.requestGeneration && this.activeSendRequestId === requestId
      && this.ownerForRequest() === ownerId && userStore.sessionRevision === sessionRevision
    try {
      await this.ensureCloudSession(ownerId, requestId)
      if (!isCurrent() || !this.tripId || !this.conversationId) return false

      const userMessage: ConversationMessage = { role: 'user', content }
      this.messages = [...this.messages, userMessage].slice(-MAX_CHAT_MESSAGES)
      turnId = `turn-${requestId}`
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
      this.persistCurrentSession()

      const result = await converse({ tripId: this.tripId, conversationId: this.conversationId, message: content }, {
        startedAt,
        isCurrent,
        onProgress: progress => {
          if (!isCurrent()) return
          runInAction(() => { this.turnProgress = { ...progress } })
        }
      })
      if (!isCurrent()) return false
      if (result.tripId !== this.tripId || result.conversationId !== this.conversationId) {
        throw new Error('CONVERSATION_ID_MISMATCH')
      }
      runInAction(() => {
        const assistant: ConversationMessage = { role: 'assistant', content: result.reply }
        const turnArtifactRefs = result.artifactRefs.map(ref => ({ ...ref }))
        this.messages = appendAssistant(this.messages, assistant.content)
        this.syncConversation(result, locale)
        this.timeline = this.timeline.map(turn => turn.id === turnId ? {
          ...turn,
          assistant,
          recommendations: [...this.recommendations],
          suggestedActions: [...this.suggestedActions],
          routes: [...this.routes],
          warnings: [...this.warnings],
          tripContextSummary: this.tripContextSummary,
          artifactRefs: turnArtifactRefs,
          stopReason: this.stopReason,
          ...(result.delivery ? { delivery: result.delivery } : {}),
          error: undefined
        } : turn)
      })
      this.persistCurrentSession()
      // The server may have queued work through an Agent tool. Reconcile by ID,
      // never by parsing its reply, and never create a second generation POST.
      await this.refreshWorkspace(locale)
      return isCurrent()
    } catch (error) {
      if (!isCurrent()) return false
      runInAction(() => {
        // Keep failures visible as an error state. Never synthesize an
        // assistant message that could be mistaken for a cloud reply.
        const message = this.transportError(error, locale)
        this.timeline = this.timeline.map(turn => turn.id === turnId ? {
          ...turn,
          assistant: null,
          error: message
        } : turn)
        this.multiError = message
        this.plansError = this.multiError
      })
      if (turnId) this.persistCurrentSession()
      return false
    } finally {
      if (this.activeSendRequestId === requestId) {
        runInAction(() => {
          this.activeSendRequestId = undefined
          this.turnProgress = undefined
          this.multiLoading = false
          this.plansLoading = false
        })
      }
    }
  }

  /** Read current cloud results without replacing the visible conversation or sending new work. */
  async refreshWorkspace(locale: 'zh' | 'en' = 'zh'): Promise<void> {
    const ownerId = this.ownerForRequest()
    if (USE_MOCK || !ownerId || this.activeOwnerId !== ownerId || !this.tripId || !this.conversationId) return
    const tripId = this.tripId
    const conversationId = this.conversationId
    const sessionId = this.currentSessionId
    const requestId = ++this.workspaceSyncRequestId
    const isCurrent = () => requestId === this.workspaceSyncRequestId && this.ownerForRequest() === ownerId
      && this.activeOwnerId === ownerId && this.currentSessionId === sessionId && this.tripId === tripId && this.conversationId === conversationId
    try {
      const workspace = await getCloudWorkspace(tripId, conversationId)
      if (!isCurrent()) return
      if (workspace.trip.id !== tripId || workspace.conversationId !== conversationId) throw new Error('WORKSPACE_ID_MISMATCH')
      runInAction(() => {
        this.tripContextSummary = workspace.tripContextSummary
        const refs = new Map(this.artifactRefs.map(ref => [ref.id, ref]))
        for (const ref of workspace.artifactRefs) refs.set(ref.id, ref)
        this.artifactRefs = [...refs.values()].slice(-100)
        const deliveries = new Map<string, ConversationDelivery>()
        for (const message of workspace.messages) {
          const identity = deliveryIdentity(message.delivery)
          if (message.role === 'assistant' && identity && message.delivery) deliveries.set(identity, message.delivery)
        }
        this.timeline = this.timeline.map(turn => {
          if (!turn.delivery || turn.delivery.status === 'satisfied' || turn.delivery.status === 'cancelled') return turn
          const identity = deliveryIdentity(turn.delivery)
          const delivery = identity ? deliveries.get(identity) : undefined
          return delivery ? { ...turn, delivery } : turn
        })
        if (workspace.routeGeneration) {
          const run = workspace.routeGeneration
          // Route results belong to the Trip, including runs from another conversation.
          if (run.tripId !== tripId) return
          if (!this.routeGenerationLoading) {
            if (this.setRouteGenerationRun(run)) this.attachRouteGenerationArtifact(run)
          }
        }
        const run = this.routeGeneration
        this.routeGenerationError = run?.status === 'failed' ? (run.error?.message ?? this.routeGenerationMessage(new Error('ROUTE_GENERATION_FAILED'), locale))
          : run?.status === 'cancelled' ? (run.error?.message ?? (locale === 'zh' ? '已取消生成路线。' : 'Route generation cancelled.')) : ''
        this.persistCurrentSession()
      })
      if (isCurrent() && this.routeGeneration && !isRouteGenerationTerminal(this.routeGeneration.status)) {
        void this.resumeRouteGeneration(locale)
      }
    } catch {
      if (isCurrent()) runInAction(() => {
        this.routeGenerationError = locale === 'zh' ? '暂时无法更新处理进度，请刷新查看结果。' : 'Progress could not be updated. Refresh to check the result.'
      })
    }
  }

  private setRouteGenerationRun(run: RouteGenerationRunView): boolean {
    const previous = this.routeGeneration
    if (previous?.id === run.id && (run.updatedAt < previous.updatedAt
      || (isRouteGenerationTerminal(previous.status) && !isRouteGenerationTerminal(run.status)))) return false
    this.routeGeneration = {
      ...run,
      progress: { ...run.progress },
      warnings: [...run.warnings],
      ...(run.error ? { error: { ...run.error } } : {})
    }
    this.routeGenerationIdempotencyKey = run.idempotencyKey
    return true
  }

  private attachRouteGenerationArtifact(run: RouteGenerationRunView) {
    if (!run.resultArtifactId) return
    this.addArtifactRef({
      id: run.resultArtifactId,
      type: 'route_set',
      schemaVersion: 1,
      presentationHint: 'route_preview'
    })
  }

  private routeGenerationMessage(error: unknown, locale: 'zh' | 'en'): string {
    const code = error instanceof Error ? error.message : ''
    if (code === 'AUTH_REQUIRED') return locale === 'zh' ? '请先登录后生成路线。' : 'Please sign in before generating a route.'
    if (code === 'ROUTE_GENERATION_UNAVAILABLE') return locale === 'zh' ? '生成路线服务暂时不可用。' : 'Route generation is unavailable right now.'
    if (code === 'ROUTE_GENERATION_NOT_READY') return locale === 'zh' ? '当前行程信息还不足以生成路线。' : 'This trip is not ready for route generation.'
    return locale === 'zh' ? '生成路线失败，请重试。' : 'Route generation failed. Please try again.'
  }

  private routeGenerationPollErrorIsRetryable(error: unknown): boolean {
    if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 429) return false
    const code = error instanceof Error ? error.message : ''
    // Authentication, malformed requests, and a missing/foreign run will not
    // become valid by polling again. Network failures, timeouts, rate limits,
    // and other transient server responses get a small bounded retry budget.
    return !/^(AUTH_REQUIRED|HTTP (400|401|403|404|409))$/.test(code)
  }

  private async pollRouteGeneration(runId: string, requestId: number, locale: 'zh' | 'en') {
    // A finite exponential schedule keeps a lost/buggy server from creating an
    // unbounded background loop. Re-entering the action starts a new bounded
    // poll, while a network retry can still reuse the same POST key.
    let delayMs = 500
    let transientGetFailures = 0
    for (let attempt = 0; attempt < 18; attempt += 1) {
      if (requestId !== this.routeGenerationRequestId) return
      await new Promise(resolve => setTimeout(resolve, delayMs))
      if (requestId !== this.routeGenerationRequestId) return

      let run: RouteGenerationRunView
      try {
        run = await getRouteGenerationRun(runId)
      } catch (error) {
        if (requestId !== this.routeGenerationRequestId) return
        transientGetFailures += 1
        if (!this.routeGenerationPollErrorIsRetryable(error) || transientGetFailures >= 3) {
          runInAction(() => {
            this.routeGenerationLoading = false
            this.routeGenerationError = this.routeGenerationMessage(error, locale)
          })
          this.persistCurrentSession()
          return
        }
        delayMs = Math.min(4_000, delayMs * 2)
        continue
      }
      if (requestId !== this.routeGenerationRequestId) return
      transientGetFailures = 0
      runInAction(() => {
        this.setRouteGenerationRun(run)
        this.routeGenerationError = ''
      })
      this.persistCurrentSession()
      if (isRouteGenerationTerminal(run.status)) {
        runInAction(() => {
          this.routeGenerationLoading = false
          if (run.status === 'failed' || run.status === 'cancelled') {
            this.routeGenerationError = run.error?.message ?? (run.status === 'cancelled' ? (locale === 'zh' ? '已取消生成路线。' : 'Route generation cancelled.') : this.routeGenerationMessage(new Error('ROUTE_GENERATION_FAILED'), locale))
          }
        })
        this.attachRouteGenerationArtifact(run)
        this.persistCurrentSession()
        await this.refreshWorkspace(locale)
        return
      }
      delayMs = Math.min(4_000, delayMs * 2)
    }
    if (requestId === this.routeGenerationRequestId) {
      runInAction(() => {
        this.routeGenerationLoading = false
        this.routeGenerationError = locale === 'zh' ? '生成路线轮询超时，请稍后重试。' : 'Route generation polling timed out. Please retry later.'
      })
      this.persistCurrentSession()
    }
  }

  /** Resume polling an accepted non-terminal run without creating another run. */
  async resumeRouteGeneration(locale: 'zh' | 'en' = 'zh') {
    if (this.routeGenerationLoading) return
    const run = this.routeGeneration
    if (!run || isRouteGenerationTerminal(run.status)) return
    const ownerId = this.ownerForRequest()
    if (!ownerId) {
      this.routeGenerationError = this.routeGenerationMessage(new Error('AUTH_REQUIRED'), locale)
      return
    }
    if (this.activeOwnerId !== ownerId || this.currentSession?.ownerId !== ownerId
      || !this.tripId || this.tripId !== run.tripId) {
      this.routeGenerationError = this.routeGenerationMessage(new Error('ROUTE_GENERATION_NOT_READY'), locale)
      return
    }
    const requestId = ++this.routeGenerationRequestId
    this.routeGenerationLoading = true
    this.routeGenerationError = ''
    this.persistCurrentSession()
    await this.pollRouteGeneration(run.id, requestId, locale)
  }

  /** Explicit user action; never sends a conversational generate-route message. */
  async generateRoute(locale: 'zh' | 'en' = 'zh', options: { reuseIdempotencyKey?: boolean } = {}) {
    if (this.routeGenerationLoading) return
    if (this.routeGeneration && !isRouteGenerationTerminal(this.routeGeneration.status)) {
      await this.resumeRouteGeneration(locale)
      return
    }
    const ownerId = this.ownerForRequest()
    if (!ownerId) {
      this.routeGenerationError = this.routeGenerationMessage(new Error('AUTH_REQUIRED'), locale)
      return
    }
    if (this.activeOwnerId !== ownerId || !this.currentSession?.ownerId || this.currentSession.ownerId !== ownerId
      || !this.tripId || !this.conversationId || !this.tripContextSummary?.readyForRouteGeneration) {
      this.routeGenerationError = this.routeGenerationMessage(new Error('ROUTE_GENERATION_NOT_READY'), locale)
      return
    }
    const previousTerminal = this.routeGeneration && isRouteGenerationTerminal(this.routeGeneration.status)
    const idempotencyKey = options.reuseIdempotencyKey || !previousTerminal
      ? (this.routeGenerationIdempotencyKey || makeRouteGenerationIdempotencyKey())
      : makeRouteGenerationIdempotencyKey()
    const requestId = ++this.routeGenerationRequestId
    this.routeGenerationIdempotencyKey = idempotencyKey
    this.routeGenerationError = ''
    this.routeGenerationLoading = true
    this.persistCurrentSession()
    try {
      const created = await createRouteGenerationRun({
        tripId: this.tripId,
        conversationId: this.conversationId,
        expectedTripVersion: this.tripContextSummary.version,
        idempotencyKey
      })
      if (requestId !== this.routeGenerationRequestId) return
      runInAction(() => {
        this.setRouteGenerationRun(created.run)
        this.routeGenerationIdempotencyKey = created.run.idempotencyKey || idempotencyKey
        this.routeGenerationError = ''
      })
      this.persistCurrentSession()
      if (isRouteGenerationTerminal(created.run.status)) {
        runInAction(() => {
          this.routeGenerationLoading = false
          if (created.run.status === 'failed' || created.run.status === 'cancelled') {
            this.routeGenerationError = created.run.error?.message ?? (created.run.status === 'cancelled'
              ? (locale === 'zh' ? '已取消生成路线。' : 'Route generation cancelled.')
              : this.routeGenerationMessage(new Error('ROUTE_GENERATION_FAILED'), locale))
          }
        })
        this.attachRouteGenerationArtifact(created.run)
        this.persistCurrentSession()
        await this.refreshWorkspace(locale)
        return
      }
      await this.pollRouteGeneration(created.run.id, requestId, locale)
    } catch (error) {
      if (requestId !== this.routeGenerationRequestId) return
      runInAction(() => {
        this.routeGenerationLoading = false
        this.routeGenerationError = this.routeGenerationMessage(error, locale)
      })
      this.persistCurrentSession()
    }
  }

  /** Cancel the active server run; late poll responses cannot overwrite it. */
  async cancelRouteGeneration(locale: 'zh' | 'en' = 'zh') {
    const run = this.routeGeneration
    if (!run || isRouteGenerationTerminal(run.status)) return
    const requestId = ++this.routeGenerationRequestId
    this.routeGenerationLoading = true
    this.routeGenerationError = ''
    try {
      const cancelled = await cancelRouteGenerationRun(run.id)
      if (requestId !== this.routeGenerationRequestId) return
      runInAction(() => {
        this.setRouteGenerationRun(cancelled)
        this.routeGenerationIdempotencyKey = cancelled.idempotencyKey
        this.routeGenerationLoading = false
        this.routeGenerationError = cancelled.status === 'cancelled'
          ? (cancelled.error?.message ?? (locale === 'zh' ? '已取消生成路线。' : 'Route generation cancelled.'))
          : cancelled.status === 'failed'
            ? (cancelled.error?.message ?? this.routeGenerationMessage(new Error('ROUTE_GENERATION_FAILED'), locale))
            : ''
      })
      this.attachRouteGenerationArtifact(cancelled)
      this.persistCurrentSession()
      await this.refreshWorkspace(locale)
    } catch (error) {
      if (requestId !== this.routeGenerationRequestId) return
      runInAction(() => {
        this.routeGenerationLoading = false
        this.routeGenerationError = this.routeGenerationMessage(error, locale)
      })
      this.persistCurrentSession()
    }
  }

  /** Route the Plan view's suggested action to the correct transport. */
  async activateSuggestedAction(action: SuggestedAction, locale: 'zh' | 'en') {
    if (action.disabled) return
    if (action.id === 'generate_route' || action.kind === 'route_generation') {
      await this.generateRoute(locale)
      return
    }
    if (action.message) await this.send(action.message, locale)
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
    saveChatHistory(this.currentSessionId, this.sessions, this.activeOwnerId || undefined)
    notifyChatSessionChanged(this.currentSessionId, this.activeOwnerId || undefined)
  }

  /** Switch to a stored session; late responses from the previous one are invalidated. */
  openCloudWorkspace(workspace: CloudWorkspace, ownerId: string) {
    if (userStore.profile?.uid !== ownerId || !workspace.conversationId) throw new Error('登录状态已变更，请重新打开行程')
    this.persistCurrentSession(true)
    this.invalidateInFlight()
    this.activateOwner(ownerId)
    this.clearLiveState()
    this.currentSessionId = `cloud-${workspace.conversationId}`
    this.tripId = workspace.trip.id
    this.conversationId = workspace.conversationId
    this.tripContextSummary = workspace.tripContextSummary
    this.routeGeneration = workspace.routeGeneration
    this.routeGenerationIdempotencyKey = workspace.routeGeneration?.idempotencyKey ?? ''
    this.artifactRefs = workspace.artifactRefs.slice(-100)
    this.messages = workspace.messages.map(m => ({ role: m.role, content: m.content })).slice(-MAX_CHAT_MESSAGES)
    const timeline: ConversationTurnSnapshot[] = []
    for (const message of workspace.messages) {
      if (message.role === 'user') {
        timeline.push({ id: message.id, user: { role: 'user', content: message.content }, assistant: null, recommendations: [], suggestedActions: [], routes: [], warnings: [], artifactRefs: [] })
      } else {
        const turn = timeline[timeline.length - 1]
        if (turn && !turn.assistant) {
          turn.assistant = { role: 'assistant', content: message.content }
          turn.artifactRefs = message.artifactRefs
          if (message.delivery) turn.delivery = message.delivery
        }
      }
    }
    this.timeline = timeline.slice(-MAX_CHAT_TIMELINE)
    this.multiActive = this.timeline.length > 0
    this.suggestedActions = workspace.tripContextSummary.readyForRouteGeneration
      ? [this.presentSuggestedAction({ id: 'generate_route', kind: 'route_generation', label: '生成路线' }, 'zh')] : []
    const snapshot = this.liveSessionSnapshot()
    snapshot.title = workspace.trip.title || sessionTitle(this.messages)
    this.sessions = [snapshot, ...this.sessions.filter(s => s.id !== snapshot.id)].slice(0, 20)
    saveChatHistory(this.currentSessionId, this.sessions, ownerId)
    if (this.routeGeneration) this.attachRouteGenerationArtifact(this.routeGeneration)
    notifyChatSessionChanged(this.currentSessionId, ownerId)
  }

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
    saveChatHistory(this.currentSessionId, this.sessions, this.activeOwnerId || undefined)
    notifyChatSessionChanged(this.currentSessionId, this.activeOwnerId || undefined)
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
      notifyChatSessionChanged(this.currentSessionId, this.activeOwnerId || undefined)
    }
    saveChatHistory(this.currentSessionId, this.sessions, this.activeOwnerId || undefined)
  }
}

export const chatStore = new ChatStore()
