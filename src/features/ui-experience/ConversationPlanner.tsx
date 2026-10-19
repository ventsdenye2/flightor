import { useEffect, useRef, useState } from 'react'
import { Button, Text, Textarea, View } from '@tarojs/components'
import { PlanCancellation } from './backendClient'
import type { ConversationClient, ConversationMessage } from './backendClient'
import type { TripPresentation } from './presentation'
import { tripDurationLabel } from './presentation'
import { PageHeader } from './SharedUI'
import { Icon } from './VisualMedia'

export function ConversationPlanner({ client, trip, initialPrompt = '', onTrip, onOpenTrip }: { client: ConversationClient; trip: TripPresentation; initialPrompt?: string; onTrip?: (trip: TripPresentation) => void; onOpenTrip: () => void }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [draft, setDraft] = useState(initialPrompt)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const active = useRef<PlanCancellation | null>(null)
  const revision = useRef(0)
  const scroll = useRef<any>(null)
  useEffect(() => {
    let current = true
    const version = revision.current
    client.load().then(value => { if (current && version === revision.current && value) setMessages(value.messages) }).catch(() => { if (current && version === revision.current) setError('上次对话暂时无法载入，请刷新重试或重新开始。') }).finally(() => { if (current) setLoadingHistory(false) })
    return () => { current = false; active.current?.abort() }
  }, [client])
  useEffect(() => { const element = scroll.current; if (element?.scrollTo) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }) }, [messages, stage, error, ready])
  const send = async (action: 'chat' | 'plan' = 'chat') => {
    if (active.current || loadingHistory || (!draft.trim() && (action === 'chat' || !messages.length))) return
    const message = draft.trim() || '请根据我们刚才聊的内容，现在开始规划行程。'
    const controller = new PlanCancellation()
    active.current = controller
    setMessages(current => [...current, { id: 'pending-' + Date.now(), role: 'user', content: message }])
    setDraft(''); setBusy(true); setError(''); setStage('正在连接…')
    try {
      const result = await client.send(message, (text, update) => {
        if (controller.signal.aborted) return
        setStage(text)
        if (update.conversation) setMessages(update.conversation.messages)
      }, controller.signal, action)
      if (controller.signal.aborted) return
      setMessages(result.conversation.messages)
      if (result.trip) { onTrip?.(result.trip); setReady(true) }
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : '消息发送失败'); setDraft(message) }
    } finally { if (active.current === controller) { active.current = null; setBusy(false); setStage('') } }
  }
  const reset = () => {
    revision.current++
    active.current?.abort(); active.current = null
    client.reset(); setMessages([]); setDraft(''); setBusy(false); setReady(false); setError(''); setStage(''); setLoadingHistory(false)
  }
  const cancel = () => { active.current?.abort(); setStage('正在停止…'); setError('已停止本次请求，可以继续聊或重新规划。') }
  return <>
    <PageHeader action={messages.length || error ? <Button className='ux-text-button' onClick={reset}>重新开始</Button> : undefined} />
    <View className='ux-scroll pl-scroll' ref={scroll}>
      {!messages.length ? <View className='pl-welcome'>
        <Text className='pl-title'>好旅行，<Text className='pl-title-line'>从聊聊开始。</Text></Text>
        <Text className='pl-intro'>还没想好去哪也没关系。<Text className='pl-intro-line'>聊聊你的想法，想好了再一起规划。</Text></Text>
        <View className='pl-suggestions'>{['想出去走走，但还没决定目的地', '第一次去巴黎，有哪些值得体验的？', '想和朋友去海边待一周，安排轻松一点'].map(text => <Button key={text} className='pl-suggestion' onClick={() => setDraft(text)}><Icon name='compass' /><Text>{text}</Text><Icon name='arrow-right' /></Button>)}</View>
      </View> : <View className='pl-conversation' aria-live='polite'>{messages.map(message => <View key={message.id} className='pl-chat-message'>
        {message.role === 'assistant' ? <View className='pl-reply-brand'><View className='pl-reply-mark'><Icon name='plane' /></View><Text>FlightOR</Text></View> : null}
        <View className={message.role === 'user' ? 'pl-user-message' : 'pl-assistant-message'}><Text>{message.content}</Text></View>
      </View>)}
        {busy ? <View className='pl-chat-status' role='status'><View className='pl-loading-dot' /><Text>{stage}</Text><Button className='ux-text-button' onClick={cancel}>停止</Button></View> : null}
        {error ? <View className='pl-chat-error' role='alert'><Text>{error}</Text></View> : null}
        {ready ? <Button className='pl-chat-result' onClick={onOpenTrip}><View><Text className='ux-section-title'>{trip.title}</Text><Text className='ux-muted'>{trip.destination} · {tripDurationLabel(trip)}</Text></View><Text>查看行程</Text><Icon name='arrow-right' /></Button> : null}
      </View>}
      {!messages.length && error ? <View className='pl-chat-error' role='alert'><Text>{error}</Text></View> : null}
    </View>
    <View className='pl-composer pl-chat-composer'>
      <View className='pl-input-wrap'><Textarea className='pl-textarea' value={draft} maxlength={4000} ariaLabel='旅行消息' placeholder={messages.length ? '继续聊聊，或告诉我现在开始规划…' : '最近想去哪里，或者有什么旅行想法？'} onInput={event => setDraft(event.detail.value)} /><View className='pl-composer-actions'><Text className='pl-composer-hint'>{loadingHistory ? '正在载入对话…' : '想法、问题、偏好，都可以聊聊'}</Text><Button className='ux-icon-button pl-chat-send' ariaLabel='发送消息' disabled={busy || loadingHistory || !draft.trim()} onClick={() => send()}><Icon name='arrow-right' /></Button></View></View>
      {messages.length ? <Button className='ux-text-button pl-chat-plan' disabled={busy || loadingHistory} onClick={() => send('plan')}>生成行程<Icon name='arrow-right' /></Button> : null}
    </View>
  </>
}
