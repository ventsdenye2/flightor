import { useEffect, useRef, useState } from 'react'
import { Button, Text, Textarea, View } from '@tarojs/components'
import { PlanCancellation } from './backendClient'
import type { ConversationClient, ConversationMessage } from './backendClient'
import type { TripPresentation } from './presentation'
import { tripDurationLabel } from './presentation'
import { PageHeader } from './SharedUI'
import { Icon, Photo } from './VisualMedia'
import { FlightChoices } from './FlightChoices'
import { flightSelectionMessage } from './flightOptions'
import type { FlightOption, FlightOptions, FlightSelection } from './flightOptions'

export function ConversationPlanner({ client, trip, initialPrompt = '', onTrip, onOpenTrip, onSearchFlights, onOpenSource }: { client: ConversationClient; trip: TripPresentation; initialPrompt?: string; onTrip?: (trip: TripPresentation) => void; onOpenTrip: () => void; onSearchFlights: () => void; onOpenSource?: (url: string) => void }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [draft, setDraft] = useState(initialPrompt)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [flightOptions, setFlightOptions] = useState<FlightOptions | null>(null)
  const [selectedFlight, setSelectedFlight] = useState<FlightSelection | null>(null)
  const [selectionLocked, setSelectionLocked] = useState(false)
  const [savingSelection, setSavingSelection] = useState(false)
  const selectedOption = selectedFlight && selectedFlight.searchId === flightOptions?.searchId ? flightOptions.options.find(option => option.id === selectedFlight.candidateId) : undefined
  const active = useRef<PlanCancellation | null>(null)
  const revision = useRef(0)
  const scroll = useRef<any>(null)
  const tripCallback = useRef(onTrip)
  tripCallback.current = onTrip
  useEffect(() => {
    let current = true
    const version = revision.current
    client.load().then(value => { if (current && version === revision.current && value) {
      setMessages(value.messages); setFlightOptions(value.flightOptions || null); setSelectedFlight(value.selectedFlight || null); setSelectionLocked(!!value.flightSelectionLocked)
      const savedTrip = [...value.messages].reverse().find(message => message.trip)?.trip
      if (savedTrip) tripCallback.current?.(savedTrip)
    } }).catch(() => { if (current && version === revision.current) setError('上次对话暂时无法载入，请刷新重试或重新开始。') }).finally(() => { if (current) setLoadingHistory(false) })
    return () => { current = false; active.current?.abort() }
  }, [client])
  useEffect(() => { const element = scroll.current; if (messages.length && element?.scrollTo) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }) }, [messages, stage, error])
  const send = async (action: 'chat' | 'plan' = 'chat') => {
    if (active.current || savingSelection || loadingHistory || (!draft.trim() && (action === 'chat' || !messages.length))) return
    const message = draft.trim() || (selectedOption && flightOptions ? flightSelectionMessage(flightOptions, selectedOption) : '请根据我们刚才聊的内容，现在开始规划行程。')
    const controller = new PlanCancellation()
    active.current = controller
    if (selectedFlight) setSelectionLocked(true)
    setMessages(current => [...current.map(item => selectedFlight && item.flightOptions?.searchId === selectedFlight.searchId ? { ...item, flightSelectionLocked: true } : item), { id: 'pending-' + Date.now(), role: 'user', content: message }])
    setDraft(''); setBusy(true); setError(''); setStage('正在连接…')
    try {
      const result = await client.send(message, (text, update) => {
        if (controller.signal.aborted) return
        setStage(text)
        if (update.conversation) { setMessages(update.conversation.messages); setFlightOptions(update.conversation.flightOptions || null); setSelectedFlight(update.conversation.selectedFlight || null); setSelectionLocked(!!update.conversation.flightSelectionLocked) }
      }, controller.signal, action)
      if (controller.signal.aborted) return
      setMessages(result.conversation.messages)
      setFlightOptions(result.conversation.flightOptions || null); setSelectedFlight(result.conversation.selectedFlight || null)
      setSelectionLocked(!!result.conversation.flightSelectionLocked)
      if (result.trip) onTrip?.(result.trip)
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : '消息发送失败'); setDraft(message) }
    } finally { if (active.current === controller) { active.current = null; setBusy(false); setStage('') } }
  }
  const chooseFlight = async (option: FlightOption | null) => {
    if (active.current || savingSelection || selectionLocked || !flightOptions) return
    const selection = option ? { searchId: flightOptions.searchId, candidateId: option.id } : null
    if (selection?.candidateId === selectedFlight?.candidateId && selection?.searchId === selectedFlight?.searchId) return
    const version = revision.current
    setSavingSelection(true); setError('')
    try {
      const conversation = await client.selectFlight(selection)
      if (version === revision.current) { setMessages(conversation.messages); setFlightOptions(conversation.flightOptions || null); setSelectedFlight(conversation.selectedFlight || null); setSelectionLocked(!!conversation.flightSelectionLocked) }
    } catch (failure) { if (version === revision.current) setError(failure instanceof Error ? failure.message : '航班选择未保存，请重试') }
    finally { if (version === revision.current) setSavingSelection(false) }
  }
  const reset = () => {
    revision.current++
    active.current?.abort(); active.current = null
    client.reset(); setMessages([]); setDraft(''); setBusy(false); setError(''); setStage(''); setLoadingHistory(false); setFlightOptions(null); setSelectedFlight(null); setSelectionLocked(false); setSavingSelection(false)
  }
  const cancel = () => {
    active.current?.abort(); active.current = null
    setBusy(false); setStage(''); setError('已停止本次回复。')
  }
  return <>
    <PageHeader action={messages.length || error ? <Button className='ux-text-button' onClick={reset}>重新开始</Button> : undefined} />
    <View className='ux-scroll pl-scroll' ref={scroll}>
      {!messages.length ? <View className='pl-welcome'>
        <Text className='pl-title'>这次，<Text className='pl-title-line'>想去哪？</Text></Text>
        <Text className='pl-intro'>先聊聊目的地、日期和预算。<Text className='pl-intro-line'>想好了，先比较航班，再安排怎么玩。</Text></Text>
        {trip.cover?.src ? <Button className='pl-inspiration' onClick={() => setDraft(`我想了解${trip.destination}，有哪些值得体验的？`)}><View className='pl-inspiration-copy'><Text className='pl-card-kicker'>{trip.provenance === 'dsh' ? '继续聊聊这段旅行' : '从这里找到灵感'}</Text><Text className='pl-inspiration-title'>{trip.title}</Text><View className='pl-inspiration-link'><Text>聊聊这个想法</Text><Icon name='arrow-right' /></View></View><Photo src={trip.cover.src} description={trip.cover.description} className='pl-inspiration-photo' retry={false} /></Button> : null}
        <View className='pl-suggestions-head'><Text>还没想好？从一句话开始</Text></View>
        <View className='pl-suggestions'>{['想出去走走，但还没决定目的地', '第一次去巴黎，有哪些值得体验的？', '想和朋友去海边待一周，安排轻松一点'].map(text => <Button key={text} className='pl-suggestion' onClick={() => setDraft(text)}><Icon name='compass' /><Text>{text}</Text><Icon name='arrow-right' /></Button>)}</View>
        <Button className='pl-flight-link' onClick={onSearchFlights}><Icon name='plane' /><View><Text className='pl-flight-title'>目的地定了，先看看机票</Text><Text className='ux-muted'>浏览航班示例，比较时间与中转安排</Text></View><Icon name='chevron-right' /></Button>
      </View> : <View className='pl-conversation' aria-live='polite'>{messages.map(message => <View key={message.id} className='pl-chat-message'>
        {message.role === 'assistant' ? <View className='pl-reply-brand'><View className='pl-reply-mark'><Icon name='plane' /></View><Text>FlightOR</Text></View> : null}
        <View className={message.role === 'user' ? 'pl-user-message' : 'pl-assistant-message'}><Text>{message.content}</Text></View>
        {message.flightOptions ? <FlightChoices key={message.flightOptions.searchId} result={message.flightOptions} selected={message.selectedFlight || null} locked={!!message.flightSelectionLocked || message.flightOptions.searchId !== flightOptions?.searchId || selectionLocked} disabled={busy || savingSelection} onSelect={chooseFlight} onOpenSource={onOpenSource} /> : null}
        {message.trip ? <Button className='pl-chat-result' ariaLabel={`查看行程：${message.trip.title}`} onClick={() => { onTrip?.(message.trip!); onOpenTrip() }}><View className='pl-chat-result-head'><View className='pl-chat-result-icon'><Icon name='calendar-active' /></View><Text className='pl-chat-result-label'>你的行程已就绪</Text></View><Text className='pl-chat-result-title'>{message.trip.title}</Text><View className='pl-chat-result-foot'><Text className='pl-chat-result-meta'>{message.trip.destination} · {tripDurationLabel(message.trip)}</Text><View className='pl-chat-result-action'><Text>查看行程</Text><Icon name='arrow-right' /></View></View></Button> : null}
      </View>)}
        {busy ? <View className='pl-chat-status' role='status' aria-live='polite'><View className='pl-loading-dot' /><Text>{stage}</Text></View> : null}
        {error ? <View className='pl-chat-error' role='alert'><Text>{error}</Text></View> : null}
      </View>}
      {!messages.length && error ? <View className='pl-chat-error' role='alert'><Text>{error}</Text></View> : null}
    </View>
    <View className='pl-composer pl-chat-composer'>
      <View className='pl-input-wrap'><Textarea className='pl-textarea' value={draft} maxlength={4000} ariaLabel='旅行消息' placeholder={messages.length ? '继续聊聊，或告诉我现在开始规划…' : '最近想去哪里，或者有什么旅行想法？'} onInput={event => setDraft(event.detail.value)} onConfirm={() => { if (!busy) void send() }} /><View className='pl-composer-actions'>{loadingHistory ? <Text className='pl-composer-hint'>正在载入对话…</Text> : null}<Button className='ux-icon-button pl-chat-send' ariaLabel={busy ? '停止生成' : '发送消息'} disabled={!busy && (loadingHistory || !draft.trim())} onClick={() => busy ? cancel() : send()}>{busy ? <View className='pl-stop-icon' /> : <Icon name='arrow-right' />}</Button></View></View>
      {messages.length ? <Button className='ux-text-button pl-chat-plan' disabled={busy || loadingHistory || savingSelection} onClick={() => send('plan')}>生成行程<Icon name='arrow-right' /></Button> : null}
    </View>
  </>
}
