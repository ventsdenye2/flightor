import { request, USE_MOCK } from '../utils/request'
export interface ExploreTemplate {
  id: string; version: number
  template: { title: string; summary: string; category: string; routeConcept: string; suggestedDays: number; interests: string[]; experienceGoals: string[]; validFrom: string; validTo: string; anchorDestinations: Array<{ id: string; name: string }>; sourceFacts: Array<{ id: string; statement: string; sourceUrls: string[] }>; verification: { checkedAt?: string; expiresAt?: string } }
}
export async function listExplore(category?: string, before?: string): Promise<{ templates: ExploreTemplate[]; nextCursor: string | null }> {
  if (USE_MOCK) throw new Error('探索需要连接真实服务')
  return request({ url: `/v1/explore?limit=20${category ? `&category=${encodeURIComponent(category)}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`, retry: 1 })
}
export async function startExplore(item: ExploreTemplate, idempotencyKey: string): Promise<{ tripId: string; conversationId: string }> {
  return request({ url: `/v1/explore/${encodeURIComponent(item.id)}/start`, method: 'POST', data: { version: item.version, idempotencyKey }, retry: 0 })
}
