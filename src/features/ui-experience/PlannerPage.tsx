import { tripText } from '../../i18n/trip'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View, Text, Button, Textarea } from '@tarojs/components'
import { Icon, Photo } from './VisualMedia'
import { formatPrice, tripDurationLabel, travelerLabel } from './presentation'
import type { TripPresentation } from './presentation'
import type { ConversationDelivery, ConversationTurnProgress } from '../../services/conversationService'
import type { PlannerRenderMeasurement, PlannerUiCommit } from '../../services/plannerTelemetry'
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
  productionCancelling?: boolean
  flightDecision?: ReactNode
  productionTelemetry?: PlannerRenderMeasurement
  onProductionCommit?: (id: string, event: PlannerUiCommit) => void
}

const suggestions = [
  { title: '海边休闲旅行', prompt: '想和朋友去海边待一周，从上海出发，喜欢散步和当地美食，安排轻松一点。', icon: 'compass' },
  { title: '从参考行程开始', prompt: '', icon: 'plane' },
  { title: '只有一个长周末', prompt: '下一个长周末想出去走走，从上海出发，两个人，想要轻松、不赶路的安排。', icon: 'calendar' }
]

export function PlannerPage({ trip, onOpenTrip, onSearchFlights, initialPrompt = '', onSubmitPrompt, productionBusy = false, productionProgress, locale = 'zh', productionError = '', productionReply = '', productionPrompt = '', productionResultAvailable = false, productionStopReason = '', productionDelivery, productionWarnings = [], onCancelProduction, productionCancelling = false, flightDecision, productionTelemetry, onProductionCommit }: PlannerPageProps) {
  const tt = (key: string, params?: Record<string, string | number>) => tripText(locale, key, params)
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
  const hasReferenceTrip = Boolean(trip.cover?.src && trip.route[0] && !trip.destination.includes('待确认'))
  const visibleSuggestions = hasReferenceTrip ? suggestions : suggestions.filter(item => item.prompt)
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

  // A passive effect confirms this tree committed. It does not prove native paint,
  // and only the active turn's server-published IDs are eligible in the sink.
  useEffect(() => {
    if (!production || !productionTelemetry || !onProductionCommit) return
    const { id, flights, guide, finalReady } = productionTelemetry
    if ((!submitted || phase !== 'cancelled') && flightDecision) for (const flight of flights) {
      onProductionCommit(id, { kind: 'flight', artifactId: flight.id, verificationStatus: flight.verificationStatus })
    }
    if (submitted && phase !== 'cancelled' && hasResult && (phase !== 'loading' || productionBusy) && guide) {
      onProductionCommit(id, { kind: 'guide', artifactId: guide.id, verificationStatus: guide.verificationStatus })
    }
    if (submitted && phase === 'ready' && !productionBusy && finalReady && (productionReply || hasResult || productionDelivery)) {
      onProductionCommit(id, { kind: 'final' })
    }
  }, [production, productionTelemetry, onProductionCommit, submitted, phase, hasResult, productionBusy, productionReply, productionDelivery, flightDecision])

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
        <Text className='pl-title'>这次，<Text className='pl-title-line'>想去哪？</Text></Text>
        <Text className='pl-intro'>告诉我们出发地、日期和预算。<Text className='pl-intro-line'>先比较航班，再安排怎么玩。</Text></Text>

        {hasReferenceTrip && <Button className='pl-inspiration' onClick={() => setDraft(samplePrompt)}>
          <View className='pl-inspiration-copy'><Text className='pl-card-kicker'>从这里找到灵感</Text><Text className='pl-inspiration-title'>{trip.title}</Text><View className='pl-inspiration-link'><Text>试试这个想法</Text><Icon name='arrow-right' /></View></View>
          <Photo src={trip.cover?.src} description={trip.cover?.description || '图片待补充'} className='pl-inspiration-photo' retry={false} />
        </Button>}

        <View className='pl-suggestions-head'><Text>还没想好？从一句话开始</Text></View>
        <View className='pl-suggestions'>{visibleSuggestions.map(item => <Button key={item.title} className={`pl-suggestion ${draft === (item.prompt || samplePrompt) ? 'is-selected' : ''}`} onClick={() => setDraft(item.prompt || samplePrompt)}><Icon name={item.icon} /><Text>{item.title}</Text><Icon name='arrow-right' /></Button>)}</View>
        <Button className='pl-flight-link' onClick={onSearchFlights}><Icon name='plane' /><View><Text className='pl-flight-title'>目的地定了，先看看机票</Text><Text className='ux-muted'>搜索航班，比较时间与中转安排</Text></View><Icon name='chevron-right' /></Button>
        {flightDecision}
      </View> : <View className='pl-conversation'>
        <Text className='pl-conversation-label'>我的旅行需求</Text>
        <View className='pl-user-message'><Text>{submitted}</Text></View>
        <View className='pl-reply-brand'><View className='pl-reply-mark'><Icon name='plane' /></View><Text>FlightOR</Text><Text className='pl-demo-badge'>{production ? '我的旅行规划' : '示例体验'}</Text></View>
        {phase === 'loading' ? <View className='pl-generating'>
          {production ? <PlannerProgress progress={productionProgress} locale={locale} compact active={productionBusy} /> : <>
            <View className='pl-loading-line' role='status'><View className='pl-loading-dot' /><Text>正在打开参考行程…</Text></View>
            <Text className='ux-muted'>{`先用${sampleLabel}示例，看看旅程会如何展开。`}</Text>
          </>}
          <View className='pl-loading-skeleton'><View /><View /><View /></View>
          {productionError && <View role='alert'><Text>{productionError}</Text></View>}
          {(!production || onCancelProduction) && <Button className='ux-text-button' disabled={productionCancelling} onClick={cancel}>{productionCancelling ? '正在取消…' : production ? '取消规划' : '取消查看'}</Button>}
          {hasResult && <View className='pl-saved-while-running'><Text className='pl-saved-while-running__label'>已保存，仍在整理/核验</Text><Button className='pl-result' onClick={onOpenTrip}><View className='pl-result-body'><View className='pl-result-meta'><Text>{trip.country || trip.destination} · {production ? trip.durationDays ? tt('trip.duration', { n: trip.durationDays }) : tt('trip.dateUnknown') : tripDurationLabel(trip)}</Text><Text>{production ? tt('trip.saved') : '固定示例'}</Text></View><Text className='pl-result-title'>{trip.title}</Text><Text className='pl-result-route'>{trip.route.join(' → ') || tt('trip.routePending')}{!production ? ` · ${travelerLabel(trip)}` : ''}</Text><View className='pl-open-result'><Text>{tt('trip.open')}</Text><Icon name='arrow-right' /></View></View></Button></View>}
          {flightDecision}
        </View> : phase === 'cancelled' ? <View className='pl-cancelled' role='status'>
          <Text className='ux-section-title'>{production ? '已取消规划' : '已取消查看'}</Text><Text className='ux-muted'>可以继续查看参考，也可以重新写下你的想法。</Text>
          <View className='pl-inline-actions'><Button className='ux-text-button' onClick={() => start(submitted)}>继续查看</Button><Button className='ux-text-button' onClick={() => reset(submitted)}>修改想法</Button></View>
        </View> : <>
          {interrupted ? <View className='pl-cancelled pl-interrupted' role='alert'>
            <Text className='ux-section-title'>本次规划未完成</Text><PlannerReply className='ux-muted' content={interruptionMessage} />
            <View className='pl-inline-actions'><Button className='ux-text-button' disabled={productionBusy} onClick={() => start(submitted)}>重新规划</Button><Button className='ux-text-button' onClick={() => reset(submitted)}>修改想法</Button></View>
          </View> : null}
          {hasResult && <>
            <Button className='pl-result' onClick={onOpenTrip}>
              {trip.cover && <Photo src={trip.cover.src} description={trip.cover.description} className='pl-result-photo' retry={false} />}
              <View className='pl-result-body'><View className='pl-result-meta'><Text>{trip.country || trip.destination} · {production ? trip.durationDays ? tt('trip.duration', { n: trip.durationDays }) : tt('trip.dateUnknown') : tripDurationLabel(trip)}</Text><Text>{production ? tt('trip.saved') : '固定示例'}</Text></View><Text className='pl-result-title'>{trip.title}</Text><Text className='pl-result-route'>{trip.route.join(' → ') || tt('trip.routePending')}{!production ? ` · ${travelerLabel(trip)}` : ''}</Text><View className='pl-result-bottom'><View><Text className='pl-result-price'>{trip.flights[0]?.price?.amount != null ? formatPrice(trip.flights[0].price) : tt('trip.priceUnknown')}{trip.flights[0]?.price && trip.flights[0].price.status !== 'unknown' && trip.flights[0].price.amount !== null ? <Text>{` / ${tt(trip.flights[0].price.unit === 'person' ? 'trip.person' : 'trip.total')}`}</Text> : null}</Text><Text className='ux-caption'>{trip.flights[0]?.price && trip.flights[0].price.status !== 'unknown' ? tt(`trip.price.${trip.flights[0].price.status}`) : tt('trip.priceUnknown')}</Text></View><View className='pl-open-result'><Text>{tt('trip.open')}</Text><Icon name='arrow-right' /></View></View></View>
            </Button>
            <View className='pl-result-status'><Icon name='info' /><Text>{trip.publication ? tt(`trip.${trip.publication.status}`) : trip.days.length ? `已有 ${trip.days.filter(day => day.status === 'ready').length} 天参考安排，可查看和调整` : '每日安排尚未补充，可先查看旅行信息'}</Text></View>
            <Text className='pl-result-description'>{trip.description}</Text>
            {!production && <DemoNote text={`这是固定的${sampleLabel}参考，未按输入内容生成；航班、价格与安排均为示例。`} />}
          </>}
          {!interrupted && <PlannerReply className='pl-reply-copy' content={production ? productionReply || tt('trip.waitReply') : '先看看这份参考。'} />}
          {flightDecision}
          {!interrupted && <View className='pl-followups'><Button className='pl-followup' onClick={() => reset(submitted)}><Text>{production && !hasResult ? (locale === 'en' ? 'Continue planning' : '继续补充想法') : tt('trip.editIdea')}</Text><Icon name='arrow-right' /></Button>{hasResult && <Button className='pl-followup' onClick={onSearchFlights}><Text>{production ? tt('trip.viewFlights') : '比较航班示例'}</Text><Icon name='plane' /></Button>}</View>}
        </>}
      </View>}
    </View>
    {(!submitted || productionBusy || Boolean(draft)) ? <View className='pl-composer'>
      <View className='pl-input-wrap'><Textarea className='pl-textarea' value={draft} maxlength={600} ariaLabel='旅行想法' placeholder='例如：北京出发，东京五天，两个人，安排轻松一点。' onInput={event => setDraft(event.detail.value)} /><View className='pl-composer-actions'><Text className='pl-composer-hint'>{draft ? `${draft.length}/600` : '出发地、日期、人数和预算'}</Text>{draft ? <Button className='ux-icon-button pl-clear' ariaLabel='清空旅行想法' onClick={() => setDraft('')}><Icon name='close' /></Button> : null}</View></View>
      <Button className='ux-primary pl-submit' disabled={!draft.trim() || productionBusy} onClick={() => start(draft)}><Text>{production ? '开始规划' : '查看行程示例'}</Text><Icon name='arrow-right' /></Button>
      <Text className='pl-composer-note'>{productionBusy ? '规划进行中：草稿会保留，当前提交入口将在本轮结束后恢复' : production ? '确认航班后再生成游玩安排，结果会自动保存' : `演示模式 · 将展示${sampleLabel}固定参考`}</Text>
    </View> : null}
  </>
}

export default PlannerPage
