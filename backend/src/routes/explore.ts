import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { ExploreRepository } from '../discovery/explore.js'
import { contentTypeSchema } from '../discovery/types.js'

export async function registerExploreRoutes(app: FastifyInstance, context: AppContext) {
  const repo = new ExploreRepository(context.db)
  const params = z.object({ id: z.string().uuid() }).strict()
  app.get('/v1/explore', async request => repo.list(z.object({ category: contentTypeSchema.optional(), before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict().parse(request.query)))
  app.get('/v1/explore/:id', async request => repo.get(params.parse(request.params).id))
  app.post('/v1/explore/:id/start', async request => {
    const { userId } = await authenticateRequest(request, context)
    const body = z.object({ version: z.number().int().positive(), idempotencyKey: z.string().uuid() }).strict().parse(request.body)
    return repo.seed(userId, params.parse(request.params).id, body.version, body.idempotencyKey)
  })
}
