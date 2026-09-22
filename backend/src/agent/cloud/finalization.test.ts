import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { saveWorkspaceArtifact } from '../../artifacts/workspace.js'
import { InMemoryTripRepository } from '../../trips/repository.js'
import { InMemoryConversationRepository } from '../../conversations/repository.js'
import { InMemoryUserMemoryRepository } from '../../memory/repository.js'
import { MockAviationProvider } from '../../aviation/providers/mock.js'
import { MockFareProvider } from '../../fares/providers/mock.js'
import { UnavailableResearchAgent } from '../../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../../flight-routing/unavailable.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { ToolRegistry } from '../runtime/registry.js'
import { workspaceScope } from '../tools/workspace-scope.js'
import { CloudPlannerService } from './service.js'
import { sourceRef } from '../../travel-guides/finalization.js'
import { publicationFor, projectGuideRecord } from '../../travel-guides/publication.js'

describe('CloudPlanner publication tail', () => {
  it('saves a hidden draft, edits through the same client/model, and never edits chat/read turns', async () => {
    const sample = JSON.parse(readFileSync(new URL('../../../test/fixtures/g1-publication-v1-original-samples.json', import.meta.url), 'utf8')).cases[0].legacy
    const trips = new InMemoryTripRepository(), trip = await trips.create()
    const owned = new Set([trip.id]), artifacts = new InMemoryArtifactRepository('owner', owned)
    const conversations = new InMemoryConversationRepository('owner', owned), conversation = await conversations.create({ tripId: trip.id })
    for (const record of [...sample.researchArtifacts, sample.routeArtifact]) await artifacts.create({
      ...record, tripId: trip.id, tripContextVersion: 0, sourceArtifactIds: [], goalId: undefined, runId: undefined })
    let savedId = '', toolSent = false, edit = false
    const registry = new ToolRegistry()
    registry.register({ name: 'save_travel_guide', description: 'Save test guide', inputSchema: z.object({}), outputSchema: z.any(),
      costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 10000,
      execute: async (_input, context, signal) => {
        const saved = await saveWorkspaceArtifact(await workspaceScope(context, signal), {
          type: 'travel_guide', schemaVersion: 1, payload: sample.artifact.payload, sourceArtifactIds: sample.artifact.payload.sourceArtifactIds })
        savedId = saved.id
        expect((projectGuideRecord(saved, 'en').payload as any).days).toEqual([])
        return { artifact: { id: saved.id } }
      } })
    const complete = vi.fn(async (_messages, model, options) => {
      expect(model).toBe('same-model')
      if (options?.responseFormat) {
        edit = true
        expect(options.tools).toEqual([])
        const input = JSON.parse(_messages[1].content)
        expect(input.locale).toBe('en'); expect(input.requirements.currentMessage).toBe('请生成文化攻略')
        return { message: { role: 'assistant' as const, content: JSON.stringify({ issues: [], text: {
          locale: 'en', reply: 'Your cultural itinerary is ready to explore.', overview: 'Enjoy the planned cultural visits at a relaxed pace.',
          days: input.guide.days.map((d: any) => ({ day: d.day, theme: 'Cultural exploration' })),
          activities: input.guide.days.flatMap((d: any) => d.items).map((i: any) => ({ activityId: i.id,
            name: 'Senso-ji', introduction: 'Explore the temple and its traditional neighborhood.',
            recommendationReason: 'This visit responds to your cultural interests at a relaxed pace.', sourceRefs: [sourceRef(i)] }))
        } }) } }
      }
      if (!toolSent) { toolSent = true; return { message: { role: 'assistant' as const, content: null,
        tool_calls: [{ id: 'save', type: 'function' as const, function: { name: 'save_travel_guide', arguments: '{}' } }] } } }
      return { message: { role: 'assistant' as const, content: 'RAW PLANNER PROSE' } }
    })
    const service = new CloudPlannerService({ ownerId: 'owner', trips, conversations, artifacts, memory: new InMemoryUserMemoryRepository(),
      runtime: new AgentRuntime({ complete }, registry, { model: 'same-model' }), aviation: new MockAviationProvider(), fares: new MockFareProvider(),
      research: new UnavailableResearchAgent(), connectionSearch: new UnavailableConnectionSearchService(),
      flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer() })
    const input = { tripId: trip.id, conversationId: conversation.id, requestId: 'request', generationId: 'generation', locale: 'en' as const, message: '请生成文化攻略' }
    const result = await service.runTurn(input)
    expect(edit).toBe(true); expect(result.reply).toBe('Your cultural itinerary is ready to explore.')
    expect(publicationFor((await artifacts.get(savedId))!)?.finalization?.variants.en?.status).toBe('accepted')
    const count = complete.mock.calls.filter(call => call[2]?.responseFormat).length
    await service.runTurn({ ...input, requestId: 'chat', message: 'Hello' })
    expect(complete.mock.calls.filter(call => call[2]?.responseFormat)).toHaveLength(count)
    expect((await trips.get(trip.id))?.version).toBe(0)
  })
})
