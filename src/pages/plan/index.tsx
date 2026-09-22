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
import { displayOffers, displayOfferById, record } from '../../components/artifacts/payload'
import { plannerTelemetry } from '../../services/plannerTelemetry'
import './index.scss'

type SubmitScope = { ownerId: string | undefined; authRevision: number; sessionId: string; tripId: string }
const currentSubmitScope = (scope: SubmitScope) => scope.ownerId === userStore.profile?.uid
  && scope.authRevision === userStore.sessionRevision && scope.sessionId === chatStore.currentSessionId
  && (!scope.tripId || scope.tripId === chatStore.tripId)

/** A saved selection and newly published alternatives have independent read scopes. */
function useScopedFlightArtifact(id: string | undefined, ownerId: string | undefined, sessionId: string, tripId: string, authRevision: number) {
  const [loaded, setLoaded] = useState<{ key: string; value: ArtifactEnvelope }>()
  const key = `${ownerId}:${authRevision}:${sessionId}:${tripId}:${id}`
  useEffect(() => {
    let active = true
    if (!ownerId || !id) return () => { active = false }
    const isCurrent = () => active && ownerId === userStore.profile?.uid && authRevision === userStore.sessionRevision
      && sessionId === chatStore.currentSessionId && tripId === chatStore.tripId
    artifactService.fetchArtifact(id, { ownerId, sessionId })
      .then(value => { if (isCurrent() && value.tripId === tripId) setLoaded({ key, value }) })
      .catch(() => { if (isCurrent()) setLoaded(undefined) })
    return () => { active = false }
  }, [key])
  return loaded?.key === key ? loaded.value : undefined
}

