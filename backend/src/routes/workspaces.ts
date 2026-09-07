import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { PostgresWorkspaceRepository } from '../workspaces/postgres.js'
import { workspacePatchSchema, type WorkspaceRepository } from '../workspaces/types.js'

const idSchema = z.object({ id: z.string().uuid() }).strict()
export async function registerWorkspaceRoutes(app: FastifyInstance, context: AppContext, factory: (userId: string) => WorkspaceRepository = id => new PostgresWorkspaceRepository(context.db, id)) {
  const repo = async (request: Parameters<typeof authenticateRequest>[0]) => factory((await authenticateRequest(request, context)).userId)
  app.get('/v1/trips', async request => {
    const r = await repo(request)
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().uuid().optional(), status: z.enum(['planning', 'generated', 'saved', 'archived']).optional() }).strict().parse(request.query)
    return r.list({ limit: query.limit, ...(query.before ? { before: query.before } : {}), ...(query.status ? { status: query.status } : {}) })
  })
  app.get('/v1/trips/:id/workspace', async request => {
    const r = await repo(request), { id } = idSchema.parse(request.params)
    const query = z.object({ conversationId: z.string().uuid().optional() }).strict().parse(request.query)
    return r.get(id, query.conversationId)
  })
  app.patch('/v1/trips/:id', async request => {
    const r = await repo(request), { id } = idSchema.parse(request.params)
    return { trip: await r.update(id, workspacePatchSchema.parse(request.body)) }
  })
}
