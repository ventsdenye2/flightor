// chatHistory — Taro storage adapter for the versioned chat history core.
import { getStorage, setStorage } from '../utils/storage'
import {
  CHAT_HISTORY_VERSION,
  makeChatHistoryPayload,
  sanitizeHistoryPayload,
  type ChatSessionRecord,
  type PersistedChatHistory
} from './chatHistoryCore'

export * from './chatHistoryCore'

export const CHAT_HISTORY_STORAGE_KEY = 'chat-history-v1'

export function loadChatHistory(): PersistedChatHistory {
  const stored = getStorage<unknown>(CHAT_HISTORY_STORAGE_KEY, null)
  if (typeof stored === 'string') {
    try {
      return sanitizeHistoryPayload(JSON.parse(stored))
    } catch {
      return { version: CHAT_HISTORY_VERSION, currentSessionId: '', sessions: [] }
    }
  }
  return sanitizeHistoryPayload(stored)
}

export function saveChatHistory(currentSessionId: string, sessions: ChatSessionRecord[]): void {
  setStorage(CHAT_HISTORY_STORAGE_KEY, makeChatHistoryPayload(currentSessionId, sessions))
}
