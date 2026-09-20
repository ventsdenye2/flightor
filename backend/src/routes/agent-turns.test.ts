import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { CloudPlannerService } from '../agent/cloud/service.js'
import { AgentRuntime } from '../agent/runtime/runtime.js'
import { ToolRegistry, type ToolExecutionContext } from '../agent/runtime/registry.js'
import type { AgentModelClient, ChatCompletion } from '../agent/runtime/model.js'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { saveWorkspaceArtifact } from '../artifacts/workspace.js'
import { MockAviationProvider } from '../aviation/providers/mock.js'
import { issueAccessToken } from '../auth/tokens.js'
import { parseEnv } from '../config/env.js'
import { InMemoryConversationRepository } from '../conversations/repository.js'
import { MockFareProvider } from '../fares/providers/mock.js'
import { InMemoryUserMemoryRepository } from '../memory/repository.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import { UnavailableResearchAgent } from '../research-agent/unavailable.js'
import { UnavailableConnectionSearchService, UnavailableFlightRoutePlanner, UnavailableRouteOptimizer } from '../flight-routing/unavailable.js'
import { workspaceScope } from '../agent/tools/workspace-scope.js'
import { registerCloudAgentRoutes } from './agent-cloud.js'

const env = parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test', REDIS_URL: 'redis://test', JWT_SECRET: 'authenticated-turn-progress-test-secret-32-chars' })
const finalResponse = { message: { role: 'assistant' as const, content: '已完成本轮回复。' } }
const committedArtifactId = '018f3f7a-75a4-7cc7-b926-7f8fe2d39412'

function artifactTool(options: { save?: boolean; releaseSave?: () => void } = {}) {
  return {
    name: 'fixture_artifact', description: 'fixture artifact writer', inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.boolean() }).passthrough(), costClass: 'free' as const, costUnits: 0,
    sideEffect: 'state' as const, parallelSafe: true, timeoutMs: 30_000,
    execute: async (_input: unknown, context: ToolExecutionContext, signal: AbortSignal) => {
      if (options.save !== false) {
        const scope = await workspaceScope(context, signal)
        await saveWorkspaceArtifact(scope, {
          id: committedArtifactId, type: 'flight_search', schemaVersion: 1,
          payload: { tripContextVersion: scope.tripContextVersion, offers: [] }
        })
        options.releaseSave?.()
      }
      return { ok: true, artifactRefs: [{ id: 'forged-reference', type: 'flight_search' }] }
    }
  }
}

async function fixture(model: AgentModelClient, registry = new ToolRegistry()) {
  const trips = new InMemoryTripRepository()
  const trip = await trips.create()
  const ownedTrips = new Set([trip.id])
  const conversations = new InMemoryConversationRepository('owner', ownedTrips)
  const conversation = await conversations.create({ tripId: trip.id })
  const artifacts = new InMemoryArtifactRepository('owner', ownedTrips)
  const memory = new InMemoryUserMemoryRepository()
  const service = new CloudPlannerService({
    trips, conversations, artifacts, memory, runtime: new AgentRuntime(model, registry),
    aviation: new MockAviationProvider(), fares: new MockFareProvider(), research: new UnavailableResearchAgent(),
    connectionSearch: new UnavailableConnectionSearchService(), flightRoutePlanner: new UnavailableFlightRoutePlanner(), routeOptimizer: new UnavailableRouteOptimizer()
  })
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof z.ZodError ? 400 : error.statusCode ?? 500).send({ code: 'error' })
  })
  await registerCloudAgentRoutes(app, { env } as unknown as AppContext, () => service)
  const headers = { authorization: `Bearer ${await issueAccessToken({ userId: 'owner', publicId: 'public-owner' }, env)}` }
  const otherHeaders = { authorization: `Bearer ${await issueAccessToken({ userId: 'other', publicId: 'public-other' }, env)}` }
  return { app, service, trips, conversations, memory, trip, conversation, headers, otherHeaders,
    artifacts, payload: { tripId: trip.id, conversationId: conversation.id, message: '安排这次旅行' } }
}

