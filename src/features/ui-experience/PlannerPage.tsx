import { useEffect, useRef, useState } from 'react'
import { View, Text, Button, Textarea } from '@tarojs/components'
import { Icon, Photo } from './VisualMedia'
import { formatPrice, priceStatusLabel, tripDurationLabel, travelerLabel } from './presentation'
import type { TripPresentation } from './presentation'
import type { ConversationDelivery, ConversationTurnProgress } from '../../services/conversationService'
import PlannerProgress from '../../components/plan/PlannerProgress'
import PlannerReply from '../../components/plan/PlannerReply'
import { DemoNote, PageHeader } from './SharedUI'
import './experience.scss'
import './planner.scss'

interface PlannerPageProps {
  trip: TripPresentation
  onOpenTrip: () => void
  onSearchFlights: () => void
  initialPrompt?: string
  onSubmitPrompt?: (message: string) => void
  productionBusy?: boolean
  productionProgress?: ConversationTurnProgress
  locale?: 'zh' | 'en'
  productionError?: string
  productionReply?: string
  productionPrompt?: string
  productionResultAvailable?: boolean
  productionStopReason?: string
  productionDelivery?: ConversationDelivery
  productionWarnings?: string[]
  onCancelProduction?: () => void
}

const suggestions = [
  { title: '去海边，慢下来', prompt: '想和朋友去海边待一周，从上海出发，喜欢散步和当地美食，安排轻松一点。', icon: 'compass' },
  { title: '从参考行程开始', prompt: '', icon: 'plane' },
  { title: '只有一个长周末', prompt: '下一个长周末想出去走走，从上海出发，两个人，想要轻松、不赶路的安排。', icon: 'calendar' }
]

