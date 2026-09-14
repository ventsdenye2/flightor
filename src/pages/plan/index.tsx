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
import { artifactService, type ArtifactEnvelope } from '../../services/artifactService'
import { getCloudWorkspace, type WorkspaceTrip } from '../../services/workspaceService'
import { FlightDecisionPanel } from '../../features/ui-experience/FlightDecisionPanel'
import './index.scss'

function PlanPage() {
  useProductionTab('plan')
  const locale = localeStore.locale
  const [productionResult, setProductionResult] = useState<{ key: string; trip: TripPresentation }>()
  const [productionError, setProductionError] = useState('')
  const [productionLoginOpen, setProductionLoginOpen] = useState(false)
  const [workspaceTrip, setWorkspaceTrip] = useState<WorkspaceTrip>()
  const [flightArtifact, setFlightArtifact] = useState<{ key: string; value: ArtifactEnvelope }>()
  const pendingPrompt = useRef('')
  const ownerId = userStore.profile?.uid
  const lastTurn = chatStore.timeline[chatStore.timeline.length - 1]
  const refs = lastTurn?.artifactRefs ?? []
  const allRefs = chatStore.artifactRefs.length ? chatStore.artifactRefs : refs
  const productionRef = [...allRefs].reverse().find(ref => ref.type === 'travel_guide')
    ?? [...allRefs].reverse().find(ref => ref.type === 'route')
  const flightRef = [...allRefs].reverse().find(ref => ref.type === 'flight_search')
  const selectedFlight = workspaceTrip?.selectedFlight
  const flightArtifactId = selectedFlight?.artifactId ?? flightRef?.id
  const artifactKey = `${ownerId}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${flightArtifactId}`
  const resultKey = `${ownerId}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${productionRef?.id}:${selectedFlight?.revision ?? 0}`
  const busy = chatStore.isThinking || chatStore.multiLoading || chatStore.multiConfirming

  useEffect(() => {
    let active = true
    setProductionError('')
    if (!ownerId || !productionRef) return () => { active = false }
    loadProductionTrip(productionRef.id, { ownerId, sessionId: chatStore.currentSessionId })
      .then(value => { if (active) { setProductionResult({ key: resultKey, trip: value.presentation }); setProductionError('') } })
      .catch(error => { if (active) setProductionError(error instanceof Error ? error.message : '行程结果暂不可用') })
    return () => { active = false }
  }, [resultKey])

  useEffect(() => {
    let active = true
    if (!ownerId || !flightArtifactId) return () => { active = false }
    artifactService.fetchArtifact(flightArtifactId, { ownerId, sessionId: chatStore.currentSessionId })
      .then(value => { if (active) setFlightArtifact({ key: artifactKey, value }) })
      .catch(() => { if (active) setFlightArtifact(undefined) })
    return () => { active = false }
  }, [artifactKey])

  useDidShow(() => {
    if (!chatStore.isThinking) void chatStore.refreshWorkspace(locale)
    const tripId = chatStore.tripId
    const revision = userStore.sessionRevision
    if (ownerId && tripId) void getCloudWorkspace(tripId, chatStore.conversationId || undefined)
      .then(workspace => { if (userStore.sessionRevision === revision && userStore.profile?.uid === ownerId) setWorkspaceTrip(workspace.trip) })
      .catch(() => setWorkspaceTrip(undefined))
  })
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
  const currentFlightArtifact = flightArtifact?.key === artifactKey ? flightArtifact.value : undefined
  const flightDecision = currentFlightArtifact ? <FlightDecisionPanel artifact={currentFlightArtifact} selection={selectedFlight} busy={busy}
    onOpenCandidates={artifactId => void Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodeURIComponent(artifactId)}` })}
    onChange={artifactId => void Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodeURIComponent(artifactId)}` })}
    onPlan={() => void submit(selectedFlight?.layoverPreference === 'consider_city'
      ? '请根据我刚刚采用的全部航段和时间安排游玩。长中转只有在入境、行李、地面交通和安全余量都合适时才考虑进城；先安排真实抵达后的目的地行程。'
      : '请根据我刚刚采用的全部航段和时间安排游玩。中转期间留在机场，先安排真实抵达后的目的地行程。')} /> : undefined

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
      flightDecision={flightDecision}
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
