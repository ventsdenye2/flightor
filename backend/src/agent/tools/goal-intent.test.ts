import { describe, expect, it, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import type { GoalVerification, GoalVerifierRegistry } from '../goals/verifier.js'
import type { LocationRef } from '../../aviation/types.js'
import type { ResearchArtifact } from '../../research-agent/types.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { createDefaultGoalVerifierRegistry } from '../goals/default-verifiers.js'
import { InMemoryGoalRepository, InMemoryGoalRunRepository } from '../goals/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { AgentRuntime } from '../runtime/runtime.js'
import { createPlannerToolRegistry } from './core.js'
import type { AuthoredGuideInput } from '../../travel-guides/authored.js'

const city: LocationRef = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const ownerId = 'goal-intent-owner'
const tripId = 'goal-intent-trip'
const now = '2026-09-08T00:00:00.000Z'
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })

function intent(allowPartial = false) {
  return {
    kind: 'travel_guide' as const,
    parameters: { questions: ['Museums and food'], researchTypes: ['activity'] as const,
      maxResults: 10, maxCities: 1, allowPartial }
  }
}

async function fixture(options: { owner?: string; generation?: string; sharedGoals?: Map<string, any>; sharedRuns?: Map<string, any> } = {}) {
  const owner = options.owner ?? ownerId
  const generation = options.generation ?? 'generation-1'
  const trip = { ...emptyTripContext(tripId), version: 1, travelDays: 1,
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' as const },
    destinationIntent: { mode: 'explicit' as const, required: [city], preferred: [], excluded: [] } }
  const trips = new InMemoryTripContextRepository([trip])
  const goals = new InMemoryGoalRepository(owner, options.sharedGoals)
  const runs = new InMemoryGoalRunRepository(owner, goals, options.sharedRuns)
  const artifacts = new InMemoryArtifactRepository(owner, new Set([trip.id]))
  const verification = { status: 'verified' as const, checkedAt: now, expiresAt: '2099-01-01T00:00:00.000Z', confidence: 1,
    sources: [{ provider: 'fixture', reference: 'https://example.com/museums' }] }
  const source: ResearchArtifact = {
    id: uuidv7(), type: 'research', schemaVersion: 2,
    brief: { destinations: [city], interests: ['food', 'culture'], questions: ['Museums and food'], researchTypes: ['activity'],
      travelWindow: { from: '2026-10-10', to: '2026-10-10' } },
    findings: [{ id: 'finding-0', title: 'Museum', summary: 'A source-backed museum.', category: 'activity', destinations: [city], verification,
      sources: [{ title: 'Museums', url: 'https://example.com/museums', domain: 'example.com', snippet: 'Source facts', authority: 'government_tourism' }], warnings: [] }],
    queryCount: 1, warnings: [], createdAt: now
  }
  await artifacts.create({ id: source.id, tripId: trip.id, type: 'research', schemaVersion: 2, tripContextVersion: 1, payload: source })
  const input: AuthoredGuideInput = { researchArtifactIds: [source.id], days: [
    { day: 1, cityId: city.id, kind: 'visit', theme: '文化与街巷', items: [{ researchIndex: 0, findingId: 'finding-0', timeOfDay: 'flexible', planningNote: '根据摄影兴趣安排。' }] }
  ] }
  const context = { ownerId: owner, tripId: trip.id, conversationId: uuidv7(), requestId: uuidv7(), generationId: generation,
    trips, artifacts, resolvedLocations: new Map([[city.id, city]]), goalRepository: goals, goalRunRepository: runs,
    goalVerifiers: createDefaultGoalVerifierRegistry(), isGenerationCurrent: () => true } as ToolExecutionContext
  return { trip, trips, goals, runs, artifacts, source, input, context }
}

async function runSave(test: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  const model = vi.fn()
    .mockResolvedValueOnce({ message: { role: 'assistant' as const, content: null,
      tool_calls: [call('save', 'save_travel_guide', { ...test.input, ...extra })] } })
    .mockResolvedValueOnce({ message: { role: 'assistant' as const, content: '已保存攻略。' } })
  const result = await new AgentRuntime({ complete: model }, createPlannerToolRegistry({ leanGoalsEnabled: true }))
    .run({ messages: [{ role: 'user', content: '保存这份攻略' }], context: test.context })
  return { result, model }
}

