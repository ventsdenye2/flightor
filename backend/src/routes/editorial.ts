import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { AppError } from '../lib/errors.js'
import { authenticateAdmin, hashAdminPassword, issueAdminToken, verifyAdminPassword } from '../admin/auth.js'
import { PostgresDiscoveryRepository } from '../discovery/postgres.js'
import { candidateStatusSchema, contentTypeSchema, discoveryInputSchema, publicationSchema, tripTemplateSchema } from '../discovery/types.js'
import { canonicalizeTemplate, resolveDiscoveryLocations } from '../discovery/service.js'
import { PostgresLocationResolver } from '../aviation/location-resolver.js'

const idParams = z.object({ id: z.string().uuid() }).strict()
const versionBody = z.object({ expectedVersion: z.number().int().positive() }).strict()
export async function registerEditorialRoutes(app: FastifyInstance, context: AppContext) {
  const repo = new PostgresDiscoveryRepository(context.db), resolver = new PostgresLocationResolver(context.db)
  // A valid dummy digest makes unknown-account verification perform the same
  // expensive password work without storing or exposing a default password.
  let dummyHash: Promise<string> | undefined
  app.post('/v1/admin/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: request => request.ip } } }, async request => {
    const input = z.object({ email: z.email().max(254).transform(s => s.toLowerCase()), password: z.string().min(1).max(256) }).strict().parse(request.body)
    const user = await context.db.selectFrom('admin_users').selectAll().where('email', '=', input.email).executeTakeFirst()
    dummyHash ??= hashAdminPassword('unusable-account-timing-placeholder')
    const valid = await verifyAdminPassword(input.password, user?.password_hash ?? await dummyHash)
    if (!user || !user.active || !valid) throw new AppError('ADMIN_UNAUTHORIZED', 'Email or password is incorrect', 401)
    const identity = { id: user.id, email: user.email, role: user.role, tokenVersion: user.token_version }
    return { token: await issueAdminToken(identity, context.env.JWT_SECRET), user: { id: user.id, email: user.email, role: user.role } }
  })
  app.get('/v1/admin/me', async request => {
    const { id, email, role } = await authenticateAdmin(request, context)
    return { user: { id, email, role } }
  })
  app.post('/v1/admin/auth/logout', async request => {
    const identity = await authenticateAdmin(request, context)
    await context.db.updateTable('admin_users').set({ token_version: identity.tokenVersion + 1 }).where('id', '=', identity.id).where('token_version', '=', identity.tokenVersion).execute()
    return { loggedOut: true }
  })
  app.get('/v1/admin/dashboard', async request => { await authenticateAdmin(request, context); await repo.expire(); return repo.dashboard() })
  app.get('/v1/admin/templates', async request => {
    await authenticateAdmin(request, context)
    const query = z.object({ status: candidateStatusSchema.optional(), category: contentTypeSchema.optional(), before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(30) }).strict().parse(request.query)
    await repo.expire()
    return repo.list(query)
  })
  app.get('/v1/admin/templates/:id', async request => {
    await authenticateAdmin(request, context)
    const { id } = idParams.parse(request.params)
    const [candidate, versions] = await Promise.all([repo.get(id), repo.versions(id)])
    return { candidate, versions }
  })
  app.put('/v1/admin/templates/:id', async request => {
    const actor = await authenticateAdmin(request, context, 'reviewer'), { id } = idParams.parse(request.params)
    const input = z.object({ expectedVersion: z.number().int().positive(), template: tripTemplateSchema }).strict().parse(request.body)
    const template = await canonicalizeTemplate(resolver, input.template)
    return { candidate: await repo.save(id, input.expectedVersion, template, actor.id) }
  })
  app.post('/v1/admin/templates/:id/publish', async request => {
    const actor = await authenticateAdmin(request, context, 'reviewer'), { id } = idParams.parse(request.params)
    return { candidate: await repo.publish(id, publicationSchema.parse(request.body), actor.id) }
  })
  for (const action of ['unpublish', 'archive', 'reject', 'review'] as const) app.post(`/v1/admin/templates/:id/${action}`, async request => {
    const actor = await authenticateAdmin(request, context, 'reviewer'), { id } = idParams.parse(request.params)
    return { candidate: await repo.transition(id, versionBody.parse(request.body).expectedVersion, action, actor.id) }
  })
  app.post('/v1/admin/templates/:id/regenerate', async (request, reply) => {
    await authenticateAdmin(request, context, 'reviewer')
    const { id } = idParams.parse(request.params)
    const input = z.object({ expectedVersion: z.number().int().positive(), instruction: z.string().trim().min(1).max(1000) }).strict().parse(request.body)
    const current = await repo.get(id)
    if (current.version !== input.expectedVersion) throw new AppError('TEMPLATE_VERSION_CONFLICT', 'Reload the current version first', 409)
    const codes = current.template.anchorDestinations.map(l => l.iata).filter((v): v is string => Boolean(v))
    const runId = await repo.enqueue(discoveryInputSchema.parse({ destinationCodes: codes, interests: current.template.interests.slice(0, 12), questions: [current.template.title], researchTypes: ['activity', 'event', 'seasonal'], validFrom: current.template.validFrom, validTo: current.template.validTo, suggestedDays: current.template.suggestedDays, maxResults: 1, candidateId: id, expectedVersion: current.version, instruction: input.instruction }))
    return reply.code(202).send({ runId })
  })
  app.get('/v1/admin/discovery/runs', async request => { await authenticateAdmin(request, context); return { runs: await repo.runs() } })
  app.post('/v1/admin/discovery/runs', async (request, reply) => {
    await authenticateAdmin(request, context, 'reviewer')
    const input = discoveryInputSchema.parse(request.body)
    // Targeted regeneration is available only through the version-aware action.
    if (input.candidateId) throw new AppError('INVALID_REQUEST', 'Use the template regeneration action', 400)
    await resolveDiscoveryLocations(resolver, input.destinationCodes)
    return reply.code(202).send({ runId: await repo.enqueue(input) })
  })
  app.post('/v1/admin/discovery/runs/:id/retry', async (request, reply) => {
    await authenticateAdmin(request, context, 'reviewer')
    const { id } = idParams.parse(request.params)
    const run = (await repo.runs()).find(r => r.id === id)
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', 'Discovery run was not found', 404)
    if (run.status !== 'failed') throw new AppError('DISCOVERY_NOT_FAILED', 'Only failed runs can be retried', 409)
    return reply.code(202).send({ runId: await repo.enqueue(run.input) })
  })
  app.get('/v1/admin/discovery/sources', async request => { await authenticateAdmin(request, context); return { sources: await repo.sources() } })
  app.post('/v1/admin/discovery/sources', async (request, reply) => {
    await authenticateAdmin(request, context, 'admin')
    const input = z.object({ name: z.string().trim().min(1).max(120), input: discoveryInputSchema, intervalHours: z.number().int().min(6).max(720) }).strict().parse(request.body)
    if (input.input.candidateId) throw new AppError('INVALID_REQUEST', 'Scheduled sources cannot overwrite a template', 400)
    await resolveDiscoveryLocations(resolver, input.input.destinationCodes)
    return reply.code(201).send({ id: await repo.addSource(input) })
  })
  app.patch('/v1/admin/discovery/sources/:id', async request => {
    await authenticateAdmin(request, context, 'admin')
    const { id } = idParams.parse(request.params), { enabled } = z.object({ enabled: z.boolean() }).strict().parse(request.body)
    await repo.setSourceEnabled(id, enabled)
    return { id, enabled }
  })
}
