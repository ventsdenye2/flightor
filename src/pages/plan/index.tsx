// pages/plan — AI 行程规划（tabBar 主页面）
// 双形态：未选航班 → 需求对话（talk with agent 拆解需求 → 核心检索系统）；
//        已选航班 → 生成行程时间轴（tripAgent）
import { useEffect, useState } from 'react'
import { View, Text, Input, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import DemoBadge from '../../components/common/DemoBadge'
import { flightStore } from '../../stores/flightStore'
import { chatStore } from '../../stores/chatStore'
import { planTrip, TripPlan, TripItemType, BiText } from '../../services/tripService'
import { cityByIata } from '../../services/routeService'
import { cityOf } from '../../mocks/airports'
import { t, fd, localeStore } from '../../i18n'
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

const PLAN_LABEL_KEY: Record<'save' | 'comfort' | 'play', string> = {
  save: 'chat.planSave',
  comfort: 'chat.planComfort',
  play: 'chat.planPlay'
}

const ROUTE_LABEL_KEY: Record<string, string> = {
  cheapest: 'chat.routeCheapest',
  mostCities: 'chat.routeMostCities',
  mostNights: 'chat.routeMostNights'
}

/** 需求对话视图 */
const AgentChat = observer(() => {
  const [input, setInput] = useState('')
  const [routeExpanded, setRouteExpanded] = useState<Record<string, boolean>>({})
  const locale = localeStore.locale
  const slots = chatStore.slots

  const handleSend = () => {
    if (!input.trim()) return
    chatStore.send(input, locale)
    setInput('')
  }

  const handleConverge = () => {
    chatStore.converge(locale)
  }

  const handleSeeAll = () => {
    // converge 已发起搜索，直接进全部结果页
    Taro.navigateTo({ url: '/pages/search/index' })
  }

  return (
    <View className='agent-chat'>
      <ScrollView className='agent-chat__body' scrollY scrollIntoView='chat-bottom'>
        {/* 开场引导 */}
        <View className='agent-chat__msg agent-chat__msg--assistant'>
          <Text>{t('chat.hello')}</Text>
        </View>
        {chatStore.messages.length === 0 && (
          <View className='agent-chat__suggests'>
            {[t('chat.eg1'), t('chat.eg2'), t('chat.eg3')].map(eg => (
              <View key={eg} className='agent-chat__suggest' hoverClass='tap-dim' onClick={() => chatStore.send(eg, locale)}>
                <Text>{eg}</Text>
              </View>
            ))}
          </View>
        )}

        {chatStore.messages.map((m, i) => (
          <View key={i} className={`agent-chat__msg agent-chat__msg--${m.role}`}>
            <Text>{m.content}</Text>
          </View>
        ))}
        {chatStore.isThinking && (
          <View className='agent-chat__msg agent-chat__msg--assistant agent-chat__msg--thinking'>
            <Text>{t('chat.thinking')}</Text>
          </View>
        )}

        {/* 需求拆解完成：参数摘要卡 → 收敛成备选攻略 */}
        {chatStore.ready && !chatStore.isThinking && (
          <View className='agent-chat__card'>
            <Text className='agent-chat__card-title'>{t('chat.parsed')}</Text>
            <View className='agent-chat__card-route'>
              <Text className='agent-chat__card-cities agent-chat__card-cities--big'>
                {cityOf(slots.origin!, locale)} → {cityOf(slots.destination!, locale)}
              </Text>
            </View>
            <View className='agent-chat__card-rows'>
              <Text>{t('chat.pDate')}: {humanDate(slots.depart_date_from!, locale)}</Text>
              {slots.stay_max != null && slots.stay_max > 0 && (
                <Text>{t('chat.pStay')}: {slots.stay_min}-{slots.stay_max}{t('chat.days')}</Text>
              )}
              {slots.budget_max != null && <Text>{t('chat.pBudget')}: ≤{formatPrice(slots.budget_max)}</Text>}
              {slots.transfer_pref === 'direct' && <Text>{t('search.directOnly')}</Text>}
              {slots.transfer_pref === 'transfer' && <Text>{t('search.allowTransfer')}</Text>}
            </View>
            {!chatStore.planCards && !chatStore.plansLoading && (
              <View className='agent-chat__card-cta' hoverClass='tap-dim' onClick={handleConverge}>
                <Text>{t('chat.genPlans')}</Text>
              </View>
            )}
          </View>
        )}

        {/* 收敛中 */}
        {chatStore.plansLoading && (
          <View className='agent-chat__msg agent-chat__msg--assistant agent-chat__msg--thinking'>
            <Text>{t('chat.planning')}</Text>
          </View>
        )}

        {/* 收敛失败 */}
        {chatStore.plansError && (
          <View className='agent-chat__card'>
            <Text>{chatStore.plansError}</Text>
            <View className='agent-chat__card-cta' hoverClass='tap-dim' onClick={handleConverge}>
              <Text>{t('tp.retry')}</Text>
            </View>
          </View>
        )}

        {/* 备选攻略卡：选一个出发 */}
        {chatStore.planCards && chatStore.planCards.length > 0 && (
          <View className='agent-chat__plans'>
            <View className='agent-chat__msg agent-chat__msg--assistant'>
              <Text>{t('chat.plansTitle', { n: chatStore.planCards.length })}</Text>
            </View>
            {chatStore.planCards.map(card => {
              const f = card.flight
              const firstSeg = f.segments[0]
              const lastSeg = f.segments[f.segments.length - 1]
              const saving = flightStore.savingsOf(f)
              return (
                <View key={card.key} className='agent-chat__plan'>
                  <View className='agent-chat__plan-head'>
                    <Text className='agent-chat__plan-label'>{t(PLAN_LABEL_KEY[card.key])}</Text>
                    <Text className='agent-chat__plan-route'>
                      {cityOf(firstSeg.origin, locale)} → {cityOf(lastSeg.destination, locale)}
                      {' · '}
                      {formatMonthDay(firstSeg.departTime)}
                    </Text>
                  </View>
                  <View className='agent-chat__plan-body'>
                    <View className='agent-chat__plan-price'>
                      <Text className='font-code'>{formatPrice(f.totalPrice)}</Text>
                      {saving.amount > 0 && (
                        <Text className='agent-chat__plan-saving'>
                          {t('common.dropPct', { pct: saving.percent })}
                        </Text>
                      )}
                    </View>
                    <View className='agent-chat__plan-meta'>
                      <Text>{fd(f.totalDuration)}</Text>
                      <Text>
                        {t(`fcc.${f.transferType}`)}
                        {f.hub ? ` · ${t('fcc.stayShort', { city: cityOf(f.hub.iata, locale), dur: fd(f.hub.layoverMinutes) })}` : ''}
                      </Text>
                    </View>
                  </View>
                  <View
                    className='agent-chat__plan-pick'
                    hoverClass='tap-dim'
                    onClick={() => chatStore.pickPlan(f)}
                  >
                    <Text>{t('chat.planPick')}</Text>
                  </View>
                </View>
              )
            })}
            <View className='agent-chat__plan-all' hoverClass='tap-dim' onClick={handleSeeAll}>
              <Text>{t('chat.planAll')}</Text>
            </View>
          </View>
        )}
        {/* 多城路线规划：规划中 */}
        {chatStore.multiLoading && (
          <View className='agent-chat__msg agent-chat__msg--assistant agent-chat__msg--thinking'>
            <Text>{t('chat.planning')}</Text>
          </View>
        )}

        {/* 多城路线规划：失败重试 */}
        {chatStore.multiError && (
          <View className='agent-chat__card'>
            <Text>{chatStore.multiError}</Text>
          </View>
        )}

        {/* 多城路线卡：城市序列 + 总价 + 航段明细 + 真实价确认 */}
        {chatStore.multiPicks && chatStore.multiPicks.length > 0 && (
          <View className='agent-chat__plans'>
            <View className='agent-chat__msg agent-chat__msg--assistant'>
              <Text>{t('chat.routeTitle', { n: chatStore.multiPicks.length })}</Text>
            </View>
            {chatStore.multiPicks.map(pick => {
              const r = pick.route
              const expanded = routeExpanded[pick.kind] === true
              const hasEstimate = r.legs.some(l => l.real !== true)
              return (
                <View key={pick.kind} className='agent-chat__plan agent-chat__plan--route'>
                  <View
                    className='agent-chat__plan-head'
                    hoverClass='tap-dim'
                    onClick={() => setRouteExpanded({ ...routeExpanded, [pick.kind]: !expanded })}
                  >
                    <Text className={`agent-chat__plan-label agent-chat__plan-label--${pick.kind}`}>{t(ROUTE_LABEL_KEY[pick.kind] ?? 'chat.routeCheapest')}</Text>
                    <Text className='agent-chat__card-cities agent-chat__card-cities--big'>
                      {r.cities.map(c => cityByIata(c, locale)).join(' → ')}
                    </Text>
                  </View>
                  <View className='agent-chat__plan-body'>
                    <View className='agent-chat__plan-price'>
                      <Text className='agent-chat__plan-price-cap'>{t('chat.routeTotal')}</Text>
                      <Text className='font-code'>{formatPrice(r.totalPrice)}</Text>
                    </View>
                    <View className='agent-chat__plan-meta'>
                      {r.nightsSaved > 0 && <Text className='agent-chat__plan-nights'>🌙 {t('chat.routeNights', { n: r.nightsSaved })}</Text>}
                      <Text className='agent-chat__route-toggle'>{expanded ? '▲' : '▼'} {t('chat.routeLegs', { n: r.legs.length })}</Text>
                    </View>
                  </View>
                  <View className={`agent-chat__rlegs ${expanded ? 'is-open' : ''}`}>
                    {r.legs.map((leg, i) => (
                      <View key={i} className='agent-chat__rleg'>
                        <Text className='agent-chat__rleg-no'>{i + 1}</Text>
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
                      className={`agent-chat__plan-pick ${chatStore.multiConfirming ? 'is-disabled' : ''}`}
                      hoverClass='tap-dim'
                      onClick={() => chatStore.confirmMulti()}
                    >
                      <Text>{chatStore.multiConfirming ? t('chat.routeConfirming') : t('chat.routeConfirm')}</Text>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )}
        <View id='chat-bottom' />
      </ScrollView>

      {/* 输入栏 */}
      <View className='agent-chat__footer'>
        {chatStore.messages.length > 0 && (
          <View className='agent-chat__reset' hoverClass='tap-dim' onClick={() => chatStore.reset()}>
            <Text>↺</Text>
          </View>
        )}
        <Input
          className='agent-chat__input'
          value={input}
          placeholder={t('chat.placeholder')}
          placeholderClass='agent-chat__placeholder'
          confirmType='send'
          onInput={e => setInput(e.detail.value)}
          onConfirm={handleSend}
        />
        <View
          className={`agent-chat__send ${input.trim() && !chatStore.isThinking ? '' : 'is-disabled'}`}
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
  const locale = localeStore.locale
  const pick = (v: BiText) => (locale === 'zh' ? v.zh : v.en)

  const flight = flightStore.selected
  const params = flightStore.lastParams

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.tripPlan') })
  }, [locale])

  const load = () => {
    if (!flight || !params) return
    setError(false)
    setPlan(null)
    planTrip(flight, params)
      .then(setPlan)
      .catch(() => setError(true))
  }

  useEffect(load, [flight?.id])

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

  if (!plan) {
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
