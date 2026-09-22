import { useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { localeStore, t } from '../../i18n'
import { artifactService, type ArtifactEnvelope } from '../../services/artifactService'
import { readRouteArtifact, type RouteView } from '../../services/routeArtifact'
import { userStore } from '../../stores/userStore'
import { chatStore } from '../../stores/chatStore'
import { RouteWorkspace } from '../../components/route/RouteWorkspace'
import { ResearchWorkspace } from '../../components/route/ResearchWorkspace'
import { FlightSearchCard } from '../../components/artifacts/FlightSearchCard'
import { FlightDetail } from '../../components/route/FlightDetail'
import { resolveArtifactRenderer } from '../../components/artifacts/registry'
import { ensureWorkspaceConversation, getCloudWorkspace, updateCloudTrip } from '../../services/workspaceService'
import { loadProductionTrip, loadProductionPlaces, samePlacePublication, prepareProductionLocale, prepareProductionPlaces } from '../../services/productionTripService'
import { loadProductionMedia, prepareProductionMedia, mergeProductionExtension } from '../../services/productionTripService'
import TripExperience from '../../features/ui-experience/TripExperience'
import type { TripPresentation } from '../../features/ui-experience/presentation'
import { safeSourceUrl } from '../../features/ui-experience/productionPresentation'
import { EmptyState, PageHeader } from '../../features/ui-experience/SharedUI'
import { decodeRouteParam, ROUTE_DETAIL_SHELL_CLASS, resolveRouteDetailView, type RouteDetailView } from './dispatch'
import '../../features/ui-experience/experience.scss'
import './index.scss'

type State = { key: string; artifact?: ArtifactEnvelope; presentation?: TripPresentation; routes?: RouteView[]; error?: string }
function RoutePage() {
  const { params } = useRouter()
  const artifactId = params.artifactId ?? ''
  const offerId = decodeRouteParam(params.offerId)
  const routeId = decodeRouteParam(params.routeId)
  const ownerId = userStore.profile?.uid
  const locale = localeStore.locale
  const key = `${ownerId ?? ''}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${artifactId}:${locale}`
  const [state, setState] = useState<State>({ key: '' })
  const [attempt, setAttempt] = useState(0)
  const [publicationAction, setPublicationAction] = useState<{ key: string; busy: boolean; error?: string }>({ key: '', busy: false })
  const [placesAction,setPlacesAction]=useState<{key:string;busy:boolean;error?:string}>({key:'',busy:false})
  const placeRequests=useRef(new Set<string>())
  const mediaRequests=useRef(new Set<string>())
  const [mediaAction,setMediaAction]=useState<{key:string;busy:boolean;error?:string}>({key:'',busy:false})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [layoverPreference, setLayoverPreference] = useState<'airport_only' | 'consider_city'>('airport_only')
  const activeKey = useRef(key); activeKey.current = key
  const publicationRequests = useRef(new Set<string>())
  const generation = useRef(0)
  function supplementPlaces(loaded: Awaited<ReturnType<typeof loadProductionTrip>>, context: Parameters<typeof loadProductionTrip>[1], ticket: number) {
    const revision = userStore.sessionRevision
    void loadProductionMedia(loaded,context).then(enriched=>{
      if(generation.current!==ticket||activeKey.current!==key||userStore.sessionRevision!==revision||userStore.profile?.uid!==ownerId)return
      setState(previous=>previous.key===key&&previous.presentation?{...previous,presentation:mergeProductionExtension(previous.presentation,enriched.presentation,'media')}:previous)
    }).catch(()=>{})
    void loadProductionPlaces(loaded, context).then(enriched => {
      if (generation.current !== ticket || activeKey.current !== key || userStore.sessionRevision !== revision || userStore.profile?.uid !== ownerId) return
      setState(previous => previous.key === key && samePlacePublication(previous.presentation, enriched.presentation)
        ? { ...previous, presentation: mergeProductionExtension(previous.presentation!,enriched.presentation,'places') } : previous)
    }).catch(() => { /* Extension diagnostics own failures; accepted text remains usable. */ })
  }
  useEffect(() => {
    const ticket = ++generation.current
    void Taro.setNavigationBarTitle({ title: t('trip.details') })
    let active = true
    setSaved(''); setSaving(false); setLayoverPreference('airport_only')
    if (!ownerId || !artifactId) return () => { active = false }
    setState({ key })
    const context = { ownerId, sessionId: chatStore.currentSessionId, force: attempt > 0, locale }
    artifactService.fetchArtifact(artifactId, context).then(async artifact => {
      if (!active || generation.current !== ticket) return
      const resolution = resolveArtifactRenderer(artifact)
      if (!resolution.supported) {
        setState({ key, artifact })
      } else if (resolution.key === 'route' || resolution.key === 'travel_guide') {
        const loaded = await loadProductionTrip(artifactId, context)
        if (active && generation.current === ticket) {
          setState({ key, artifact: loaded.route, presentation: loaded.presentation })
          supplementPlaces(loaded, context, ticket)
        }
      } else setState({ key, artifact, ...(resolution.key.startsWith('route_set:') ? { routes: readRouteArtifact(artifact) } : {}) })
    }).catch(error => { if (active && generation.current === ticket) setState({ key, error: error instanceof Error ? error.message : '加载失败，请重试' }) })
    return () => { active = false; generation.current++ }
  }, [key, attempt])
  const current = state.key === key ? state : undefined
  const artifact = current?.artifact
  async function prepareMedia(){
    if(!ownerId||mediaRequests.current.has(key))return
    mediaRequests.current.add(key);setMediaAction({key,busy:true})
    const ticket=generation.current,revision=userStore.sessionRevision
    try{const loaded=await prepareProductionMedia(artifactId,{ownerId,sessionId:chatStore.currentSessionId,locale})
      if(generation.current===ticket&&activeKey.current===key&&userStore.sessionRevision===revision&&userStore.profile?.uid===ownerId){
        setState(previous=>previous.key===key&&previous.presentation?{...previous,presentation:mergeProductionExtension(previous.presentation,loaded.presentation,'media')}:previous)
        setMediaAction({key,busy:false})
      }
    }catch{if(activeKey.current===key&&userStore.sessionRevision===revision)setMediaAction({key,busy:false,error:t('trip.mediaFailed')})}
    finally{mediaRequests.current.delete(key)}
  }
  async function preparePlaces(){
    if(!ownerId||placeRequests.current.has(key))return
    placeRequests.current.add(key);setPlacesAction({key,busy:true})
    const ticket=generation.current
    const revision=userStore.sessionRevision
    try {const loaded=await prepareProductionPlaces(artifactId,{ownerId,sessionId:chatStore.currentSessionId,locale})
      if(generation.current===ticket&&activeKey.current===key&&userStore.sessionRevision===revision){setState(previous=>previous.key===key&&previous.presentation?{...previous,presentation:mergeProductionExtension(previous.presentation,loaded.presentation,'places')}:previous);setPlacesAction({key,busy:false})}
    }catch{if(activeKey.current===key&&userStore.sessionRevision===revision)setPlacesAction({key,busy:false,error:t('trip.placesFailed')})}
    finally{placeRequests.current.delete(key)}
  }
  async function prepareLocale(retryRevision?: number) {
    if (!ownerId || publicationRequests.current.has(key)) return
    publicationRequests.current.add(key)
    const authRevision = userStore.sessionRevision
    const ticket = ++generation.current
    setPublicationAction({ key, busy: true })
    try {
      const loaded = await prepareProductionLocale(artifactId, { ownerId, sessionId: chatStore.currentSessionId, locale }, retryRevision)
      if (generation.current === ticket && activeKey.current === key && userStore.sessionRevision === authRevision) {
        setState({ key, artifact: loaded.route, presentation: loaded.presentation })
        supplementPlaces(loaded, { ownerId, sessionId: chatStore.currentSessionId, locale }, ticket)
      }
    } catch {
      if (activeKey.current === key && userStore.sessionRevision === authRevision) setPublicationAction({ key, busy: false, error: t('trip.requestFailed') })
      return
    } finally { publicationRequests.current.delete(key) }
    if (activeKey.current === key) setPublicationAction({ key, busy: false })
  }
  async function save(routeId: string) {
    if (!artifact || !ownerId || saving) return
    const revision = userStore.sessionRevision
    setSaving(true)
    try {
      const workspace = await getCloudWorkspace(artifact.tripId)
      if (activeKey.current !== key || userStore.profile?.uid !== ownerId || userStore.sessionRevision !== revision) return
      await updateCloudTrip(artifact.tripId, {
        expectedVersion: workspace.trip.version,
        selectedFlight: { kind: 'route', artifactId: artifact.id, routeId, layoverPreference }
      })
      const updated = await ensureWorkspaceConversation(await getCloudWorkspace(artifact.tripId, artifact.conversationId))
      if (activeKey.current !== key || userStore.profile?.uid !== ownerId || userStore.sessionRevision !== revision) return
      chatStore.openCloudWorkspace(updated, ownerId)
      setSaved('已采用此航线')
      await Taro.showToast({ title: '航线已保存', icon: 'success' })
      await Taro.switchTab({ url: '/pages/plan/index' })
    } catch (error) { if (activeKey.current === key) void Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' }) }
    finally { if (activeKey.current === key) setSaving(false) }
  }
  async function continuePlanning() {
    if (!artifact || !ownerId) return
    const revision = userStore.sessionRevision
    try {
      if (chatStore.isThinking || chatStore.multiLoading) throw new Error('当前规划仍在处理中，请稍后再试')
      const workspace = await ensureWorkspaceConversation(await getCloudWorkspace(artifact.tripId, artifact.conversationId))
      if (activeKey.current !== key || userStore.sessionRevision !== revision || userStore.profile?.uid !== ownerId) return
      if (chatStore.isThinking || chatStore.multiLoading) throw new Error('当前规划仍在处理中，请稍后再试')
      chatStore.openCloudWorkspace(workspace, ownerId)
      await Taro.switchTab({ url: '/pages/plan/index' })
    } catch (error) { void Taro.showToast({ title: error instanceof Error ? error.message : '无法打开规划记录', icon: 'none' }) }
  }
  async function adoptOffer(source: ArtifactEnvelope, offerId: string) {
    if (!ownerId || saving) return
    const revision = userStore.sessionRevision
    setSaving(true); setSaved('')
    try {
      const workspace = await getCloudWorkspace(source.tripId, source.conversationId)
      if (activeKey.current !== key || userStore.sessionRevision !== revision || userStore.profile?.uid !== ownerId) return
      await updateCloudTrip(source.tripId, {
        expectedVersion: workspace.trip.version,
        selectedFlight: { kind: 'offer', artifactId: source.id, offerId, layoverPreference }
      })
      const updated = await ensureWorkspaceConversation(await getCloudWorkspace(source.tripId, source.conversationId))
      if (activeKey.current !== key || userStore.sessionRevision !== revision || userStore.profile?.uid !== ownerId) return
      chatStore.openCloudWorkspace(updated, ownerId)
      setSaved('已采用此航线')
      await Taro.showToast({ title: '航线已保存', icon: 'success' })
      await Taro.switchTab({ url: '/pages/plan/index' })
    } catch (error) {
      if (activeKey.current === key) void Taro.showToast({ title: error instanceof Error ? error.message : '保存失败，请重试', icon: 'none' })
    } finally { if (activeKey.current === key) setSaving(false) }
  }
  const openSource = (url: string) => { const safe = safeSourceUrl(url); if (safe) void Taro.setClipboardData({ data: safe }).then(() => Taro.showToast({ title: t('trip.sourceCopied'), icon: 'none' })).catch(() => Taro.showToast({ title: t('trip.copyFailed'), icon: 'none' })) }
  const view = resolveRouteDetailView({ ownerId, artifactId, error: current?.error, artifact, presentation: current?.presentation, routes: current?.routes, offerId })
  const goBack = () => { void Taro.navigateBack().catch(() => Taro.switchTab({ url: '/pages/trips/index' })) }
  if (view.kind === 'trip') return <View className={ROUTE_DETAIL_SHELL_CLASS}>
    <TripExperience key={key} trip={view.presentation} production embedded onBack={goBack} onContinuePlanning={() => void continuePlanning()} onOpenSource={openSource}
      onPreparePlaces={()=>void preparePlaces()} placesBusy={placesAction.key===key&&placesAction.busy} placesError={placesAction.key===key?placesAction.error:undefined}
      onPrepareMedia={()=>void prepareMedia()} mediaBusy={mediaAction.key===key&&mediaAction.busy} mediaError={mediaAction.key===key?mediaAction.error:undefined}
      onRefresh={() => setAttempt(value => value + 1)} onPrepareLocale={retryRevision => void prepareLocale(retryRevision)}
      publicationBusy={publicationAction.key === key && publicationAction.busy} publicationError={publicationAction.key === key ? publicationAction.error : undefined} />
  </View>
  return <View className={ROUTE_DETAIL_SHELL_CLASS}>
    <PageHeader title={viewTitle(view)} onBack={goBack} />
    <View className='ux-scroll route-production__scroll'>
      <RouteDetailBody view={view} routeId={routeId} saving={saving} saved={saved} layoverPreference={layoverPreference}
        onLayoverPreference={setLayoverPreference} onAdoptOffer={adoptOffer} onRetry={() => setAttempt(value => value + 1)} onSave={save} />
      {!['guest', 'missing', 'loading'].includes(view.kind) && <View className='route-production__footer'>
        <Button className='ux-secondary' onClick={() => Taro.switchTab({ url: '/pages/trips/index' })}>查看我的行程</Button>
        <Button className='ux-text-button' onClick={() => Taro.switchTab({ url: '/pages/plan/index' })}>返回规划</Button>
      </View>}
    </View>
  </View>
}

function viewTitle(view: RouteDetailView): string {
  if (view.kind === 'route-set') return '路线方案'
  if (view.kind === 'flight-list') return '航班搜索'
  if (view.kind === 'flight-detail') return '航班详情'
  if (view.kind === 'research') return '目的地资料'
  if (view.kind === 'destination') return '目的地建议'
  return t('trip.details')
}

function unavailableCopy(view: Extract<RouteDetailView, { kind: 'unavailable' }>): string {
  if (view.reason === 'unsupported_version') return '此内容由较新的版本生成，请更新小程序后再查看。'
  if (view.reason === 'unsupported_payload_kind') return '当前版本还不能展示这种路线结果。'
  if (view.reason === 'presentation_unavailable') return '暂时无法显示完整行程，请从规划记录重新打开。'
  return '返回的内容不完整，暂时无法安全展示。'
}

function RouteDetailBody({ view, routeId, saving, saved, layoverPreference, onLayoverPreference, onAdoptOffer, onRetry, onSave }: {
  view: Exclude<RouteDetailView, { kind: 'trip' }>; routeId?: string; saving: boolean; saved: string
  layoverPreference: 'airport_only' | 'consider_city'; onLayoverPreference: (value: 'airport_only' | 'consider_city') => void
  onAdoptOffer: (artifact: ArtifactEnvelope, offerId: string) => void; onRetry: () => void; onSave: (routeId: string) => void
}) {
  if (view.kind === 'guest') return <EmptyState icon='user' title='登录后查看行程' description='登录后可以读取已保存的路线、攻略与航班结果。' actionLabel='前往我的行程' onAction={() => Taro.switchTab({ url: '/pages/trips/index' })} />
  if (view.kind === 'missing') return <EmptyState icon='calendar' title='这条行程链接已经失效' description='请从规划结果或“我的行程”重新打开。' actionLabel='查看我的行程' onAction={() => Taro.switchTab({ url: '/pages/trips/index' })} />
  if (view.kind === 'loading') return <View className='route-production__loading' role='status'><View className='route-production__loading-line' /><Text className='route-production__state-title'>{t('trip.loading')}</Text><Text className='ux-muted'>{t('trip.saved')}</Text></View>
  if (view.kind === 'error') return <EmptyState icon='calendar' title={t('trip.loadFailed')} description={t('trip.requestFailed')} actionLabel={t('trip.refresh')} onAction={onRetry} />
  if (view.kind === 'unavailable') return <EmptyState icon='calendar' title='此内容暂时无法展示' description={unavailableCopy(view)} />
  if (view.kind === 'route-set') return <><RouteWorkspace routes={view.routes} initialRouteId={routeId} onSave={onSave}
    saving={saving} layoverPreference={layoverPreference} onLayoverPreference={onLayoverPreference} />{(saving || saved) && <Text className='route-production__save-state'>{saving ? '正在保存…' : saved}</Text>}</>
  if (view.kind === 'flight-list') return <FlightSearchCard artifact={view.artifact} onAction={() => Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodeURIComponent(view.artifact.id)}` })} />
  if (view.kind === 'flight-detail') return <FlightDetail artifact={view.artifact} offerId={view.offerId} adopting={saving}
    layoverPreference={layoverPreference} onLayoverPreference={onLayoverPreference} onAdopt={() => onAdoptOffer(view.artifact, view.offerId)} />
  return <ResearchWorkspace artifact={view.artifact} />
}
export default observer(RoutePage)
