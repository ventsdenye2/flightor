import { useEffect, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { listExplore, startExplore, type ExploreTemplate } from '../../services/exploreService'
import { getCloudWorkspace } from '../../services/workspaceService'
import { userStore } from '../../stores/userStore'
import { chatStore } from '../../stores/chatStore'
import LoginSheet from '../../components/common/LoginSheet'
import { useProductionTab } from '../../components/navigation/ProductionTabBar'
import ProductionExplorePage from '../../features/ui-experience/ProductionExplorePage'
import './index.scss'

function ExplorePage() {
  useProductionTab('explore')
  const [category, setCategory] = useState('')
  const [items, setItems] = useState<ExploreTemplate[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState(''), [startError, setStartError] = useState('')
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [login, setLogin] = useState(false)
  const listGeneration = useRef(0), startGeneration = useRef(0)
  const activeStart = useRef<{ revision: number } | null>(null)
  const seedKeys = useRef(new Map<string, string>())
  const pendingStart = useRef<ExploreTemplate | null>(null)
  const sessionRevision = userStore.sessionRevision
  useEffect(() => {
    if (activeStart.current && activeStart.current.revision !== sessionRevision) {
      startGeneration.current++; activeStart.current = null; setBusy(false); setStartError('')
    }
    void load()
    return () => { listGeneration.current++ }
  }, [category, sessionRevision])
  useEffect(() => () => { startGeneration.current++; activeStart.current = null; pendingStart.current = null }, [])

  async function load(before?: string) {
    const current = ++listGeneration.current
    setLoading(true); setError('')
    if (!before) { setItems([]); setNext(null) }
    try {
      const result = await listExplore(category, before)
      if (current !== listGeneration.current) return
      setItems(old => before ? Array.from(new Map([...old, ...result.templates].map(item => [item.id, item])).values()) : result.templates)
      setNext(result.nextCursor)
    } catch (failure) {
      if (current === listGeneration.current) setError(failure instanceof Error ? failure.message : '旅行灵感暂时无法加载，请稍后重试。')
    } finally { if (current === listGeneration.current) setLoading(false) }
  }

  async function start(item: ExploreTemplate) {
    const owner = userStore.profile?.uid, revision = userStore.sessionRevision
    if (!owner) { pendingStart.current = item; setLogin(true); return }
    if (activeStart.current?.revision === revision) return
    const current = ++startGeneration.current
    const isCurrent = () => current === startGeneration.current && owner === userStore.profile?.uid && revision === userStore.sessionRevision
    activeStart.current = { revision }; setBusy(true); setStartError('')
    const identity = `${owner}:${item.id}:${item.version}`
    let key = seedKeys.current.get(identity)
    if (!key) {
      key = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => { const digit = Math.floor(Math.random() * 16); return (value === 'x' ? digit : (digit & 3) | 8).toString(16) })
      seedKeys.current.set(identity, key)
    }
    try {
      const result = await startExplore(item, key)
      if (!isCurrent()) return
      const workspace = await getCloudWorkspace(result.tripId, result.conversationId)
      if (!isCurrent()) return
      chatStore.openCloudWorkspace(workspace, owner)
      await Taro.switchTab({ url: '/pages/plan/index' })
    } catch (failure) {
      if (isCurrent()) setStartError(failure instanceof Error ? failure.message : '暂时无法开始规划，请重试。')
    } finally { if (current === startGeneration.current) { activeStart.current = null; setBusy(false) } }
  }

  return <View className='ux-app ux-screen production-main-page explore-production'>
    <ProductionExplorePage items={items} category={category} onCategoryChange={setCategory} loading={loading} error={error} onRetry={() => void load()} hasMore={Boolean(next)} onLoadMore={() => next && !loading && void load(next)} busy={busy} startError={startError} onStart={item => void start(item)} onOpenSource={url => { void Taro.setClipboardData({ data: url }).catch(() => Taro.showToast({ title: '复制来源链接失败，请重试', icon: 'none' })) }} />
    <LoginSheet visible={login} onClose={() => setLogin(false)} onSuccess={() => { const item = pendingStart.current; pendingStart.current = null; if (item) void start(item) }} />
  </View>
}
export default observer(ExplorePage)
