import type { Activity, MediaPresentation, TripPresentation } from './presentation'
import type { FlightOptions, FlightSelection } from './flightOptions'
export type BackendTransport = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<any>
export type PlaceMediaLoader = (activity: Activity, destination: string) => Promise<MediaPresentation | null>
export interface PlaceLocation { latitude: number; longitude: number; source: { label: string; url: string; status: 'unverified' } }
export type PlaceLocationLoader = (activity: Activity) => Promise<PlaceLocation | null>
export function createPlaceLocationLoader(transport: BackendTransport): PlaceLocationLoader {
  const pending = new Map<string, Promise<PlaceLocation | null>>()
  return activity => {
    if (activity.imageQuery === null || !activity.area) return Promise.resolve(null)
    const body = { name: activity.name, query: activity.imageQuery || activity.name, city: activity.area }
    const key = JSON.stringify(body)
    if (!pending.has(key)) pending.set(key, transport('POST', '/api/place-locations', body).then(result => {
      if (result.status === 'unavailable') pending.delete(key)
      return result.location || null
    }).catch(() => { pending.delete(key); return null }))
    return pending.get(key)!
  }
}
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
  } catch (error) { cancel(); throw error }
  finally { signal.removeEventListener('abort', cancel) }
}
export interface ConversationMessage { id: string; role: 'user' | 'assistant'; content: string; flightOptions?: FlightOptions | null; selectedFlight?: FlightSelection | null; flightSelectionLocked?: boolean; trip?: TripPresentation }
export interface Conversation { id: string; messages: ConversationMessage[]; flightOptions?: FlightOptions | null; selectedFlight?: FlightSelection | null; flightSelectionLocked?: boolean }
export interface ConversationUpdate { conversation?: Conversation; flightOptions?: FlightOptions; stage: string; progress?: { text: string; role: string; updatedAt: string } }
export interface ConversationResult { conversation: Conversation; trip?: TripPresentation }
export interface FlightSearchQuery {
  origin: string; destination: string; departureDate: string; tripType: 'one_way' | 'round_trip'; returnDate?: string
  adults: number; cabin: 'economy'; currency: 'CNY'
}
export interface FlightLocation {
  code: string; kind: 'city' | 'airport'; label: string; name: string; city?: string; country?: string; airports: string[]; value: string
}
export interface ConversationClient {
  load: () => Promise<Conversation | null>
  reset: () => void
  resumeTrip?: (tripId: string) => Promise<Conversation>
  subscribe?: (listener: () => void) => () => void
  listTrips?: () => Promise<SavedTripSummary[]>
  loadTrip?: (id: string) => Promise<TripPresentation>
  archiveTrip?: (id: string, archived: boolean) => Promise<void>
  rememberTripCover?: (id: string, media: MediaPresentation) => void
  selectFlight: (selection: FlightSelection | null, signal?: PlanSignal) => Promise<Conversation>
  loadFlightDetails?: (selection: FlightSelection, signal: PlanSignal) => Promise<Conversation>
  send: (message: string, progress: (text: string, update: ConversationUpdate) => void, signal: PlanSignal, action?: 'chat' | 'plan') => Promise<ConversationResult>
  searchFlights?: (query: FlightSearchQuery, progress: (text: string) => void, signal: PlanSignal) => Promise<Conversation>
  searchLocations?: (query: string) => Promise<FlightLocation[]>
}
export interface SavedTripSummary extends Pick<TripPresentation, 'id' | 'title' | 'destination' | 'dates' | 'durationDays' | 'travelers' | 'route' | 'cover' | 'status'> {
  archived: boolean; contextAvailable: boolean; createdAt: string | null; completedAt: string | null
}
export type TripContextReference = NonNullable<TripPresentation['context']>
export interface ConversationStorage {
  get: () => string | null; set: (id: string) => void; clear: () => void
  getTripContext?: () => TripContextReference | null
  setTripContext?: (context: TripContextReference | null) => void
  getTripCovers?: () => Record<string, MediaPresentation>
  setTripCovers?: (covers: Record<string, MediaPresentation>) => void
}
export function createConversationClient(transport: BackendTransport, storage: ConversationStorage, onTrip?: (id: string) => void): ConversationClient {
  let conversationId = storage.get()
  const tripCovers = storage.getTripCovers?.() || {}
  let tripContext = storage.getTripContext?.() || null
  if (tripContext?.conversationId !== conversationId) { tripContext = null; storage.setTripContext?.(null) }
  let generation = 0, switching = false, blocked = ''
  const requests = new Set<PlanCancellation>(), listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  const changeSession = () => {
    generation++; requests.forEach(request => request.abort()); requests.clear()
    conversationId = null; tripContext = null; storage.clear(); storage.setTripContext?.(null); blocked = ''; notify()
    return generation
  }
  const assertCurrent = (version: number, signal?: PlanSignal) => {
    if (version !== generation || signal?.aborted) throw Error('已取消：对话已经切换')
  }
  const assertReady = () => {
    if (switching) throw Error('正在恢复原对话，请稍候')
    if (blocked) throw Error(blocked)
  }
  const validate = (value: Conversation, expected: string | null) => {
    if (!value?.id || !Array.isArray(value.messages) || (expected && value.id !== expected)) throw Error('对话归属不一致，已停止更新，请重新打开原对话。')
    return value
  }
  const inSession = async <T,>(signal: PlanSignal | undefined, work: (scope: { id: string | null; signal: PlanSignal; check: () => void; adopt: (value: Conversation) => Conversation }) => Promise<T>): Promise<T> => {
    assertReady()
    if (requests.size) throw Error('请等待当前请求结束或先停止它')
    const version = generation, controller = new PlanCancellation()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    requests.add(controller)
    let expected = conversationId
    const check = () => assertCurrent(version, controller.signal)
    const adopt = (value: Conversation) => {
      check(); validate(value, expected)
      expected = value.id
      if (conversationId !== value.id) { conversationId = value.id; storage.set(value.id) }
      return value
    }
    try { check(); return await work({ id: expected, signal: controller.signal, check, adopt }) }
    finally { requests.delete(controller); signal?.removeEventListener('abort', abort) }
  }
  return {
    async listTrips() { return (await transport('GET','/api/trips')).trips.map((trip: SavedTripSummary) => tripCovers[trip.id]?.src ? {...trip,cover:tripCovers[trip.id]} : trip) },
    async loadTrip(id) {
      const trip = await restoreTrip(transport,id.replace(/^live-/,''))
      if (!trip || (trip.id !== id && trip.id !== 'live-'+id)) throw Error('未取得所选行程，请刷新列表后重试。')
      return tripCovers[trip.id]?.src ? {...trip,cover:tripCovers[trip.id]} : trip
    },
    async archiveTrip(id, archived) { await transport('POST','/api/trips/'+encodeURIComponent(id)+'/archive',{archived}) },
    rememberTripCover(id, media) {
      if (!media.src || tripCovers[id]?.src === media.src) return
      tripCovers[id] = media
      try { storage.setTripCovers?.({...tripCovers}) } catch { /* Optional cover cache must not interrupt the overview. */ }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async searchLocations(query) { return (await transport('GET', '/api/flight-locations?q=' + encodeURIComponent(query))).locations },
    async load() {
      assertReady()
      const version = generation, id = conversationId
      if (!id) return null
      const value = await transport('GET', '/api/conversations/' + id)
      assertCurrent(version); return validate(value, id)
    },
    reset() { switching = false; changeSession() },
    async resumeTrip(tripId) {
      switching = true
      const version = changeSession()
      try {
        const result = await transport('GET', '/api/trips/' + encodeURIComponent(tripId) + '/context')
        assertCurrent(version)
        const context = result.context, value = validate(result.conversation, context?.conversationId || null)
        const selectedTripId = context?.tripId || tripId
        if (context?.runId !== tripId.replace(/^live-/,'') || (selectedTripId !== tripId && selectedTripId !== 'live-'+tripId) || !context?.conversationId || !value.messages.some(message => message.id === context.messageId && message.role === 'assistant' && message.trip?.id === selectedTripId)) throw Error('行程与原对话不匹配')
        conversationId = value.id; tripContext = context; storage.set(value.id); storage.setTripContext?.(context); switching = false; onTrip?.(context.runId); notify()
        return value
      } catch (error) {
        assertCurrent(version)
        switching = false; blocked = '原对话恢复失败，请重试恢复，或点击重新开始。'; notify()
        throw error
      }
    },
    async selectFlight(selection, signal) {
      return inSession(signal, async scope => {
        if (!scope.id) throw Error('请先查询航班')
        const value = selection ? (await pollRun(transport, '/api/flights/details', { conversationId: scope.id, selection, select: true }, scope.signal, () => {})).conversation
          : await untilCancelled(transport('POST', '/api/conversations/' + scope.id + '/flight-selection', { selection }), scope.signal)
        return scope.adopt(value)
      })
    },
    async loadFlightDetails(selection, signal) {
      return inSession(signal, async scope => {
        if (!scope.id) throw Error('请先查询航班')
        return scope.adopt((await pollRun(transport, '/api/flights/details', { conversationId: scope.id, selection, select: false }, scope.signal, () => {})).conversation)
      })
    },
    async searchFlights(query, progress, signal) {
      return inSession(signal, async scope => {
        const run = await pollRun(transport, '/api/flights/search', { query, conversationId: scope.id }, scope.signal, run => {
          scope.check(); progress(run.progress?.text || '正在查询航班…')
        })
        scope.check()
        if (!run.conversation?.flightOptions) throw Error('未取得航班结果，请重试')
        return scope.adopt(run.conversation)
      })
    },
    async send(message, progress, signal, action = 'chat') {
      return inSession(signal, async scope => {
        const run = await pollRun(transport, '/api/conversations/turns', { message, conversationId: scope.id, action, ...(tripContext ? {tripContext} : {}) }, scope.signal, run => {
          scope.check()
          if (run.conversation) scope.adopt(run.conversation)
          progress(run.progress?.text || labels[run.stage] || '正在处理…', run)
        })
        scope.check(); scope.adopt(run.conversation)
        if (run.trip) {
          const anchor = run.conversation.messages.find((message: ConversationMessage) => message.role === 'assistant' && message.trip?.id === run.trip.id)
          if (!anchor || (run.trip.id !== run.id && run.trip.id !== 'live-'+run.id) || (run.trip.context && run.trip.context.conversationId !== run.conversation.id)) throw Error('行程与当前对话归属不一致，已停止更新。')
          tripContext = { conversationId: run.conversation.id, messageId: anchor.id, runId: run.id, tripId: run.trip.id }
          storage.setTripContext?.(tripContext)
          onTrip?.(run.id)
        }
        return { conversation: run.conversation, trip: run.trip }
      })
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
