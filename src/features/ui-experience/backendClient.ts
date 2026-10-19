import type { TripPresentation } from './presentation'
export type BackendTransport = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<any>
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
export interface ConversationMessage { id: string; role: 'user' | 'assistant'; content: string }
export interface Conversation { id: string; messages: ConversationMessage[] }
export interface ConversationUpdate { conversation?: Conversation; stage: string }
export interface ConversationResult { conversation: Conversation; trip?: TripPresentation }
export interface ConversationClient {
  load: () => Promise<Conversation | null>
  reset: () => void
  send: (message: string, progress: (text: string, update: ConversationUpdate) => void, signal: PlanSignal, action?: 'chat' | 'plan') => Promise<ConversationResult>
}
export function createConversationClient(transport: BackendTransport, storage: { get: () => string | null; set: (id: string) => void; clear: () => void }, onTrip?: (id: string) => void): ConversationClient {
  let conversationId = storage.get()
  return {
    async load() { return conversationId ? transport('GET', '/api/conversations/' + conversationId) : null },
    reset() { conversationId = null; storage.clear() },
    async send(message, progress, signal, action = 'chat') {
      if (signal.aborted) throw Error('已取消')
      const initial = await transport('POST', '/api/conversations/turns', { message, conversationId, action })
      const id = initial.id
      const cancel = () => { void transport('DELETE', '/api/runs/' + id).catch(() => {}) }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) { cancel(); throw Error('已取消') }
      try {
        for (let attempt = 0; attempt < 480; attempt++) {
          if (signal.aborted) throw Error('已取消')
          const run = await transport('GET', '/api/runs/' + id)
          if (signal.aborted) throw Error('已取消')
          if (run.conversation) { conversationId = run.conversation.id; storage.set(conversationId!) }
          progress(labels[run.stage] || '正在处理…', run)
          if (run.stage === 'completed') { if (run.trip) onTrip?.(id); return { conversation: run.conversation, trip: run.trip } }
          if (run.stage === 'failed' || run.stage === 'cancelled') throw Error(run.error || '本次对话未完成')
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
        cancel(); throw Error('等待超时，请重试')
      } finally { signal.removeEventListener('abort', cancel) }
    }
  }
}
export async function restoreTrip(transport: BackendTransport, id: string): Promise<TripPresentation | null> {
  const run = await transport('GET', '/api/runs/' + id)
  return run.stage === 'completed' && run.trip?.provenance === 'dsh' ? run.trip : null
}
export function createGenerator(transport: BackendTransport, onComplete?: (id: string) => void): GenerateTrip {
  return async (prompt, progress, signal) => {
    if (signal.aborted) throw Error('已取消')
    const initial = await transport('POST', '/api/runs', { prompt })
    const id = initial.id
    const cancel = () => { void transport('DELETE', '/api/runs/' + id).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { cancel(); throw Error('已取消') }
    try {
      for (let attempt = 0; attempt < 480; attempt++) {
        if (signal.aborted) throw Error('已取消')
        const run = await transport('GET', '/api/runs/' + id)
        if (signal.aborted) throw Error('已取消')
        if (run.stage === 'completed') { onComplete?.(id); return run.trip }
        if (run.stage === 'failed' || run.stage === 'cancelled') throw Error(run.error || '本次任务未完成')
        progress(labels[run.stage] || '正在处理…')
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      cancel()
      throw Error('等待超时，请查看后端任务记录')
    } finally { signal.removeEventListener('abort', cancel) }
  }
}
