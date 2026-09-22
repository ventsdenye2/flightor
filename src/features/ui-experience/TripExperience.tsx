import { Fragment, useEffect, useRef, useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import type { Activity, MediaPresentation, TripDay, TripPresentation } from './presentation'
import { findAlternative, formatPrice, formatTripDates, hasKnownPrice, priceStatusLabel, selectTripDay, travelerLabel, tripDurationLabel } from './presentation'
import { Photo, Icon } from './VisualMedia'
import { DayPlan } from './DayPlan'
import { FlightTicket, FlightRoute } from './FlightTicket'
import { EmptyState } from './SharedUI'
import './experience.scss'
import PublishedTripExperience from './PublishedTripExperience'

type Tab = 'overview' | 'days' | 'flights'
type Sheet = { kind: 'activity'; activity: Activity } | { kind: 'adjust' } | { kind: 'credits' }
export interface TripExperienceProps {
  trip: TripPresentation
  imageError?: boolean
  onNavigate?: () => void
  onOpenSource?: (url: string) => void
  embedded?: boolean
  onBack?: () => void
  saved?: boolean
  onSavedChange?: (value: boolean) => void
  onProductionEdit?: (message: string) => Promise<void>
  onSave?: () => void
  production?: boolean
  initialTab?: Tab
  onContinuePlanning?: () => void
  onRefresh?: () => void
  onPrepareLocale?: (retryRevision?: number) => void
  publicationBusy?: boolean
  publicationError?: string
  onPreparePlaces?:()=>void
  placesBusy?:boolean
  placesError?:string
}
function TripPhoto({ image, className, forceError = false }: { image: MediaPresentation | null; className: string; forceError?: boolean }) {
  return image?.src ? <Photo src={image.src} description={image.description} className={className} forceError={forceError} /> : <View className={`ux-photo-fallback ${className}`}><Icon name='image' /><Text>{image?.description || '目的地照片待补充'}</Text></View>
}

export default function TripExperience(props: TripExperienceProps) {
  if (props.production) return <PublishedTripExperience {...props} />
  // A different trip starts with its own selected day, edits and pending timers.
  return <TripContent key={props.trip.id} {...props} />
}
function TripContent({ trip, imageError = false, onNavigate, onOpenSource, embedded = false, onBack, saved: controlledSaved, onSavedChange, onProductionEdit, onSave, production = false, onContinuePlanning, initialTab = 'overview' }: TripExperienceProps) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [days, setDays] = useState(trip.days)
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
  const day = selectTripDay(days, dayId)
  const dayNumber = day ? days.indexOf(day) + 1 : 0
  const completed = days.map((value, index) => value.status === 'ready' ? `D${index + 1}` : null).filter(Boolean)
  const partial = trip.status === 'partial' || days.some(value => value.status === 'pending')
  const firstFlight = trip.flights[0]
  const price = firstFlight?.price
  const candidate = day ? findAlternative(day, trip.alternatives) : undefined
  const notify = (message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 3200)
  }
  const updateDay = (activities: Activity[], message: string) => {
    if (!day) return
    if (onProductionEdit) {
      setModifying(true)
      void onProductionEdit(message).catch(error => notify(error instanceof Error ? error.message : '调整未完成')).finally(() => setModifying(false))
      setSheet(null)
      return
    }
    setUndo(days)
    setDays(days.map(value => value.id === day.id ? { ...value, activities } : value))
    setSheet(null)
    notify(message)
  }
  const replaceActivity = (activity: Activity) => {
    if (modifying || !day) return
    const replacement = findAlternative(day, trip.alternatives, activity.id)
    if (onProductionEdit) {
      setModifying(true)
      void onProductionEdit(`把「${activity.name}」换成其他合适的去处`).catch(error => notify(error instanceof Error ? error.message : '调整未完成')).finally(() => setModifying(false))
      setSheet(null)
      return
    }
    if (!replacement) { notify('暂无替代地点，可以先移出行程。'); return }
    setModifying(true)
    pendingChange.current = setTimeout(() => {
      updateDay(day.activities.map(value => value.id === activity.id ? { ...replacement, time: activity.time, until: activity.until } : value), '已替换这个停留，其他安排保持原样')
      setModifying(false)
      pendingChange.current = null
    }, 650)
  }
  const closeSheet = () => { if (!modifying) setSheet(null) }

  return <View className={`ux-app ${embedded ? 'ux-embedded' : ''}`}>
    <View className='ux-header'>
      {tab === 'overview' ? onBack ? <><Button className='ux-icon-button' ariaLabel='返回上一页' onClick={onBack}><Icon name='chevron-left' /></Button><Text className='ux-header-title'>{trip.destination} · 旅行详情</Text></> : <View className='ux-wordmark'><Icon name='plane' /><Text>FlightOR</Text></View> : <><Button className='ux-icon-button' ariaLabel='返回行程概览' onClick={() => setTab('overview')}><Icon name='chevron-left' /></Button><Text className='ux-header-title'>{trip.destination} · {tab === 'days' ? '每日行程' : '航班安排'}</Text></>}
      {(production || onProductionEdit) ? <View /> : <Button className={`ux-icon-button ${saved ? 'is-saved' : ''}`} ariaLabel={saved ? '取消收藏示例行程' : '收藏示例行程'} aria-pressed={saved} onClick={() => { setSaved(!saved); notify(saved ? '已取消收藏' : '已收藏此示例，仅在本次预览保留') }}><Icon name={saved ? 'bookmark-filled' : 'bookmark'} /></Button>}
    </View>
    <View className='ux-scroll' key={tab}>
      {tab === 'overview' ? <>
        <TripPhoto image={trip.cover} className='ux-hero' forceError={imageError} />
        <View className='ux-intro'>
          <Text className='ux-title'>{trip.title}</Text>
          <View className='ux-route'>{trip.route.length ? trip.route.map((place, index) => <Fragment key={`${place}-${index}`}>{index ? <Icon name='arrow-right' /> : null}<Text>{place}</Text></Fragment>) : <Text>出发地与目的地待确认</Text>}</View>
          <Text className='ux-dates'>{formatTripDates(trip)} · {tripDurationLabel(trip)}</Text>
          <View className='ux-summary'><View><Text className='ux-summary-label'>航班{priceStatusLabel(price)}</Text><Text className='ux-price'>{formatPrice(price)}{hasKnownPrice(price) ? <Text className='ux-per'>{price.unit === 'person' ? ' / 人' : ' / 总计'}</Text> : null}</Text></View><View className='ux-travelers'><Icon name='people' /><Text>{travelerLabel(trip)}</Text></View></View>
          <Text className='ux-caption'>{price?.source?.label || '报价来源待补充'}</Text>
          {trip.budget ? <View className='ux-guide-budget'><Text className='ux-section-title'>全程预算约束</Text><Text className='ux-guide-budget-value'>{trip.budget.label} · {trip.budget.currency} {trip.budget.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</Text><Text className='ux-caption'>行程总额 · 同行人数口径未指定</Text></View> : null}
        </View>
      </> : null}
      {partial ? <View className='ux-progress' role='status'><View className='ux-progress-dot' /><View><Text>{production ? '部分内容已保存，完整行程仍待确认' : trip.flights.length ? '已有航班参考，日程仍在补充' : '日程正在补充'}</Text><Text className='ux-caption'>{completed.length ? `已有 ${completed.join('、')} 安排，可以先查看和调整。` : '每日安排尚未完成，请稍后再查看。'}</Text></View></View> : null}
      <View className='ux-tabs' role='tablist' ariaLabel='行程内容'>
        {([{ id: 'overview', label: '概览' }, { id: 'days', label: '每日行程' }, { id: 'flights', label: '航班' }] as const).map(item => <Button aria-selected={tab === item.id} key={item.id} className={`ux-tab ${tab === item.id ? 'is-active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</Button>)}
      </View>
      {tab === 'overview' ? <View className='ux-overview'>
        {firstFlight ? <FlightTicket flight={firstFlight} onExpand={() => setTab('flights')} /> : <EmptyState icon='plane' title='航班安排尚未补充' description='确认出发地与日期后，再查看航班、价格和中转安排。' />}
        <View className='ux-route-map'><Text className='ux-section-title'>路线示意</Text><FlightRoute route={trip.route} illustration={trip.routeIllustration} /><Text className='ux-caption'>{production ? '路线示意 · 连线非实际交通轨迹' : '示例行程 · 连线非实际交通轨迹'}</Text></View>
        <Button className='ux-day-teaser' onClick={() => setTab('days')}><View><Text className='ux-section-title'>{trip.durationDays ? `${tripDurationLabel(trip)}每日行程` : '每日行程'}</Text><Text className='ux-muted'>{trip.description}</Text></View><Icon name='arrow-right' /></Button>
        {trip.supportingEvidence?.length ? <View className='ux-guide-evidence'><Text className='ux-section-title'>实用与补充信息</Text>{trip.supportingEvidence.map((item, index) => <View key={`${item.title}-${index}`} className='ux-guide-evidence-item'><Text className='ux-section-title'>{item.title}</Text><Text className='ux-muted'>{item.description}</Text><Text className='ux-caption ux-guide-applicability'>{item.sourceApplicabilityNotice}</Text><Text className='ux-caption'>{item.category} · {item.verification === 'verified' ? '已核验' : item.verification === 'partial' ? '部分核验' : item.verification === 'stale' ? '资料已过期' : '待核验'}{item.destinations.length ? ` · ${item.destinations.join('、')}` : ''}</Text></View>)}</View> : null}
      </View> : tab === 'days' ? <>
        {days.length ? <View className='ux-day-selector' role='group' ariaLabel='选择日期'>{days.map((value, index) => <Button key={value.id} disabled={value.status === 'pending'} aria-pressed={day?.id === value.id} className={`ux-day-chip ${day?.id === value.id ? 'is-active' : ''}`} onClick={() => { setDayId(value.id); setUndo(null) }}><Text>D{index + 1}</Text><Text>{value.status === 'pending' ? '待补充' : value.label}</Text></Button>)}</View> : null}
        {day ? <DayPlan day={day} dayNumber={dayNumber} imageError={imageError} onActivity={activity => setSheet({ kind: 'activity', activity })} onAdjust={() => production ? onContinuePlanning?.() : setSheet({ kind: 'adjust' })} /> : <EmptyState icon='calendar' title='每日安排尚未补充' description='每日安排尚未确定，已知信息可在概览查看。' />}
      </> : <View className='ux-flight-page'>{trip.flights.length ? trip.flights.map(flight => <FlightTicket key={flight.id} flight={flight} expanded onOpenSource={onOpenSource} />) : <EmptyState icon='plane' title='还没有航班安排' description='出发日期、班次与价格都留待确认。' />}{trip.returnNote ? <View className='ux-return'><Icon name='plane' /><View><Text className='ux-section-title'>返程安排</Text><Text className='ux-muted'>{trip.returnNote}</Text></View></View> : null}</View>}
      {undo ? <View className='ux-undo' role='status'><Text>日程已调整</Text><Button className='ux-text-button' onClick={() => { setDays(undo); setUndo(null); notify('已恢复上一次安排') }}>撤销调整</Button></View> : null}
      <View className='ux-footer-note'><Text>{(production || onProductionEdit) ? '已自动保存 · 部分信息仍待核验' : '示例行程 · 价格与安排用于界面预览'}</Text>{onSave ? <Button className='ux-text-button' onClick={onSave}>保存到我的行程</Button> : null}<Button className='ux-text-button' onClick={() => setSheet({ kind: 'credits' })}>图片与来源<Icon name='external' /></Button></View>
    </View>
    {!embedded ? <View className='ux-bottom-nav' ariaLabel='主导航'>{[{ name: 'home', label: '规划' }, { name: 'compass', label: '探索' }, { name: 'calendar', label: '行程' }, { name: 'user', label: '我的' }].map(item => <Button key={item.name} className={item.label === '行程' ? 'is-active' : ''} onClick={() => item.label === '行程' ? setTab('overview') : onNavigate?.()}><Icon name={item.name} /><Text>{item.label}</Text></Button>)}</View> : null}
    {notice ? <View className='ux-toast' role='status'><Icon name='check' /><Text>{notice}</Text></View> : null}
    {sheet ? <View className='ux-modal' onClick={closeSheet}>
      <View className='ux-sheet' role='dialog' aria-modal='true' ariaLabel={sheet.kind === 'activity' ? sheet.activity.name : sheet.kind === 'adjust' ? '调整这一天' : '图片与来源'} onClick={event => event.stopPropagation()}>
        <View className='ux-sheet-handle' /><Button className='ux-icon-button ux-sheet-close' disabled={modifying} ariaLabel='关闭详情' onClick={closeSheet}><Icon name='close' /></Button>
        {sheet.kind === 'activity' ? <>
          <TripPhoto image={sheet.activity.media} className='ux-detail-photo' forceError={imageError} />
          {sheet.activity.media?.atmosphere ? <Text className='ux-photo-label'>{sheet.activity.media.description}</Text> : null}
          <Text className='ux-detail-title'>{sheet.activity.name}</Text>
          <Text className='ux-muted'>{sheet.activity.time || '时间待确认'}{sheet.activity.until ? ` – ${sheet.activity.until}` : ''} · {sheet.activity.category}</Text>
          <Text className='ux-detail-copy'>{sheet.activity.summary}</Text><Text className='ux-caption ux-guide-applicability'>{sheet.activity.sourceApplicabilityNotice}</Text>
          {sheet.activity.source?.url && onOpenSource ? <Button className='ux-source' onClick={() => onOpenSource(sheet.activity.source!.url!)}><Icon name='external' /><Text>来源 · {sheet.activity.source.label}</Text><Icon name='arrow-right' /></Button> : <Text className='ux-caption'>{sheet.activity.source?.label || '活动来源尚未补充'}</Text>}
          <Text className='ux-caption ux-detail-caveat'>开放情况、交通与具体时刻以出发前核验的信息为准；空缺信息尚未确认。</Text>
          {production ? <Button className='ux-primary' onClick={onContinuePlanning}>在规划记录中调整</Button> : <View className='ux-sheet-actions'><Button className='ux-secondary' disabled={modifying || !day} onClick={() => day && updateDay(day.activities.filter(activity => activity.id !== sheet.activity.id), '从当天安排中移出这个活动')}>移出行程</Button><Button className='ux-primary' disabled={modifying || !day || (!onProductionEdit && !findAlternative(day, trip.alternatives, sheet.activity.id))} onClick={() => replaceActivity(sheet.activity)}>{modifying ? '正在调整…' : '换个去处'}</Button></View>}
        </> : sheet.kind === 'adjust' && day ? <>
          <Text className='ux-detail-title'>调整当天安排</Text><Text className='ux-muted'>D{dayNumber} · {day.title}</Text>
          <Button className='ux-adjust-option' disabled={!day.activities.length} onClick={() => updateDay(day.activities.slice(0, -1), '已减少一个停留，留出更多自由时间')}><Text className='ux-section-title'>轻松一点</Text><Text className='ux-muted'>减少最后一个停留，给喜欢的地方多一点时间。</Text><Icon name='arrow-right' /></Button>
          <Button className='ux-adjust-option' disabled={!onProductionEdit && !candidate} onClick={() => { if (onProductionEdit) updateDay(day.activities, '在这一天增加一个合适的停留'); else if (candidate) updateDay([...day.activities, candidate], `已加入${candidate.name}，可以撤销`) }}><Text className='ux-section-title'>增加一个地点</Text><Text className='ux-muted'>{onProductionEdit ? '为今天增加一个合适的地点。' : candidate ? `把${candidate.name}加入今天，具体时间可以再确认。` : '当前没有其他可用候选，已有安排仍可调整。'}</Text><Icon name='arrow-right' /></Button>
          <Text className='ux-caption'>{onProductionEdit ? '提交调整后，行程将在处理完成后更新。' : '当前使用此行程的固定候选演示调整，尚未连接行程生成服务。'}</Text>
        </> : <>
          <Text className='ux-detail-title'>{trip.destination} · 图片与来源</Text><Text className='ux-muted'>来源状态跟随当前行程显示</Text>
          {trip.sources.map((source, index) => source.url && onOpenSource ? <Button key={`${source.label}-${index}`} className='ux-credit' onClick={() => onOpenSource(source.url!)}><View><Text className='ux-section-title'>{source.label}</Text><Text className='ux-muted'>{source.status === 'verified' ? '来源页已核对' : source.status === 'sample' ? '固定示例' : source.status === 'partial' ? '部分核验' : source.status === 'stale' ? '资料已过期' : '来源待核验'}</Text></View><Icon name='external' /></Button> : <View key={`${source.label}-${index}`} className='ux-credit'><Text className='ux-muted'>{source.label}</Text></View>)}
          {!trip.sources.length ? <Text className='ux-muted'>当前行程的图片与信息来源尚未补充。</Text> : null}
          <Text className='ux-caption'>城市氛围照片不代表所有活动的实拍。没有对应图片时展示占位，不借用其他目的地照片。</Text>
        </>}
      </View>
    </View> : null}
  </View>
}
