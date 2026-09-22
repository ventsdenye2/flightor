import type { ArtifactRepository } from '../artifacts/repository.js'
import { goalDeliverySchema } from '../agent/goals/completion.js'
import type { ConversationMessage } from '../conversations/repository.js'
import { GUIDE_LEGACY_REPLY, guidePublicationReply } from './publication.js'
import { finalPendingReply } from './finalization-schema.js'

/** Stable copy shown when an old guide message has no usable saved guide. */
export const LEGACY_GUIDE_HISTORY_NOTICE = GUIDE_LEGACY_REPLY
const GUIDE_DELIVERY_NOTICES = {
  not_requested: '攻略尚未保存。请继续规划后再查看已保存的攻略。',
  pending: '攻略仍在处理中，当前未形成可发布的保存结果。',
  partial: '攻略仅部分完成，当前未形成可发布的完整结果。',
  failed: '攻略保存未完成，当前未形成可发布的结果。',
  cancelled: '攻略处理已取消，当前未形成可发布的结果。'
} as const

export interface HistoryPublicationScope {
  locale?: 'zh' | 'en'
  tripContextVersion?: number
  flightSelectionRevision?: number | undefined
  checkFlightSelection?: boolean
  tripId: string
  conversationId: string
  artifacts: Pick<ArtifactRepository, 'get'>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function guideDelivery(metadata: Record<string, unknown>) {
  const delivery = goalDeliverySchema.safeParse(metadata.delivery)
  return delivery.success && (delivery.data.kind === 'travel_guide'
    || delivery.data.goals.some(goal => goal.kind === 'travel_guide')) ? delivery.data : undefined
}

function sameScope(record: { type: string; tripId: string; conversationId?: string }, scope: HistoryPublicationScope): boolean {
  return record.type === 'travel_guide' && record.tripId === scope.tripId
    && (record.conversationId === undefined || record.conversationId === scope.conversationId)
}

/**
 * Project one persisted assistant message at the public history boundary.
 * Stored conversation content remains untouched; only the response copy is
 * replaced. User messages are deliberately never interpreted as publications.
 */
export async function projectHistoricalGuideMessage(
  message: ConversationMessage,
  scope: HistoryPublicationScope
): Promise<ConversationMessage> {
  if (message.role !== 'assistant') return message
  const refs = strings(message.metadata.artifact_refs)
  const delivery = guideDelivery(message.metadata)
  const isGuideMessage = delivery !== undefined
  // In-flight and unsuccessful guide turns may contain arbitrary old model
  // prose. Replace it with a deterministic status notice; only satisfied
  // turns may publish a saved guide reply.
  if (delivery && delivery.status !== 'satisfied') {
    return { ...message, content: scope.locale === 'en' ? finalPendingReply('en') : GUIDE_DELIVERY_NOTICES[delivery.status] }
  }
  if (!isGuideMessage && refs.length === 0) return message

  for (const id of refs.slice(0, 100)) {
    const record = await scope.artifacts.get(id)
    if (!record || !sameScope(record, scope)) continue
    if ((scope.tripContextVersion !== undefined && record.tripContextVersion !== scope.tripContextVersion)
      || (scope.checkFlightSelection && (record.payload as { flightSelection?: { revision: number } })?.flightSelection?.revision !== scope.flightSelectionRevision)) {
      return { ...message, content: finalPendingReply(scope.locale ?? 'zh') }
    }
    return { ...message, content: guidePublicationReply(record, scope.locale ?? 'zh') }
  }
  return isGuideMessage ? { ...message, content: LEGACY_GUIDE_HISTORY_NOTICE } : message
}

export async function projectHistoricalGuideMessages(
  messages: ConversationMessage[],
  scope: HistoryPublicationScope
): Promise<ConversationMessage[]> {
  const cached = new Map<string, ReturnType<HistoryPublicationScope['artifacts']['get']>>()
  const artifacts = { get: (id: string) => {
    const existing = cached.get(id)
    if (existing) return existing
    const pending = scope.artifacts.get(id)
    cached.set(id, pending)
    return pending
  } }
  return Promise.all(messages.map(message => projectHistoricalGuideMessage(message, { ...scope, artifacts })))
}
