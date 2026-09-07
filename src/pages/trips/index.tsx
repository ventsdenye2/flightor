import { useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { chatStore } from '../../stores/chatStore'
import { userStore } from '../../stores/userStore'
import { ensureWorkspaceConversation, getCloudWorkspace, listCloudTrips, updateCloudTrip, type CloudWorkspace, type WorkspaceTrip } from '../../services/workspaceService'
import LoginSheet from '../../components/common/LoginSheet'
import './index.scss'

const statuses = { planning: '正在规划', generated: '已生成', saved: '已保存', archived: '已归档' }
function TripsPage() {
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
  return <View className='trips-page'>
    <View className='trips-page__header'><Text className='trips-page__eyebrow'>FLIGHTOR / TRIPS</Text><Text className='trips-page__title'>我的行程</Text><Text className='trips-page__subtitle'>从任何设备继续规划，保存你选定的路线。</Text></View>
    {!ownerId ? <View className='trips-page__primary' onClick={() => setShowLogin(true)}>登录查看云端行程</View> : <>
      <View className='trips-page__filters'>{([undefined, 'planning', 'generated', 'saved', 'archived'] as const).map(s => <View key={s ?? 'all'} className={filter === s ? 'is-active' : ''} onClick={() => { setFilter(s); setWorkspace(null) }}>{s ? statuses[s] : '全部'}</View>)}</View>
      {view.key === key && view.error && <View className='trips-page__error'><Text>{view.error}</Text><View onClick={() => load()}>重试</View></View>}
      {loading && <Text>正在加载…</Text>}
      {!loading && !trips.length && <View className='trips-page__empty'><Text>还没有此类行程</Text></View>}
      {trips.map(trip => <View key={trip.id} className='trips-page__card'>
        <Text className='trips-page__status'>{statuses[trip.status]}</Text><Text className='trips-page__card-title'>{trip.title || '未命名行程'}</Text>
        <Text className='trips-page__summary'>更新于 {new Date(trip.updatedAt).toLocaleDateString()}</Text>
        {trip.savedRoute && <View className='trips-page__action' onClick={() => Taro.navigateTo({ url: `/pages/route/index?artifactId=${encodeURIComponent(trip.savedRoute!.artifactId)}&routeId=${encodeURIComponent(trip.savedRoute!.routeId)}` })}>查看保存的路线{trip.savedRoute.contextVersion !== trip.contextVersion ? ' · 条件已变更' : ''}</View>}
        <View className='trips-page__actions'><View onClick={() => !busy && open(trip)}>继续规划</View><View onClick={() => !busy && details(trip)}>对话与结果</View><View onClick={() => !busy && archive(trip)}>{trip.status === 'archived' ? '恢复' : '归档'}</View></View>
      </View>)}
      {view.key === key && view.next && !loading && <View className='trips-page__action' onClick={() => load(view.next!)}>加载更多</View>}
      {detail && <View className='trips-page__card'><Text className='trips-page__card-title'>{detail.trip.title || '行程内容'}</Text>
        {detail.conversations.map(c => <View className='trips-page__action' key={c.id} onClick={() => open(detail.trip, c.id)}>{c.title || `对话 · ${new Date(c.createdAt).toLocaleDateString()}`}</View>)}
        {detail.artifactRefs.map(a => <View className='trips-page__action' key={a.id} onClick={() => Taro.navigateTo({ url: `${a.type === 'flight_search' ? '/pages/search/index' : '/pages/route/index'}?artifactId=${encodeURIComponent(a.id)}` })}>{({ route_set: '路线结果', route: '行程大纲', travel_guide: '每日攻略', research: '目的地资料', flight_search: '航班搜索', destination_set: '目的地建议', activity: '活动' } as Record<string, string>)[a.type] || '结果'}</View>)}
        <View onClick={() => setWorkspace(null)}>收起</View>
      </View>}
    </>}
    <View className='trips-page__primary' onClick={() => { chatStore.reset(); Taro.switchTab({ url: '/pages/plan/index' }) }}>开始新的旅行</View>
    <LoginSheet visible={showLogin} onClose={() => setShowLogin(false)} />
  </View>
}
export default observer(TripsPage)
