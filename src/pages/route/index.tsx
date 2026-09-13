import { useEffect, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
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
import { loadProductionTrip } from '../../services/productionTripService'
import TripExperience from '../../features/ui-experience/TripExperience'
import type { TripPresentation } from '../../features/ui-experience/presentation'
import { safeSourceUrl } from '../../features/ui-experience/productionPresentation'
import './index.scss'

type State = { key: string; artifact?: ArtifactEnvelope; presentation?: TripPresentation; routes?: RouteView[]; error?: string }
function RoutePage() {
  const { params } = useRouter()
  const artifactId = params.artifactId ?? ''
  const ownerId = userStore.profile?.uid
  const key = `${ownerId ?? ''}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${artifactId}`
  const [state, setState] = useState<State>({ key: '' })
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const activeKey = useRef(key); activeKey.current = key
  useEffect(() => {
    void Taro.setNavigationBarTitle({ title: '行程详情' })
    let active = true
    setSaved(''); setSaving(false)
    if (!ownerId || !artifactId) return () => { active = false }
    setState({ key })
    const context = { ownerId, sessionId: chatStore.currentSessionId, force: attempt > 0 }
    artifactService.fetchArtifact(artifactId, context).then(async artifact => {
      if (!active) return
      if (artifact.type === 'route' || artifact.type === 'travel_guide') {
        const loaded = await loadProductionTrip(artifactId, context)
        if (active) setState({ key, artifact: loaded.route, presentation: loaded.presentation })
      } else setState({ key, artifact, ...(artifact.type === 'route_set' ? { routes: readRouteArtifact(artifact) } : {}) })
    }).catch(error => { if (active) setState({ key, error: error instanceof Error ? error.message : '加载失败，请重试' }) })
    return () => { active = false }
  }, [key, attempt])
  const current = state.key === key ? state : undefined
  const artifact = current?.artifact
  async function save(routeId: string) {
    if (!artifact || !ownerId || saving) return
    const revision = userStore.sessionRevision
    setSaving(true)
    try {
      const workspace = await getCloudWorkspace(artifact.tripId)
      if (activeKey.current !== key || userStore.profile?.uid !== ownerId || userStore.sessionRevision !== revision) return
      await updateCloudTrip(artifact.tripId, { expectedVersion: workspace.trip.version, savedRoute: { artifactId: artifact.id, routeId } })
      if (activeKey.current === key && userStore.profile?.uid === ownerId && userStore.sessionRevision === revision) setSaved('已保存到「我的行程」')
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
  const openSource = (url: string) => { const safe = safeSourceUrl(url); if (safe) void Taro.setClipboardData({ data: safe }).then(() => Taro.showToast({ title: '来源链接已复制', icon: 'none' })).catch(() => Taro.showToast({ title: '复制失败，请重试', icon: 'none' })) }
  if (ownerId && current?.presentation) return <View className='production-detail-page'>
    <TripExperience key={key} trip={current.presentation} production embedded onBack={() => Taro.navigateBack()} onContinuePlanning={() => void continuePlanning()} onOpenSource={openSource} />
  </View>
  return <View className='route-detail-page'>
    {!ownerId ? <Text>请登录后查看保存的行程。</Text> : !artifactId ? <Text>此旧链接无法恢复行程，请从航班搜索或规划结果重新打开。</Text> : current?.error ? <View><Text>{current.error}</Text><View className='route-workspace__action' onClick={() => setAttempt(x => x + 1)}>重试</View></View> : !artifact ? <Text>正在加载行程…</Text> : current.routes ? <RouteWorkspace key={key} routes={current.routes} initialRouteId={params.routeId} onSave={save} /> : current.presentation ? <TripExperience key={ownerId} trip={current.presentation} production embedded onBack={() => Taro.navigateBack()} onContinuePlanning={() => void continuePlanning()} onOpenSource={openSource} /> : artifact.type === 'flight_search' && resolveArtifactRenderer(artifact).supported ? params.offerId ? <FlightDetail artifact={artifact} offerId={params.offerId} /> : <FlightSearchCard artifact={artifact} onAction={() => Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodeURIComponent(artifact.id)}` })} /> : <ResearchWorkspace key={key} artifact={artifact} />}
    {(saving || saved) && <Text>{saving ? '正在保存…' : saved}</Text>}
    <View className='route-workspace__action' onClick={() => Taro.switchTab({ url: '/pages/trips/index' })}>查看我的行程</View>
    <View className='route-workspace__action' onClick={() => Taro.switchTab({ url: '/pages/plan/index' })}>返回规划</View>
  </View>
}
export default observer(RoutePage)
