import { useEffect, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { chatStore } from '../../stores/chatStore'
import { userStore } from '../../stores/userStore'
import { ensureWorkspaceConversation, getCloudWorkspace, listCloudTrips, updateCloudTrip, type CloudWorkspace, type WorkspaceTrip } from '../../services/workspaceService'
import LoginSheet from '../../components/common/LoginSheet'
import { useProductionTab } from '../../components/navigation/ProductionTabBar'
import { CloudTripsPage } from '../../features/ui-experience/LibraryPages'
import { localeStore } from '../../i18n'
import '../../features/ui-experience/experience.scss'
import './index.scss'

function TripsPage() {
  useProductionTab('trips')
  const [filter, setFilter] = useState<WorkspaceTrip['status'] | undefined>()
  const [view, setView] = useState<{ key: string; trips: WorkspaceTrip[]; next: string | null; error?: string }>({ key: '', trips: [], next: null })
  const [workspace, setWorkspace] = useState<{ key: string; value: CloudWorkspace } | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [revision, setRevision] = useState(0)
  const ownerId = userStore.profile?.uid
  const key = `${ownerId ?? ''}:${userStore.sessionRevision}:${filter ?? ''}`
  const currentKey = useRef(key); currentKey.current = key
  const requestId = useRef(0)
  useDidShow(() => setRevision(x => x + 1))
  useEffect(() => { void load() }, [key, revision])
  async function load(before?: string) {
    const id = ++requestId.current
    if (!ownerId) { setLoading(false); return }
    setLoading(true)
    try {
      const result = await listCloudTrips(filter, before)
      if (currentKey.current !== key || requestId.current !== id) return
      setView(v => ({ key, trips: before && v.key === key ? [...v.trips, ...result.trips] : result.trips, next: result.nextCursor }))
    } catch (error) {
      if (currentKey.current === key && requestId.current === id) setView(v => ({ key, trips: v.key === key ? v.trips : [], next: v.key === key ? v.next : null, error: error instanceof Error ? error.message : '加载失败' }))
    } finally { if (currentKey.current === key && requestId.current === id) setLoading(false) }
  }
  async function open(trip: WorkspaceTrip, conversationId?: string) {
    if (busy || !ownerId) return
    setBusy(true)
    const authRevision = userStore.sessionRevision
    try {
      const data = await ensureWorkspaceConversation(await getCloudWorkspace(trip.id, conversationId))
      if (currentKey.current !== key || userStore.sessionRevision !== authRevision || userStore.profile?.uid !== ownerId) return
      chatStore.openCloudWorkspace(data, ownerId)
      await Taro.switchTab({ url: '/pages/plan/index' })
    } catch (error) { if (currentKey.current === key) Taro.showToast({ title: error instanceof Error ? error.message : '恢复失败', icon: 'none' }) }
    finally { setBusy(false) }
  }
  async function details(trip: WorkspaceTrip) {
    if (busy) return
    setBusy(true)
    try { const value = await getCloudWorkspace(trip.id); if (currentKey.current === key) setWorkspace({ key, value }) }
    catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' }) }
    finally { setBusy(false) }
  }
  async function archive(trip: WorkspaceTrip) {
    if (busy) return
    setBusy(true)
    try {
      await updateCloudTrip(trip.id, { expectedVersion: trip.version, status: trip.status === 'archived' ? 'planning' : 'archived' })
      if (currentKey.current === key) { setWorkspace(null); await load() }
    } catch (error) { Taro.showToast({ title: error instanceof Error ? error.message : '更新失败', icon: 'none' }) }
    finally { setBusy(false) }
  }
  const trips = view.key === key ? view.trips : []
  const detail = workspace?.key === key ? workspace.value : null
  return <View className='ux-app production-main-page trips-production'>
    <View className='ux-screen'><CloudTripsPage signedIn={Boolean(ownerId)} trips={trips} filter={filter} loading={loading} busy={busy}
      error={view.key === key ? view.error : undefined} hasMore={view.key === key && Boolean(view.next)} workspace={detail} locale={localeStore.locale}
      onLogin={() => setShowLogin(true)} onPlan={() => { chatStore.reset(); void Taro.switchTab({ url: '/pages/plan/index' }) }}
      onFilter={status => { setFilter(status); setWorkspace(null) }} onRetry={() => void load()} onLoadMore={() => { if (view.key === key && view.next) void load(view.next) }}
      onOpenTrip={(trip, conversationId) => void open(trip, conversationId)} onDetails={trip => void details(trip)} onArchive={trip => void archive(trip)}
      onSavedRoute={trip => { if (trip.savedRoute) void Taro.navigateTo({ url: `/pages/route/index?artifactId=${encodeURIComponent(trip.savedRoute.artifactId)}&routeId=${encodeURIComponent(trip.savedRoute.routeId)}` }) }}
      onArtifact={artifact => void Taro.navigateTo({ url: `${artifact.type === 'flight_search' ? '/pages/search/index' : '/pages/route/index'}?artifactId=${encodeURIComponent(artifact.id)}` })}
      onCloseWorkspace={() => setWorkspace(null)} /></View>
    <LoginSheet visible={showLogin} onClose={() => setShowLogin(false)} />
  </View>
}
export default observer(TripsPage)
