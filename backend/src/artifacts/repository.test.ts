import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from './repository.js'

describe('InMemoryArtifactRepository lineage', () => {
  it('stores lineage and supports owner/trip/goal/run scoped reads', async () => {
    const repo = new InMemoryArtifactRepository('owner-a', new Set(['trip-a']))
    const source = await repo.create({ tripId: 'trip-a', type: 'research', schemaVersion: 1, tripContextVersion: 4, payload: { ok: true } })
    const derived = await repo.create({
      tripId: 'trip-a', goalId: 'goal-a', runId: 'run-a', tripContextVersion: 4,
      sourceArtifactIds: [source.id], type: 'route_set', schemaVersion: 1, payload: { route: true }
    })

    expect(derived).toMatchObject({ goalId: 'goal-a', runId: 'run-a', tripContextVersion: 4, sourceArtifactIds: [source.id] })
    expect(await repo.getForScope(derived.id, { tripId: 'trip-a', goalId: 'goal-a', runId: 'run-a', tripContextVersion: 4 })).toEqual(derived)
    expect(await repo.getForScope(derived.id, { goalId: 'other-goal' })).toBeUndefined()
    expect((await repo.listForGoal('goal-a')).map(item => item.id)).toEqual([derived.id])
    expect((await repo.listForRun('run-a')).map(item => item.id)).toEqual([derived.id])
  })

  it('rejects cross-trip and self source references', async () => {
    const shared = new Map<string, any>()
    const first = new InMemoryArtifactRepository('owner-a', new Set(['trip-a']), shared)
    const second = new InMemoryArtifactRepository('owner-a', new Set(['trip-b']), shared)
    const source = await first.create({ tripId: 'trip-a', type: 'research', schemaVersion: 1, payload: {} })

    await expect(second.create({ tripId: 'trip-b', sourceArtifactIds: [source.id], type: 'route', schemaVersion: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(first.create({ id: 'self-artifact', tripId: 'trip-a', sourceArtifactIds: ['self-artifact'], type: 'route', schemaVersion: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'INVALID_ARTIFACT' })
  })

  it('validates optional goal/run relationships when resolvers are provided', async () => {
    const repo = new InMemoryArtifactRepository('owner-a', new Set(['trip-a']), new Map(), {
      goal: goalId => goalId === 'goal-a' ? { ownerId: 'owner-a', tripId: 'trip-a', tripContextVersion: 3 } : undefined,
      run: runId => runId === 'run-a' ? { ownerId: 'owner-a', tripId: 'trip-a', goalId: 'goal-a', tripContextVersion: 3 } : undefined
    })
    await expect(repo.create({ tripId: 'trip-a', goalId: 'goal-a', runId: 'run-a', tripContextVersion: 3, type: 'route', schemaVersion: 1, payload: {} })).resolves.toBeTruthy()
    await expect(repo.create({ tripId: 'trip-a', goalId: 'goal-a', runId: 'run-a', tripContextVersion: 2, type: 'route', schemaVersion: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT', statusCode: 409 })
    await expect(repo.create({ tripId: 'trip-a', goalId: 'goal-b', type: 'route', schemaVersion: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 })
    await expect(repo.create({ tripId: 'trip-a', runId: 'run-a', type: 'route', schemaVersion: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'INVALID_ARTIFACT' })
  })

  it('requires the repository write boundary to approve each stale source', async () => {
    const repo = new InMemoryArtifactRepository('owner-a', new Set(['trip-a']))
    const flight = await repo.create({ tripId: 'trip-a', tripContextVersion: 1, type: 'flight_search', schemaVersion: 1, payload: {} })
    const research = await repo.create({ tripId: 'trip-a', tripContextVersion: 1, type: 'research', schemaVersion: 2, payload: {} })
    await expect(repo.create({ tripId: 'trip-a', tripContextVersion: 2, type: 'route', schemaVersion: 1,
      sourceArtifactIds: [flight.id], payload: {} })).rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
    await expect(repo.create({ tripId: 'trip-a', tripContextVersion: 2, type: 'route', schemaVersion: 1,
      sourceArtifactIds: [flight.id], payload: {}, isSourceContextCompatible: source => source.id === flight.id })).resolves.toBeTruthy()
    await expect(repo.create({ tripId: 'trip-a', tripContextVersion: 2, type: 'route', schemaVersion: 1,
      sourceArtifactIds: [research.id], payload: {}, isSourceContextCompatible: source => source.id === flight.id }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
  })
})
