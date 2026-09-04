// pages/plan — AI 行程规划（tabBar 主页面）
// 双形态：未选航班 → 需求对话（talk with agent 拆解需求 → 核心检索系统）；
//        已选航班 → 生成行程时间轴（自建后端）
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Input, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import DemoBadge from '../../components/common/DemoBadge'
import { flightStore } from '../../stores/flightStore'
import {
  chatStore,
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
  TravelGuideSourceKind,
  TripState
} from '../../services/conversationService'
import { planTrip, TripPlan, TripItemType, BiText } from '../../services/tripService'
import { cityByIata, type RoutePick } from '../../services/routeService'
import { cityOf } from '../../mocks/airports'
import { t, localeStore } from '../../i18n'
import { formatPrice, formatMonthDay, humanDate } from '../../utils/format'
import './index.scss'

const TYPE_ICON: Record<TripItemType, string> = {
  flight: '✈️',
  transit: '🚉',
  activity: '📍',
  meal: '🍜',
  rest: '🏨',
  tip: '💡'
}

const ROUTE_LABEL_KEY: Record<string, string> = {
  cheapest: 'chat.routeCheapest',
  mostCities: 'chat.routeMostCities',
  mostNights: 'chat.routeMostNights'
}

const REGION_LABEL_KEY: Record<string, string> = {
  japan: 'chat.regionJapan',
  schengen: 'chat.regionEurope',
  visa_free: 'chat.regionVisaFree'
}

