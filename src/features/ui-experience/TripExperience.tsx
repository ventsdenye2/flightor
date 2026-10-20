import { useEffect, useRef, useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import type { Activity, FlightLegDisplay, MediaPresentation, TripDay, TripPresentation } from './presentation'
import type { PlaceMediaLoader, PlaceLocationLoader } from './backendClient'
import { findAlternative, selectTripCover, selectTripDay, shouldLoadPlaceDetails } from './presentation'
import { Photo, Icon } from './VisualMedia'
import { DayPlan } from './DayPlan'
import { FlightTicket } from './FlightTicket'
import { WorldFlightMap } from './WorldFlightMap'
import { EmptyState } from './SharedUI'
import './experience.scss'

type Tab = 'overview' | 'days' | 'flights'
const emptyFlightLegs: FlightLegDisplay[] = []
type Sheet = { kind: 'activity'; activity: Activity } | { kind: 'adjust' } | { kind: 'credits' }
export interface TripExperienceProps {
  trip: TripPresentation
  onCoverResolved?: (media: MediaPresentation) => void
  loadPlaceMedia?: PlaceMediaLoader
  loadPlaceLocation?: PlaceLocationLoader
  imageError?: boolean
  onNavigate?: () => void
  onOpenSource?: (url: string) => void
  embedded?: boolean
  onBack?: () => void
  onContinuePlanning?: () => void
  saved?: boolean
  onSavedChange?: (value: boolean) => void
}
function TripPhoto({ image, className, forceError = false }: { image: MediaPresentation | null; className: string; forceError?: boolean }) {
  return image?.src ? <Photo src={image.src} candidates={image.candidates} description={image.description} className={className} forceError={forceError} /> : <View className={`ux-photo-fallback ${className}`}><Icon name='image' /><Text>{image?.description || '目的地照片待补充'}</Text></View>
}
function MediaCredit({ media, onOpenSource }: { media: MediaPresentation; onOpenSource?: (url: string) => void }) {
  return <View className='ux-media-credit'><Text>{media.author ? `摄影：${media.author} · ` : ''}{media.source?.label || '图片来源'}</Text>{media.source?.url && onOpenSource ? <Button className='ux-text-button' onClick={() => onOpenSource(media.source!.url!)}>原图与作者<Icon name='external' /></Button> : null}{media.license ? media.licenseUrl && onOpenSource ? <Button className='ux-text-button' onClick={() => onOpenSource(media.licenseUrl!)}>{media.license}</Button> : <Text>{media.license}</Text> : null}</View>
}

export default function TripExperience(props: TripExperienceProps) {
  // A different trip starts with its own selected day, edits and pending timers.
  return <TripContent key={props.trip.id} {...props} />
}
function TripContent({ trip, onCoverResolved, loadPlaceMedia, loadPlaceLocation, imageError = false, onNavigate, onOpenSource, embedded = false, onBack, onContinuePlanning, saved: controlledSaved, onSavedChange }: TripExperienceProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState(trip.days)
  const [mediaById, setMediaById] = useState<Record<string, MediaPresentation>>({})
  useEffect(() => {
    setMediaById({})
    if (!loadPlaceMedia || !shouldLoadPlaceDetails(trip)) return
    let current = true, cursor = 0
    const activities = trip.days.flatMap(value => value.activities).filter(activity => !activity.media?.src && activity.imageQuery !== null)
    const worker = async () => {
      while (current && cursor < activities.length) {
        const activity = activities[cursor++]
        const media = await loadPlaceMedia(activity, trip.destination)
        if (current && media) setMediaById(previous => ({ ...previous, [activity.id]: media }))
      }
    }
    void Promise.all([worker(), worker()])
    return () => { current = false }
  }, [trip.days, trip.destination, trip.provenance, trip.placesResolved, loadPlaceMedia])
  const [dayId, setDayId] = useState<TripDay['id'] | undefined>(() => selectTripDay(trip.days, trip.initialDayId)?.id)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [localSaved, setLocalSaved] = useState(false)
  const saved = controlledSaved ?? localSaved
  const setSaved = (value: boolean) => { setLocalSaved(value); onSavedChange?.(value) }
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<TripDay[] | null>(null)
  const [modifying, setModifying] = useState(false)
  const pendingChange = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const daySnapshot = useRef(trip.days)
  useEffect(() => {
    // A new immutable source snapshot supersedes local draft edits, even for the
    // same trip id. Ordinary parent renders retain the original array identity.
    if (daySnapshot.current === trip.days) return
    daySnapshot.current = trip.days
    if (pendingChange.current) clearTimeout(pendingChange.current)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    pendingChange.current = null
    noticeTimer.current = null
    setDays(trip.days)
    setDayId(current => selectTripDay(trip.days, current)?.id)
    setUndo(null)
    setSheet(null)
    setModifying(false)
    setNotice('')
  }, [trip.days])
  useEffect(() => () => { if (pendingChange.current) clearTimeout(pendingChange.current); if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])
  const displayDays = days.map(value => ({ ...value, activities: value.activities.map(activity => activity.media?.src || !mediaById[activity.id] ? activity : { ...activity, media: mediaById[activity.id] }) }))
  const day = selectTripDay(displayDays, dayId)
  const dayNumber = day ? displayDays.indexOf(day) + 1 : 0
  const photos = displayDays.flatMap(value => value.activities).map(activity => activity.media).filter((media): media is MediaPresentation => !!media?.src)
  const cover = selectTripCover({ cover: trip.cover, days: displayDays })
  useEffect(() => { if (cover?.src) onCoverResolved?.(cover) }, [cover, onCoverResolved])
  const detailMedia = sheet?.kind === 'activity' ? sheet.activity.media || mediaById[sheet.activity.id] || null : null
  const completed = days.map((value, index) => value.status === 'ready' ? `D${index + 1}` : null).filter(Boolean)
  const partial = trip.status === 'partial' || days.some(value => value.status === 'pending')
  const firstFlight = trip.flights[0]
  const candidate = day ? findAlternative(day, trip.alternatives) : undefined
  const notify = (message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 3200)
  }
  const updateDay = (activities: Activity[], message: string) => {
    if (!day) return
    setUndo(days)
    setDays(days.map(value => value.id === day.id ? { ...value, activities } : value))
    setSheet(null)
    notify(message)
  }
  const replaceActivity = (activity: Activity) => {
    if (modifying || !day) return
    const replacement = findAlternative(day, trip.alternatives, activity.id)
    if (!replacement) { notify('当前没有其他可用候选，可以先移出一个停留'); return }
    setModifying(true)
    pendingChange.current = setTimeout(() => {
      updateDay(day.activities.map(value => value.id === activity.id ? { ...replacement, time: activity.time, until: activity.until } : value), '已替换这个停留，其他安排保持原样')
      setModifying(false)
      pendingChange.current = null
    }, 650)
  }
  const closeSheet = () => { if (!modifying) setSheet(null) }

  return <View className={`ux-app ux-published ${embedded ? 'ux-embedded' : ''}`}>
    <View className='ux-header'>
      {tab === 'overview' ? onBack ? <><Button className='ux-icon-button' ariaLabel='返回上一页' onClick={onBack}><Icon name='chevron-left' /></Button><Text className='ux-header-title'>{trip.destination} · 旅行详情</Text></> : <View className='ux-wordmark'><Icon name='plane' /><Text>FlightOR</Text></View> : <><Button className='ux-icon-button' ariaLabel='返回行程概览' onClick={() => setTab('overview')}><Icon name='chevron-left' /></Button><Text className='ux-header-title'>{trip.destination} · {tab === 'days' ? '每日行程' : '航班安排'}</Text></>}
      <Button className={`ux-icon-button ${saved ? 'is-saved' : ''}`} ariaLabel={saved ? '取消收藏行程' : '收藏行程'} aria-pressed={saved} onClick={() => { setSaved(!saved); notify(saved ? '已取消收藏' : '已收藏，仅在本次浏览保留') }}><Icon name={saved ? 'bookmark-filled' : 'bookmark'} /></Button>
    </View>
    <View className='ux-scroll' key={tab}>
      {partial && tab !== 'overview' ? <View className='ux-progress' role='status'><View className='ux-progress-dot' /><View><Text>{trip.flights.length ? '已有航班参考，日程仍在补充' : '日程正在补充'}</Text><Text className='ux-caption'>{completed.length ? `已完成 ${completed.join('、')}，可以先查看和调整。` : '每日安排尚未完成，请稍后再查看。'}</Text></View></View> : null}
      <View className='ux-tabs' role='tablist' ariaLabel='行程内容'>
        {([{ id: 'overview', label: '概览' }, { id: 'days', label: '每日行程' }, { id: 'flights', label: '航班' }] as const).map(item => <Button aria-selected={tab === item.id} key={item.id} className={`ux-tab ${tab === item.id ? 'is-active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</Button>)}
      </View>
      {tab === 'overview' ? <View className='ux-overview ux-overview-curated'>
        <View className='ux-overview-cover'><TripPhoto image={cover} className='ux-hero' forceError={imageError} />{cover?.src ? <MediaCredit media={cover} onOpenSource={onOpenSource} /> : null}</View>
        {trip.highlights?.length ? <View className='ux-trip-highlights'><Text className='ux-section-title'>这趟旅行，值得期待</Text>{trip.highlights.map((item, index) => <View className='ux-trip-highlight' key={`${item.title}-${index}`}><View><Text className='ux-highlight-title'>{item.title}</Text><Text className='ux-muted'>{item.description}</Text></View></View>)}</View> : null}
        {trip.travelNotes?.length ? <View className='ux-travel-notes'><Text className='ux-section-title'>出发前留意</Text>{trip.travelNotes.map((note, index) => <Text className='ux-muted' key={index}>{note}</Text>)}</View> : null}
        <WorldFlightMap legs={firstFlight?.legs || emptyFlightLegs} />
      </View> : tab === 'days' ? <>
        {days.length ? <View className='ux-day-selector' role='group' ariaLabel='选择日期'>{days.map((value, index) => <Button key={value.id} disabled={value.status === 'pending'} aria-pressed={day?.id === value.id} className={`ux-day-chip ${day?.id === value.id ? 'is-active' : ''}`} onClick={() => { setDayId(value.id); setUndo(null) }}><Text>D{index + 1}</Text><Text>{value.status === 'pending' ? '待补充' : value.label}</Text></Button>)}</View> : null}
        {day ? <DayPlan key={day.id} day={day} dayNumber={dayNumber} loadPlaceLocation={shouldLoadPlaceDetails(trip) ? loadPlaceLocation : undefined} imageError={imageError} published={trip.provenance === 'dsh'} onActivity={activity => setSheet({ kind: 'activity', activity })} onAdjust={() => setSheet({ kind: 'adjust' })} /> : <EmptyState icon='calendar' title='每日安排尚未补充' description='每日安排尚未确定，已知信息可在概览查看。' />}
      </> : <View className='ux-flight-page'>{trip.flights.length ? trip.flights.map(flight => <FlightTicket key={flight.id} flight={flight} expanded onOpenSource={onOpenSource} />) : <EmptyState icon='plane' title='还没有航班安排' description='出发日期、班次与价格都留待确认。' />}{trip.returnNote ? <View className='ux-return'><Icon name='plane' /><View><Text className='ux-section-title'>返程安排</Text><Text className='ux-muted'>{trip.returnNote}</Text></View></View> : null}</View>}
      {undo && tab === 'days' ? <View className='ux-undo' role='status'><Text>日程已调整</Text><Button className='ux-text-button' onClick={() => { setDays(undo); setUndo(null); notify('已恢复上一次安排') }}>撤销调整</Button></View> : null}
      {tab !== 'overview' ? <View className='ux-footer-note'><Text>{trip.provenance === 'dsh' ? '按需求规划 · 具体安排与报价以出发前核实为准' : '示例行程 · 价格与安排用于界面预览'}</Text><Button className='ux-text-button' onClick={() => setSheet({ kind: 'credits' })}>图片与来源<Icon name='external' /></Button></View> : null}
    </View>
    {!embedded ? <View className='ux-bottom-nav' ariaLabel='主导航'>{[{ name: 'home', label: '规划' }, { name: 'compass', label: '探索' }, { name: 'calendar', label: '行程' }, { name: 'user', label: '我的' }].map(item => <Button key={item.name} className={item.label === '行程' ? 'is-active' : ''} onClick={() => item.label === '行程' ? setTab('overview') : onNavigate?.()}><Icon name={item.name} /><Text>{item.label}</Text></Button>)}</View> : null}
    {notice ? <View className='ux-toast' role='status'><Icon name='check' /><Text>{notice}</Text></View> : null}
    {sheet ? <View className='ux-modal' onClick={closeSheet}>
      <View className='ux-sheet' role='dialog' aria-modal='true' ariaLabel={sheet.kind === 'activity' ? sheet.activity.name : sheet.kind === 'adjust' ? '调整这一天' : '图片与来源'} onClick={event => event.stopPropagation()}>
        <View className='ux-sheet-handle' /><Button className='ux-icon-button ux-sheet-close' disabled={modifying} ariaLabel='关闭详情' onClick={closeSheet}><Icon name='close' /></Button>
        {sheet.kind === 'activity' ? <>
          <TripPhoto image={detailMedia} className='ux-detail-photo' forceError={imageError} />
          {detailMedia?.src ? <MediaCredit media={detailMedia} onOpenSource={onOpenSource} /> : null}
          {sheet.activity.media?.atmosphere ? <Text className='ux-photo-label'>{sheet.activity.media.description}</Text> : null}
          <Text className='ux-detail-title'>{sheet.activity.name}</Text>
          <Text className='ux-muted'>{sheet.activity.time || '时间待确认'}{sheet.activity.until ? ` – ${sheet.activity.until}` : ''} · {sheet.activity.category}</Text>
          <View className='ux-detail-section'><Text className='ux-section-title'>关于这里</Text><Text className='ux-detail-copy'>{sheet.activity.introduction || sheet.activity.summary}</Text></View>
          {sheet.activity.recommendationReason ? <View className='ux-detail-section'><Text className='ux-section-title'>为什么安排这里</Text><Text className='ux-detail-copy'>{sheet.activity.recommendationReason}</Text></View> : null}
          {sheet.activity.introduction && sheet.activity.summary ? <View className='ux-detail-section'><Text className='ux-section-title'>怎么玩</Text><Text className='ux-detail-copy'>{sheet.activity.summary}</Text></View> : null}
          {sheet.activity.visitNotes ? <View className='ux-detail-section'><Text className='ux-section-title'>游玩提醒</Text><Text className='ux-detail-copy'>{sheet.activity.visitNotes}</Text></View> : null}
          {sheet.activity.source?.url && onOpenSource ? <Button className='ux-source' onClick={() => onOpenSource(sheet.activity.source!.url!)}><Icon name='external' /><Text>来源 · {sheet.activity.source.label}</Text><Icon name='arrow-right' /></Button> : <Text className='ux-caption'>{sheet.activity.source?.label || '活动来源尚未补充'}</Text>}
          <Text className='ux-caption ux-detail-caveat'>开放情况、交通与具体时刻以出发前核验的信息为准；空缺信息尚未确认。</Text>
          <View className='ux-sheet-actions'><Button className='ux-secondary' disabled={modifying || !day} onClick={() => day && updateDay(day.activities.filter(activity => activity.id !== sheet.activity.id), '已移出行程，可以撤销')}>移出行程</Button><Button className='ux-primary' disabled={modifying || !day || !findAlternative(day, trip.alternatives, sheet.activity.id)} onClick={() => replaceActivity(sheet.activity)}>{modifying ? '正在调整…' : '换个去处'}</Button></View>
        </> : sheet.kind === 'adjust' && day ? <>
          <Text className='ux-detail-title'>这一天，按你的节奏</Text><Text className='ux-muted'>D{dayNumber} · {day.title}</Text>
          <Button className='ux-adjust-option' disabled={!day.activities.length} onClick={() => updateDay(day.activities.slice(0, -1), '已减少一个停留，留出更多自由时间')}><Text className='ux-section-title'>轻松一点</Text><Text className='ux-muted'>减少最后一个停留，给喜欢的地方多一点时间。</Text><Icon name='arrow-right' /></Button>
          <Button className='ux-adjust-option' disabled={!candidate} onClick={() => { if (candidate) updateDay([...day.activities, candidate], `已加入${candidate.name}，可以撤销`) }}><Text className='ux-section-title'>加一点风景</Text><Text className='ux-muted'>{candidate ? `把${candidate.name}加入今天，具体时间可以再确认。` : '当前没有其他可用候选，已有安排仍可调整。'}</Text><Icon name='arrow-right' /></Button>
          {onContinuePlanning ? <Button className='ux-primary' onClick={onContinuePlanning}>回到对话，继续调整</Button> : null}
          <Text className='ux-caption'>这里的快速调整只在本次浏览保留；回到对话可继续讨论安排。</Text>
        </> : <>
          <Text className='ux-detail-title'>{trip.destination} · 图片与来源</Text><Text className='ux-muted'>来源状态跟随当前行程显示</Text>
          {[...new globalThis.Map([...(trip.cover ? [trip.cover] : []), ...photos].map(media => [media.src, media])).values()].map(media => <View className='ux-credit' key={media.src || media.description}><View><Text className='ux-section-title'>{media.description}</Text><MediaCredit media={media} onOpenSource={onOpenSource} /></View></View>)}
          {trip.sources.map((source, index) => source.url && onOpenSource ? <Button key={`${source.label}-${index}`} className='ux-credit' onClick={() => onOpenSource(source.url!)}><View><Text className='ux-section-title'>{source.label}</Text><Text className='ux-muted'>{source.status === 'verified' ? '来源页已核对' : source.status === 'sample' ? '固定示例' : '来源待核验'}</Text></View><Icon name='external' /></Button> : <View key={`${source.label}-${index}`} className='ux-credit'><Text className='ux-muted'>{source.label}</Text></View>)}
          {!trip.sources.length && !photos.length && !trip.cover ? <Text className='ux-muted'>当前行程的图片与信息来源尚未补充。</Text> : null}
          <Text className='ux-caption'>{trip.provenance === 'dsh' ? '景点照片来自对应的 Commons 文件记录；没有匹配图片时保留占位。' : '城市氛围照片不代表所有活动的实拍。没有对应图片时展示占位，不借用其他目的地照片。'}</Text>
        </>}
      </View>
    </View> : null}
  </View>
}
