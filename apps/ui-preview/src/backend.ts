import { createConversationClient, createGenerator, createPlaceMediaLoader, createPlaceLocationLoader, restoreTrip } from '../../../src/features/ui-experience/backendClient'
import type { BackendTransport } from '../../../src/features/ui-experience/backendClient'
const storageKey = 'flightor-dsh-last-completed-v1'
const transport: BackendTransport = async (method, path, body) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(path, { method, signal: controller.signal, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    const value = await response.json()
    if (!response.ok) throw Error(value.error || `后端请求失败 (${response.status})`)
    return value
  } catch (error) {
    if (controller.signal.aborted) throw Error('连接后端超时，请检查服务后刷新查看回复')
    throw error
  } finally { window.clearTimeout(timeout) }
}
export const generateTrip = createGenerator(transport, id => window.localStorage.setItem(storageKey, id))
export const loadPlaceMedia = createPlaceMediaLoader(transport)
export const loadPlaceLocation = createPlaceLocationLoader(transport)
const conversationKey = 'flightor-dsh-conversation-v1'
const tripContextKey = 'flightor-session-trip-context-v1'
const tripCoversKey = 'flightor-trip-covers-v1'
export const conversationClient = createConversationClient(transport, { get: () => window.localStorage.getItem(conversationKey), set: id => window.localStorage.setItem(conversationKey, id), clear: () => window.localStorage.removeItem(conversationKey),
  getTripContext: () => { try { return JSON.parse(window.localStorage.getItem(tripContextKey) || 'null') } catch { return null } },
  setTripContext: value => { if (value) window.localStorage.setItem(tripContextKey, JSON.stringify(value)); else window.localStorage.removeItem(tripContextKey) },
  getTripCovers: () => { try { return JSON.parse(window.localStorage.getItem(tripCoversKey) || '{}') } catch { return {} } },
  setTripCovers: value => window.localStorage.setItem(tripCoversKey,JSON.stringify(value))
}, id => window.localStorage.setItem(storageKey, id))
export async function loadLastTrip() {
  const id = new URLSearchParams(window.location.search).get('run') || window.localStorage.getItem(storageKey)
  return id ? restoreTrip(transport, id) : null
}
