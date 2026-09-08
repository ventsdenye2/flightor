import { z } from 'zod'
import type { TripContext } from '../trips/types.js'

export const routeGenerationStatusSchema = z.enum([
  'queued', 'running', 'succeeded', 'failed', 'cancelled'
])
export type RouteGenerationStatus = z.infer<typeof routeGenerationStatusSchema>

export const routeGenerationProgressStageSchema = z.enum([
  'queued',
  'searching_connections',
  'planning_paths',
  'optimizing_routes',
  'persisting_artifacts',
  'completed',
  'failed',
  'cancelled'
])
export type RouteGenerationProgressStage = z.infer<typeof routeGenerationProgressStageSchema>

export const routeGenerationRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  expectedTripVersion: z.number().int().nonnegative().optional()
}).strict()
export type RouteGenerationRequest = z.infer<typeof routeGenerationRequestSchema>

export const routeGenerationPathParamsSchema = z.object({ tripId: z.string().uuid() }).strict()
export const routeGenerationRunParamsSchema = z.object({ id: z.string().uuid() }).strict()

export const routeGenerationIdempotencyKeySchema = z.string()
  .trim()
  .min(1)
  .max(200)
  .refine(value => !/[\u0000-\u001f\u007f]/u.test(value), 'Idempotency-Key contains control characters')

export const routeGenerationErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  message: z.string().min(1).max(240)
}).strict()

export const routeGenerationRunSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  goalId: z.string().uuid().optional(),
  goalRunId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).max(200),
  contextVersion: z.number().int().nonnegative(),
  status: routeGenerationStatusSchema,
  stale: z.boolean().optional(),
  progress: z.object({
    stage: routeGenerationProgressStageSchema,
    percent: z.number().int().min(0).max(100)
  }).strict(),
  resultArtifactId: z.string().uuid().optional(),
  error: routeGenerationErrorSchema.optional(),
  warnings: z.array(z.string().min(1).max(240)).max(40),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).optional(),
  finishedAt: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((value, context) => {
  if ((value.goalId === undefined) !== (value.goalRunId === undefined)) {
    context.addIssue({ code: 'custom', path: ['goalRunId'], message: 'Goal and Goal run lineage must be present together' })
  }
})
export type RouteGenerationRunView = z.infer<typeof routeGenerationRunSchema>

export interface RouteGenerationRunRecord {
  id: string
  ownerId: string
  tripId: string
  conversationId?: string
  goalId?: string
  goalRunId?: string
  idempotencyKey: string
  requestHash: string
  contextSnapshot: TripContext
  contextVersion: number
  status: RouteGenerationStatus
  progressStage: RouteGenerationProgressStage
  progressPercent: number
  resultArtifactId?: string
  errorCode?: string
  errorMessage?: string
  warnings: string[]
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export type RouteGenerationRunMutation = {
  status?: RouteGenerationStatus
  progressStage?: RouteGenerationProgressStage
  progressPercent?: number
  resultArtifactId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  warnings?: string[]
  startedAt?: string | null
  finishedAt?: string | null
}

export interface CreateRouteGenerationRunInput {
  ownerId: string
  tripId: string
  conversationId?: string
  goalId?: string
  goalRunId?: string
  idempotencyKey: string
  requestHash: string
  contextVersion: number
  contextSnapshot: TripContext
}

export interface RouteGenerationRunRepository {
  /** Creates one durable run and its one route_generation job, or returns the idempotent run. */
  createOrGet(input: CreateRouteGenerationRunInput): Promise<{ run: RouteGenerationRunRecord; created: boolean }>
  get(runId: string): Promise<RouteGenerationRunRecord | undefined>
  claim(runId: string): Promise<RouteGenerationRunRecord | undefined>
  update(runId: string, mutation: RouteGenerationRunMutation): Promise<RouteGenerationRunRecord | undefined>
  cancel(runId: string): Promise<RouteGenerationRunRecord | undefined>
}

export function toRouteGenerationRunView(run: RouteGenerationRunRecord, options: { stale?: boolean } = {}): RouteGenerationRunView {
  const view = {
    id: run.id,
    tripId: run.tripId,
    ...(run.conversationId === undefined ? {} : { conversationId: run.conversationId }),
    ...(run.goalId === undefined ? {} : { goalId: run.goalId }),
    ...(run.goalRunId === undefined ? {} : { goalRunId: run.goalRunId }),
    idempotencyKey: run.idempotencyKey,
    contextVersion: run.contextVersion,
    status: run.status,
    ...(options.stale === undefined ? {} : { stale: options.stale }),
    progress: { stage: run.progressStage, percent: run.progressPercent },
    ...(run.status === 'succeeded' && run.resultArtifactId !== undefined
      ? { resultArtifactId: run.resultArtifactId }
      : {}),
    ...(run.errorCode !== undefined
      ? { error: { code: run.errorCode, message: run.errorMessage ?? 'Route generation failed' } }
      : {}),
    warnings: [...run.warnings],
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt })
  }
  return routeGenerationRunSchema.parse(view)
}
