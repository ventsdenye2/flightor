import { useEffect, useRef, useState } from 'react'
import { View, Text, Button, Textarea } from '@tarojs/components'
import { Icon, Photo } from './VisualMedia'
import { formatPrice, priceStatusLabel, tripDurationLabel, travelerLabel } from './presentation'
import type { TripPresentation } from './presentation'
import type { ConversationClient, GenerateTrip } from './backendClient'
import { ConversationPlanner } from './ConversationPlanner'
import { PlanCancellation } from './backendClient'
import { DemoNote, PageHeader } from './SharedUI'
import './planner.scss'

interface PlannerPageProps {
  conversationClient?: ConversationClient
  onTrip?: (trip: TripPresentation) => void
  onGenerate?: GenerateTrip
  trip: TripPresentation
  onOpenTrip: () => void
  onSearchFlights: () => void
  initialPrompt?: string
}

const suggestions = [
  { title: '去海边，慢下来', prompt: '想和朋友去海边待一周，从上海出发，喜欢散步和当地美食，安排轻松一点。', icon: 'compass' },
  { title: '从参考行程开始', prompt: '', icon: 'plane' },
  { title: '只有一个长周末', prompt: '下一个长周末想出去走走，从上海出发，两个人，想要轻松、不赶路的安排。', icon: 'calendar' }
]

