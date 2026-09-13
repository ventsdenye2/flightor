import { useEffect, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { chatStore } from '../../stores/chatStore'
import { t, localeStore } from '../../i18n'
import { userStore } from '../../stores/userStore'
import LoginSheet from '../../components/common/LoginSheet'
import { useProductionTab } from '../../components/navigation/ProductionTabBar'
import PlannerPage from '../../features/ui-experience/PlannerPage'
import { loadProductionTrip } from '../../services/productionTripService'
import type { TripPresentation } from '../../features/ui-experience/presentation'
import './index.scss'

function PlanPage() {
  useProductionTab('plan')
  const locale = localeStore.locale
  const [productionResult, setProductionResult] = useState<{ key: string; trip: TripPresentation }>()
  const [productionError, setProductionError] = useState('')
  const [productionLoginOpen, setProductionLoginOpen] = useState(false)
  const pendingPrompt = useRef('')
  const ownerId = userStore.profile?.uid
  const lastTurn = chatStore.timeline[chatStore.timeline.length - 1]
  const refs = lastTurn?.artifactRefs ?? []
  const productionRef = [...refs].reverse().find(ref => ref.type === 'travel_guide')
    ?? [...refs].reverse().find(ref => ref.type === 'route')
  const resultKey = `${ownerId}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${productionRef?.id}`
  const busy = chatStore.isThinking || chatStore.multiLoading || chatStore.multiConfirming

  useEffect(() => {
    let active = true
    if (!ownerId || !productionRef) return () => { active = false }
    loadProductionTrip(productionRef.id, { ownerId, sessionId: chatStore.currentSessionId })
      .then(value => { if (active) setProductionResult({ key: resultKey, trip: value.presentation }) })
      .catch(error => { if (active) setProductionError(error instanceof Error ? error.message : '行程结果暂不可用') })
    return () => { active = false }
  }, [resultKey])

  useDidShow(() => { if (!chatStore.isThinking) void chatStore.refreshWorkspace(locale) })
  useEffect(() => { void Taro.setNavigationBarTitle({ title: t('nav.tripPlan') }) }, [locale])
  useEffect(() => { setProductionError('') }, [ownerId, userStore.sessionRevision, chatStore.currentSessionId])

  async function submit(message: string) {
    if (busy) return
    if (chatStore.requiresLogin) {
      pendingPrompt.current = message
      setProductionLoginOpen(true)
      setProductionError('请先完成登录，再继续规划。')
      return
    }
    const revision = userStore.sessionRevision
    setProductionError('')
    const accepted = await chatStore.send(message, locale)
    if (revision !== userStore.sessionRevision) return
    if (!accepted) setProductionError(chatStore.multiError || '规划请求未完成，请查看规划记录')
  }

  const fallbackTrip: TripPresentation = {
    id: chatStore.tripId || 'production-planning',
    title: '新的旅行计划',
    destination: chatStore.tripContextSummary?.destinations.required[0]?.name || '目的地待确认',
    route: [],
    dates: { start: null, end: null, label: '日期待确认' },
    durationDays: chatStore.tripContextSummary?.travelDays || null,
    travelers: null,
    cover: null,
    description: '继续补充想法，生成后的行程会自动保存。',
    days: [],
    status: 'pending',
    flights: [],
    alternatives: [],
    sources: []
  }
  const result = productionResult?.key === resultKey ? productionResult.trip : undefined

  return <View className='trip-plan ux-app production-main-page'>
    <PlannerPage
      key={ownerId ?? 'guest'}
      trip={result ?? fallbackTrip}
      onOpenTrip={() => productionRef && void Taro.navigateTo({ url: `/pages/route/index?artifactId=${encodeURIComponent(productionRef.id)}` })}
      onSearchFlights={() => void Taro.navigateTo({ url: '/pages/index/index' })}
      onSubmitPrompt={message => void submit(message)}
      productionBusy={busy}
      productionProgress={chatStore.turnProgress}
      locale={locale}
      productionError={productionError || chatStore.multiError}
      productionReply={lastTurn?.assistant?.content}
      productionPrompt={lastTurn?.user.content}
      productionResultAvailable={Boolean(result)}
      productionStopReason={lastTurn?.stopReason}
      productionDelivery={lastTurn?.delivery}
      productionWarnings={lastTurn?.warnings}
    />
    <LoginSheet
      visible={productionLoginOpen}
      onClose={() => setProductionLoginOpen(false)}
      onSuccess={() => {
        const prompt = pendingPrompt.current
        pendingPrompt.current = ''
        setProductionLoginOpen(false)
        if (prompt) void submit(prompt)
      }}
    />
  </View>
}

export default observer(PlanPage)
