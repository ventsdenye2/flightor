import type { ConversationDelivery } from '../../services/conversationService'

/** Only a server-verified delivery can produce a completed result label. */
export function conversationDeliveryLabel(delivery: ConversationDelivery | undefined, locale: 'zh' | 'en'): string {
  if (!delivery || delivery.status === 'not_requested') return ''
  const labels = {
    pending: ['仍在处理，结果尚未完成。', 'Work is still in progress. The result is not complete.'],
    satisfied: ['结果已完成并保存。', 'The result is complete and saved.'],
    partial: ['已完成部分内容，仍有内容待完成。', 'Part of the request is complete; some work remains.'],
    failed: ['本次请求未完成，可继续对话重试。', 'This request did not complete. You can continue the conversation to retry.'],
    cancelled: ['已取消本次处理。', 'This request was cancelled.']
  }
  return labels[delivery.status][locale === 'zh' ? 0 : 1]
}
