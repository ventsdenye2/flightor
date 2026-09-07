import { request, USE_MOCK } from '../utils/request'
import type { CloudArtifactRef, CloudTripContextSummary } from './conversationService'
import type { RouteGenerationRunView } from './routeGenerationService'

export interface WorkspaceTrip {
  id: string; title: string; status: 'planning' | 'generated' | 'saved' | 'archived'
  version: number; contextVersion: number
  savedRoute: { artifactId: string; routeId: string; contextVersion: number } | null
  createdAt: string; updatedAt: string
}
export interface CloudWorkspace {
  trip: WorkspaceTrip; tripContextSummary: CloudTripContextSummary
  conversations: Array<{ id: string; tripId: string; title: string; status: string; createdAt: string; updatedAt: string }>
  conversationId: string | null
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; artifactRefs: CloudArtifactRef[]; createdAt: string }>
  artifactRefs: CloudArtifactRef[]
  routeGeneration?: RouteGenerationRunView
}
export interface CloudMemory { enabled: boolean; markdown: string; version: number; parseVersion: number; createdAt: string; updatedAt: string }

function requireCloud() { if (USE_MOCK) throw new Error('演示模式不提供云端保存，请切换到真实服务') }
export async function listCloudTrips(status?: WorkspaceTrip['status'], before?: string): Promise<{ trips: WorkspaceTrip[]; nextCursor: string | null }> {
  requireCloud()
  const query = ['limit=20', ...(status ? [`status=${status}`] : []), ...(before ? [`before=${encodeURIComponent(before)}`] : [])].join('&')
  return request({ url: `/v1/trips?${query}`, retry: 1 })
}
export async function getCloudWorkspace(tripId: string, conversationId?: string): Promise<CloudWorkspace> {
  requireCloud()
  return request({ url: `/v1/trips/${encodeURIComponent(tripId)}/workspace${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''}`, retry: 1 })
}
export async function updateCloudTrip(tripId: string, change: { expectedVersion: number; title?: string; status?: 'planning' | 'archived'; savedRoute?: { artifactId: string; routeId: string } | null }): Promise<WorkspaceTrip> {
  requireCloud()
  const result = await request<{ trip: WorkspaceTrip }>({ url: `/v1/trips/${encodeURIComponent(tripId)}`, method: 'PATCH', data: change, retry: 0 })
  return result.trip
}
export async function ensureWorkspaceConversation(workspace: CloudWorkspace): Promise<CloudWorkspace> {
  if (workspace.conversationId) return workspace
  const { conversation } = await request<{ conversation: { id: string } }>({ url: '/v1/conversations', method: 'POST', data: { trip_id: workspace.trip.id }, retry: 0 })
  return getCloudWorkspace(workspace.trip.id, conversation.id)
}
export async function getCloudMemory(): Promise<CloudMemory> {
  requireCloud()
  return (await request<{ memory: CloudMemory }>({ url: '/v1/memory', retry: 1 })).memory
}
export async function saveCloudMemory(markdown: string, expectedVersion: number): Promise<CloudMemory> {
  requireCloud()
  return (await request<{ memory: CloudMemory }>({ url: '/v1/memory', method: 'PUT', data: { markdown, expected_version: expectedVersion }, retry: 0 })).memory
}
export async function setCloudMemoryEnabled(enabled: boolean, expectedVersion: number): Promise<CloudMemory> {
  requireCloud()
  return (await request<{ memory: CloudMemory }>({ url: '/v1/memory/settings', method: 'PATCH', data: { enabled, expected_version: expectedVersion }, retry: 0 })).memory
}
