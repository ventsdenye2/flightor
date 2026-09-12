import { useEffect, useRef, useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import { initialDays, alternative } from './fixtures'
import type { Activity, Scenario, TripDay } from './fixtures'
import { Photo, Icon } from './VisualMedia'
import { media, photoDescriptions } from './media'
import { DayPlan } from './DayPlan'
import { FlightTicket, FlightRoute } from './FlightTicket'
import './experience.scss'

type Tab = 'overview' | 'days' | 'flights'
type Sheet = { kind: 'activity'; activity: Activity } | { kind: 'adjust' } | { kind: 'credits' }
export interface TripExperienceProps {
  scenario?: Scenario
  days?: TripDay[]
  onNavigate?: () => void
  onOpenSource?: (url: string) => void
  embedded?: boolean
  onBack?: () => void
  saved?: boolean
  onSavedChange?: (value: boolean) => void
}

export default function TripExperience({ scenario = 'ready', days: seedDays = initialDays, onNavigate, onOpenSource, embedded = false, onBack, saved: controlledSaved, onSavedChange }: TripExperienceProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState(seedDays)
  const [dayId, setDayId] = useState(2)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [localSaved, setLocalSaved] = useState(false)
  const saved = controlledSaved ?? localSaved
  const setSaved = (value: boolean) => { setLocalSaved(value); onSavedChange?.(value) }
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<TripDay[] | null>(null)
  const [modifying, setModifying] = useState(false)
  const pendingChange = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pendingChange.current) clearTimeout(pendingChange.current); if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])
  const day = days.find(d => d.id === dayId) || days[0]
  const partial = scenario === 'partial'
  const imageError = scenario === 'image-error'
  const complex = scenario === 'connection'
  const notify = (message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 3200)
  }
  const updateDay = (activities: Activity[], message: string) => {
    setUndo(days)
    setDays(days.map(d => d.id === dayId ? { ...d, activities } : d))
    setSheet(null)
    notify(message)
  }
  const replaceActivity = (activity: Activity) => {
    if (modifying) return
    const replacement = [alternative, ...initialDays[1].activities].find(candidate => candidate.id !== activity.id && !day.activities.some(a => a.id === candidate.id))
    if (!replacement) { notify('当前示例候选已在行程中，可先移出一个停留'); return }
    setModifying(true)
    // Local design-state simulation; this never calls a model or modifies an Artifact.
    pendingChange.current = setTimeout(() => {
      updateDay(day.activities.map(a => a.id === activity.id ? { ...replacement, time: activity.time, until: activity.until } : a), '已替换这个停留，其他安排保持原样')
      setModifying(false)
      pendingChange.current = null
    }, 650)
  }
  const closeSheet = () => { if (!modifying) setSheet(null) }

  return <View className={`ux-app ${embedded ? 'ux-embedded' : ''}`}>
    <View className='ux-header'>
      {tab === 'overview' ? onBack ? <><Button className='ux-icon-button' ariaLabel='返回上一页' onClick={onBack}><Icon name='chevron-left' /></Button><Text className='ux-header-title'>里斯本 · 旅行详情</Text></> : <View className='ux-wordmark'><Icon name='plane' /><Text>FlightOR</Text></View> : <><Button className='ux-icon-button' ariaLabel='返回行程概览' onClick={() => setTab('overview')}><Icon name='chevron-left' /></Button><Text className='ux-header-title'>里斯本 · {tab === 'days' ? '每日行程' : '航班安排'}</Text></>}
      <Button className={`ux-icon-button ${saved ? 'is-saved' : ''}`} ariaLabel={saved ? '取消收藏示例行程' : '收藏示例行程'} aria-pressed={saved} onClick={() => { setSaved(!saved); notify(saved ? '已取消收藏' : '已收藏此示例，仅在本次预览保留') }}><Icon name={saved ? 'bookmark-filled' : 'bookmark'} /></Button>
    </View>
    <View className='ux-scroll' key={tab}>
      {tab === 'overview' ? <>
        <Photo src={media.hero} description='里斯本城市与特茹河景观' className='ux-hero' forceError={imageError} />
        <View className='ux-intro'>
          <Text className='ux-title'>去里斯本，慢一点。</Text>
          <View className='ux-route'><Text>上海</Text><Icon name='arrow-right' /><Text>多哈</Text><Icon name='arrow-right' />{complex ? <><Text>马德里</Text><Icon name='arrow-right' /></> : null}<Text>里斯本</Text></View>
          <Text className='ux-dates'>10.12 – 10.18 · 7 天</Text>
          <View className='ux-summary'><View><Text className='ux-summary-label'>航班示例</Text><Text className='ux-price'>¥5,280<Text className='ux-per'> / 人</Text></Text></View><View className='ux-travelers'><Icon name='people' /><Text>2 人同行</Text></View></View>
        </View>
      </> : null}
      {partial ? <View className='ux-progress' role='status'><View className='ux-progress-dot' /><View><Text>航班已就绪，日程正在补充</Text><Text className='ux-caption'>已完成 D1–D2，可以先查看和调整。</Text></View></View> : null}
      <View className='ux-tabs' role='tablist' ariaLabel='行程内容'>
        {([{ id: 'overview', label: '概览' }, { id: 'days', label: '每日行程' }, { id: 'flights', label: '航班' }] as const).map(item => <Button aria-selected={tab === item.id} key={item.id} className={`ux-tab ${tab === item.id ? 'is-active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</Button>)}
      </View>
      {tab === 'overview' ? <View className='ux-overview'>
        <FlightTicket complex={complex} onExpand={() => setTab('flights')} />
        <View className='ux-route-map'><Text className='ux-section-title'>航线示意</Text><FlightRoute complex={complex} /><Text className='ux-caption'>示例行程 · 航线连线非实际飞行轨迹</Text></View>
        <Button className='ux-day-teaser' onClick={() => setTab('days')}><View><Text className='ux-section-title'>7 天，不必把时间填满</Text><Text className='ux-muted'>老城、河岸、海风，还有一点留白。</Text></View><Icon name='arrow-right' /></Button>
      </View> : tab === 'days' ? <>
        <View className='ux-day-selector' role='group' ariaLabel='选择日期'>{days.map(d => <Button key={d.id} disabled={partial && d.id > 2} aria-pressed={dayId === d.id} className={`ux-day-chip ${dayId === d.id ? 'is-active' : ''}`} onClick={() => { setDayId(d.id); setUndo(null) }}><Text>D{d.id}</Text><Text>{partial && d.id > 2 ? '待补充' : d.label}</Text></Button>)}</View>
        <DayPlan day={day} imageError={imageError} onActivity={activity => setSheet({ kind: 'activity', activity })} onAdjust={() => setSheet({ kind: 'adjust' })} />
      </> : <View className='ux-flight-page'><FlightTicket complex={complex} expanded /><View className='ux-return'><Icon name='plane' /><View><Text className='ux-section-title'>返程安排，留待下一步</Text><Text className='ux-muted'>10 月 18 日 · 航班与机场接驳尚未补充</Text></View></View></View>}
      {undo ? <View className='ux-undo' role='status'><Text>日程已调整</Text><Button className='ux-text-button' onClick={() => { setDays(undo); setUndo(null); notify('已恢复上一次安排') }}>撤销调整</Button></View> : null}
      <View className='ux-footer-note'><Text>示例行程 · 价格与安排用于界面预览</Text><Button className='ux-text-button' onClick={() => setSheet({ kind: 'credits' })}>图片与来源<Icon name='external' /></Button></View>
    </View>
    {!embedded ? <View className='ux-bottom-nav' ariaLabel='主导航'>{[{ name: 'home', label: '规划' }, { name: 'compass', label: '探索' }, { name: 'calendar', label: '行程' }, { name: 'user', label: '我的' }].map(item => <Button key={item.name} className={item.label === '行程' ? 'is-active' : ''} onClick={() => item.label === '行程' ? setTab('overview') : onNavigate?.()}><Icon name={item.name} /><Text>{item.label}</Text></Button>)}</View> : null}
    {notice ? <View className='ux-toast' role='status'><Icon name='check' /><Text>{notice}</Text></View> : null}
    {sheet ? <View className='ux-modal' onClick={closeSheet}>
      <View className='ux-sheet' role='dialog' aria-modal='true' ariaLabel={sheet.kind === 'activity' ? sheet.activity.name : sheet.kind === 'adjust' ? '调整这一天' : '图片与来源'} onClick={event => event.stopPropagation()}>
        <View className='ux-sheet-handle' /><Button className='ux-icon-button ux-sheet-close' disabled={modifying} ariaLabel='关闭详情' onClick={closeSheet}><Icon name='close' /></Button>
        {sheet.kind === 'activity' ? <>
          <Photo src={media[sheet.activity.photo]} description={photoDescriptions[sheet.activity.photo]} className='ux-detail-photo' forceError={imageError} />
          {sheet.activity.photo === 'hero' || sheet.activity.photo === 'sunset' ? <Text className='ux-photo-label'>{photoDescriptions[sheet.activity.photo]}</Text> : null}
          <Text className='ux-detail-title'>{sheet.activity.name}</Text>
          <Text className='ux-muted'>{sheet.activity.time}{sheet.activity.until ? ` – ${sheet.activity.until}` : ''} · {sheet.activity.category}</Text>
          <Text className='ux-detail-copy'>{sheet.activity.summary}</Text>
          <Button className='ux-source' onClick={() => onOpenSource?.(sheet.activity.source)}><Icon name='external' /><Text>来源 · {sheet.activity.sourceName}</Text><Icon name='arrow-right' /></Button>
          <Text className='ux-caption ux-detail-caveat'>开放时间与门票待出发前确认。图片为目的地氛围参考，具体拍摄点见图片来源。</Text>
          <View className='ux-sheet-actions'><Button className='ux-secondary' disabled={modifying} onClick={() => updateDay(day.activities.filter(a => a.id !== sheet.activity.id), '已移出行程，可以撤销')}>移出行程</Button><Button className='ux-primary' disabled={modifying} onClick={() => replaceActivity(sheet.activity)}>{modifying ? '正在调整…' : '换个去处'}</Button></View>
        </> : sheet.kind === 'adjust' ? <>
          <Text className='ux-detail-title'>这一天，按你的节奏</Text><Text className='ux-muted'>D{day.id} · {day.title}</Text>
          <Button className='ux-adjust-option' disabled={!day.activities.length} onClick={() => updateDay(day.activities.slice(0, -1), '已减少一个停留，留出更多自由时间')}><Text className='ux-section-title'>轻松一点</Text><Text className='ux-muted'>减少最后一个停留，给喜欢的地方多一点时间。</Text><Icon name='arrow-right' /></Button>
          <Button className='ux-adjust-option' onClick={() => { if (day.activities.some(a => a.id === alternative.id)) { closeSheet(); notify('格拉萨观景台已在当天行程中'); return }; updateDay([...day.activities, { ...alternative, time: day.activities.length ? '18:30' : '10:00', until: day.activities.length ? '19:30' : '12:00' }], '已加入格拉萨观景台，时间为示例') }}><Text className='ux-section-title'>加一点风景</Text><Text className='ux-muted'>把格拉萨观景台加入今天，找个角度看看城市。</Text><Icon name='arrow-right' /></Button>
          <Text className='ux-caption'>当前使用固定候选演示调整，尚未连接行程生成服务。</Text>
        </> : <>
          <Text className='ux-detail-title'>镜头里的里斯本</Text><Text className='ux-muted'>本地实景照片 · Unsplash License</Text>
          {[['Aswin', '城市与河岸', 'https://unsplash.com/photos/es7bSg9VPP0'], ['Pamela Hallam', '城堡景观', 'https://unsplash.com/photos/jabczusxopU'], ['Dmitry Voronov', '阿尔法玛街区', 'https://unsplash.com/photos/JejHeHnfb0E'], ['Timur Seyfelmlyukov', '城市日落 · 来源信息待复核', 'https://unsplash.com/photos/i5j0kB6FcA']].map(([author, subject, url]) => <Button key={url} className='ux-credit' onClick={() => onOpenSource?.(url)}><View><Text className='ux-section-title'>{subject}</Text><Text className='ux-muted'>{author} / Unsplash</Text></View><Icon name='external' /></Button>)}
          <Text className='ux-caption'>城市照片可用于不同日程的氛围展示，不代表所有活动的实拍。航班、报价、开放时间均为未核验的设计样例。</Text>
        </>}
      </View>
    </View> : null}
  </View>
}
