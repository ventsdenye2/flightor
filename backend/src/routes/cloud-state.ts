import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import type { ArtifactRepository } from '../artifacts/repository.js'
import { authenticateRequest } from '../auth/service.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import type { ConversationRepository } from '../conversations/repository.js'
import { PostgresUserMemoryRepository } from '../memory/postgres.js'
import type { UserMemoryRepository } from '../memory/repository.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import type { TripRepository } from '../trips/repository.js'
import { tripContextPatchSchema } from '../trips/types.js'

export interface CloudRepositories {
  trips: TripRepository
  conversations: ConversationRepository
  artifacts: ArtifactRepository
  memory: UserMemoryRepository
}

export type CloudRepositoryFactory = (trustedUserId: string) => CloudRepositories

const idParamsSchema = z.object({ id: z.string().uuid() }).strict()
const tripParamsSchema = z.object({ tripId: z.string().uuid() }).strict()
const conversationParamsSchema = z.object({ conversationId: z.string().uuid() }).strict()
export const createTripRequestSchema = z.object({
  title: z.string().trim().max(200).optional(),
  initial_context: tripContextPatchSchema.optional()
}).strict()
export const updateTripContextRequestSchema = z.object({
  patch: tripContextPatchSchema,
  expected_version: z.number().int().nonnegative()
}).strict()
export const createConversationRequestSchema = z.object({
  trip_id: z.string().uuid(),
  title: z.string().trim().max(200).optional()
}).strict()
export const updateMemoryRequestSchema = z.object({
  markdown: z.string(),
  expected_version: z.number().int().nonnegative()
}).strict()
export const updateMemorySettingsRequestSchema = z.object({
  enabled: z.boolean(),
  expected_version: z.number().int().nonnegative()
}).strict()

function defaultFactory(context: AppContext): CloudRepositoryFactory {
  return userId => ({
    trips: new PostgresTripRepository(context.db, userId),
    conversations: new PostgresConversationRepository(context.db, userId),
    artifacts: new PostgresArtifactRepository(context.db, userId),
    memory: new PostgresUserMemoryRepository(context.db, userId)
  })
}

export async function registerCloudStateRoutes(
  app: FastifyInstance,
  context: AppContext,
  repositoriesForUser: CloudRepositoryFactory = defaultFactory(context)
): Promise<void> {
  const repositories = async (request: Parameters<typeof authenticateRequest>[0]) => {
    const identity = await authenticateRequest(request, context)
    return repositoriesForUser(identity.userId)
  }

  app.post('/v1/trips', async (request, reply) => {
    const input = createTripRequestSchema.parse(request.body)
    const repos = await repositories(request)
    const trip = await repos.trips.create({
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.initial_context === undefined ? {} : { initialContext: input.initial_context })
    })
    return reply.code(201).send({ trip })
  })

  app.get('/v1/trips/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const trip = await (await repositories(request)).trips.getTrip(id)
    if (!trip) return reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Trip was not found' } })
    return reply.send({ trip })
  })

  app.put('/v1/trips/:tripId/context', async (request, reply) => {
    const { tripId } = tripParamsSchema.parse(request.params)
    const input = updateTripContextRequestSchema.parse(request.body)
    const contextValue = await (await repositories(request)).trips.update(tripId, input.patch, input.expected_version)
    return reply.send({ trip_context: contextValue })
  })

  app.post('/v1/conversations', async (request, reply) => {
    const input = createConversationRequestSchema.parse(request.body)
    const conversation = await (await repositories(request)).conversations.create({
      tripId: input.trip_id,
      ...(input.title === undefined ? {} : { title: input.title })
    })
    return reply.code(201).send({ conversation })
  })

  app.get('/v1/conversations/:conversationId', async (request, reply) => {
    const { conversationId } = conversationParamsSchema.parse(request.params)
    const conversation = await (await repositories(request)).conversations.get(conversationId)
    if (!conversation) return reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Conversation was not found' } })
    return reply.send({ conversation })
  })

  app.get('/v1/conversations/:conversationId/messages', async (request, reply) => {
    const { conversationId } = conversationParamsSchema.parse(request.params)
    const messages = await (await repositories(request)).conversations.listMessages(conversationId)
    return reply.send({ messages })
  })

  app.get('/v1/artifacts/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const artifact = await (await repositories(request)).artifacts.get(id)
    if (!artifact) return reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Artifact was not found' } })
    return reply.send({ artifact })
  })

  app.get('/v1/memory', async (request, reply) => {
    return reply.send({ memory: await (await repositories(request)).memory.get() })
  })

  app.put('/v1/memory', async (request, reply) => {
    const input = updateMemoryRequestSchema.parse(request.body)
    const memory = await (await repositories(request)).memory.updateMarkdown(input.markdown, input.expected_version)
    return reply.send({ memory })
  })

  app.patch('/v1/memory/settings', async (request, reply) => {
    const input = updateMemorySettingsRequestSchema.parse(request.body)
    const memory = await (await repositories(request)).memory.setEnabled(input.enabled, input.expected_version)
    return reply.send({ memory })
  })
}
