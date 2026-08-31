import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import type { JsonValue } from '../db/types.js'
import { enqueueJob } from '../jobs/repository.js'
import { AppError } from '../lib/errors.js'

const locationSchema = z.object({
  airportCode: z.string().trim().length(3).transform(value => value.toUpperCase())
})

const routeSchema = z.object({
  origin: z.string().trim().length(3).transform(value => value.toUpperCase()),
  destination: z.string().trim().length(3).transform(value => value.toUpperCase()),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date().optional(),
  includeConnections: z.boolean().default(true),
  limit: z.number().int().min(1).max(1000).default(100)
}).superRefine((input, ctx) => {
  if (input.origin === input.destination) {
    ctx.addIssue({ code: 'custom', message: 'Origin and destination must be different', path: ['destination'] })
  }
  if (input.dateTo) {
    const from = Date.parse(`${input.dateFrom}T00:00:00Z`)
    const to = Date.parse(`${input.dateTo}T00:00:00Z`)
    const days = (to - from) / 86_400_000
    if (days < 0 || days > 6) {
      ctx.addIssue({ code: 'custom', message: 'Connections date range must be between 1 and 7 days', path: ['dateTo'] })
    }
  }
})

const runParamsSchema = z.object({ id: z.uuid() })
const jobParamsSchema = z.object({ id: z.string().regex(/^\d+$/) })

function requireAdmin(request: FastifyRequest, context: AppContext): void {
  const expected = context.env.ADMIN_API_TOKEN
  if (!expected) throw new AppError('ADMIN_DISABLED', 'Admin sync API is not configured', 503)
  const supplied = request.headers['x-admin-token']
  if (typeof supplied !== 'string') throw new AppError('UNAUTHORIZED', 'X-Admin-Token is required', 401)
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new AppError('UNAUTHORIZED', 'Admin token is invalid', 401)
  }
}

export async function registerAdminSyncRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/admin/sync/oag/location', async (request, reply) => {
    requireAdmin(request, context)
    const input = locationSchema.parse(request.body)
    const jobId = await enqueueJob(context.db, 'oag_sync_location', input as unknown as JsonValue, { maxAttempts: 3 })
    return reply.code(202).send({ jobId, status: 'queued', statusUrl: `/v1/admin/jobs/${jobId}` })
  })

  app.post('/v1/admin/sync/oag/route', async (request, reply) => {
    requireAdmin(request, context)
    const input = routeSchema.parse(request.body)
    const jobId = await enqueueJob(context.db, 'oag_sync_route', input as unknown as JsonValue, { maxAttempts: 3 })
    return reply.code(202).send({ jobId, status: 'queued', statusUrl: `/v1/admin/jobs/${jobId}` })
  })

  app.get('/v1/admin/jobs/:id', async request => {
    requireAdmin(request, context)
    const params = jobParamsSchema.parse(request.params)
    const job = await context.db.selectFrom('jobs')
      .select([
        'id', 'type', 'status', 'attempts', 'max_attempts', 'last_error',
        'run_at', 'locked_at', 'completed_at', 'created_at', 'updated_at'
      ])
      .where('id', '=', params.id)
      .executeTakeFirst()
    if (!job) throw new AppError('JOB_NOT_FOUND', 'Job was not found', 404)
    return { job }
  })

  app.get('/v1/admin/sync-runs/:id', async request => {
    requireAdmin(request, context)
    const params = runParamsSchema.parse(request.params)
    const run = await context.db.selectFrom('sync_runs')
      .select([
        'public_id', 'provider', 'dataset', 'status', 'rows_seen', 'rows_written',
        'error_summary', 'started_at', 'finished_at', 'created_at'
      ])
      .where('public_id', '=', params.id)
      .executeTakeFirst()
    if (!run) throw new AppError('SYNC_RUN_NOT_FOUND', 'Sync run was not found', 404)
    return { run }
  })
}
