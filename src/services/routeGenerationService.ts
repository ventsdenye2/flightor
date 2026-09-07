// Authenticated explicit route-generation run client.
// Conversation suggestions are metadata; this service is the only client path
// allowed to create/poll/cancel a deterministic generation run.
import { request, USE_MOCK } from '../utils/request'

export type RouteGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type RouteGenerationProgressStage =
  | 'queued'
  | 'searching_connections'
  | 'planning_paths'
  | 'optimizing_routes'
  | 'persisting_artifacts'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RouteGenerationProgress {
  stage: RouteGenerationProgressStage
  percent: number
}

export interface RouteGenerationError {
  code: string
  message: string
}

export interface RouteGenerationRunView {
  id: string
  tripId: string
  conversationId?: string
  idempotencyKey: string
  contextVersion: number
  status: RouteGenerationStatus
  stale?: boolean
  progress: RouteGenerationProgress
  resultArtifactId?: string
  error?: RouteGenerationError
  warnings: string[]
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export interface CreateRouteGenerationRunResult {
  run: RouteGenerationRunView
  created: boolean
}

export interface CreateRouteGenerationRunOptions {
  tripId: string
  conversationId?: string
  expectedTripVersion?: number
  idempotencyKey: string
}

export function isRouteGenerationTerminal(status: RouteGenerationStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function unavailable(): never {
  throw new Error('ROUTE_GENERATION_UNAVAILABLE')
}

/** Create one run. The caller owns/reuses idempotencyKey across retries. */
export async function createRouteGenerationRun(options: CreateRouteGenerationRunOptions): Promise<CreateRouteGenerationRunResult> {
  if (USE_MOCK) return unavailable()
  const body: Record<string, unknown> = {
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    ...(options.expectedTripVersion === undefined ? {} : { expectedTripVersion: options.expectedTripVersion })
  }
  return request<CreateRouteGenerationRunResult>({
    url: `/v1/trips/${encodeURIComponent(options.tripId)}/route-generation-runs`,
    method: 'POST',
    data: body,
    header: { 'Idempotency-Key': options.idempotencyKey },
    retry: 0,
    timeout: 30_000
  })
}

export async function getRouteGenerationRun(runId: string): Promise<RouteGenerationRunView> {
  if (USE_MOCK) return unavailable()
  const response = await request<{ run: RouteGenerationRunView }>({
    url: `/v1/route-generation-runs/${encodeURIComponent(runId)}`,
    method: 'GET',
    retry: 0,
    timeout: 15_000
  })
  return response.run
}

/** DELETE is the server's cooperative cancellation operation. */
export async function cancelRouteGenerationRun(runId: string): Promise<RouteGenerationRunView> {
  if (USE_MOCK) return unavailable()
  const response = await request<{ run: RouteGenerationRunView }>({
    url: `/v1/route-generation-runs/${encodeURIComponent(runId)}`,
    method: 'DELETE',
    retry: 0,
    timeout: 15_000
  })
  return response.run
}

export function makeRouteGenerationIdempotencyKey(): string {
  const part = () => Math.floor(Math.random() * 0x1_0000).toString(16).padStart(4, '0')
  return `route-${Date.now().toString(36)}-${part()}${part()}`
}
