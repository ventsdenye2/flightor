import { useEffect, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { listExplore, startExplore, type ExploreTemplate } from '../../services/exploreService'
import { getCloudWorkspace } from '../../services/workspaceService'
import { userStore } from '../../stores/userStore'
import { chatStore } from '../../stores/chatStore'
import LoginSheet from '../../components/common/LoginSheet'
import './index.scss'

const categories = { event: '活动', seasonal: '应季', theme: '主题', stopover: '中转体验', deal: '旅行机会' }
function ExplorePage() {
  const [category, setCategory] = useState(''), [items, setItems] = useState<ExploreTemplate[]>([]), [next, setNext] = useState<string | null>(null)
  const [selected, setSelected] = useState<ExploreTemplate | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [login, setLogin] = useState(false)
  const generation = useRef(0), seedKeys = useRef(new Map<string, string>())
  useEffect(() => { void load(); return () => { generation.current++ } }, [category])
  async function load(before?: string) {
    const current = ++generation.current
    setLoading(true); setError('')
    if (!before) { setItems([]); setSelected(null) }
    try { const result = await listExplore(category, before); if (current === generation.current) { setItems(old => before ? [...old, ...result.templates] : result.templates); setNext(result.nextCursor) } }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : '加载失败') }
    finally { if (current === generation.current) setLoading(false) }
  }
  async function start(item: ExploreTemplate) {
    const owner = userStore.profile?.uid, revision = userStore.sessionRevision, current = generation.current
    if (!owner) { setLogin(true); return }
    if (busy) return
    setBusy(true)
    const identity = `${owner}:${item.id}:${item.version}`
    // This UUID identifies a retry, not a secret or an authorization credential.
    let key = seedKeys.current.get(identity)
    if (!key) { key = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16) }); seedKeys.current.set(identity, key) }
    try {
      const result = await startExplore(item, key), workspace = await getCloudWorkspace(result.tripId, result.conversationId)
      if (owner !== userStore.profile?.uid || revision !== userStore.sessionRevision || current !== generation.current) return
      chatStore.openCloudWorkspace(workspace, owner)
      await Taro.switchTab({ url: '/pages/plan/index' })
    } catch (e) { setError(e instanceof Error ? e.message : '暂时无法开始规划') }
    finally { setBusy(false) }
  }
  return <View className='explore-page'>
    <View className='explore-page__header'><Text className='explore-page__title'>值得出发的灵感</Text><Text>从一场活动、一个季节，开始你的下一段旅行。</Text></View>
    <View className='explore-filters'>{[['', '全部'], ...Object.entries(categories)].map(([id, label]) => <View className={category === id ? 'active' : ''} key={id} onClick={() => setCategory(id)}>{label}</View>)}</View>
    {error && <View className='explore-error'><Text>{error}</Text><View onClick={() => load()}>重新加载</View></View>}
    {loading && <Text>正在寻找旅行灵感…</Text>}
    {!loading && !error && !items.length && <View className='explore-page__unavailable'>暂时没有有效的已审核内容，稍后再来看看。</View>}
    {items.map(item => <View className='explore-card' key={item.id} onClick={() => setSelected(item)}><Text className='explore-card__category'>{categories[item.template.category] || item.template.category} · 约 {item.template.suggestedDays} 天</Text><Text className='explore-card__title'>{item.template.title}</Text><Text>{item.template.summary}</Text><Text className='explore-card__date'>{item.template.validFrom} — {item.template.validTo}</Text><View className='explore-link'>查看灵感 →</View></View>)}
    {next && !loading && <View className='explore-link' onClick={() => load(next)}>加载更多</View>}
    {selected && <View className='explore-detail'><View className='explore-link' onClick={() => setSelected(null)}>收起详情</View><Text className='explore-card__title'>{selected.template.title}</Text><Text>{selected.template.routeConcept}</Text>{selected.template.experienceGoals.map(goal => <Text key={goal}>· {goal}</Text>)}<Text className='explore-card__date'>核验有效至 {selected.template.verification.expiresAt?.slice(0, 10) || '未知'}</Text>{selected.template.sourceFacts.map(fact => <View className='explore-fact' key={fact.id}><Text>{fact.statement}</Text>{fact.sourceUrls.map(url => <View className='explore-link' key={url} onClick={() => /^https?:\/\//i.test(url) && Taro.setClipboardData({ data: url })}>复制来源链接</View>)}</View>)}<Text>这是可调整的旅行建议。航班、报价与可行路线将在规划中重新查询。</Text><View className='explore-start' onClick={() => start(selected)}>{busy ? '正在打开…' : '用此灵感规划'}</View></View>}
    <LoginSheet visible={login} onClose={() => setLogin(false)} />
  </View>
}
export default observer(ExplorePage)