function PlanPage() {
  useProductionTab('plan')
  const locale = localeStore.locale
  const [productionResult, setProductionResult] = useState<{ key: string; trip: TripPresentation; guideId?: string; reply?: string; verificationStatus: string | null }>()
  const [productionError, setProductionError] = useState('')
  const [productionLoginOpen, setProductionLoginOpen] = useState(false)
  const [workspaceTrip, setWorkspaceTrip] = useState<{ key: string; trip: WorkspaceTrip }>()
  const pendingPrompt = useRef('')
  const activeSubmit = useRef<SubmitScope | undefined>(undefined)
  const ownerId = userStore.profile?.uid
  const lastTurn = chatStore.timeline[chatStore.timeline.length - 1]
  const refs = lastTurn?.artifactRefs ?? []
  const allRefs = chatStore.artifactRefs.length ? chatStore.artifactRefs : refs
  const productionRef = [...allRefs].reverse().find(ref => ref.type === 'travel_guide')
    ?? [...allRefs].reverse().find(ref => ref.type === 'route')
  const flightRef = [...refs].reverse().find(ref => ref.type === 'flight_search')
    ?? [...allRefs].reverse().find(ref => ref.type === 'flight_search')
  const workspaceKey = `${ownerId}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${chatStore.tripId}`
  const currentWorkspaceTrip = workspaceTrip?.key === workspaceKey ? workspaceTrip.trip : undefined
  const selectedFlight = currentWorkspaceTrip?.selectedFlight
  const flightArtifactId = selectedFlight?.artifactId ?? flightRef?.id
  const alternativeArtifactId = selectedFlight && flightRef?.id !== selectedFlight.artifactId ? flightRef?.id : undefined
  const currentFlightArtifact = useScopedFlightArtifact(flightArtifactId, ownerId, chatStore.currentSessionId, chatStore.tripId, userStore.sessionRevision)
  const alternativeFlightArtifact = useScopedFlightArtifact(alternativeArtifactId, ownerId, chatStore.currentSessionId, chatStore.tripId, userStore.sessionRevision)
  const resultKey = `${workspaceKey}:${productionRef?.id}:${selectedFlight?.revision ?? 0}:${locale}:${chatStore.isThinking}`
  const busy = chatStore.isThinking || chatStore.multiLoading || chatStore.multiConfirming

  useEffect(() => {
    let active = true
    setProductionError('')
    if (!ownerId || !productionRef) return () => { active = false }
    const sessionId = chatStore.currentSessionId
    const tripId = chatStore.tripId
    const authRevision = userStore.sessionRevision
    loadProductionTrip(productionRef.id, { ownerId, sessionId, locale })
      .then(value => { if (active && authRevision === userStore.sessionRevision && ownerId === userStore.profile?.uid && sessionId === chatStore.currentSessionId && tripId === chatStore.tripId) { setProductionResult({ key: resultKey, trip: value.presentation, guideId: value.guide?.id,
        reply: record(record(value.guide?.payload)?.publication)?.reply as string | undefined,
        verificationStatus: artifactVerificationStatus(value.guide) }); setProductionError('') } })
      .catch(error => { if (active && authRevision === userStore.sessionRevision && ownerId === userStore.profile?.uid && sessionId === chatStore.currentSessionId && tripId === chatStore.tripId) setProductionError(error instanceof Error ? error.message : '行程结果暂不可用') })
    return () => { active = false }
  }, [resultKey])

  useDidShow(() => {
    if (!chatStore.isThinking) void chatStore.refreshWorkspace(locale)
    const tripId = chatStore.tripId
    const revision = userStore.sessionRevision
    const sessionId = chatStore.currentSessionId
    if (ownerId && tripId) void getCloudWorkspace(tripId, chatStore.conversationId || undefined)
      .then(workspace => { if (userStore.sessionRevision === revision && userStore.profile?.uid === ownerId && chatStore.currentSessionId === sessionId && chatStore.tripId === tripId) setWorkspaceTrip({ key: `${ownerId}:${revision}:${sessionId}:${tripId}`, trip: workspace.trip }) })
      .catch(() => { if (userStore.sessionRevision === revision && userStore.profile?.uid === ownerId && chatStore.currentSessionId === sessionId && chatStore.tripId === tripId) setWorkspaceTrip(undefined) })
  })
  useEffect(() => { void Taro.setNavigationBarTitle({ title: t('nav.tripPlan') }) }, [locale])
  useEffect(() => { setProductionError('') }, [ownerId, userStore.sessionRevision, chatStore.currentSessionId])
  useEffect(() => { setWorkspaceTrip(undefined) }, [ownerId, userStore.sessionRevision, chatStore.currentSessionId, chatStore.tripId])
  useEffect(() => {
    const scope = activeSubmit.current
    if (!scope) return
    if (!currentSubmitScope(scope)) activeSubmit.current = undefined
    else if (!scope.tripId && chatStore.tripId) scope.tripId = chatStore.tripId
  }, [ownerId, userStore.sessionRevision, chatStore.currentSessionId, chatStore.tripId])
  useEffect(() => () => { activeSubmit.current = undefined }, [])

  async function submit(message: string, clickedAtMs: number | null = null) {
    if (busy || chatStore.isThinking) return
    if (chatStore.requiresLogin) {
      pendingPrompt.current = message
      setProductionLoginOpen(true)
      setProductionError('请先完成登录，再继续规划。')
      return
    }
    const revision = userStore.sessionRevision
    const submitOwnerId = userStore.profile?.uid
    setProductionError('')
    const sending = chatStore.send(message, locale, { clickedAtMs })
    // Owner activation and legacy-session migration run synchronously before
    // send's first await; capture their resulting scope, allowing fresh Trip bootstrap.
    const scope = { ownerId: submitOwnerId, authRevision: revision, sessionId: chatStore.currentSessionId, tripId: chatStore.tripId }
    activeSubmit.current = scope
    const accepted = await sending
    if (activeSubmit.current !== scope || !currentSubmitScope(scope)) return
    activeSubmit.current = undefined
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
  const openFlightCandidates = (artifactId: string) => void Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodeURIComponent(artifactId)}` })
  const planSelectedFlight = () => void submit(selectedFlight?.layoverPreference === 'consider_city'
    ? '请根据我刚刚采用的全部航段和时间安排游玩。长中转只有在入境、行李、地面交通和安全余量都合适时才考虑进城；先安排真实抵达后的目的地行程。'
    : '请根据我刚刚采用的全部航段和时间安排游玩。中转期间留在机场，先安排真实抵达后的目的地行程。', plannerTelemetry.now())
  const flightDecision = <>
    {currentFlightArtifact && <FlightDecisionPanel key={currentFlightArtifact.id} artifact={currentFlightArtifact} selection={selectedFlight} busy={busy}
      onOpenCandidates={openFlightCandidates} onChange={openFlightCandidates} onPlan={planSelectedFlight} />}
    {alternativeFlightArtifact && <FlightDecisionPanel key={alternativeFlightArtifact.id} artifact={alternativeFlightArtifact} busy={busy}
      onOpenCandidates={openFlightCandidates} onChange={openFlightCandidates} onPlan={planSelectedFlight} />}
  </>

  return <View className='trip-plan ux-app production-main-page'>
    <PlannerPage
      key={workspaceKey}
      trip={result ?? fallbackTrip}
      onOpenTrip={() => productionRef && void Taro.navigateTo({ url: `/pages/route/index?artifactId=${encodeURIComponent(productionRef.id)}` })}
      onSearchFlights={() => void Taro.navigateTo({ url: '/pages/index/index' })}
      onSubmitPrompt={message => void submit(message, plannerTelemetry.now())}
      productionBusy={busy}
      productionProgress={chatStore.turnProgress}
      productionCancelling={chatStore.turnCancelling}
      locale={locale}
      productionError={productionError || chatStore.multiError}
      productionReply={productionRef?.type === 'travel_guide' ? (productionResult?.key === resultKey ? productionResult.reply : undefined)
        : lastTurn?.assistant?.locale && lastTurn.assistant.locale !== locale ? undefined : lastTurn?.assistant?.content}
      productionPrompt={lastTurn?.user.content}
      productionResultAvailable={Boolean(result)}
      productionStopReason={lastTurn?.stopReason}
      productionDelivery={lastTurn?.delivery}
      productionWarnings={lastTurn?.warnings}
      onCancelProduction={() => { activeSubmit.current = undefined; void chatStore.cancelTurn(locale) }}
      flightDecision={flightDecision}
      productionTelemetry={chatStore.turnTelemetryId ? {
        id: chatStore.turnTelemetryId, finalReady: chatStore.turnTelemetryFinalReady,
        flights: [currentFlightArtifact, alternativeFlightArtifact].flatMap(artifact => {
          const payload = artifact && record(artifact.payload)
          const usable = payload && (artifact?.id === selectedFlight?.artifactId && selectedFlight?.kind === 'offer'
            ? displayOfferById(payload, selectedFlight.offerId, artifact?.presentation) : displayOffers(payload, artifact?.presentation).length > 0)
          return artifact?.type === 'flight_search' && usable ? [{ id: artifact.id, verificationStatus: artifactVerificationStatus(artifact) }] : []
        }),
        ...(result && productionResult?.guideId ? { guide: { id: productionResult.guideId, verificationStatus: productionResult.verificationStatus } } : {})
      } : undefined}
      onProductionCommit={(id, event) => chatStore.recordTurnUiCommit(id, event)}
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

function artifactVerificationStatus(artifact: ArtifactEnvelope | undefined): string | null {
  const status = record(artifact?.verification)?.status ?? record(record(artifact?.payload)?.verification)?.status
  return typeof status === 'string' ? status : null
}
