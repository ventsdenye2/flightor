import { Button, Text, View } from '@tarojs/components'
import { Icon } from './VisualMedia'
import type { CloudWorkspace, WorkspaceTrip } from '../../services/workspaceService'
import type { CloudArtifactRef } from '../../services/conversationService'
import type { Locale } from '../../i18n'
import { EmptyState, PageHeader, Sheet } from './SharedUI'
import './library.scss'

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
