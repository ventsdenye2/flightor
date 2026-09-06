import { describe, expect, it } from 'vitest'
import { InMemoryTripContextRepository, TripContextVersionConflict } from './repository.js'
import { emptyTripContext } from './types.js'

describe('InMemoryTripContextRepository', () => {
  it('applies patches immutably and increments the version', async () => {
    const repo = new InMemoryTripContextRepository([emptyTripContext('trip-1')])
    const updated = await repo.update('trip-1', { notes: ['fixed timestamp'] }, 0)
    expect(updated).toMatchObject({ id: 'trip-1', notes: ['fixed timestamp'], version: 1 })
    const original = await repo.get('trip-1')
    expect(original).toEqual(updated)
    updated.notes.push('caller mutation')
    expect((await repo.get('trip-1'))?.notes).toEqual(['fixed timestamp'])
  })

  it('rejects stale expected versions', async () => {
    const repo = new InMemoryTripContextRepository([emptyTripContext('trip-1')])
    await repo.update('trip-1', { notes: ['first'] }, 0)
    await expect(repo.update('trip-1', { notes: ['stale'] }, 0)).rejects.toBeInstanceOf(TripContextVersionConflict)
    await expect(repo.update('missing', { notes: ['x'] })).rejects.toThrow('TRIP_CONTEXT_NOT_FOUND')
  })
})
