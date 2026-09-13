// pages/plan — default Trip Workspace tab
import { useEffect, useRef, useState } from 'react'
import { View, Text, Input, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import DemoBadge from '../../components/common/DemoBadge'
import {
  chatStore,
  registerChatSessionChangeHandler,
  formatConversationWarning,
  isConversationTurnInteractive,
  type ChatSessionRecord,
  type ConversationTurnSnapshot
} from '../../stores/chatStore'
import type {
  DestinationRecommendation,
  SuggestedAction,
  TravelGuide,
  TravelGuideSource,
  TravelGuideSourceKind
} from '../../services/conversationService'
import { cityByIata, type RoutePick } from '../../services/routeService'
import { isRouteGenerationTerminal } from '../../services/routeGenerationService'
import { t, localeStore } from '../../i18n'
import { formatPrice, formatMonthDay } from '../../utils/format'
import TripContextChips from '../../components/plan/TripContextChipsView'
import type { TripContextChipViewModel } from '../../components/plan/tripContextChips'
import { ArtifactTimelineItem } from '../../components/artifacts'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { artifactService } from '../../services/artifactService'
import { userStore } from '../../stores/userStore'
import LoginSheet from '../../components/common/LoginSheet'
import { conversationDeliveryLabel } from '../../components/plan/conversationDelivery'
import PlannerProgress from '../../components/plan/PlannerProgress'
import PlannerPage from '../../features/ui-experience/PlannerPage'
import { loadProductionTrip } from '../../services/productionTripService'
import type { TripPresentation } from '../../features/ui-experience/presentation'
import './index.scss'

const ROUTE_LABEL_KEY: Record<string, string> = {
  cheapest: 'chat.routeCheapest',
  mostCities: 'chat.routeMostCities',
  mostNights: 'chat.routeMostNights'
}

const GUIDE_SOURCE_LABEL_KEY: Record<TravelGuideSourceKind, string> = {
  web: 'chat.guideSourceWeb',
  catalog: 'chat.guideSourceCatalog',
  rules: 'chat.guideSourceRules'
}

function guideSourceLabel(source: TravelGuideSourceKind): string {
  return t(GUIDE_SOURCE_LABEL_KEY[source])
}

function isSafeGuideWebUrl(value: string): boolean {
  if (typeof URL !== 'function') {
    const match = value.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i)
    return Boolean(match && match[1] && !match[1].includes('@'))
  }
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function sessionUpdatedLabel(timestamp: number, locale: 'zh' | 'en'): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return locale === 'zh'
    ? `${month}月${day}日 ${hour}:${minute}`
    : `${MONTHS_EN[month - 1]} ${day} · ${hour}:${minute}`
}

interface SessionHistoryPanelProps {
  sessions: ChatSessionRecord[]
  currentSessionId: string
  locale: 'zh' | 'en'
  onNew: () => void
  onSelect: (sessionId: string) => void
  onDelete: (session: ChatSessionRecord) => void
  onClose: () => void
}

