import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { GoalIdempotencyConflict, GoalRevisionConflict, GoalRunStatusConflict, GoalStatusConflict, InMemoryGoalRepository, InMemoryGoalRunRepository, canonicalFingerprint, selectLatestCompatibleRun } from './repository.js'
import { addArtifactRef, addLocationHandle, mergeWorkingSet } from './working-set.js'
import { GoalVerifierRegistry, artifactIdsFromWorkingSet, type GoalVerification, type GoalVerifier } from './verifier.js'
import { goalRecordSchema, type GoalRunRecord } from './types.js'

const tripId = 'trip-goal-1'
const ownerId = 'owner-goal-1'
const conversationId = '018f3f7a-75a4-7cc7-b926-7f8fe2d39410'
const artifactId = '018f3f7a-75a4-7cc7-b926-7f8fe2d39411'
const observedAt = '2026-09-07T00:00:00.000Z'

const input = {
  tripId, conversationId, kind: 'travel_guide' as const,
  parameters: { maxCities: 1, maxResults: 10, allowPartial: true, researchTypes: ['activity'], questions: ['museums'] },
  createdContextVersion: 3, idempotencyKey: 'goal-request-1'
}

function runInput(goalId: string, contextVersion: number, generationId: string, idempotencyKey: string) {
  return {
    goalId, tripId, contextVersion, generationId, idempotencyKey,
    contextSnapshot: { ...emptyTripContext(tripId), version: contextVersion }
  }
}