describe('asynchronous authenticated Planner turns', () => {
  it('retries an old context read before reconciling a newly committed artifact', async () => {
    let releaseWrite!: () => void
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve })
    let releaseFinal!: (response: ChatCompletion) => void
    const writer = artifactTool()
    const complete = vi.fn<AgentModelClient['complete']>()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: writer.name, arguments: '{}' } }] } })
      .mockImplementationOnce(async () => new Promise(resolve => { releaseFinal = resolve }))
    const f = await fixture({ complete }, new ToolRegistry().register({ ...writer,
      execute: async (input, context, signal) => { await writeGate; return writer.execute(input, context, signal) }
    }))
    let releaseContext!: () => void
    let contextRead!: () => void
    const contextSeen = new Promise<void>(resolve => { contextRead = resolve })
    try {
      const accepted = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
      const url = `/v1/agent/turns/${accepted.json().turnId}`
      const originalContext = f.service.publicationContext.bind(f.service)
      vi.spyOn(f.service, 'publicationContext').mockImplementationOnce(async input => {
        const old = await originalContext(input)
        contextRead()
        await new Promise<void>(resolve => { releaseContext = resolve })
        return old
      })
      const pending = f.app.inject({ url, headers: f.headers }).then(response => response)
      await contextSeen
      await f.trips.update(f.trip.id, { interests: ['food'] }, 0)
      releaseWrite()
      await vi.waitFor(() => expect(releaseFinal).toBeTypeOf('function'))
      releaseContext()
      expect((await pending).json()).toMatchObject({ status: 'running', artifactRevision: 1,
        artifactRefs: [{ id: committedArtifactId, tripContextVersion: 1 }] })
      releaseFinal(finalResponse)
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({
        status: 'completed', artifactRevision: 1, artifactRefs: [{ id: committedArtifactId, tripContextVersion: 1 }]
      }))
    } finally { releaseWrite(); releaseContext?.(); await f.app.close() }
  })

  it('re-reads context when a pending snapshot becomes terminal without publishing refs', async () => {
    let releaseFinal!: (response: ChatCompletion) => void
    const complete = vi.fn<AgentModelClient['complete']>().mockImplementationOnce(async () => new Promise(resolve => { releaseFinal = resolve }))
    const f = await fixture({ complete })
    let releaseContext!: () => void
    let contextRead!: () => void
    const contextSeen = new Promise<void>(resolve => { contextRead = resolve })
    try {
      const accepted = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
      const url = `/v1/agent/turns/${accepted.json().turnId}`
      await vi.waitFor(() => expect(releaseFinal).toBeTypeOf('function'))
      const originalContext = f.service.publicationContext.bind(f.service)
      vi.spyOn(f.service, 'publicationContext').mockImplementationOnce(async input => {
        const old = await originalContext(input)
        contextRead()
        await new Promise<void>(resolve => { releaseContext = resolve })
        return old
      })
      const pending = f.app.inject({ url, headers: f.headers }).then(response => response)
      await contextSeen
      await f.trips.update(f.trip.id, { interests: ['food'] }, 0)
      releaseFinal(finalResponse)
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json().status).toBe('completed'))
      releaseContext()
      expect((await pending).json()).toMatchObject({ status: 'completed', artifactRevision: 0,
        response: { tripContextSummary: { version: 1 } } })
    } finally { releaseContext?.(); await f.app.close() }
  })

  it('bounds retries during continuous publication and leaves new refs intact', async () => {
    const f = await fixture({ complete: vi.fn() })
    let publish!: NonNullable<Parameters<CloudPlannerService['runTurn']>[0]['onActivity']>
    let generationId!: string
    vi.spyOn(f.service, 'runTurn').mockImplementation(async input => {
      publish = input.onActivity!
      generationId = input.generationId
      return new Promise(() => {})
    })
    try {
      const accepted = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
      const url = `/v1/agent/turns/${accepted.json().turnId}`
      await vi.waitFor(() => expect(publish).toBeTypeOf('function'))
      let index = 0
      const context = vi.spyOn(f.service, 'publicationContext').mockImplementation(async () => {
        index += 1
        publish({ type: 'artifact_committed', tripId: f.trip.id, conversationId: f.conversation.id, generationId,
          artifact: { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, type: 'flight_search', schemaVersion: 1,
            tripContextVersion: 1, presentationHint: 'flight_cards' } })
        return { tripContextVersion: 0, selectedFlightRevision: undefined }
      })
      expect((await f.app.inject({ url, headers: f.headers })).statusCode).toBe(503)
      expect(context).toHaveBeenCalledTimes(3)
      context.mockResolvedValue({ tripContextVersion: 1, selectedFlightRevision: undefined })
      const fresh = (await f.app.inject({ url, headers: f.headers })).json()
      expect(fresh.artifactRevision).toBe(3)
      expect(fresh.artifactRefs).toHaveLength(3)
    } finally { await f.app.close() }
  })

  it('accepts and snapshots the trip scope, publishes only after the artifact commit, and exposes refs while finalizing', async () => {
    let releaseCreate!: () => Promise<void>
    let createStarted!: () => void
    const createSeen = new Promise<void>(resolve => { createStarted = resolve })
    let releaseFinal!: (response: ChatCompletion) => void
    const complete = vi.fn<AgentModelClient['complete']>()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'fixture_artifact', arguments: '{}' } }] } })
      .mockImplementationOnce(async () => new Promise(resolve => { releaseFinal = resolve }))
    const f = await fixture({ complete }, new ToolRegistry().register(artifactTool()))
    const originalCreate = f.artifacts.create.bind(f.artifacts)
    vi.spyOn(f.artifacts, 'create').mockImplementation(async input => {
      createStarted()
      return new Promise(resolve => {
        releaseCreate = async () => resolve(await originalCreate(input))
      })
    })
    try {
      const accepted = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
      expect(accepted.statusCode).toBe(202)
      expect(accepted.json()).toMatchObject({ status: 'running', tripId: f.trip.id, conversationId: f.conversation.id, generationId: expect.any(String) })
      const { turnId } = accepted.json()
      const url = `/v1/agent/turns/${turnId}`
      await createSeen
      expect(await f.artifacts.get(committedArtifactId)).toBeUndefined()
      expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({
        status: 'running', tripId: f.trip.id, conversationId: f.conversation.id,
        generationId: expect.any(String), artifactRevision: 0, artifactRefs: []
      })
      await releaseCreate()
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({
        status: 'running', stage: 'thinking', artifactRevision: 1,
        artifactRefs: [{ id: committedArtifactId, type: 'flight_search', schemaVersion: 1, tripContextVersion: 0, presentationHint: 'flight_cards' }]
      }))
      releaseFinal(finalResponse)
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json().status).toBe('completed'))
    } finally { await f.app.close() }
  })

  it('does not publish model-forged references or tools that need revision and ignores late publication after cancellation', async () => {
    const complete = vi.fn<AgentModelClient['complete']>()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'forged', type: 'function', function: { name: 'fixture_artifact', arguments: '{}' } }] } })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'needs revision' } })
    const f = await fixture({ complete }, new ToolRegistry().register(artifactTool({ save: false })))
    try {
      const accepted = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
      const url = `/v1/agent/turns/${accepted.json().turnId}`
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({ status: 'completed', artifactRevision: 0, artifactRefs: [] }))
    } finally { await f.app.close() }
  })

  it('allows only the owner to cancel, aborts the run, retains refs, and ignores late model completion', async () => {
    let releaseFinal!: (response: ChatCompletion) => void
    let modelSignal: AbortSignal | undefined
    const complete = vi.fn<AgentModelClient['complete']>()
      .mockResolvedValueOnce({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'fixture_artifact', arguments: '{}' } }] } })
      .mockImplementationOnce(async (_messages, _model, options) => {
        modelSignal = options?.signal
        return new Promise(resolve => { releaseFinal = resolve })
      })
    const f = await fixture({ complete }, new ToolRegistry().register(artifactTool()))
    try {
      const accepted = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
      const url = `/v1/agent/turns/${accepted.json().turnId}`
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json().artifactRefs).toHaveLength(1))
      expect((await f.app.inject({ method: 'POST', url: `${url}/cancel`, headers: f.otherHeaders })).statusCode).toBe(404)
      const cancelled = await f.app.inject({ method: 'POST', url: `${url}/cancel`, headers: f.headers })
      expect(cancelled.statusCode).toBe(200)
      expect(cancelled.json()).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_CANCELLED' }, artifactRefs: [{ id: committedArtifactId }] })
      expect(modelSignal?.aborted).toBe(true)
      releaseFinal(finalResponse)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({ status: 'failed', artifactRefs: [{ id: committedArtifactId }] })
      expect((await f.app.inject({ method: 'POST', url: `${url}/cancel`, headers: f.headers })).json().status).toBe('failed')
    } finally { await f.app.close() }
  })

  it('returns 202 before model/tool completion, reports actual stages, and keeps progress out of persisted context', async () => {
    let releaseModel!: (response: ChatCompletion) => void
    let releaseResearch!: (result: { ok: boolean }) => void
    const complete = vi.fn()
      .mockImplementationOnce(async () => new Promise(resolve => { releaseModel = resolve }))
      .mockResolvedValueOnce(finalResponse)
    const registry = new ToolRegistry().register({
      name: 'web_research', description: 'research', inputSchema: z.object({}).strict(), outputSchema: z.object({ ok: z.boolean() }),
      costClass: 'free', costUnits: 0, sideEffect: 'none', parallelSafe: true, timeoutMs: 30_000,
      execute: async () => new Promise(resolve => { releaseResearch = resolve })
    })
    const f = await fixture({ complete }, registry)
    try {
      const accepted = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
      expect(accepted.statusCode).toBe(202)
      expect(accepted.headers['cache-control']).toBe('no-store')
      const url = `/v1/agent/turns/${accepted.json().turnId}`
      await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
      expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({ status: 'running', stage: 'thinking' })
      expect((await f.app.inject({ url, headers: f.otherHeaders })).statusCode).toBe(404)
      expect((await f.app.inject({ url })).statusCode).toBe(401)
      releaseModel({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'research', type: 'function', function: { name: 'web_research', arguments: '{}' } }] } })
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({ status: 'running', stage: 'researching' }))
      releaseResearch({ ok: true })
      await vi.waitFor(async () => expect((await f.app.inject({ url, headers: f.headers })).json()).toMatchObject({ status: 'completed', stage: 'finalizing', response: { reply: finalResponse.message.content, stopReason: 'responded' } }))
      const status = await f.app.inject({ url, headers: f.headers })
      expect(status.headers['cache-control']).toBe('no-store')
      expect(status.json().startedAt).toEqual(expect.any(String))
      expect(status.json().updatedAt).toEqual(expect.any(String))
      const messages = await f.conversations.listMessages(f.conversation.id)
      expect(messages.map(message => message.role)).toEqual(['user', 'assistant'])
      const domainState = JSON.stringify({ messages, trip: await f.trips.get(f.trip.id), memory: await f.memory.get() })
      expect(domainState).not.toMatch(/model_start|tool_start|researching|updatedAt.*turnId/)
      expect(complete.mock.calls[1]?.[0]).not.toEqual(expect.arrayContaining([expect.objectContaining({ content: 'researching' })]))
    } finally { await f.app.close() }
  })

  it('rejects invalid input and mismatched owned scope before starting work', async () => {
    const complete = vi.fn().mockResolvedValue(finalResponse)
    const f = await fixture({ complete })
    try {
      const run = vi.spyOn(f.service, 'runTurn')
      const invalid = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: { ...f.payload, message: '' } })
      expect(invalid.statusCode).toBe(400)
      const anotherTrip = await f.trips.create()
      const mismatch = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: { ...f.payload, tripId: anotherTrip.id } })
      expect(mismatch.statusCode).toBe(404)
      expect(run).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
      expect(await f.conversations.listMessages(f.conversation.id)).toEqual([])
    } finally { await f.app.close() }
  })

  it('serves sanitized failures and cancels model work on app close without a late assistant write', async () => {
    let modelSignal: AbortSignal | undefined
    let rejectModel!: (error: Error) => void
    const complete = vi.fn<AgentModelClient['complete']>(async (_messages, _model, options) => {
      modelSignal = options?.signal
      return new Promise<never>((_resolve, reject) => { rejectModel = reject })
    })
    const f = await fixture({ complete })
    const failedRun = vi.spyOn(f.service, 'runTurn').mockRejectedValueOnce(new Error('secret provider token'))
    const failed = await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
    const failureUrl = `/v1/agent/turns/${failed.json().turnId}`
    await vi.waitFor(async () => {
      const response = (await f.app.inject({ url: failureUrl, headers: f.headers })).json()
      expect(response).toMatchObject({ status: 'failed', error: { code: 'AGENT_TURN_FAILED' } })
      expect(JSON.stringify(response)).not.toContain('secret')
    })
    failedRun.mockRestore()
    await f.app.inject({ method: 'POST', url: '/v1/agent/turns', headers: f.headers, payload: f.payload })
    await vi.waitFor(() => expect(modelSignal).toBeDefined())
    await f.app.close()
    expect(modelSignal?.aborted).toBe(true)
    rejectModel(new Error('provider rejected after shutdown'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await f.conversations.listMessages(f.conversation.id)).map(message => message.role)).toEqual(['user'])
  })
})