describe('Lean Goal intent protocol', () => {
  it('accepts intent once, saves a real guide, and uses shared completion without finish_goal', async () => {
    const test = await fixture()
    const { result } = await runSave(test, { intent: intent() })
    expect(result).toMatchObject({ stopReason: 'completed', delivery: { status: 'satisfied', kind: 'travel_guide' } })
    expect(result.traces.map(trace => trace.toolName)).toEqual(['save_travel_guide'])
    expect(result.traces[0]).toMatchObject({ toolResultStatus: 'success' })
    expect((await test.goals.listForTrip(tripId))).toHaveLength(1)
    const goal = (await test.goals.listForTrip(tripId))[0]!
    expect(goal.parameters).toEqual(intent().parameters)
    const run = (await test.runs.listForGoal(goal.id))[0]!
    expect(run).toMatchObject({ status: 'satisfied', generationId: 'generation-1' })
    // The save result must enter the active Run working set before the wrapper
    // performs automatic completion, so later verification can use its lineage.
    expect(run.workingSet.artifactRefs.map(ref => ref.id)).toContain(result.delivery.artifactIds[0])
    const definitions = createPlannerToolRegistry({ leanGoalsEnabled: true }).definitions().map(value => value.function.name)
    expect(definitions).not.toEqual(expect.arrayContaining(['declare_goal', 'resume_goal', 'finish_goal']))
  })

  it('binds goalRef to a new run only after the earlier attempt ended', async () => {
    const seed = await fixture({ generation: 'seed-generation' })
    const accepted = await seed.runs.accept!({ tripId, conversationId: seed.context.conversationId, requestId: seed.context.requestId,
      generationId: 'seed-generation', contextSnapshot: seed.trip, intent: intent() })
    await seed.runs.update(accepted.run.id, accepted.run.revision, { status: 'failed' })
    const next = await fixture({ generation: 'generation-2', sharedGoals: (seed.goals as any).goals, sharedRuns: (seed.runs as any).runs })
    // The repositories intentionally share their backing maps; use the seed repositories for
    // the actual owner-scoped context so the goalRef is visible to this new generation.
    next.context.goalRepository = seed.goals
    next.context.goalRunRepository = seed.runs
    next.context.trips = seed.trips
    next.context.artifacts = seed.artifacts
    next.input = seed.input
    const { result } = await runSave(next, { goalRef: accepted.goal.id })
    expect(result.delivery).toMatchObject({ status: 'satisfied', goalId: accepted.goal.id })
    expect((await seed.runs.listForGoal(accepted.goal.id)).map(run => run.generationId)).toEqual(expect.arrayContaining(['seed-generation', 'generation-2']))
  })

  it('does not weaken accepted constraints or switch intent during one turn', async () => {
    const test = await fixture()
    const model = vi.fn()
      .mockResolvedValueOnce({ message: { role: 'assistant' as const, content: null,
        tool_calls: [call('save-1', 'save_travel_guide', { ...test.input, intent: { ...intent(), parameters: { ...intent().parameters, researchTypes: ['activity', 'practical'] } } })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant' as const, content: null,
        tool_calls: [call('save-2', 'save_travel_guide', { ...test.input, intent: intent() })] } })
      .mockResolvedValueOnce({ message: { role: 'assistant' as const, content: '我会补齐缺失证据。' } })
    const result = await new AgentRuntime({ complete: model }, createPlannerToolRegistry({ leanGoalsEnabled: true }))
      .run({ messages: [{ role: 'user', content: '保存攻略并满足活动与实用信息要求' }], context: test.context })
    expect(result.traces.map(trace => trace.domainErrorCode)).toEqual([undefined, 'GOAL_INTENT_CONFLICT'])
    expect(result.delivery.status).toBe('pending')
    const goal = (await test.goals.listForTrip(tripId))[0]!
    expect(goal.parameters).toMatchObject({ researchTypes: ['activity', 'practical'] })
    expect((await test.artifacts.listForTrip(tripId)).map(record => record.type)).toEqual(['research'])
  })

  it('rejects goalRef takeover by another generation and by another owner', async () => {
    const first = await fixture({ generation: 'generation-1' })
    const accepted = await first.runs.accept!({ tripId, conversationId: first.context.conversationId, requestId: first.context.requestId,
      generationId: 'generation-1', contextSnapshot: first.trip, intent: intent() })
    const next = await fixture({ generation: 'generation-2' })
    next.context.goalRepository = first.goals
    next.context.goalRunRepository = first.runs
    next.context.trips = first.trips
    next.context.artifacts = first.artifacts
    const registry = createPlannerToolRegistry({ leanGoalsEnabled: true })
    const takeover = await registry.execute(call('takeover', 'save_travel_guide', { ...next.input, goalRef: accepted.goal.id }), next.context, new AbortController().signal)
    expect(takeover).toMatchObject({ ok: false, domainErrorCode: 'GOAL_RUN_ALREADY_RUNNING' })

    const foreign = await fixture({ owner: 'foreign-owner', generation: 'foreign-generation' })
    foreign.context.goalRepository = first.goals
    foreign.context.goalRunRepository = first.runs
    foreign.context.trips = first.trips
    foreign.context.artifacts = first.artifacts
    const crossOwner = await registry.execute(call('foreign', 'save_travel_guide', { ...foreign.input, goalRef: accepted.goal.id }), foreign.context, new AbortController().signal)
    expect(crossOwner).toMatchObject({ ok: false, domainErrorCode: 'RESOURCE_NOT_FOUND' })
  })

  it('closes a Goal accepted before an aborted acceptance promise returns', async () => {
    const test = await fixture()
    const original = test.runs.accept!.bind(test.runs)
    let release!: () => void
    let accepted!: () => void
    const acceptedStarted = new Promise<void>(resolve => { accepted = resolve })
    vi.spyOn(test.runs, 'accept').mockImplementation(async input => {
      const value = await original(input)
      accepted()
      await new Promise<void>(resolve => { release = resolve })
      return value
    })
    const controller = new AbortController()
    const model = vi.fn().mockResolvedValueOnce({ message: { role: 'assistant' as const, content: null,
      tool_calls: [call('save', 'save_travel_guide', { ...test.input, intent: intent() })] } })
    const pending = new AgentRuntime({ complete: model }, createPlannerToolRegistry({ leanGoalsEnabled: true }))
      .run({ messages: [{ role: 'user', content: '保存攻略' }], context: test.context, signal: controller.signal })
    await acceptedStarted
    controller.abort()
    release()
    const result = await pending
    expect(result.stopReason).toBe('cancelled')
    const goal = (await test.goals.listForTrip(tripId))[0]!
    expect((await test.runs.listForGoal(goal.id))[0]).toMatchObject({ status: 'cancelled' })
  })

  it('keeps a committed save successful when verification hangs, and preserves its artifact reference', async () => {
    vi.useFakeTimers()
    let release!: (value: GoalVerification) => void
    let verificationStarted!: () => void
    const started = new Promise<void>(resolve => { verificationStarted = resolve })
    const verification = new Promise<GoalVerification>(resolve => { release = resolve })
    try {
      const test = await fixture()
      const verify = vi.fn(async () => {
        verificationStarted()
        return verification
      })
      test.context.goalVerifiers = { verify } as unknown as GoalVerifierRegistry
      const registry = createPlannerToolRegistry({ leanGoalsEnabled: true })
      const pending = registry.execute(call('save', 'save_travel_guide', { ...test.input, intent: intent() }),
        test.context, new AbortController().signal)
      await verificationStarted
      await vi.advanceTimersByTimeAsync(2_600)
      const outcome = await pending
      expect(outcome.ok).toBe(true)
      const body = JSON.parse(outcome.content) as { ok: boolean; data: { artifact?: { id: string }; completion?: GoalVerification } }
      expect(body.data.artifact?.id).toBeDefined()
      expect(body.data.completion).toMatchObject({ status: 'pending', warnings: ['goal_verification_timeout'] })
      expect((await test.artifacts.listForTrip(tripId)).map(record => record.type)).toEqual(expect.arrayContaining(['research', 'route', 'travel_guide']))
      const goal = (await test.goals.listForTrip(tripId))[0]!
      const run = (await test.runs.listForGoal(goal.id))[0]!
      expect(run.status).toBe('running')
      expect(run.workingSet.artifactRefs.map(ref => ref.id)).toContain(body.data.artifact!.id)

      // A verifier resolving after its bounded child signal expires cannot commit
      // a terminal Goal state.
      release({ status: 'satisfied', artifactIds: [body.data.artifact!.id], missing: [], warnings: [] })
      await Promise.resolve()
      await Promise.resolve()
      expect((await test.goals.get(goal.id))?.status).toBe('pending')
      expect((await test.runs.get(run.id))?.status).toBe('running')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the legacy registry and schema when the flag is disabled', async () => {
    const legacy = createPlannerToolRegistry()
    const names = legacy.definitions().map(value => value.function.name)
    expect(names).toEqual(expect.arrayContaining(['declare_goal', 'resume_goal', 'finish_goal']))
    const save = legacy.get('save_travel_guide')!
    const test = await fixture()
    expect(save.inputSchema.safeParse({ ...test.input, intent: intent() }).success).toBe(false)
  })
})
