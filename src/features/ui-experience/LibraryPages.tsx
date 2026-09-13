import { useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import { Icon, Photo } from './VisualMedia'
import { formatTripDates, tripDurationLabel, travelerLabel } from './presentation'
import type { TripPresentation } from './presentation'
import type { CloudWorkspace, WorkspaceTrip } from '../../services/workspaceService'
import type { CloudArtifactRef } from '../../services/conversationService'
import type { Locale } from '../../i18n'
import { DemoNote, EmptyState, PageHeader, Sheet } from './SharedUI'
import './library.scss'

export interface SavedInspiration { id: string; title: string; subtitle: string; photo?: string | null; photoDescription?: string }
export interface PriceAlert { id: number; route: string; targetPrice: number; date: string; active: boolean }

interface CloudTripsPageProps {
  signedIn: boolean
  trips: WorkspaceTrip[]
  filter?: WorkspaceTrip['status']
  loading: boolean
  busy: boolean
  error?: string
  hasMore: boolean
  workspace: CloudWorkspace | null
  locale: Locale
  onLogin: () => void
  onPlan: () => void
  onFilter: (status?: WorkspaceTrip['status']) => void
  onRetry: () => void
  onLoadMore: () => void
  onOpenTrip: (trip: WorkspaceTrip, conversationId?: string) => void
  onDetails: (trip: WorkspaceTrip) => void
  onArchive: (trip: WorkspaceTrip) => void
  onSavedRoute: (trip: WorkspaceTrip) => void
  onArtifact: (artifact: CloudArtifactRef) => void
  onCloseWorkspace: () => void
}

/** The production library receives cloud records; it never supplies sample trips. */
export function CloudTripsPage(props: CloudTripsPageProps) {
  const { trips, filter, loading, busy, error, workspace, locale } = props
  const en = locale === 'en'
  const statusLabels = en
    ? { planning: 'Planning', generated: 'Generated', saved: 'Saved', archived: 'Archived' }
    : { planning: '正在规划', generated: '已生成', saved: '已保存', archived: '已归档' }
  const artifactLabels: Record<string, string> = en
    ? { route_set: 'Route options', route: 'Trip outline', travel_guide: 'Daily guide', research: 'Destination research', flight_search: 'Flight search', destination_set: 'Destination ideas', activity: 'Activity' }
    : { route_set: '路线结果', route: '行程大纲', travel_guide: '每日攻略', research: '目的地资料', flight_search: '航班搜索', destination_set: '目的地建议', activity: '活动' }
  const date = (value: string) => {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? (en ? 'Date unavailable' : '日期待确认') : parsed.toLocaleDateString(en ? 'en-GB' : 'zh-CN')
  }
  return <>
    <PageHeader title={en ? 'My trips' : '我的行程'} action={<Button className='ux-text-button' disabled={busy} onClick={props.onPlan}>{en ? 'New trip' : '新建行程'}<Icon name='arrow-right' /></Button>} />
    <View className='ux-scroll ui-page lb-cloud-page'>
      <Text className='ui-display'>{en ? 'Keep your next journey close.' : '把期待，排进日历。'}</Text>
      <Text className='ux-muted'>{en ? 'Your saved plans, ready to pick up again.' : '计划好的远方，随时回来接着安排。'}</Text>
      {!props.signedIn ? <EmptyState icon='calendar' title={en ? 'Your trips travel with you' : '让旅行计划，跟着你走'} description={en ? 'Sign in to view your trips and continue previous conversations.' : '登录后查看已保存的行程，从上次的对话继续安排。'} actionLabel={en ? 'Sign in' : '登录与同步'} onAction={props.onLogin} /> : <>
        <View className='ui-segment lb-cloud-filters'>{([undefined, 'planning', 'generated', 'saved', 'archived'] as const).map(status => <Button key={status ?? 'all'} className={`ui-segment-button ${filter === status ? 'is-active' : ''}`} aria-pressed={filter === status} disabled={busy} onClick={() => props.onFilter(status)}>{status ? statusLabels[status] : en ? 'All' : '全部'}</Button>)}</View>
        {error ? <View className='ui-inline-notice lb-cloud-error' role='alert'><Text>{error}</Text><Button className='ux-text-button' disabled={loading} onClick={props.onRetry}>{en ? 'Try again' : '重新加载'}</Button></View> : null}
        {loading ? <View className='lb-cloud-loading' role='status'><View className='lb-cloud-loading-dot' /><Text>{en ? 'Loading your trips…' : '正在读取你的行程…'}</Text></View> : null}
        {!loading && !error && !trips.length ? <EmptyState icon='calendar' title={filter === 'archived' ? (en ? 'Memories will gather here' : '让回忆慢慢积累') : (en ? 'Your next stop is still unwritten' : '下一站，还没写下')} description={filter === 'archived' ? (en ? 'Archived trips stay here and can be restored anytime.' : '归档后的行程会留在这里，随时可以恢复。') : (en ? 'No trips in this category yet. Start with a place you want to visit.' : '还没有此类行程。说说想去的地方，从一个旅行念头开始。')} actionLabel={filter === 'archived' ? (en ? 'View all trips' : '查看全部行程') : (en ? 'Start planning' : '开始规划')} onAction={filter === 'archived' ? () => props.onFilter(undefined) : props.onPlan} /> : null}
        <View className='lb-cloud-list'>{trips.map(trip => <View key={trip.id} className='lb-trip lb-cloud-trip'>
          <View className='lb-cloud-card-top'><View className='lb-cloud-trip-mark'><Icon name='calendar' /></View><Text className={`lb-cloud-status lb-cloud-status--${trip.status}`}>{statusLabels[trip.status]}</Text></View>
          <View className='lb-trip-body'><Button className='lb-cloud-open' disabled={busy} onClick={() => props.onOpenTrip(trip)}><Text className='ui-display'>{trip.title || (en ? 'Untitled trip' : '未命名行程')}</Text><Text className='ux-muted'>{en ? 'Updated ' : '更新于 '}{date(trip.updatedAt)}</Text></Button>
            {trip.savedRoute ? <Button className='lb-cloud-saved' disabled={busy} onClick={() => props.onSavedRoute(trip)}><Icon name='bookmark' /><Text>{en ? 'View saved route' : '查看保存的路线'}{trip.savedRoute.contextVersion !== trip.contextVersion ? (en ? ' · Preferences changed' : ' · 条件已变更') : ''}</Text><Icon name='chevron-right' /></Button> : null}
            <View className='lb-trip-footer'><Button className='ux-text-button' disabled={busy} onClick={() => props.onDetails(trip)}>{en ? 'Conversations & results' : '对话与结果'}</Button><Button className='ux-text-button' disabled={busy} onClick={() => props.onOpenTrip(trip)}>{en ? 'Continue planning' : '继续安排'}<Icon name='arrow-right' /></Button></View>
            <Button className='ux-text-button lb-cloud-archive' disabled={busy} onClick={() => props.onArchive(trip)}>{trip.status === 'archived' ? (en ? 'Restore trip' : '恢复行程') : (en ? 'Archive trip' : '归档行程')}</Button>
          </View>
        </View>)}</View>
        {props.hasMore && !loading ? <Button className='ux-secondary lb-cloud-more' disabled={busy} onClick={props.onLoadMore}>{en ? 'Load more' : '加载更多行程'}</Button> : null}
        {!loading && trips.length ? <Text className='ux-caption lb-cloud-note'>{en ? 'Trips and conversations are saved to your account.' : '行程与对话已保存在当前账户，换个设备也能继续。'}</Text> : null}
      </>}
    </View>
    {props.signedIn && workspace ? <Sheet title={workspace.trip.title || (en ? 'Trip contents' : '行程内容')} onClose={props.onCloseWorkspace}>
      <Text className='ux-section-title'>{en ? 'Conversations' : '规划对话'}</Text>
      {workspace.conversations.length ? workspace.conversations.map(conversation => <Button className='lb-cloud-detail-row' key={conversation.id} disabled={busy} onClick={() => props.onOpenTrip(workspace.trip, conversation.id)}><Icon name='compass' /><Text>{conversation.title || `${en ? 'Conversation' : '对话'} · ${date(conversation.createdAt)}`}</Text><Icon name='chevron-right' /></Button>) : <Text className='ux-muted'>{en ? 'No conversations yet.' : '还没有规划对话。'}</Text>}
      <Text className='ux-section-title lb-cloud-detail-heading'>{en ? 'Saved results' : '已保存的结果'}</Text>
      {workspace.artifactRefs.length ? workspace.artifactRefs.map(artifact => <Button className='lb-cloud-detail-row' key={artifact.id} disabled={busy} onClick={() => props.onArtifact(artifact)}><Icon name='bookmark' /><Text>{artifactLabels[artifact.type] || (en ? 'Result' : '结果')}</Text><Icon name='chevron-right' /></Button>) : <Text className='ux-muted'>{en ? 'Results will appear after planning.' : '继续规划后，生成的结果会留在这里。'}</Text>}
    </Sheet> : null}
  </>
}

export function TripsPage({ trip, onOpenTrip, onPlan, archived, onArchive }: { trip: TripPresentation; onOpenTrip: () => void; onPlan: () => void; archived: boolean; onArchive: (value: boolean) => void }) {
  const dateParts = trip.dates.start?.match(/^\d{4}-(\d{2})-(\d{2})$/)
  const [filter, setFilter] = useState('upcoming')
  const [menu, setMenu] = useState(false)
  const visible = filter === 'archived' ? archived : !archived
  return <><PageHeader title='我的行程' action={<Button className='ux-text-button' onClick={onPlan}>新建行程<Icon name='arrow-right' /></Button>} />
    <View className='ux-scroll ui-page'>
      <Text className='ui-display'>把期待，排进日历。</Text><Text className='ux-muted'>计划好的远方，随时回来接着安排。</Text>
      <View className='ui-segment'>{[{ id: 'upcoming', text: '待出发' }, { id: 'archived', text: '已归档' }].map(item => <Button key={item.id} aria-pressed={filter === item.id} className={`ui-segment-button ${filter === item.id ? 'is-active' : ''}`} onClick={() => setFilter(item.id)}>{item.text}</Button>)}</View>
      {visible ? <View className='lb-trip'>
        <Button className='lb-trip-cover' ariaLabel={`打开${trip.destination}行程`} onClick={onOpenTrip}><Photo src={trip.cover?.src} description={trip.cover?.description || '图片待补充'} className='lb-trip-photo' retry={false} />{dateParts ? <View className='lb-date-stamp'><Text>{Number(dateParts[1])} 月</Text><Text>{dateParts[2]}</Text></View> : null}</Button>
        <View className='lb-trip-body'><View className='lb-trip-title'><View><Text className='ui-display'>{trip.title}</Text><Text className='ux-muted'>{formatTripDates(trip)} · {tripDurationLabel(trip)} · {travelerLabel(trip)}</Text></View><Button className='ux-icon-button' ariaLabel={`管理${trip.destination}行程`} onClick={() => setMenu(true)}><Icon name='info' /></Button></View>
          <View className='lb-trip-route'><Text>{trip.route[0] || '出发地待确认'}</Text><Icon name='plane' /><Text>{trip.destination}</Text></View>
          <View className='lb-trip-footer'><Text className='ux-caption'>示例行程 · 待核验</Text><Button className='ux-text-button' onClick={onOpenTrip}>继续安排<Icon name='arrow-right' /></Button></View>
        </View>
      </View> : <EmptyState icon='calendar' title={filter === 'archived' ? '让回忆慢慢积累' : '下一站，还没写下'} description={filter === 'archived' ? '归档后的行程会留在这里，随时可以恢复。' : '说说想去的地方，从一个旅行念头开始。'} actionLabel={filter === 'archived' ? '查看待出发行程' : '开始规划'} onAction={filter === 'archived' ? () => setFilter('upcoming') : onPlan} />}
      <DemoNote text='此行程为固定设计示例。归档和恢复仅在本次预览保留。' />
    </View>
    {menu ? <Sheet title='管理这次旅行' onClose={() => setMenu(false)}><Text className='ux-muted'>归档会将行程移到“已归档”，日程内容仍会保留。</Text><Button className='ux-primary' onClick={() => { onArchive(!archived); setMenu(false); setFilter(archived ? 'upcoming' : 'archived') }}>{archived ? '恢复到待出发' : '归档行程'}</Button></Sheet> : null}
  </>
}

export function CollectionsPage({ trip, savedTrip, items, onBack, onOpenTrip, onOpenItem, onToggleTrip, onToggleItem, onExplore }: { trip: TripPresentation; savedTrip: boolean; items: SavedInspiration[]; onBack: () => void; onOpenTrip: () => void; onOpenItem: (id: string) => void; onToggleTrip: () => void; onToggleItem: (id: string) => void; onExplore: () => void }) {
  const [tab, setTab] = useState('all')
  const [removed, setRemoved] = useState<string | null>(null)
  const showTrip = savedTrip && tab !== 'inspiration'
  const shown = tab === 'trips' ? [] : items
  return <><PageHeader title='我的收藏' onBack={onBack} /><View className='ux-scroll ui-page'>
    <Text className='ui-display'>留给下一次出发。</Text><Text className='ux-muted'>喜欢的去处和行程，在这里相遇。</Text>
    <View className='ui-segment'>{[{ id: 'all', label: '全部' }, { id: 'inspiration', label: '灵感' }, { id: 'trips', label: '行程' }].map(item => <Button key={item.id} className={`ui-segment-button ${tab === item.id ? 'is-active' : ''}`} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}</View>
    {showTrip ? <View className='lb-saved-row'><Button className='lb-saved-open' onClick={onOpenTrip}><Photo src={trip.cover?.src} description={trip.cover?.description || '图片待补充'} className='lb-saved-photo' retry={false} /><View><Text className='ux-section-title'>{trip.title}</Text><Text className='ux-muted'>{tripDurationLabel(trip)} · {travelerLabel(trip)} · 示例行程</Text></View></Button><Button className='ux-icon-button' ariaLabel={`取消收藏${trip.destination}行程`} onClick={() => { onToggleTrip(); setRemoved('trip') }}><Icon name='bookmark-filled' /></Button></View> : null}
    {shown.map(item => <View className='lb-saved-row' key={item.id}><Button className='lb-saved-open' onClick={() => onOpenItem(item.id)}><Photo src={item.photo} description={item.photoDescription || '图片待补充'} className='lb-saved-photo' retry={false} /><View><Text className='ux-section-title'>{item.title}</Text><Text className='ux-muted'>{item.subtitle}</Text></View></Button><Button className='ux-icon-button' ariaLabel={`取消收藏${item.title}`} onClick={() => { onToggleItem(item.id); setRemoved(item.id) }}><Icon name='bookmark-filled' /></Button></View>)}
    {!showTrip && !shown.length ? <EmptyState icon='bookmark' title='还没有收藏' description='在探索或行程详情中点亮书签，把喜欢的地方留在这里。' actionLabel='去探索' onAction={onExplore} /> : null}
    {removed ? <View className='ux-undo'><Text>已取消收藏</Text><Button className='ux-text-button' onClick={() => { if (removed === 'trip') onToggleTrip(); else onToggleItem(removed); setRemoved(null) }}>撤销</Button></View> : null}
    <DemoNote text='收藏仅在本次预览保留，尚未同步到账户。' />
  </View></>
}

export function AlertsPage({ alerts, onBack, onSearch, onUpdate, onRemove, onRestore }: { alerts: PriceAlert[]; onBack: () => void; onSearch: () => void; onUpdate: (alert: PriceAlert) => void; onRemove: (id: number) => void; onRestore: (alert: PriceAlert) => void }) {
  const [editing, setEditing] = useState<PriceAlert | null>(null)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [removed, setRemoved] = useState<PriceAlert | null>(null)
  return <><PageHeader title='价格提醒' onBack={onBack} action={<Button className='ux-text-button' onClick={onSearch}>新建</Button>} /><View className='ux-scroll ui-page'>
    <Text className='ui-display'>给心动的价格，留个位置。</Text><Text className='ux-muted'>设置目标价，整理你正在关注的航线。</Text>
    <View className='ui-inline-notice'>当前仅演示提醒设置，不监测票价，也不会发送通知。</View>
    {!alerts.length ? <EmptyState icon='plane' title='还没有关注的航线' description='在航班搜索结果中选择“价格提醒”，设一个合适的目标价。' actionLabel='查找航班' onAction={onSearch} /> : alerts.map(alert => <View className='lb-alert' key={alert.id}>
      <View className='lb-alert-heading'><Icon name='plane' /><Text className='ux-section-title'>{alert.route}</Text></View><Text className='ux-muted'>{alert.date} · 单人单程 · 经济舱</Text>
      <View className='lb-alert-price'><View><Text className='ux-caption'>目标价格</Text><Text className='ux-price'>¥{alert.targetPrice.toLocaleString()}</Text></View><Button className={`ui-pill ${alert.active ? 'is-active' : ''}`} ariaLabel={`${alert.active ? '暂停' : '启用'}${alert.route}示例提醒`} aria-pressed={alert.active} onClick={() => onUpdate({ ...alert, active: !alert.active })}>{alert.active ? '已设定 · 演示' : '已暂停'}</Button></View>
      <View className='lb-alert-actions'><Button className='ux-text-button' onClick={() => { setEditing(alert); setAmount(String(alert.targetPrice)); setError('') }}>修改目标价</Button><Button className='ux-text-button ui-danger' onClick={() => { onRemove(alert.id); setRemoved(alert) }}>删除提醒</Button></View>
    </View>)}
    {removed ? <View className='ux-undo'><Text>已删除这条提醒</Text><Button className='ux-text-button' onClick={() => { onRestore(removed); setRemoved(null) }}>撤销</Button></View> : null}
    <DemoNote text='提醒设置仅在本次预览保留。' />
  </View>{editing ? <Sheet title='修改目标价格' onClose={() => setEditing(null)}><Text className='ux-muted'>{editing.route} · {editing.date}</Text><View className='ui-form-field'><Text>目标价格（人民币 / 人）</Text><Input ariaLabel='修改提醒目标价格' type='digit' value={amount} maxlength={6} onInput={event => setAmount(event.detail.value)} /></View>{error ? <View className='ui-danger' role='alert'>{error}</View> : null}<Button className='ux-primary' onClick={() => { const price = Number(amount); if (!/^\d+$/.test(amount) || !Number.isFinite(price) || price < 1 || price > 999999 || !Number.isInteger(price)) { setError('请输入 1–999999 之间的整数价格'); return }; onUpdate({ ...editing, targetPrice: price }); setEditing(null) }}>保存目标价格</Button></Sheet> : null}</>
}