export function PlannerPage(props: PlannerPageProps) {
  return props.conversationClient ? <ConversationPlanner {...props} client={props.conversationClient} /> : <PreviewPlannerPage {...props} />
}
function PreviewPlannerPage({ trip, onOpenTrip, onSearchFlights, initialPrompt = '', onGenerate }: PlannerPageProps) {
  const sampleLabel = `${trip.destination} · ${tripDurationLabel(trip)}`
  const samplePrompt = `从${trip.route[0] || '出发地待定'}出发，去${trip.destination}，${tripDurationLabel(trip)}，${travelerLabel(trip)}，安排轻松一点。`
  const price = trip.flights[0]?.price
  const [draft, setDraft] = useState(initialPrompt)
  const [submitted, setSubmitted] = useState('')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'cancelled' | 'failed'>('idle')
  const [progress, setProgress] = useState('请求已接收')
  const [error, setError] = useState('')
  const active = useRef<PlanCancellation | null>(null)
  const live = !!onGenerate
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    active.current?.abort()
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    setDraft(initialPrompt)
    setSubmitted('')
    setPhase('idle')
  }, [initialPrompt])

  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); active.current?.abort() }, [])

  const start = async (message: string) => {
    if (!message.trim() || phase === 'loading') return
    setSubmitted(message.trim())
    setDraft('')
    setPhase('loading')
    setError('')
    if (onGenerate) {
      active.current?.abort()
      const controller = new PlanCancellation()
      active.current = controller
      setProgress('正在连接后端…')
      try {
        await onGenerate(message.trim(), text => { if (!controller.signal.aborted) setProgress(text) }, controller.signal)
        if (!controller.signal.aborted) setPhase('ready')
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : '请求失败'); setPhase('failed') }
      }
      return
    }
    // Only advances local preview state; the result is the injected sample, never model output.
    pending.current = setTimeout(() => { setPhase('ready'); pending.current = null }, 1100)
  }
  const cancel = () => {
    active.current?.abort()
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    setPhase('cancelled')
  }
  const reset = (message = '') => {
    active.current?.abort()
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    setDraft(message)
    setSubmitted('')
    setPhase('idle')
  }

  return <>
    <PageHeader action={submitted || draft ? <Button className='ux-text-button' onClick={() => reset()}>重新开始</Button> : undefined} />
    <View className='ux-scroll pl-scroll' key={submitted ? 'conversation' : 'welcome'}>
      {!submitted ? <View className='pl-welcome'>
        <Text className='pl-title'>好旅行，<Text className='pl-title-line'>从一个想法开始。</Text></Text>
        <Text className='pl-intro'>想去哪、和谁一起、喜欢什么。<Text className='pl-intro-line'>把想法留在这里，让旅程慢慢成形。</Text></Text>

        <Button className='pl-inspiration' onClick={() => setDraft(samplePrompt)}>
          <View className='pl-inspiration-copy'><Text className='pl-card-kicker'>从这里找到灵感</Text><Text className='pl-inspiration-title'>{trip.title}</Text><View className='pl-inspiration-link'><Text>试试这个想法</Text><Icon name='arrow-right' /></View></View>
          <Photo src={trip.cover?.src} description={trip.cover?.description || '图片待补充'} className='pl-inspiration-photo' retry={false} />
        </Button>

        <View className='pl-suggestions-head'><Text>还没想好？从一句话开始</Text></View>
        <View className='pl-suggestions'>{suggestions.map(item => <Button key={item.title} className={`pl-suggestion ${draft === (item.prompt || samplePrompt) ? 'is-selected' : ''}`} onClick={() => setDraft(item.prompt || samplePrompt)}><Icon name={item.icon} /><Text>{item.title}</Text><Icon name='arrow-right' /></Button>)}</View>
        <Button className='pl-flight-link' onClick={onSearchFlights}><Icon name='plane' /><View><Text className='pl-flight-title'>目的地定了，先看看机票</Text><Text className='ux-muted'>搜索航班，比较时间与中转安排</Text></View><Icon name='chevron-right' /></Button>
      </View> : <View className='pl-conversation'>
        <Text className='pl-conversation-label'>这一次，想这样出发</Text>
        <View className='pl-user-message'><Text>{submitted}</Text></View>
        <View className='pl-reply-brand'><View className='pl-reply-mark'><Icon name='plane' /></View><Text>FlightOR</Text><Text className='pl-demo-badge'>{live ? '行程规划' : '示例体验'}</Text></View>
        {phase === 'loading' ? <View className='pl-generating' role='status' aria-live='polite'>
          <View className='pl-loading-line'><View className='pl-loading-dot' /><Text>{live ? progress : '正在打开参考行程…'}</Text></View>
          <Text className='ux-muted'>{live ? '会根据你的想法查询资料、规划并核对安排。' : `先用${sampleLabel}示例，看看旅程会如何展开。`}</Text>
          <View className='pl-loading-skeleton'><View /><View /><View /></View>
          <Button className='ux-text-button' onClick={cancel}>{live ? '取消规划' : '取消查看'}</Button>
        </View> : phase === 'cancelled' ? <View className='pl-cancelled' role='status'>
          <Text className='ux-section-title'>已暂停，想法还在这里</Text><Text className='ux-muted'>可以继续查看参考，也可以重新写下你的想法。</Text>
          <View className='pl-inline-actions'><Button className='ux-text-button' onClick={() => start(submitted)}>继续查看</Button><Button className='ux-text-button' onClick={() => reset(submitted)}>修改想法</Button></View>
        </View> : phase === 'failed' ? <View className='pl-cancelled' role='alert'><Text className='ux-section-title'>这次没有完成</Text><Text className='ux-muted'>{error}</Text><Button className='ux-text-button' onClick={() => reset(submitted)}>修改想法后重试</Button></View> : <>
          <Text className='pl-reply-copy'>{live ? '为你整理了这份行程。' : '先看看这份参考。'}<Text className='pl-reply-copy-line'>{trip.description}</Text></Text>
          <Button className='pl-result' onClick={onOpenTrip}>
            <Photo src={trip.cover?.src} description={trip.cover?.description || '图片待补充'} className='pl-result-photo' retry={false} />
            <View className='pl-result-body'><View className='pl-result-meta'><Text>{trip.country || trip.destination} · {tripDurationLabel(trip)}</Text><Text>{live ? '本次规划' : '固定示例'}</Text></View><Text className='pl-result-title'>{trip.title}</Text><Text className='pl-result-route'>{trip.route.join(' → ') || '路线待确认'} · {travelerLabel(trip)}</Text><View className='pl-result-bottom'><View><Text className='pl-result-price'>{formatPrice(price)}{price && price.status !== 'unknown' && price.amount !== null ? <Text>{price.unit === 'person' ? ' / 人' : ' / 合计'}</Text> : null}</Text><Text className='ux-caption'>{priceStatusLabel(price)}</Text></View><View className='pl-open-result'><Text>查看行程</Text><Icon name='arrow-right' /></View></View></View>
          </Button>
          <View className='pl-result-status'><Icon name='info' /><Text>{trip.days.length ? `已有 ${trip.days.filter(day => day.status === 'ready').length} 天参考安排，可查看和调整` : '每日安排尚未补充，可先查看旅行信息'}</Text></View>
          <DemoNote text={live ? '按你的需求生成，资料来源可在行程中查看；营业时间与交通仍需出发前核对。' : `这是固定的${sampleLabel}参考，未按输入内容生成；航班、价格与安排均为示例。`} />
          <View className='pl-followups'><Button className='pl-followup' onClick={() => reset(submitted)}><Text>修改我的想法</Text><Icon name='arrow-right' /></Button><Button className='pl-followup' onClick={onSearchFlights}><Text>比较航班示例</Text><Icon name='plane' /></Button></View>
        </>}
      </View>}
    </View>
    {!submitted ? <View className='pl-composer'>
      <View className='pl-input-wrap'><Textarea className='pl-textarea' value={draft} maxlength={600} ariaLabel='旅行想法' placeholder='例如：从哪里出发、去几天、和谁一起、喜欢什么…' onInput={event => setDraft(event.detail.value)} /><View className='pl-composer-actions'><Text className='pl-composer-hint'>{draft ? `${draft.length}/600` : '目的地、天数、预算，都可以聊聊'}</Text>{draft ? <Button className='ux-icon-button pl-clear' ariaLabel='清空旅行想法' onClick={() => setDraft('')}><Icon name='close' /></Button> : null}</View></View>
      <Button className='ux-primary pl-submit' disabled={!draft.trim()} onClick={() => start(draft)}><Text>{live ? '开始规划' : '查看行程示例'}</Text><Icon name='arrow-right' /></Button>
      <Text className='pl-composer-note'>{live ? '写清目的地、日期和天数，让安排更贴合你的想法' : `演示模式 · 将展示${sampleLabel}固定参考`}</Text>
    </View> : null}
  </>
}

export default PlannerPage
