import { describe, expect, it } from 'vitest'
import { InMemoryRouteGenerationRunRepository } from './repository.js'

const snapshot = {
  id: 'trip-1', destinationIntent: { mode: 'explicit' as const, required: [], preferred: [], excluded: [] },
  interests: [], priorities: {}, transferPreferences: {}, locationRoleOverrides: [],
  mustIncludeEvents: [], notes: [], version: 0
}

describe('InMemoryRouteGenerationRunRepository', () => {
  it('scopes lookup to the owner and makes idempotency reuse explicit', async () => {
    const repo = new InMemoryRouteGenerationRunRepository('user-a', new Set(['trip-1']))
    const first = await repo.createOrGet({ ownerId: 'user-a', tripId: 'trip-1', idempotencyKey: 'key', requestHash: 'a'.repeat(64), contextVersion: 0, contextSnapshot: snapshot })
    const same = await repo.createOrGet({ ownerId: 'user-a', tripId: 'trip-1', idempotencyKey: 'key', requestHash: 'a'.repeat(64), contextVersion: 0, contextSnapshot: snapshot })
    expect(same.created).toBe(false)
    expect(same.run.id).toBe(first.run.id)
    await expect(repo.createOrGet({ ownerId: 'user-a', tripId: 'trip-1', idempotencyKey: 'key', requestHash: 'b'.repeat(64), contextVersion: 0, contextSnapshot: snapshot })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE' })
    expect(await repo.get(first.run.id)).toBeDefined()
    expect(await new InMemoryRouteGenerationRunRepository('user-b', new Set(['trip-1'])).get(first.run.id)).toBeUndefined()
  })

  it('cancels queued and running runs idempotently without reopening terminal state', async () => {
    const repo = new InMemoryRouteGenerationRunRepository('user-a', new Set(['trip-1']))
    const first = await repo.createOrGet({ ownerId: 'user-a', tripId: 'trip-1', idempotencyKey: 'cancel', requestHash: 'a'.repeat(64), contextVersion: 0, contextSnapshot: snapshot })
    expect((await repo.cancel(first.run.id))?.status).toBe('cancelled')
    expect((await repo.cancel(first.run.id))?.status).toBe('cancelled')
    expect((await repo.update(first.run.id, { status: 'succeeded', resultArtifactId: 'artifact' }))?.status).toBe('cancelled')
  })

  it('keeps a succeeded run terminal and immutable', async () => {
    const repo = new InMemoryRouteGenerationRunRepository('user-a', new Set(['trip-1']))
    const first = await repo.createOrGet({ ownerId: 'user-a', tripId: 'trip-1', idempotencyKey: 'terminal', requestHash: 'a'.repeat(64), contextVersion: 0, contextSnapshot: snapshot })
    await repo.claim(first.run.id)
    const succeeded = await repo.update(first.run.id, { status: 'succeeded', progressPercent: 100 })
    const after = await repo.update(first.run.id, { status: 'failed', errorCode: 'SHOULD_NOT_CHANGE' })
    expect(succeeded?.status).toBe('succeeded')
    expect(after).toEqual(succeeded)
  })
})