const INTEREST_LABEL_KEY: Record<string, string> = {
  culture: 'interest.culture',
  food: 'interest.food',
  nature: 'interest.nature',
  shopping: 'interest.shopping',
  nightlife: 'interest.nightlife'
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

function understandingDate(from: string | null, to: string | null, locale: 'zh' | 'en'): string {
  if (!from && !to) return t('chat.understandingUnset')
  if (from && to && from !== to) return `${humanDate(from, locale)} – ${humanDate(to, locale)}`
  return humanDate(from ?? to ?? '', locale)
}

function understandingIatas(iatas: string[], locale: 'zh' | 'en'): string {
  return iatas
    .map(iata => `${cityOf(iata, locale)} (${iata})`)
    .join(locale === 'zh' ? '、' : ', ')
}

function understandingSummary(state: TripState, locale: 'zh' | 'en'): string {
  const parts: string[] = []
  if (state.origin) parts.push(`${cityOf(state.origin, locale)} (${state.origin})`)
  if (state.window_from || state.window_to) parts.push(understandingDate(state.window_from, state.window_to, locale))
  if (state.travel_days != null) parts.push(`${state.travel_days}${t('chat.days')}`)
  if (state.budget_max != null) parts.push(`≤${formatPrice(state.budget_max)}`)
  if (state.regions.length > 0) {
    parts.push(state.regions.map(region => t(REGION_LABEL_KEY[region] ?? 'chat.understandingUnset')).join(locale === 'zh' ? '、' : ', '))
  }
  if (state.destination_mode === 'recommend') parts.push(t('chat.modeRecommend'))
  return parts.join(' · ') || t('chat.understandingUnset')
}

interface UnderstandingPanelProps {
  state: TripState
  locale: 'zh' | 'en'
  expanded: boolean
  onToggle: () => void
  onReset: () => void
}

function UnderstandingPanel({ state, locale, expanded, onToggle, onReset }: UnderstandingPanelProps) {
  return (
    <View className={`agent-chat__understanding ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <View className='agent-chat__understanding-head' hoverClass='tap-dim' onClick={onToggle}>
        <View className='agent-chat__understanding-heading'>
          <Text className='agent-chat__section-title'>{t('chat.understandingTitle')}</Text>
          {!expanded && <Text className='agent-chat__understanding-summary'>{understandingSummary(state, locale)}</Text>}
        </View>
        <Text className='agent-chat__understanding-arrow'>{expanded ? '⌃' : '⌄'}</Text>
      </View>
      {expanded && (
        <View className='agent-chat__understanding-content'>
          <View className='agent-chat__understanding-grid'>
            <View className='agent-chat__understanding-item'>
              <Text className='agent-chat__understanding-label'>{t('chat.understandingOrigin')}</Text>
              <Text className='agent-chat__understanding-value'>
                {state.origin ? `${cityOf(state.origin, locale)} (${state.origin})` : t('chat.understandingUnset')}
              </Text>
            </View>
            <View className='agent-chat__understanding-item'>
              <Text className='agent-chat__understanding-label'>{t('chat.understandingDate')}</Text>
              <Text className='agent-chat__understanding-value'>{understandingDate(state.window_from, state.window_to, locale)}</Text>
            </View>
            <View className='agent-chat__understanding-item'>
              <Text className='agent-chat__understanding-label'>{t('chat.understandingDays')}</Text>
              <Text className='agent-chat__understanding-value'>
                {state.travel_days != null ? `${state.travel_days}${t('chat.days')}` : t('chat.understandingUnset')}
              </Text>
            </View>
            <View className='agent-chat__understanding-item'>
              <Text className='agent-chat__understanding-label'>{t('chat.understandingBudget')}</Text>
              <Text className='agent-chat__understanding-value'>
                {state.budget_max != null ? `≤${formatPrice(state.budget_max)}` : t('chat.understandingUnset')}
              </Text>
            </View>
            <View className='agent-chat__understanding-item agent-chat__understanding-item--wide'>
              <Text className='agent-chat__understanding-label'>{t('chat.understandingRegions')}</Text>
              <Text className='agent-chat__understanding-value'>
                {state.regions.length > 0
                  ? state.regions.map(region => t(REGION_LABEL_KEY[region] ?? 'chat.understandingUnset')).join(locale === 'zh' ? '、' : ', ')
                  : t('chat.understandingUnset')}
              </Text>
            </View>
            <View className='agent-chat__understanding-item agent-chat__understanding-item--wide'>
              <Text className='agent-chat__understanding-label'>{t('chat.understandingInterests')}</Text>
              <Text className='agent-chat__understanding-value'>
                {state.interests.length > 0
                  ? state.interests.map(interest => t(INTEREST_LABEL_KEY[interest] ?? 'chat.understandingUnset')).join(locale === 'zh' ? '、' : ', ')
                  : t('chat.understandingUnset')}
              </Text>
            </View>
            {state.required_iatas.length > 0 && (
              <View className='agent-chat__understanding-item agent-chat__understanding-item--wide'>
                <Text className='agent-chat__understanding-label'>{t('chat.understandingMustVisit')}</Text>
                <Text className='agent-chat__understanding-value'>{understandingIatas(state.required_iatas, locale)}</Text>
              </View>
            )}
            {state.excluded_iatas.length > 0 && (
              <View className='agent-chat__understanding-item agent-chat__understanding-item--wide'>
                <Text className='agent-chat__understanding-label'>{t('chat.understandingExcluded')}</Text>
                <Text className='agent-chat__understanding-value'>{understandingIatas(state.excluded_iatas, locale)}</Text>
              </View>
            )}
            {state.destination_mode === 'recommend' && (
              <Text className='agent-chat__understanding-mode'>{t('chat.modeRecommend')}</Text>
            )}
          </View>
          <View className='agent-chat__new-trip' hoverClass='tap-dim' onClick={onReset}>
            <Text>↺ {t('chat.newTrip')}</Text>
          </View>
        </View>
      )}
    </View>
  )
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
  const hasAttachments = turn.recommendations.length > 0
    || turn.suggestedActions.length > 0
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

      {turn.suggestedActions.length > 0 && (
        <View className='agent-chat__actions'>
          <Text className='agent-chat__section-title'>{t('chat.actionsTitle')}</Text>
          <View className='agent-chat__action-list'>
            {turn.suggestedActions.slice(0, 3).map(action => (
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
  pending: boolean
}

function ConversationTurnView({ turn, pending, ...attachmentProps }: ConversationTurnViewProps) {
  return (
    <View className='agent-chat__turn'>
      <View className='agent-chat__msg agent-chat__msg--user'>
        <Text>{turn.user.content}</Text>
      </View>
      {turn.assistant ? (
        <View className='agent-chat__msg agent-chat__msg--assistant'>
          <Text>{turn.assistant.content}</Text>
        </View>
      ) : pending ? (
        <View className='agent-chat__msg agent-chat__msg--assistant agent-chat__msg--thinking'>
          <Text>{t('chat.thinking')}</Text>
        </View>
      ) : null}
      <TurnAttachments turn={turn} {...attachmentProps} />
      {turn.error && (
        <View className='agent-chat__card agent-chat__card--error'>
          <Text>{turn.error}</Text>
        </View>
      )}
    </View>
  )
}

/** 需求对话视图 */
const AgentChat = observer(() => {
  const [input, setInput] = useState('')
  const [routeExpanded, setRouteExpanded] = useState<Record<string, boolean>>({})
  const [guideExpanded, setGuideExpanded] = useState<Record<string, boolean>>({})
  const [understandingExpanded, setUnderstandingExpanded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const locale = localeStore.locale
  const state = chatStore.state
  const busy = chatStore.isThinking || chatStore.multiLoading || chatStore.multiConfirming
  const hasUnderstanding = Boolean(
    state.origin
    || state.window_from
    || state.window_to
    || state.travel_days != null
    || state.budget_max != null
    || state.regions.length > 0
    || state.interests.length > 0
    || state.required_iatas.length > 0
    || state.excluded_iatas.length > 0
    || state.destination_mode === 'recommend'
  )

  useEffect(() => {
    if (chatStore.timeline.length === 0 && !hasUnderstanding) {
      setUnderstandingExpanded(false)
      setRouteExpanded({})
      setGuideExpanded({})
      setInput('')
    }
  }, [chatStore.timeline.length, hasUnderstanding])

  useEffect(() => {
    setUnderstandingExpanded(false)
    setRouteExpanded({})
    setGuideExpanded({})
    setInput('')
  }, [chatStore.currentSessionId])

  const handleSend = () => {
    if (!input.trim() || busy) return
    void chatStore.send(input, locale)
    setInput('')
  }

  const handleSuggestedAction = (message: string) => {
    if (busy) return
    void chatStore.send(message, locale)
  }

  const handleRecommendation = (recommendation: DestinationRecommendation) => {
    if (busy) return
    const message = locale === 'zh'
      ? `把${recommendation.cityZh}加入必去城市`
      : `Add ${recommendation.cityEn} to my must-visit cities`
    void chatStore.send(message, locale)
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
    setUnderstandingExpanded(false)
    setHistoryOpen(false)
  }

  const handleSelectSession = (sessionId: string) => {
    chatStore.switchSession(sessionId)
    setInput('')
    setRouteExpanded({})
    setGuideExpanded({})
    setUnderstandingExpanded(false)
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
    setUnderstandingExpanded(false)
  }

  return (
    <View className='agent-chat'>
      <View className='agent-chat__topbar'>
        <View className='agent-chat__topbar-title'>
          <Text className='agent-chat__topbar-kicker'>FLIGHTOR / AGENT</Text>
          <Text className='agent-chat__topbar-label'>{t('nav.tripPlan')}</Text>
        </View>
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
      {hasUnderstanding && (
        <UnderstandingPanel
          state={state}
          locale={locale}
          expanded={understandingExpanded}
          onToggle={() => setUnderstandingExpanded(value => !value)}
          onReset={handleReset}
        />
      )}
      <ScrollView className='agent-chat__body' scrollY scrollIntoView='chat-bottom'>
        {/* 开场引导 */}
        <View className='agent-chat__msg agent-chat__msg--assistant'>
          <Text>{t('chat.hello')}</Text>
        </View>
        {chatStore.timeline.length === 0 && (
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

        {chatStore.timeline.map((turn, index, turns) => (
          <ConversationTurnView
            key={turn.id}
            turn={turn}
            locale={locale}
            pending={index === turns.length - 1 && (chatStore.isThinking || chatStore.multiLoading)}
            interactive={isConversationTurnInteractive(turns, turn.id, busy)}
            confirming={chatStore.multiConfirming}
            routeExpanded={routeExpanded}
            guideExpanded={guideExpanded}
            onToggleRoute={routeKey => setRouteExpanded(current => ({ ...current, [routeKey]: !current[routeKey] }))}
            onToggleGuide={turnId => setGuideExpanded(current => ({ ...current, [turnId]: !current[turnId] }))}
            onCopyGuideSource={handleCopyGuideSource}
            onRecommendation={handleRecommendation}
            onSuggestedAction={action => {
              if (!busy) void chatStore.send(action.message, locale)
            }}
            onConfirm={kind => {
              if (!busy) void chatStore.confirmMulti(kind, locale)
            }}
          />
        ))}

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
          onInput={e => setInput(e.detail.value)}
          onConfirm={handleSend}
        />
        <View
          className={`agent-chat__send ${input.trim() && !busy ? '' : 'is-disabled'}`}
          hoverClass='tap-dim'
          onClick={handleSend}
        >
          <Text>{t('chat.send')}</Text>
        </View>
      </View>
    </View>
  )
})

function PlanPage() {
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [error, setError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const requestId = useRef(0)
  const locale = localeStore.locale
  const pick = (v: BiText) => (locale === 'zh' ? v.zh : v.en)

  const flight = flightStore.selected
  const params = flightStore.lastParams

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.tripPlan') })
  }, [locale])

  const load = useCallback(() => {
    if (!flight || !params) return
    const currentRequestId = ++requestId.current
    setError(false)
    setPlan(null)
    setIsLoading(true)
    planTrip(flight, params)
      .then(nextPlan => {
        // Ignore a slower response from a previous selection or retry.
        if (currentRequestId === requestId.current) setPlan(nextPlan)
      })
      .catch(() => {
        if (currentRequestId === requestId.current) setError(true)
      })
      .finally(() => {
        if (currentRequestId === requestId.current) setIsLoading(false)
      })
  }, [flight, params])

  useEffect(() => {
    load()
    return () => {
      // Invalidate in-flight work when the selected flight changes or the page unmounts.
      requestId.current += 1
    }
  }, [load])

  // 未选航班：需求对话
  if (!flight || !params) {
    return (
      <View className='trip-plan trip-plan--chat'>
        <DemoBadge />
        <AgentChat />
      </View>
    )
  }

  if (error) {
    return (
      <View className='trip-plan trip-plan--center'>
        <Text className='trip-plan__error-icon'>🛰</Text>
        <Text className='trip-plan__error-text'>{t('tp.error')}</Text>
        <View className='trip-plan__retry' hoverClass='tap-dim' onClick={load}>
          <Text>{t('tp.retry')}</Text>
        </View>
      </View>
    )
  }

  if (isLoading || !plan) {
    return (
      <View className='trip-plan trip-plan--center'>
        <Text className='trip-plan__loading-icon'>✨</Text>
        <Text className='trip-plan__loading-text'>{t('tp.loading')}</Text>
      </View>
    )
  }

  return (
    <View className='trip-plan'>
      <DemoBadge />
      {/* 概述 */}
      <View className='trip-plan__summary'>
        <Text className='trip-plan__summary-text'>{pick(plan.summary)}</Text>
      </View>

      {/* 逐日时间轴 */}
      {plan.days.map(day => (
        <View key={day.day} className='trip-plan__day'>
          <View className='trip-plan__day-header'>
            <Text className='trip-plan__day-badge'>{t('tp.day', { n: day.day })}</Text>
            <Text className='trip-plan__day-title'>{pick(day.title)}</Text>
            <Text className='trip-plan__day-date'>{day.date}</Text>
          </View>
          {day.items.map((item, idx) => (
            <View key={`${day.day}-${idx}`} className='trip-plan__item'>
              <Text className='font-code trip-plan__item-time'>{item.time}</Text>
              <Text className='trip-plan__item-icon'>{TYPE_ICON[item.type]}</Text>
              <View className='trip-plan__item-main'>
                <Text className='trip-plan__item-title'>{pick(item.title)}</Text>
                {pick(item.note) && <Text className='trip-plan__item-note'>{pick(item.note)}</Text>}
              </View>
            </View>
          ))}
        </View>
      ))}

      {/* 预算 */}
      <View className='trip-plan__budget'>
        <Text className='trip-plan__section-title'>{t('tp.budget')}</Text>
        <View className='trip-plan__budget-row'>
          <Text>{t('tp.bFlights')}</Text>
          <Text className='font-code'>{formatPrice(plan.budgetCny.flights)}</Text>
        </View>
        <View className='trip-plan__budget-row'>
          <Text>{t('tp.bStay')}</Text>
          <Text className='font-code'>{formatPrice(plan.budgetCny.stay)}</Text>
        </View>
        <View className='trip-plan__budget-row'>
          <Text>{t('tp.bActivities')}</Text>
          <Text className='font-code'>{formatPrice(plan.budgetCny.activities)}</Text>
        </View>
        <View className='trip-plan__budget-row trip-plan__budget-row--total'>
          <Text>{t('tp.bTotal')}</Text>
          <Text className='font-code'>{formatPrice(plan.budgetCny.total)}</Text>
        </View>
      </View>

      {/* 提醒 */}
      {plan.reminders.length > 0 && (
        <View className='trip-plan__reminders'>
          <Text className='trip-plan__section-title'>{t('tp.reminders')}</Text>
          {plan.reminders.map((r, i) => (
            <Text key={i} className='trip-plan__reminder'>· {pick(r)}</Text>
          ))}
        </View>
      )}

      <View className='trip-plan__disclaimer'>
        <Text>{t('tp.disclaimer')}</Text>
      </View>
    </View>
  )
}

export default observer(PlanPage)