function SessionHistoryPanel({
  sessions,
  currentSessionId,
  locale,
  onNew,
  onSelect,
  onDelete,
  onClose
}: SessionHistoryPanelProps) {
  return (
    <View className='agent-chat__history-panel'>
      <View className='agent-chat__history-head'>
        <View className='agent-chat__history-heading'>
          <Text className='agent-chat__section-title'>{t('chat.historyTitle')}</Text>
          <Text className='agent-chat__history-local'>{t('chat.historyLocal')}</Text>
        </View>
        <View className='agent-chat__history-close' hoverClass='tap-dim' onClick={onClose}>
          <Text>×</Text>
        </View>
      </View>
      <ScrollView className='agent-chat__history-list' scrollY>
        {sessions.length === 0 ? (
          <Text className='agent-chat__history-empty'>{t('chat.historyEmpty')}</Text>
        ) : (
          sessions.map(session => (
            <View
              key={session.id}
              className={`agent-chat__history-item ${session.id === currentSessionId ? 'is-current' : ''}`}
              hoverClass='tap-dim'
              onClick={() => onSelect(session.id)}
            >
              <View className='agent-chat__history-item-main'>
                <View className='agent-chat__history-item-title-row'>
                  <Text className='agent-chat__history-item-title'>{session.title || t('chat.historyUntitled')}</Text>
                  {session.id === currentSessionId && <Text className='agent-chat__history-current'>{t('chat.historyCurrent')}</Text>}
                </View>
                <Text className='agent-chat__history-item-summary'>{session.summary || session.title || t('chat.historyUntitled')}</Text>
                <Text className='agent-chat__history-item-time'>{sessionUpdatedLabel(session.updatedAt, locale)}</Text>
              </View>
              <View
                className='agent-chat__history-delete'
                hoverClass='tap-dim'
                onClick={event => {
                  event.stopPropagation()
                  onDelete(session)
                }}
              >
                <Text>{t('chat.historyDelete')}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <View className='agent-chat__history-new' hoverClass='tap-dim' onClick={onNew}>
        <Text>＋ {t('chat.historyNew')}</Text>
      </View>
    </View>
  )
}

interface TravelGuideCardProps {
  turnId: string
  guide: TravelGuide
  locale: 'zh' | 'en'
  expanded: boolean
  onToggle: () => void
  onCopySource: (source: TravelGuideSource) => void
}

function TravelGuideCard({
  turnId,
  guide,
  locale,
  expanded,
  onToggle,
  onCopySource
}: TravelGuideCardProps) {
  return (
    <View className='agent-chat__guide' key={`guide-${turnId}`}>
      <View className='agent-chat__guide-head' hoverClass='tap-dim' onClick={onToggle}>
        <View className='agent-chat__guide-heading'>
          <View className='agent-chat__guide-title-row'>
            <Text className='agent-chat__section-title'>{t('chat.guideTitle')}</Text>
            <Text className='agent-chat__guide-source-badge'>{guideSourceLabel(guide.source)}</Text>
          </View>
          <Text className='agent-chat__guide-days-count'>{t('chat.guideDaysCount', { n: guide.days.length })}</Text>
        </View>
        <Text className='agent-chat__guide-toggle'>{expanded ? '▲' : '▼'}</Text>
      </View>

      <View className='agent-chat__guide-summary'>
        <Text className='agent-chat__guide-summary-zh'>{guide.summary.zh}</Text>
        <Text className='agent-chat__guide-summary-en'>{guide.summary.en}</Text>
      </View>

      {expanded && (
        <View className='agent-chat__guide-days'>
          {guide.days.map(day => (
            <View key={`${turnId}-guide-day-${day.day}`} className='agent-chat__guide-day'>
              <View className='agent-chat__guide-day-head'>
                <Text className='agent-chat__guide-day-label'>{t('chat.guideDay', { n: day.day })}</Text>
                <Text className='agent-chat__guide-day-city'>
                  {locale === 'zh' ? day.city.zh : day.city.en} · {day.cityIata}
                </Text>
              </View>
              {day.items.map((item, index) => (
                <View key={`${turnId}-guide-day-${day.day}-item-${index}`} className='agent-chat__guide-item'>
                  <View className='agent-chat__guide-item-head'>
                    <Text className='agent-chat__guide-item-title'>
                      {locale === 'zh' ? item.title.zh : item.title.en}
                    </Text>
                    <Text className='agent-chat__guide-item-source'>{guideSourceLabel(item.source)}</Text>
                  </View>
                  <Text className='agent-chat__guide-item-description'>
                    {locale === 'zh' ? item.description.zh : item.description.en}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {guide.sources.length > 0 && (
        <View className='agent-chat__guide-sources'>
          <Text className='agent-chat__guide-sources-title'>{t('chat.guideSources')}</Text>
          {guide.sources.map((source, index) => (
            <View key={`${turnId}-guide-source-${index}`} className='agent-chat__guide-source'>
              <View className='agent-chat__guide-source-copy'>
                <Text className='agent-chat__guide-source-title'>{source.title}</Text>
                <Text className='agent-chat__guide-source-domain'>{source.domain}</Text>
              </View>
              {source.source === 'web' && isSafeGuideWebUrl(source.url) && (
                <View
                  className='agent-chat__guide-copy'
                  hoverClass='tap-dim'
                  onClick={event => {
                    event.stopPropagation()
                    onCopySource(source)
                  }}
                >
                  <Text>{t('chat.guideCopy')}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

interface TurnAttachmentsProps {
  turn: ConversationTurnSnapshot
  locale: 'zh' | 'en'
  interactive: boolean
  confirming: boolean
  routeExpanded: Record<string, boolean>
  guideExpanded: Record<string, boolean>
  onToggleRoute: (routeKey: string) => void
  onToggleGuide: (turnId: string) => void
  onCopyGuideSource: (source: TravelGuideSource) => void
  onRecommendation: (recommendation: DestinationRecommendation) => void
  onSuggestedAction: (action: SuggestedAction) => void
  onConfirm: (kind: RoutePick['kind']) => void
}

function TurnAttachments({
  turn,
  locale,
  interactive,
  confirming,
  routeExpanded,
  guideExpanded,
  onToggleRoute,
  onToggleGuide,
  onCopyGuideSource,
  onRecommendation,
  onSuggestedAction,
  onConfirm
}: TurnAttachmentsProps) {
  const canAct = interactive && !confirming
  const inlineActions = turn.suggestedActions.filter(action => action.kind !== 'route_generation')
  const hasAttachments = turn.recommendations.length > 0
    || inlineActions.length > 0
    || turn.routes.length > 0
    || turn.warnings.length > 0
    || Boolean(turn.travelGuide)

  if (!hasAttachments) return null

  return (
    <View className='agent-chat__turn-attachments'>
      {turn.recommendations.length > 0 && (
        <View className='agent-chat__recommendations'>
          <Text className='agent-chat__section-title'>{t('chat.recommendationsTitle')}</Text>
          <View className='agent-chat__recommendation-list'>
            {turn.recommendations.slice(0, 3).map(recommendation => (
              <View key={recommendation.iata} className='agent-chat__recommendation'>
                <View className='agent-chat__recommendation-head'>
                  <View className='agent-chat__recommendation-city'>
                    <Text className='agent-chat__recommendation-name'>
                      {locale === 'zh' ? recommendation.cityZh : recommendation.cityEn}
                    </Text>
                    <Text className='agent-chat__recommendation-iata font-code'>{recommendation.iata}</Text>
                  </View>
                  <Text className='agent-chat__recommendation-days'>
                    {recommendation.suggestedDays}{t('chat.days')}
                  </Text>
                </View>
                <Text className='agent-chat__recommendation-reason'>
                  {locale === 'zh' ? recommendation.reason.zh : recommendation.reason.en}
                </Text>
                <View
                  className={`agent-chat__recommendation-add ${canAct ? '' : 'is-disabled'}`}
                  hoverClass='tap-dim'
                  onClick={() => {
                    if (canAct) onRecommendation(recommendation)
                  }}
                >
                  <Text>{t('chat.addMustVisit')}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {inlineActions.length > 0 && (
        <View className='agent-chat__actions'>
          <Text className='agent-chat__section-title'>{t('chat.actionsTitle')}</Text>
          <View className='agent-chat__action-list'>
            {inlineActions.slice(0, 3).map(action => (
              <View
                key={action.id}
                className={`agent-chat__action ${canAct ? '' : 'is-disabled'}`}
                hoverClass='tap-dim'
                onClick={() => {
                  if (canAct) onSuggestedAction(action)
                }}
              >
                <Text>{locale === 'zh' ? action.label.zh : action.label.en}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {turn.warnings.map((warning, index) => (
        <View key={`${turn.id}-warning-${index}`} className='agent-chat__msg agent-chat__msg--assistant agent-chat__msg--warning'>
          <Text>{formatConversationWarning(warning, locale)}</Text>
        </View>
      ))}

      {turn.routes.length > 0 && (
        <View className='agent-chat__plans'>
          <View className='agent-chat__msg agent-chat__msg--assistant'>
            <Text>{t('chat.routeTitle', { n: turn.routes.length })}</Text>
          </View>
          {turn.routes.map(pick => {
            const route = pick.route
            const routeKey = `${turn.id}:${pick.kind}`
            const expanded = routeExpanded[routeKey] === true
            const hasEstimate = route.legs.some(leg => leg.real !== true)
            return (
              <View key={`${turn.id}-${pick.kind}`} className='agent-chat__plan agent-chat__plan--route'>
                <View
                  className='agent-chat__plan-head'
                  hoverClass='tap-dim'
                  onClick={() => onToggleRoute(routeKey)}
                >
                  <Text className={`agent-chat__plan-label agent-chat__plan-label--${pick.kind}`}>{t(ROUTE_LABEL_KEY[pick.kind] ?? 'chat.routeCheapest')}</Text>
                  <Text className='agent-chat__card-cities agent-chat__card-cities--big'>
                    {route.cities.map(city => cityByIata(city, locale)).join(' → ')}
                  </Text>
                </View>
                <View className='agent-chat__plan-body'>
                  <View className='agent-chat__plan-price'>
                    <Text className='agent-chat__plan-price-cap'>{t('chat.routeTotal')}</Text>
                    <Text className='font-code'>{formatPrice(route.totalPrice)}</Text>
                  </View>
                  <View className='agent-chat__plan-meta'>
                    {route.nightsSaved > 0 && <Text className='agent-chat__plan-nights'>🌙 {t('chat.routeNights', { n: route.nightsSaved })}</Text>}
                    <Text className='agent-chat__route-toggle'>{expanded ? '▲' : '▼'} {t('chat.routeLegs', { n: route.legs.length })}</Text>
                  </View>
                </View>
                <View className={`agent-chat__rlegs ${expanded ? 'is-open' : ''}`}>
                  {route.legs.map((leg, index) => (
                    <View key={index} className='agent-chat__rleg'>
                      <Text className='agent-chat__rleg-no'>{index + 1}</Text>
                      <View className='agent-chat__rleg-main'>
                        <Text className='agent-chat__rleg-od'>
                          {cityByIata(leg.from, locale)} → {cityByIata(leg.to, locale)}
                        </Text>
                        <Text className='agent-chat__rleg-sub font-code'>
                          {formatMonthDay(leg.date)} · {leg.departTime}→{leg.arriveTime}{leg.crossDay ? '+1' : ''}
                        </Text>
                      </View>
                      <View className='agent-chat__rleg-side'>
                        <Text className={`agent-chat__rleg-tag ${leg.real ? 'agent-chat__rleg-tag--real' : 'agent-chat__rleg-tag--est'}`}>
                          {t(leg.real ? 'chat.routeReal' : 'chat.routeEst')}
                        </Text>
                        <Text className='font-code agent-chat__rleg-price'>{formatPrice(leg.price)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
                {'note' in pick && <Text className='agent-chat__plan-note'>{(pick as { note: string }).note}</Text>}
                {hasEstimate && (
                  <View
                    className={`agent-chat__plan-pick ${canAct ? '' : 'is-disabled'}`}
                    hoverClass='tap-dim'
                    onClick={() => {
                      if (canAct) onConfirm(pick.kind)
                    }}
                  >
                    <Text>{confirming && interactive ? t('chat.routeConfirming') : t('chat.routeConfirm')}</Text>
                  </View>
                )}
              </View>
            )
          })}
        </View>
      )}

      {turn.travelGuide && (
        <TravelGuideCard
          turnId={turn.id}
          guide={turn.travelGuide}
          locale={locale}
          expanded={guideExpanded[turn.id] === true}
          onToggle={() => onToggleGuide(turn.id)}
          onCopySource={onCopyGuideSource}
        />
      )}
    </View>
  )
}

interface ConversationTurnViewProps extends TurnAttachmentsProps {
  ownerId?: string
  sessionId: string
  onArtifactAction: (artifact: ArtifactEnvelope) => void
}

function ConversationTurnView({ turn, ownerId, sessionId, onArtifactAction, ...attachmentProps }: ConversationTurnViewProps) {
  const deliveryLabel = conversationDeliveryLabel(turn.delivery, attachmentProps.locale)
  return (
    <View className='agent-chat__turn'>
      <View className='agent-chat__msg agent-chat__msg--user'>
        <Text>{turn.user.content}</Text>
      </View>
      {turn.assistant ? (
        <View className='agent-chat__msg agent-chat__msg--assistant'>
          <Text>{turn.assistant.content}</Text>
        </View>
      ) : null}
      {deliveryLabel && <View className='agent-chat__card'><Text>{deliveryLabel}</Text></View>}
      <TurnAttachments turn={turn} {...attachmentProps} />
      {turn.artifactRefs?.map(ref => (
        <ArtifactTimelineItem
          key={ref.id}
          artifactRef={ref}
          ownerId={ownerId}
          sessionId={sessionId}
          onAction={onArtifactAction}
        />
      ))}
      {turn.error && (
        <View className='agent-chat__card agent-chat__card--error'>
          <Text>{turn.error}</Text>
        </View>
      )}
    </View>
  )
}

/** 需求对话视图 */
const AgentChat = observer(({ onOpenExperience }: { onOpenExperience: () => void }) => {
  const [input, setInput] = useState('')
  const [routeExpanded, setRouteExpanded] = useState<Record<string, boolean>>({})
  const [guideExpanded, setGuideExpanded] = useState<Record<string, boolean>>({})
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const draftRevision = useRef(0)
  const submitting = useRef(false)
  const locale = localeStore.locale
  const ownerId = userStore.profile?.uid
  const busy = chatStore.isThinking || chatStore.multiLoading || chatStore.multiConfirming
  const routeAction = chatStore.suggestedActions.find(action => action.kind === 'route_generation')
  const timelineArtifactIds = new Set(chatStore.timeline.flatMap(turn => turn.artifactRefs?.map(ref => ref.id) ?? []))
  const workspaceArtifactRefs = chatStore.artifactRefs.filter(ref => !timelineArtifactIds.has(ref.id))

  useEffect(() => {
    if (chatStore.timeline.length === 0 && !chatStore.tripContextSummary) {
      setRouteExpanded({})
      setGuideExpanded({})
    }
  }, [chatStore.timeline.length, chatStore.tripContextSummary])

  useEffect(() => {
    setRouteExpanded({})
    setGuideExpanded({})
  }, [chatStore.currentSessionId])

  useEffect(() => registerChatSessionChangeHandler((_sessionId, nextOwner) => {
    // A login expiry must not discard the message being submitted. Explicit
    // workspace switches invalidate its draft so late completion cannot clear another one.
    if (!nextOwner && submitting.current) return
    draftRevision.current += 1
    setInput('')
  }), [])

  useEffect(() => {
    artifactService.setSession(ownerId, chatStore.currentSessionId)
  }, [ownerId, chatStore.currentSessionId])

  const submitMessage = async (message: string) => {
    if (!message.trim() || busy) return
    if (chatStore.requiresLogin) { setLoginOpen(true); return }
    const revision = draftRevision.current
    submitting.current = true
    try {
      const accepted = await chatStore.send(message, locale)
      if (accepted && draftRevision.current === revision) setInput(current => current === message ? '' : current)
    } finally { submitting.current = false }
  }

  const handleSend = () => submitMessage(input)

  const handleSuggestedAction = (message: string) => {
    if (busy) return
    draftRevision.current += 1
    setInput(message)
    void submitMessage(message)
  }

  const handleRecommendation = (recommendation: DestinationRecommendation) => {
    if (busy) return
    const message = locale === 'zh'
      ? `把${recommendation.cityZh}加入必去城市`
      : `Add ${recommendation.cityEn} to my must-visit cities`
    handleSuggestedAction(message)
  }

  const handleCopyGuideSource = (source: TravelGuideSource) => {
    if (source.source !== 'web' || !isSafeGuideWebUrl(source.url)) return
    void Taro.setClipboardData({ data: source.url })
      .then(() => {
        void Taro.showToast({ title: t('chat.guideCopied'), icon: 'none' })
      })
      .catch(() => {
        void Taro.showToast({ title: t('chat.guideCopyFailed'), icon: 'none' })
      })
  }

  const handleReset = () => {
    chatStore.reset()
    setInput('')
    setRouteExpanded({})
    setGuideExpanded({})
    setHistoryOpen(false)
  }

  const handleSelectSession = (sessionId: string) => {
    chatStore.switchSession(sessionId)
    void chatStore.refreshWorkspace(locale)
    setInput('')
    setRouteExpanded({})
    setGuideExpanded({})
    setHistoryOpen(false)
  }

  const handleDeleteSession = async (session: ChatSessionRecord) => {
    const result = await Taro.showModal({
      title: t('chat.historyDeleteTitle'),
      content: t('chat.historyDeleteConfirm'),
      confirmText: t('chat.historyDelete'),
      cancelText: t('chat.historyClose')
    })
    if (!result.confirm) return
    chatStore.deleteSession(session.id)
    setInput('')
    setRouteExpanded({})
    setGuideExpanded({})
  }

  const handleRemoveContextChip = (chip: TripContextChipViewModel) => {
    if (busy) return
    const message = locale === 'zh'
      ? `从本次行程上下文中移除「${chip.label}」`
      : `Remove "${chip.label}" from this trip context`
    handleSuggestedAction(message)
  }

  const handleArtifactAction = (artifact: ArtifactEnvelope) => {
    const encodedId = encodeURIComponent(artifact.id)
    if (artifact.type === 'flight_search') {
      void Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodedId}` })
      return
    }
    if (['route_set', 'route', 'research', 'travel_guide', 'activity', 'destination_set'].includes(artifact.type)) {
      void Taro.navigateTo({ url: `/pages/route/index?artifactId=${encodedId}` })
    }
  }

  return (
    <View className='agent-chat'>
      <View className='agent-chat__topbar'>
        <View className='agent-chat__topbar-title'>
          <Text className='agent-chat__topbar-kicker'>FLIGHTOR</Text>
          <Text className='agent-chat__topbar-label'>
            {chatStore.currentSession?.title || (locale === 'zh' ? '新的旅行计划' : 'New trip plan')}
          </Text>
        </View>
        <View className='agent-chat__history-trigger' hoverClass='tap-dim' onClick={onOpenExperience}><Text>新版规划</Text></View>
        <View
          className={`agent-chat__history-trigger ${historyOpen ? 'is-open' : ''}`}
          hoverClass='tap-dim'
          onClick={() => setHistoryOpen(value => !value)}
        >
          <Text>◷ {t('chat.history')}</Text>
          {chatStore.sessions.length > 0 && <Text className='agent-chat__history-count'>{chatStore.sessions.length}</Text>}
        </View>
      </View>
      {historyOpen && (
        <SessionHistoryPanel
          sessions={chatStore.sessions}
          currentSessionId={chatStore.currentSessionId}
          locale={locale}
          onNew={handleReset}
          onSelect={handleSelectSession}
          onDelete={session => void handleDeleteSession(session)}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {chatStore.requiresLogin && (
        <View className='agent-chat__card'>
          <Text>{locale === 'zh' ? '登录后开始规划，输入内容会保留。' : 'Sign in to start planning. Your message will be kept.'}</Text>
          <View className='agent-chat__action' hoverClass='tap-dim' onClick={() => setLoginOpen(true)}><Text>{locale === 'zh' ? '登录并继续' : 'Sign in and continue'}</Text></View>
        </View>
      )}
      {chatStore.multiError && !chatStore.timeline.some(turn => turn.error === chatStore.multiError) && (
        <View className='agent-chat__card agent-chat__card--error'><Text>{chatStore.multiError}</Text></View>
      )}
      {chatStore.routeGenerationError && (
        <View className='agent-chat__card agent-chat__card--error'>
          <Text>{chatStore.routeGenerationError}</Text>
          <View className='agent-chat__action' hoverClass='tap-dim' onClick={() => void chatStore.refreshWorkspace(locale)}><Text>{locale === 'zh' ? '刷新结果' : 'Refresh results'}</Text></View>
        </View>
      )}
      {chatStore.routeGeneration && (
        <View className='agent-chat__card agent-chat__route-generation'>
          <Text>
            {locale === 'zh' ? '路线生成' : 'Route generation'} · {({ queued: locale === 'zh' ? '等待处理' : 'Queued', running: locale === 'zh' ? '处理中' : 'In progress', succeeded: locale === 'zh' ? '已完成' : 'Complete', failed: locale === 'zh' ? '未完成' : 'Failed', cancelled: locale === 'zh' ? '已取消' : 'Cancelled' })[chatStore.routeGeneration.status]} · {chatStore.routeGeneration.progress.percent}%
            {chatStore.routeGeneration.stale ? ` · ${locale === 'zh' ? '结果已过期' : 'stale result'}` : ''}
          </Text>
          {!isRouteGenerationTerminal(chatStore.routeGeneration.status) && !chatStore.routeGenerationLoading && (
            <View
              className='agent-chat__action'
              hoverClass='tap-dim'
              onClick={() => void chatStore.resumeRouteGeneration(locale)}
            >
              <Text>{locale === 'zh' ? '继续生成' : 'Resume generation'}</Text>
            </View>
          )}
          {!isRouteGenerationTerminal(chatStore.routeGeneration.status) && (
            <View className='agent-chat__action' hoverClass='tap-dim' onClick={() => void chatStore.cancelRouteGeneration(locale)}>
              <Text>{locale === 'zh' ? '取消生成' : 'Cancel generation'}</Text>
            </View>
          )}
          {chatStore.routeGeneration.resultArtifactId && (
            <Text>{locale === 'zh' ? '路线已保存，可在下方查看。' : 'The route is saved and available below.'}</Text>
          )}
          {chatStore.routeGeneration.error && <Text>{chatStore.routeGeneration.error.message}</Text>}
          {chatStore.routeGeneration.warnings.map((warning, index) => <Text key={`route-generation-warning-${index}`}>{warning}</Text>)}
        </View>
      )}
      {chatStore.tripContextSummary && (
        <TripContextChips
          summary={chatStore.tripContextSummary}
          locale={locale}
          onRemove={handleRemoveContextChip}
          onEdit={() => setInput(locale === 'zh' ? '我想修改本次行程：' : 'I want to update this trip: ')}
        />
      )}
      <ScrollView className='agent-chat__body' scrollY scrollIntoView='chat-bottom'>
        {/* 开场引导 */}
        <View className='agent-chat__msg agent-chat__msg--assistant'>
          <Text>{t('chat.hello')}</Text>
        </View>
        {chatStore.messages.slice(0, chatStore.messages.findIndex(m => m.role === 'user') < 0 ? chatStore.messages.length : chatStore.messages.findIndex(m => m.role === 'user')).filter(m => m.role === 'assistant').map((message, i) => (
          <View key={`introduction-${i}`} className='agent-chat__msg agent-chat__msg--assistant'><Text>{message.content}</Text></View>
        ))}
        {chatStore.timeline.length === 0 && !chatStore.tripContextSummary && (
          <View className='agent-chat__suggests'>
            {[t('chat.eg1'), t('chat.eg2'), t('chat.eg3')].map(eg => (
              <View
                key={eg}
                className={`agent-chat__suggest ${busy ? 'is-disabled' : ''}`}
                hoverClass='tap-dim'
                onClick={() => handleSuggestedAction(eg)}
              >
                <Text>{eg}</Text>
              </View>
            ))}
          </View>
        )}

        {chatStore.timeline.map(turn => (
          <ConversationTurnView
            key={turn.id}
            turn={turn}
            locale={locale}
            ownerId={ownerId}
            sessionId={chatStore.currentSessionId}
            onArtifactAction={handleArtifactAction}
            interactive={isConversationTurnInteractive(chatStore.timeline, turn.id, busy)}
            confirming={chatStore.multiConfirming}
            routeExpanded={routeExpanded}
            guideExpanded={guideExpanded}
            onToggleRoute={routeKey => setRouteExpanded(current => ({ ...current, [routeKey]: !current[routeKey] }))}
            onToggleGuide={turnId => setGuideExpanded(current => ({ ...current, [turnId]: !current[turnId] }))}
            onCopyGuideSource={handleCopyGuideSource}
            onRecommendation={handleRecommendation}
            onSuggestedAction={action => {
              if (!busy) void chatStore.activateSuggestedAction(action, locale)
            }}
            onConfirm={kind => {
              if (!busy) void chatStore.confirmMulti(kind, locale)
            }}
          />
        ))}

        {(chatStore.isThinking || chatStore.multiLoading) && (
          <View className='agent-chat__msg agent-chat__msg--assistant agent-chat__msg--thinking'>
            <PlannerProgress progress={chatStore.turnProgress} locale={locale} />
          </View>
        )}

        {workspaceArtifactRefs.length > 0 && (
          <View className='agent-chat__workspace-artifacts'>
            <Text className='agent-chat__section-title'>{locale === 'zh' ? '工作区结果' : 'Workspace results'}</Text>
            {workspaceArtifactRefs.map(ref => (
              <ArtifactTimelineItem
                key={ref.id}
                artifactRef={ref}
                ownerId={ownerId}
                sessionId={chatStore.currentSessionId}
                onAction={handleArtifactAction}
              />
            ))}
          </View>
        )}

        <View className='agent-chat__workspace-actions'>
          <View
            className={`agent-chat__quick-action ${busy ? 'is-disabled' : ''}`}
            hoverClass='tap-dim'
            onClick={() => {
              if (!busy) void Taro.navigateTo({ url: '/pages/index/index' })
            }}
          >
            <View className='agent-chat__quick-action-mark'><Text>FLIGHT</Text></View>
            <View className='agent-chat__quick-action-copy'>
              <Text className='agent-chat__quick-action-title'>{locale === 'zh' ? '查航班' : 'Search flights'}</Text>
              <Text className='agent-chat__quick-action-subtitle'>{locale === 'zh' ? '按日期与目的地查询，结果保存在当前行程' : 'Search by date and destination, and keep results with this trip'}</Text>
            </View>
            <Text className='agent-chat__quick-action-chevron'>›</Text>
          </View>

          {routeAction ? (
            <View
              className={`agent-chat__generate ${busy ? 'is-disabled' : ''}`}
              hoverClass='tap-dim'
              onClick={() => {
                if (!busy) void chatStore.activateSuggestedAction(routeAction, locale)
              }}
            >
              <Text>{locale === 'zh' ? '生成路线' : 'Generate route'}</Text>
            </View>
          ) : chatStore.tripContextSummary && !chatStore.tripContextSummary.readyForRouteGeneration ? (
            <View className='agent-chat__generate agent-chat__generate--disabled'>
              <Text>{locale === 'zh' ? '补充出发地、日期与明确目的地后可生成路线' : 'Add origin, dates, and a final destination to generate a route'}</Text>
            </View>
          ) : null}
        </View>

        <View id='chat-bottom' />
      </ScrollView>

      {/* 输入栏 */}
      <View className='agent-chat__footer'>
        {chatStore.timeline.length > 0 && (
          <View className='agent-chat__reset' hoverClass='tap-dim' onClick={handleReset}>
            <Text>↺ {t('chat.newTrip')}</Text>
          </View>
        )}
        <Input
          className='agent-chat__input'
          value={input}
          disabled={busy}
          placeholder={t('chat.placeholder')}
          placeholderClass='agent-chat__placeholder'
          confirmType='send'
          onInput={e => { draftRevision.current += 1; setInput(e.detail.value) }}
          onConfirm={() => void handleSend()}
        />
        <View
          className={`agent-chat__send ${input.trim() && !busy ? '' : 'is-disabled'}`}
          hoverClass='tap-dim'
          onClick={() => void handleSend()}
        >
          <Text>{t('chat.send')}</Text>
        </View>
      </View>
      <LoginSheet visible={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={() => void handleSend()} />
    </View>
  )
})

function PlanPage() {
  const locale = localeStore.locale
  const [experienceOpen, setExperienceOpen] = useState(true)
  const [productionResult, setProductionResult] = useState<{ key: string; trip: TripPresentation }>()
  const [productionError, setProductionError] = useState('')
  const [productionLoginOpen, setProductionLoginOpen] = useState(false)
  const pendingPrompt = useRef('')
  const ownerId = userStore.profile?.uid
  const lastTurn = chatStore.timeline[chatStore.timeline.length - 1]
  const refs = lastTurn?.artifactRefs ?? []
  const productionRef = [...refs].reverse().find(ref => ref.type === 'travel_guide') ?? [...refs].reverse().find(ref => ref.type === 'route')
  const resultKey = `${ownerId}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${productionRef?.id}`
  const busy = chatStore.isThinking || chatStore.multiLoading || chatStore.multiConfirming
  useEffect(() => {
    let active = true
    if (!experienceOpen || !ownerId || !productionRef) return () => { active = false }
    loadProductionTrip(productionRef.id, { ownerId, sessionId: chatStore.currentSessionId }).then(value => { if (active) setProductionResult({ key: resultKey, trip: value.presentation }) }).catch(error => { if (active) setProductionError(error instanceof Error ? error.message : '行程结果暂不可用') })
    return () => { active = false }
  }, [experienceOpen, resultKey])
  useDidShow(() => { if (!chatStore.isThinking) void chatStore.refreshWorkspace(locale) })
  useEffect(() => { void Taro.setNavigationBarTitle({ title: t('nav.tripPlan') }) }, [locale])
  useEffect(() => { setProductionError('') }, [ownerId, userStore.sessionRevision, chatStore.currentSessionId])
  async function submit(message: string) {
    if (busy) return
    if (chatStore.requiresLogin) { pendingPrompt.current = message; setProductionLoginOpen(true); setProductionError('请先完成登录，再继续规划。'); return }
    const revision = userStore.sessionRevision
    setProductionError('')
    const accepted = await chatStore.send(message, locale)
    if (revision !== userStore.sessionRevision) return
    if (!accepted) setProductionError(chatStore.multiError || '规划请求未完成，请查看规划记录')
  }
  const fallbackTrip: TripPresentation = {
    id: chatStore.tripId || 'production-planning', title: '新的旅行计划', destination: chatStore.tripContextSummary?.destinations.required[0]?.name || '目的地待确认', route: [], dates: { start: null, end: null, label: '日期待确认' }, durationDays: chatStore.tripContextSummary?.travelDays || null, travelers: null, cover: null, description: '继续补充想法，生成后的行程会自动保存。', days: [], status: 'pending', flights: [], alternatives: [], sources: []
  }
  const result = productionResult?.key === resultKey ? productionResult.trip : undefined
  if (experienceOpen) return <View className='trip-plan trip-plan--chat ux-app'><PlannerPage key={ownerId ?? 'guest'} trip={result ?? fallbackTrip} onExit={() => setExperienceOpen(false)} onOpenTrip={() => productionRef && void Taro.navigateTo({ url: `/pages/route/index?artifactId=${encodeURIComponent(productionRef.id)}` })} onSearchFlights={() => void Taro.navigateTo({ url: '/pages/index/index' })} onSubmitPrompt={message => void submit(message)} productionBusy={busy} productionError={productionError || chatStore.multiError} productionReply={lastTurn?.assistant?.content} productionPrompt={lastTurn?.user.content} productionResultAvailable={Boolean(result)} productionStopReason={lastTurn?.stopReason} productionDelivery={lastTurn?.delivery} productionWarnings={lastTurn?.warnings} /><LoginSheet visible={productionLoginOpen} onClose={() => setProductionLoginOpen(false)} onSuccess={() => { const prompt = pendingPrompt.current; pendingPrompt.current = ''; setProductionLoginOpen(false); if (prompt) void submit(prompt) }} /></View>
  return <View className='trip-plan trip-plan--chat'><DemoBadge /><AgentChat onOpenExperience={() => setExperienceOpen(true)} /></View>
}

export default observer(PlanPage)