describe('Agentic Goal domain', () => {
  it('creates, restores, and idempotently reuses a durable goal', async () => {
    const shared = new Map()
    const repository = new InMemoryGoalRepository(ownerId, shared)
    const first = await repository.create(input)
    expect(first.created).toBe(true)
    expect(first.goal.status).toBe('pending')
    expect((await new InMemoryGoalRepository(ownerId, shared).get(first.goal.id))?.id).toBe(first.goal.id)

    const retry = await repository.create(input)
    expect(retry.created).toBe(false)
    expect(retry.goal).toEqual(first.goal)
    const contextMoved = await repository.create({ ...input, createdContextVersion: 4 })
    expect(contextMoved.created).toBe(false)
    await expect(repository.create({ ...input, parameters: { ...input.parameters, maxCities: 2 } })).rejects.toBeInstanceOf(GoalIdempotencyConflict)
  })

  it('enforces owner scope, optimistic revisions, and monotonic terminal status', async () => {
    const shared = new Map()
    const repository = new InMemoryGoalRepository(ownerId, shared)
    const otherOwner = new InMemoryGoalRepository('owner-other', shared)
    const created = await repository.create(input)
    await expect(otherOwner.get(created.goal.id)).resolves.toBeUndefined()

    const partial = await repository.update(created.goal.id, 0, { status: 'partial' })
    expect(partial.revision).toBe(1)
    await expect(repository.update(created.goal.id, 0, { status: 'satisfied' })).rejects.toBeInstanceOf(GoalRevisionConflict)
    const satisfied = await repository.update(created.goal.id, 1, { status: 'satisfied' })
    expect(satisfied.status).toBe('satisfied')
    await expect(repository.update(created.goal.id, 2, { status: 'failed' })).rejects.toBeInstanceOf(GoalStatusConflict)
  })

  it('requires explicit authorization for route-generation goals', async () => {
    const repository = new InMemoryGoalRepository(ownerId)
    await expect(repository.create({ ...input, kind: 'route_generation' })).rejects.toThrow()
    const created = await repository.create({
      ...input, kind: 'route_generation', idempotencyKey: 'route-goal-1',
      parameters: { requestKey: 'route-1' },
      authorization: { source: 'button', grantedAt: observedAt }
    })
    expect(created.goal.authorization?.source).toBe('button')
    const retried = await repository.create({
      ...input, kind: 'route_generation', idempotencyKey: 'route-goal-1',
      parameters: { requestKey: 'route-1' },
      authorization: { source: 'button', grantedAt: '2026-09-07T00:00:01.000Z' }
    })
    expect(retried).toMatchObject({ created: false, goal: { id: created.goal.id } })
  })

  it('keeps the working set opaque, deduplicated, and immutable to callers', () => {
    const base = { artifactRefs: [], locationHandles: [] }
    const withArtifact = addArtifactRef(base, { id: artifactId, type: 'research', schemaVersion: 2, observedAt })
    const withDuplicate = addArtifactRef(withArtifact, { id: artifactId, type: 'research', schemaVersion: 2, observedAt })
    const withLocation = addLocationHandle(withDuplicate, { id: 'resolved-location-1', kind: 'city', observedAt })
    const merged = mergeWorkingSet(withLocation, { locationHandles: [{ id: 'resolved-location-1', kind: 'city', observedAt }] })
    expect(merged.artifactRefs).toHaveLength(1)
    expect(merged.locationHandles).toHaveLength(1)
    expect(artifactIdsFromWorkingSet(merged)).toEqual([artifactId])
    expect(withArtifact).not.toBe(withDuplicate)
    expect(base.artifactRefs).toHaveLength(0)
  })

  it('verifies scope and the frozen run version before invoking a kind verifier', async () => {
    const repository = new InMemoryGoalRepository(ownerId)
    const created = await repository.create(input)
    const runs = new InMemoryGoalRunRepository(ownerId, repository)
    const run = await runs.create(runInput(created.goal.id, 3, 'generation-1', 'run-1'))
    const verifier: GoalVerifier = {
      kind: 'travel_guide',
      verify: vi.fn(async (): Promise<GoalVerification> => ({ status: 'satisfied', artifactIds: [artifactId], missing: [], warnings: [] }))
    }
    const registry = new GoalVerifierRegistry().register(verifier)
    const artifacts = new InMemoryArtifactRepository(ownerId, new Set([tripId]))
    const base = { ownerId, tripId, run: run.run, artifacts }
    await expect(registry.verify(created.goal, base)).resolves.toMatchObject({ status: 'satisfied', artifactIds: [artifactId] })
    expect(verifier.verify).toHaveBeenCalledTimes(1)
    const mismatchedSnapshot = { ...run.run, contextVersion: 4, contextSnapshot: { ...run.run.contextSnapshot, version: 4 } }
    await expect(registry.verify(created.goal, { ...base, run: mismatchedSnapshot })).resolves.toMatchObject({ status: 'satisfied' })
    expect(verifier.verify).toHaveBeenCalledTimes(2)
    await expect(registry.verify(created.goal, { ...base, ownerId: 'owner-other' })).resolves.toMatchObject({ status: 'failed', missing: ['goal_scope'] })
    expect(goalRecordSchema.parse(created.goal)).toEqual(created.goal)
  })

  it('continues a partial goal in a new run with a new frozen context version', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const created = await goals.create(input)
    const sharedRuns = new Map()
    const runs = new InMemoryGoalRunRepository(ownerId, goals, sharedRuns)
    const first = await runs.create(runInput(created.goal.id, 3, 'generation-1', 'run-partial'))
    const partial = await runs.update(first.run.id, 0, { status: 'partial' })
    const second = await runs.create(runInput(created.goal.id, 4, 'generation-2', 'run-retry'))
    expect(partial.status).toBe('partial')
    expect(second.run.contextVersion).toBe(4)
    expect(second.run.contextSnapshot.version).toBe(4)
    expect((await new InMemoryGoalRunRepository(ownerId, goals, sharedRuns).get(second.run.id))?.generationId).toBe('generation-2')
    expect((await runs.latestCompatible({ goalId: created.goal.id, tripId, contextVersion: 4 }))?.id).toBe(second.run.id)
    expect((await runs.latestCompatible({ goalId: created.goal.id, tripId, contextVersion: 3 }))?.id).toBe(first.run.id)
  })

  it('cancels a run explicitly and never verifies it as satisfied', async () => {
    const goals = new InMemoryGoalRepository(ownerId)
    const created = await goals.create(input)
    const runs = new InMemoryGoalRunRepository(ownerId, goals)
    const run = await runs.create(runInput(created.goal.id, 3, 'generation-cancel', 'run-cancel'))
    const cancelled = await runs.update(run.run.id, 0, { status: 'cancelled' })
    expect(cancelled.status).toBe('cancelled')
    await expect(runs.update(run.run.id, 1, { status: 'satisfied' })).rejects.toBeInstanceOf(GoalRunStatusConflict)
    const registry = new GoalVerifierRegistry().register({
      kind: 'travel_guide',
      verify: vi.fn(async (): Promise<GoalVerification> => ({ status: 'satisfied', artifactIds: [artifactId], missing: [], warnings: [] }))
    })
    const result = await registry.verify(created.goal, {
      ownerId, tripId, run: cancelled,
      artifacts: new InMemoryArtifactRepository(ownerId, new Set([tripId]))
    })
    expect(result).toMatchObject({ status: 'failed', missing: ['run_cancelled'] })
  })

  it('uses canonical idempotency fingerprints independent of object key order', () => {
    expect(canonicalFingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalFingerprint({ a: { c: 3, d: 4 }, b: 2 }))
  })

  it('selects only latest compatible runs and excludes cancelled or mismatched runs', () => {
    const makeRun = (id: string, contextVersion: number, status: GoalRunRecord['status'], updatedAt: string): GoalRunRecord => ({
      id, ownerId, goalId: '018f3f7a-75a4-7cc7-b926-7f8fe2d39412', tripId, generationId: id,
      contextVersion, contextSnapshot: { ...emptyTripContext(tripId), version: contextVersion }, status,
      workingSet: { artifactRefs: [], locationHandles: [] }, revision: 0,
      createdAt: updatedAt, updatedAt
    })
    const runs = [
      makeRun('018f3f7a-75a4-7cc7-b926-7f8fe2d39413', 3, 'partial', '2026-09-07T00:00:00.000Z'),
      makeRun('018f3f7a-75a4-7cc7-b926-7f8fe2d39414', 3, 'cancelled', '2026-09-07T01:00:00.000Z'),
      makeRun('018f3f7a-75a4-7cc7-b926-7f8fe2d39415', 4, 'running', '2026-09-07T02:00:00.000Z')
    ]
    expect(selectLatestCompatibleRun(runs, { goalId: runs[0]!.goalId, tripId, contextVersion: 3 })?.id).toBe(runs[0]!.id)
    expect(selectLatestCompatibleRun(runs, { goalId: runs[0]!.goalId, tripId, contextVersion: 4 })?.id).toBe(runs[2]!.id)
  })
})
