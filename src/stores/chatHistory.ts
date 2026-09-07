// chatHistory — Taro storage adapter for the versioned chat history core.
import { getStorage, removeStorage, setStorage } from '../utils/storage'
import {
  CHAT_HISTORY_VERSION,
  makeChatHistoryPayload,
  sanitizeHistoryPayload,
  type ChatSessionRecord,
  type PersistedChatHistory
} from './chatHistoryCore'

export * from './chatHistoryCore'

export const CHAT_HISTORY_STORAGE_KEY = 'chat-history-v1'
export const CLOUD_CHAT_HISTORY_STORAGE_PREFIX = 'chat-history-cloud-v1:'

let activeOwnerClearHandler: ((ownerId: string) => void) | undefined

export function registerCloudChatHistoryClearHandler(handler: (ownerId: string) => void): void {
  activeOwnerClearHandler = handler
}

function cloudStorageKey(ownerId: string): string {
  // UID is supplied by the authenticated backend identity. Keep the storage
  // key bounded and prevent punctuation from creating accidental key aliases.
  return `${CLOUD_CHAT_HISTORY_STORAGE_PREFIX}${ownerId.trim().slice(0, 160).replace(/[^a-zA-Z0-9_.:@-]/g, '_')}`
}

function readHistory(key: string): PersistedChatHistory {
  const stored = getStorage<unknown>(key, null)
  if (typeof stored === 'string') {
    try {
      return sanitizeHistoryPayload(JSON.parse(stored))
    } catch {
      return { version: CHAT_HISTORY_VERSION, currentSessionId: '', sessions: [] }
    }
  }
  return sanitizeHistoryPayload(stored)
}

/**
 * Legacy histories remain visible after login, but owner cloud material is
 * stored under a separate key and can be removed on logout without touching
 * favorites, search history, or the migration-readable legacy cache.
 */
export function loadChatHistory(ownerId?: string): PersistedChatHistory {
  if (!ownerId) return readHistory(CHAT_HISTORY_STORAGE_KEY)
  const owner = readHistory(cloudStorageKey(ownerId))
  const legacy = readHistory(CHAT_HISTORY_STORAGE_KEY)
  // Only anonymous legacy sessions are migratable. A legacy record carrying
  // another owner's cloud identity must never become visible after login as a
  // different owner.
  const anonymousLegacy = legacy.sessions.filter(session => !session.ownerId)
  const sessions = [...owner.sessions, ...anonymousLegacy.filter(session => !owner.sessions.some(item => item.id === session.id))]
  const legacyCurrentSessionId = anonymousLegacy.some(session => session.id === legacy.currentSessionId)
    ? legacy.currentSessionId
    : ''
  return sanitizeHistoryPayload({
    version: CHAT_HISTORY_VERSION,
    currentSessionId: owner.currentSessionId || legacyCurrentSessionId,
    sessions
  })
}

export function saveChatHistory(currentSessionId: string, sessions: ChatSessionRecord[], ownerId?: string): void {
  if (!ownerId) {
    setStorage(CHAT_HISTORY_STORAGE_KEY, makeChatHistoryPayload(currentSessionId, sessions))
    return
  }
  // Never copy anonymous legacy sessions into an owner-scoped cache. They stay
  // readable from the legacy key and are not replayed into the cloud API.
  const owned = sessions.filter(session => session.ownerId === ownerId)
  setStorage(cloudStorageKey(ownerId), makeChatHistoryPayload(currentSessionId, owned))
}

export function clearCloudChatHistory(ownerId: string): void {
  if (!ownerId.trim()) return
  removeStorage(cloudStorageKey(ownerId))
  // Older builds used the unscoped key. Remove only records carrying this
  // owner's cloud IDs there; anonymous migration histories remain readable.
  const legacy = readHistory(CHAT_HISTORY_STORAGE_KEY)
  const retained = legacy.sessions.filter(session => session.ownerId !== ownerId)
  if (retained.length !== legacy.sessions.length) {
    const currentSessionId = retained.some(session => session.id === legacy.currentSessionId)
      ? legacy.currentSessionId
      : (retained[0]?.id ?? '')
    setStorage(CHAT_HISTORY_STORAGE_KEY, makeChatHistoryPayload(currentSessionId, retained))
  }
  activeOwnerClearHandler?.(ownerId)
}
