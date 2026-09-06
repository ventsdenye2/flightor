import type { AviationProvider } from '../../aviation/providers/provider.js'
import type { ArtifactRepository } from '../../artifacts/repository.js'
import type { ConversationRepository } from '../../conversations/repository.js'
import type { FareProvider } from '../../fares/providers/provider.js'
import { AppError } from '../../lib/errors.js'
import type { UserMemoryRepository } from '../../memory/repository.js'
import type { TripRepository } from '../../trips/repository.js'
import type { ChatMessage } from '../runtime/model.js'
import { AgentRuntime } from '../runtime/runtime.js'

export interface CloudPlannerRepositories {
  trips: TripRepository
  conversations: ConversationRepository
  artifacts: ArtifactRepository
  memory: UserMemoryRepository
}

export interface CloudPlannerDependencies extends CloudPlannerRepositories {
  runtime: AgentRuntime
  aviation: AviationProvider
  fares: FareProvider
}

export interface CloudPlannerTurnInput {
  requestId: string
  tripId: string
  conversationId: string
  message: string
  generationId: string
  signal?: AbortSignal
}

export interface CloudPlannerTurnResult {
  reply: string
  tripVersion: number
  artifactRefs: string[]
  stopReason: string
}

const PLANNER_SYSTEM_PROMPT = `You are FlightOR Planner Agent, the only user-facing Agent.
Use tools for location and flight facts; never invent them. Keep current-trip state in Trip Context and only put explicit long-term preferences in User Memory. Route planning remains a deterministic FlightOR engine responsibility. Research output is advisory and never automatically becomes a required destination or event.`

function historyMessage(role: string, content: string): ChatMessage | undefined {
  if (role === 'system' || role === 'user') return { role, content }
  if (role === 'assistant') return { role: 'assistant', content }
  return undefined
}

export class CloudPlannerService {
  constructor(private readonly dependencies: CloudPlannerDependencies) {}

  async runTurn(input: CloudPlannerTurnInput): Promise<CloudPlannerTurnResult> {
    const trip = await this.dependencies.trips.getTrip(input.tripId)
    if (!trip) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    const conversation = await this.dependencies.conversations.get(input.conversationId)
    if (!conversation || conversation.tripId !== input.tripId) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Conversation was not found', 404)
    }

    const prior = await this.dependencies.conversations.listMessages(input.conversationId, 100)
    const memory = await this.dependencies.memory.getForAgent()
    const systemContent = memory?.markdown
      ? `${PLANNER_SYSTEM_PROMPT}\n\nEnabled User Memory (Markdown, user-owned):\n${memory.markdown}`
      : PLANNER_SYSTEM_PROMPT
    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...prior.flatMap(message => {
        const mapped = historyMessage(message.role, message.content)
        return mapped ? [mapped] : []
      }),
      { role: 'user', content: input.message }
    ]

    await this.dependencies.conversations.appendMessage({
      conversationId: input.conversationId,
      role: 'user',
      content: input.message,
      metadata: { request_id: input.requestId, generation_id: input.generationId }
    })

    const result = await this.dependencies.runtime.run({
      messages,
      context: {
        requestId: input.requestId,
        conversationId: input.conversationId,
        tripId: input.tripId,
        generationId: input.generationId,
        trips: this.dependencies.trips,
        artifacts: this.dependencies.artifacts,
        memory: this.dependencies.memory,
        aviation: this.dependencies.aviation,
        fares: this.dependencies.fares
      },
      ...(input.signal ? { signal: input.signal } : {})
    })
    const artifactRefs = [...new Set(result.traces.flatMap(trace => trace.artifactIds))]
    await this.dependencies.conversations.appendMessage({
      conversationId: input.conversationId,
      role: 'assistant',
      content: result.reply,
      metadata: {
        request_id: input.requestId,
        generation_id: input.generationId,
        artifact_refs: artifactRefs,
        stop_reason: result.stopReason,
        tool_traces: result.traces.map(trace => ({
          step: trace.agentStep,
          tool: trace.toolName,
          status: trace.toolResultStatus,
          artifact_ids: trace.artifactIds
        }))
      }
    })
    const current = await this.dependencies.trips.get(input.tripId)
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    return { reply: result.reply, tripVersion: current.version, artifactRefs, stopReason: result.stopReason }
  }
}
