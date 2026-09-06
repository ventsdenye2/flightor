import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { CloudPlannerService } from '../agent/cloud/service.js'
import { AgentRuntime } from '../agent/runtime/runtime.js'
import { createCoreToolRegistry } from '../agent/tools/core.js'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresConversationRepository } from '../conversations/postgres.js'
import { PostgresUserMemoryRepository } from '../memory/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'

export const cloudAgentRequestSchema = z.object({
  trip_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  message: z.string().trim().min(1).max(2_000)
}).strict()

export type CloudAgentServiceFactory = (trustedUserId: string) => CloudPlannerService

function defaultFactory(context: AppContext): CloudAgentServiceFactory {
  return userId => {
    if (!context.env.OPENROUTER_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter is not configured', 503)
    const trips = new PostgresTripRepository(context.db, userId)
    const conversations = new PostgresConversationRepository(context.db, userId)
    const artifacts = new PostgresArtifactRepository(context.db, userId)
    const memory = new PostgresUserMemoryRepository(context.db, userId)
    const runtime = new AgentRuntime(context.providers.openrouter, createCoreToolRegistry())
    return new CloudPlannerService({
      trips, conversations, artifacts, memory, runtime,
      aviation: context.providers.aviation,
      fares: context.providers.fares
    })
  }
}

export async function registerCloudAgentRoutes(
  app: FastifyInstance,
  context: AppContext,
  serviceForUser: CloudAgentServiceFactory = defaultFactory(context)
): Promise<void> {
  app.post('/v1/agent-v2/converse', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const identity = await authenticateRequest(request, context)
    const input = cloudAgentRequestSchema.parse(request.body)
    const service = serviceForUser(identity.userId)
    const result = await service.runTurn({
      requestId: request.id,
      tripId: input.trip_id,
      conversationId: input.conversation_id,
      message: input.message,
      generationId: uuidv7()
    })
    return reply.header('Cache-Control', 'no-store').send({
      reply: result.reply,
      trip_version: result.tripVersion,
      artifact_refs: result.artifactRefs,
      stop_reason: result.stopReason
    })
  })
}
