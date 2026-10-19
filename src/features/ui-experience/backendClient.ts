import type { Activity, MediaPresentation, TripPresentation } from './presentation'
import type { FlightOptions, FlightSelection } from './flightOptions'
export type BackendTransport = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<any>
export type PlaceMediaLoader = (activity: Activity, destination: string) => Promise<MediaPresentation | null>
export function createPlaceMediaLoader(transport: BackendTransport): PlaceMediaLoader {
  const pending = new Map<string, Promise<MediaPresentation | null>>()
  return (activity, destination) => {
    if (activity.imageQuery === null) return Promise.resolve(null)
    const body = { name: activity.name, query: activity.imageQuery || activity.name, city: activity.area || destination }
    const key = JSON.stringify(body)
    if (!pending.has(key)) pending.set(key, transport('POST', '/api/place-media', body).then(result => {
      if (result.status === 'unavailable') pending.delete(key)
      return result.media || null
    }).catch(() => { pending.delete(key); return null }))
    return pending.get(key)!
  }
}
export interface PlanSignal {
  aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}
// WeChat's JS runtime does not promise the browser AbortController global.
export class PlanCancellation {
  private listeners = new Set<() => void>()
  readonly signal: PlanSignal = {
    aborted: false,
    addEventListener: (_type, listener) => { this.listeners.add(listener) },
    removeEventListener: (_type, listener) => { this.listeners.delete(listener) }
  }
  abort() {
    if (this.signal.aborted) return
    this.signal.aborted = true
    this.listeners.forEach(listener => listener())
    this.listeners.clear()
  }
}
export type GenerateTrip = (prompt: string, onProgress: (message: string) => void, signal: PlanSignal) => Promise<TripPresentation>
const labels: Record<string, string> = { queued: '请求已接收', chatting: '正在回复…', planning: '正在查询资料并规划行程…', reviewing: '正在核对需求与整理行程…' }
function untilCancelled<T>(pending: Promise<T>, signal: PlanSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(Error('已取消')) }
    signal.addEventListener('abort', cancel, { once: true })
    pending.then(value => { signal.removeEventListener('abort', cancel); if (signal.aborted) reject(Error('已取消')); else resolve(value) }, error => { signal.removeEventListener('abort', cancel); reject(error) })
    if (signal.aborted) cancel()
  })
}
async function pollRun(transport: BackendTransport, route: string, body: unknown, signal: PlanSignal, update: (run: any) => void) {
  if (signal.aborted) throw Error('已取消')
  let id: string | undefined
  let cancelled = false
  const cancel = () => {
    if (id && !cancelled) { cancelled = true; void transport('DELETE', '/api/runs/' + id).catch(() => {}) }
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    // If cancellation wins the POST race, cancel the task when its ID arrives.
    await untilCancelled(transport('POST', route, body).then(initial => { id = initial.id; if (signal.aborted) cancel(); return initial }), signal)
    for (let attempt = 0; attempt < 480; attempt++) {
      const run = await untilCancelled(transport('GET', '/api/runs/' + id), signal)
      if (signal.aborted) throw Error('已取消')
      update(run)
      if (run.stage === 'completed') return { ...run, id: run.id || id }
      if (run.stage === 'failed' || run.stage === 'cancelled') throw Error(run.error || '本次任务未完成')
      await untilCancelled(new Promise(resolve => setTimeout(resolve, 1500)), signal)
    }
    cancel(); throw Error('等待超时，请刷新查看已保存的对话或重试')
  } finally { signal.removeEventListener('abort', cancel) }
}
export interface ConversationMessage { id: string; role: 'user' | 'assistant'; content: string; flightOptions?: FlightOptions | null; selectedFlight?: FlightSelection | null; flightSelectionLocked?: boolean; trip?: TripPresentation }
export interface Conversation { id: string; messages: ConversationMessage[]; flightOptions?: FlightOptions | null; selectedFlight?: FlightSelection | null; flightSelectionLocked?: boolean }
export interface ConversationUpdate { conversation?: Conversation; stage: string; progress?: { text: string; role: string; updatedAt: string } }
export interface ConversationResult { conversation: Conversation; trip?: TripPresentation }
export interface ConversationClient {
  load: () => Promise<Conversation | null>
  reset: () => void
  selectFlight: (selection: FlightSelection | null) => Promise<Conversation>
  send: (message: string, progress: (text: string, update: ConversationUpdate) => void, signal: PlanSignal, action?: 'chat' | 'plan') => Promise<ConversationResult>
}
export function createConversationClient(transport: BackendTransport, storage: { get: () => string | null; set: (id: string) => void; clear: () => void }, onTrip?: (id: string) => void): ConversationClient {
  let conversationId = storage.get()
  return {
    async load() { return conversationId ? transport('GET', '/api/conversations/' + conversationId) : null },
    reset() { conversationId = null; storage.clear() },
    async selectFlight(selection) {
      if (!conversationId) throw Error('请先查询航班')
      return transport('POST', '/api/conversations/' + conversationId + '/flight-selection', { selection })
    },
    async send(message, progress, signal, action = 'chat') {
      const run = await pollRun(transport, '/api/conversations/turns', { message, conversationId, action }, signal, run => {
        if (run.conversation) { conversationId = run.conversation.id; storage.set(conversationId!) }
        progress(run.progress?.text || labels[run.stage] || '正在处理…', run)
      })
      if (signal.aborted) throw Error('已取消')
      if (run.trip) onTrip?.(run.id)
      return { conversation: run.conversation, trip: run.trip }
    }
  }
}
export async function restoreTrip(transport: BackendTransport, id: string): Promise<TripPresentation | null> {
  const run = await transport('GET', '/api/runs/' + id)
  return run.stage === 'completed' && run.trip?.provenance === 'dsh' ? run.trip : null
}
export function createGenerator(transport: BackendTransport, onComplete?: (id: string) => void): GenerateTrip {
  return async (prompt, progress, signal) => {
    const run = await pollRun(transport, '/api/runs', { prompt }, signal, run => progress(run.progress?.text || labels[run.stage] || '正在处理…'))
    if (signal.aborted) throw Error('已取消')
    onComplete?.(run.id)
    return run.trip
  }
}