export function PlannerPage({ trip, onOpenTrip, onSearchFlights, initialPrompt = '', onSubmitPrompt, productionBusy = false, productionProgress, locale = 'zh', productionError = '', productionReply = '', productionPrompt = '', productionResultAvailable = false, productionStopReason = '', productionDelivery, productionWarnings = [], onCancelProduction }: PlannerPageProps) {
  const production = Boolean(onSubmitPrompt)
  const hasResult = !production || productionResultAvailable
  const rateLimited = productionWarnings.includes('research_provider_rate_limited')
    || productionDelivery?.warnings.includes('research_provider_rate_limited')
  const interrupted = production && (Boolean(productionError) || (productionStopReason !== 'completed' && productionDelivery?.status !== 'satisfied' && (
    ['max_tool_steps', 'tool_call_limit', 'model_failure', 'turn_timeout', 'stale_generation', 'goal_failed', 'goal_partial'].includes(productionStopReason)
    || productionDelivery?.status === 'failed' || productionDelivery?.status === 'partial'
    || (rateLimited && (productionStopReason === 'goal_pending' || productionDelivery?.status === 'pending')))))
  const interruptionMessage = productionError || (rateLimited
    ? `联网研究服务暂时限流，${productionResultAvailable ? '本次规划尚未完成；已保存的内容仍可查看' : '本次未生成新攻略'}，请稍后重试。`
    : productionReply || '本次规划未完成，请按原想法重试，或修改后再次提交。')
  const sampleLabel = `${trip.destination} · ${tripDurationLabel(trip)}`
  const samplePrompt = `从${trip.route[0] || '出发地待定'}出发，去${trip.destination}，${tripDurationLabel(trip)}，${travelerLabel(trip)}，安排轻松一点。`
  const price = trip.flights[0]?.price
  const [draft, setDraft] = useState(initialPrompt)
  const [submitted, setSubmitted] = useState('')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'cancelled'>('idle')
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const receivedPrompt = useRef('')

  useEffect(() => {
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    setDraft(initialPrompt)
    setSubmitted('')
    setPhase('idle')
  }, [initialPrompt])

  useEffect(() => {
    if (!production) return
    if (productionPrompt && receivedPrompt.current !== productionPrompt) { receivedPrompt.current = productionPrompt; setSubmitted(productionPrompt); setPhase(productionBusy ? 'loading' : 'ready') }
    if (productionBusy) { setPhase('loading'); if (productionPrompt) setSubmitted(productionPrompt) }
    else if (submitted) setPhase('ready')
  }, [production, productionBusy, productionError, submitted, productionPrompt])

  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])

  const start = (message: string) => {
    if (!message.trim() || phase === 'loading') return
    setSubmitted(message.trim())
    setDraft('')
    setPhase('loading')
    if (onSubmitPrompt) {
      onSubmitPrompt(message.trim())
      return
    }
    // Only advances local preview state; the result is the injected sample, never model output.
    pending.current = setTimeout(() => { setPhase('ready'); pending.current = null }, 1100)
  }
  const cancel = () => {
    if (onCancelProduction) {
      onCancelProduction()
      setPhase('cancelled')
      return
    }
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    setPhase('cancelled')
  }
  const reset = (message = '') => {
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
    setDraft(message)
    setSubmitted('')
    setPhase('idle')
  }

  return <>
    <PageHeader action={submitted || draft ? <Button className='ux-text-button' disabled={productionBusy} onClick={() => reset()}>重新输入</Button> : null} />
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
        <View className='pl-reply-brand'><View className='pl-reply-mark'><Icon name='plane' /></View><Text>FlightOR</Text><Text className='pl-demo-badge'>{production ? '我的旅行规划' : '示例体验'}</Text></View>
        {phase === 'loading' ? <View className='pl-generating'>
          {production ? <PlannerProgress progress={productionProgress} locale={locale} compact active={productionBusy} /> : <>
            <View className='pl-loading-line' role='status'><View className='pl-loading-dot' /><Text>正在打开参考行程…</Text></View>
            <Text className='ux-muted'>{`先用${sampleLabel}示例，看看旅程会如何展开。`}</Text>
          </>}
          <View className='pl-loading-skeleton'><View /><View /><View /></View>
          <Button className='ux-text-button' disabled={production && !onCancelProduction} onClick={cancel}>{production ? '取消规划' : '取消查看'}</Button>
        </View> : phase === 'cancelled' ? <View className='pl-cancelled' role='status'>
          <Text className='ux-section-title'>已暂停，想法还在这里</Text><Text className='ux-muted'>可以继续查看参考，也可以重新写下你的想法。</Text>
          <View className='pl-inline-actions'><Button className='ux-text-button' onClick={() => start(submitted)}>继续查看</Button><Button className='ux-text-button' onClick={() => reset(submitted)}>修改想法</Button></View>
        </View> : <>
          {interrupted ? <View className='pl-cancelled pl-interrupted' role='alert'>
            <Text className='ux-section-title'>本次规划未完成</Text><PlannerReply className='ux-muted' content={interruptionMessage} />
            <View className='pl-inline-actions'><Button className='ux-text-button' disabled={productionBusy} onClick={() => start(submitted)}>重试这次规划</Button><Button className='ux-text-button' onClick={() => reset(submitted)}>修改想法</Button></View>
          </View> : null}
          {hasResult && <Button className='pl-result' onClick={onOpenTrip}>
            {trip.cover && <Photo src={trip.cover.src} description={trip.cover.description} className='pl-result-photo' retry={false} />}
            <View className='pl-result-body'><View className='pl-result-meta'><Text>{trip.country || trip.destination} · {tripDurationLabel(trip)}</Text><Text>{production ? '已保存结果' : '固定示例'}</Text></View><Text className='pl-result-title'>{trip.title}</Text><Text className='pl-result-route'>{trip.route.join(' → ') || '路线待确认'} · {travelerLabel(trip)}</Text><View className='pl-result-bottom'><View><Text className='pl-result-price'>{formatPrice(price)}{price && price.status !== 'unknown' && price.amount !== null ? <Text>{price.unit === 'person' ? ' / 人' : ' / 合计'}</Text> : null}</Text><Text className='ux-caption'>{priceStatusLabel(price)}</Text></View><View className='pl-open-result'><Text>查看行程</Text><Icon name='arrow-right' /></View></View></View>
          </Button>}
          {hasResult && <>
            <View className='pl-result-status'><Icon name='info' /><Text>{trip.days.length ? `已有 ${trip.days.filter(day => day.status === 'ready').length} 天参考安排，可查看和调整` : '每日安排尚未补充，可先查看旅行信息'}</Text></View>
            <Text className='pl-result-description'>{trip.description}</Text>
            {!production && <DemoNote text={`这是固定的${sampleLabel}参考，未按输入内容生成；航班、价格与安排均为示例。`} />}
          </>}
          {!interrupted && <PlannerReply className='pl-reply-copy' content={production ? productionReply || '正在等待规划回复。' : '先看看这份参考。'} />}
          {!interrupted && <View className='pl-followups'><Button className='pl-followup' onClick={() => reset(submitted)}><Text>{production && !hasResult ? '继续补充想法' : '修改我的想法'}</Text><Icon name='arrow-right' /></Button>{hasResult && <Button className='pl-followup' onClick={onSearchFlights}><Text>{production ? '查看航班' : '比较航班示例'}</Text><Icon name='plane' /></Button>}</View>}
        </>}
      </View>}
    </View>
    {!submitted ? <View className='pl-composer'>
      <View className='pl-input-wrap'><Textarea className='pl-textarea' value={draft} maxlength={600} ariaLabel='旅行想法' placeholder='例如：从哪里出发、去几天、和谁一起、喜欢什么…' onInput={event => setDraft(event.detail.value)} /><View className='pl-composer-actions'><Text className='pl-composer-hint'>{draft ? `${draft.length}/600` : '目的地、天数、预算，都可以聊聊'}</Text>{draft ? <Button className='ux-icon-button pl-clear' ariaLabel='清空旅行想法' onClick={() => setDraft('')}><Icon name='close' /></Button> : null}</View></View>
      <Button className='ux-primary pl-submit' disabled={!draft.trim() || productionBusy} onClick={() => start(draft)}><Text>{production ? '开始规划' : '查看行程示例'}</Text><Icon name='arrow-right' /></Button>
      <Text className='pl-composer-note'>{production ? '生成后的行程会自动保存到我的行程' : `演示模式 · 将展示${sampleLabel}固定参考`}</Text>
    </View> : null}
  </>
}

export default PlannerPage
