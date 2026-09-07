import { useEffect, useState } from 'react'
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
import { getCloudWorkspace, updateCloudTrip } from '../../services/workspaceService'
import './index.scss'

type State = { key: string; artifact?: ArtifactEnvelope; routes?: RouteView[]; error?: string }
function RoutePage() {
  const { params } = useRouter()
  const artifactId = params.artifactId ?? ''
  const ownerId = userStore.profile?.uid
  const key = `${ownerId ?? ''}:${userStore.sessionRevision}:${chatStore.currentSessionId}:${artifactId}`
  const [state, setState] = useState<State>({ key: '' })
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: '行程详情' })
    let active = true
    if (!ownerId || !artifactId) return () => { active = false }
    setState({ key })
    artifactService.fetchArtifact(artifactId, { ownerId, sessionId: chatStore.currentSessionId, force: attempt > 0 }).then(artifact => {
      if (!active) return
      setState({ key, artifact, ...(artifact.type === 'route_set' ? { routes: readRouteArtifact(artifact) } : {}) })
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
      if (userStore.profile?.uid !== ownerId || userStore.sessionRevision !== revision) return
      await updateCloudTrip(artifact.tripId, { expectedVersion: workspace.trip.version, savedRoute: { artifactId: artifact.id, routeId } })
      if (userStore.profile?.uid === ownerId && userStore.sessionRevision === revision) setSaved('已保存到「我的行程」')
    } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' }) }
    finally { setSaving(false) }
  }
  return <View className='route-detail-page'>
    {!ownerId ? <Text>请登录后查看保存的行程。</Text> : !artifactId ? <Text>此旧链接无法恢复行程，请从航班搜索或规划结果重新打开。</Text> : current?.error ? <View><Text>{current.error}</Text><View className='route-workspace__action' onClick={() => setAttempt(x => x + 1)}>重试</View></View> : !artifact ? <Text>正在加载行程…</Text> : current.routes ? <RouteWorkspace key={key} routes={current.routes} initialRouteId={params.routeId} onSave={save} /> : artifact.type === 'flight_search' && resolveArtifactRenderer(artifact).supported ? params.offerId ? <FlightDetail artifact={artifact} offerId={params.offerId} /> : <FlightSearchCard artifact={artifact} onAction={() => Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodeURIComponent(artifact.id)}` })} /> : <ResearchWorkspace key={key} artifact={artifact} />}
    {(saving || saved) && <Text>{saving ? '正在保存…' : saved}</Text>}
    <View className='route-workspace__action' onClick={() => Taro.switchTab({ url: '/pages/plan/index' })}>返回规划</View>
    <Text className='route-workspace__disclaimer'>签证、过境及入境条件可能因护照、行程和政策变化而不同，请在出行前自行确认最新要求。</Text>
  </View>
}
export default observer(RoutePage)
