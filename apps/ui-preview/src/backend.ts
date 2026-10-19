import { createConversationClient, createGenerator, restoreTrip } from '../../../src/features/ui-experience/backendClient'
import type { BackendTransport } from '../../../src/features/ui-experience/backendClient'
const storageKey = 'flightor-dsh-last-completed-v1'
const transport: BackendTransport = async (method, path, body) => {
  const response = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const value = await response.json()
  if (!response.ok) throw Error(value.error || `后端请求失败 (${response.status})`)
  return value
}
export const generateTrip = createGenerator(transport, id => window.localStorage.setItem(storageKey, id))
const conversationKey = 'flightor-dsh-conversation-v1'
export const conversationClient = createConversationClient(transport, { get: () => window.localStorage.getItem(conversationKey), set: id => window.localStorage.setItem(conversationKey, id), clear: () => window.localStorage.removeItem(conversationKey) }, id => window.localStorage.setItem(storageKey, id))
export async function loadLastTrip() {
  const id = new URLSearchParams(window.location.search).get('run') || window.localStorage.getItem(storageKey)
  return id ? restoreTrip(transport, id) : null
}
