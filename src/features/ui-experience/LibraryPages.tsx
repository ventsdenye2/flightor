import { useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import { Icon, Photo } from './VisualMedia'
import { media } from './media'
import { DemoNote, EmptyState, PageHeader, Sheet } from './SharedUI'
import './library.scss'

export interface SavedInspiration { id: string; title: string; subtitle: string; photo: string }
export interface PriceAlert { id: number; route: string; targetPrice: number; date: string; active: boolean }

export function TripsPage({ onOpenTrip, onPlan, archived, onArchive }: { onOpenTrip: () => void; onPlan: () => void; archived: boolean; onArchive: (value: boolean) => void }) {
  const [filter, setFilter] = useState('upcoming')
  const [menu, setMenu] = useState(false)
  const visible = filter === 'archived' ? archived : !archived
  return <><PageHeader title='我的行程' action={<Button className='ux-text-button' onClick={onPlan}>新建行程<Icon name='arrow-right' /></Button>} />
    <View className='ux-scroll ui-page'>
      <Text className='ui-display'>把期待，排进日历。</Text><Text className='ux-muted'>计划好的远方，随时回来接着安排。</Text>
      <View className='ui-segment'>{[{ id: 'upcoming', text: '待出发' }, { id: 'archived', text: '已归档' }].map(item => <Button key={item.id} aria-pressed={filter === item.id} className={`ui-segment-button ${filter === item.id ? 'is-active' : ''}`} onClick={() => setFilter(item.id)}>{item.text}</Button>)}</View>
      {visible ? <View className='lb-trip'>
        <Button className='lb-trip-cover' ariaLabel='打开里斯本七日行程' onClick={onOpenTrip}><Photo src={media.hero} description='里斯本城市与河岸' className='lb-trip-photo' retry={false} /><View className='lb-date-stamp'><Text>OCT</Text><Text>12</Text></View></Button>
        <View className='lb-trip-body'><View className='lb-trip-title'><View><Text className='ui-display'>里斯本，慢一点</Text><Text className='ux-muted'>10.12 – 10.18 · 7 天 · 2 人</Text></View><Button className='ux-icon-button' ariaLabel='管理里斯本行程' onClick={() => setMenu(true)}><Icon name='info' /></Button></View>
          <View className='lb-trip-route'><Text>上海 PVG</Text><Icon name='plane' /><Text>里斯本 LIS</Text></View>
          <View className='lb-trip-footer'><Text className='ux-caption'>示例行程 · 待核验</Text><Button className='ux-text-button' onClick={onOpenTrip}>继续安排<Icon name='arrow-right' /></Button></View>
        </View>
      </View> : <EmptyState icon='calendar' title={filter === 'archived' ? '让回忆慢慢积累' : '下一站，还没写下'} description={filter === 'archived' ? '归档后的行程会留在这里，随时可以恢复。' : '说说想去的地方，从一个旅行念头开始。'} actionLabel={filter === 'archived' ? '查看待出发行程' : '开始规划'} onAction={filter === 'archived' ? () => setFilter('upcoming') : onPlan} />}
      <DemoNote text='此行程为固定设计示例。归档和恢复仅在本次预览保留。' />
    </View>
    {menu ? <Sheet title='管理这次旅行' onClose={() => setMenu(false)}><Text className='ux-muted'>归档会将行程移到“已归档”，日程内容仍会保留。</Text><Button className='ux-primary' onClick={() => { onArchive(!archived); setMenu(false); setFilter(archived ? 'upcoming' : 'archived') }}>{archived ? '恢复到待出发' : '归档行程'}</Button></Sheet> : null}
  </>
}

export function CollectionsPage({ savedTrip, items, onBack, onOpenTrip, onOpenItem, onToggleTrip, onToggleItem, onExplore }: { savedTrip: boolean; items: SavedInspiration[]; onBack: () => void; onOpenTrip: () => void; onOpenItem: (id: string) => void; onToggleTrip: () => void; onToggleItem: (id: string) => void; onExplore: () => void }) {
  const [tab, setTab] = useState('all')
  const [removed, setRemoved] = useState<string | null>(null)
  const showTrip = savedTrip && tab !== 'inspiration'
  const shown = tab === 'trips' ? [] : items
  return <><PageHeader title='我的收藏' onBack={onBack} /><View className='ux-scroll ui-page'>
    <Text className='ui-display'>留给下一次出发。</Text><Text className='ux-muted'>喜欢的去处和行程，在这里相遇。</Text>
    <View className='ui-segment'>{[{ id: 'all', label: '全部' }, { id: 'inspiration', label: '灵感' }, { id: 'trips', label: '行程' }].map(item => <Button key={item.id} className={`ui-segment-button ${tab === item.id ? 'is-active' : ''}`} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}</View>
    {showTrip ? <View className='lb-saved-row'><Button className='lb-saved-open' onClick={onOpenTrip}><Photo src={media.hero} description='里斯本城市与河岸' className='lb-saved-photo' retry={false} /><View><Text className='ux-section-title'>里斯本，慢一点</Text><Text className='ux-muted'>7 天 · 2 人 · 示例行程</Text></View></Button><Button className='ux-icon-button' ariaLabel='取消收藏里斯本行程' onClick={() => { onToggleTrip(); setRemoved('trip') }}><Icon name='bookmark-filled' /></Button></View> : null}
    {shown.map(item => <View className='lb-saved-row' key={item.id}><Button className='lb-saved-open' onClick={() => onOpenItem(item.id)}><Photo src={item.photo} description={item.title + ' · 氛围参考'} className='lb-saved-photo' retry={false} /><View><Text className='ux-section-title'>{item.title}</Text><Text className='ux-muted'>{item.subtitle}</Text></View></Button><Button className='ux-icon-button' ariaLabel={`取消收藏${item.title}`} onClick={() => { onToggleItem(item.id); setRemoved(item.id) }}><Icon name='bookmark-filled' /></Button></View>)}
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
