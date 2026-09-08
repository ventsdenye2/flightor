import { describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository } from './repository.js'
import { createArtifactWorkspace, loadWorkspaceArtifact, saveWorkspaceArtifact } from './workspace.js'
import { InMemoryTripContextRepository } from '../trips/repository.js'
import { emptyTripContext } from '../trips/types.js'

function setup() {
  const trip = { ...emptyTripContext('trip'), version: 2, travelDays: 10 }
  const trips = new InMemoryTripContextRepository([trip])
  const artifacts = new InMemoryArtifactRepository('owner', new Set(['trip', 'other-trip']))
  return { trip, trips, artifacts, input: { artifacts, trips, tripId: trip.id } }
}

describe('Artifact workspace consistency', () => {
  it('permits same-version research from a different run while rejecting legacy and stale sources', async () => {
    const { artifacts, input } = setup()
    const scope = await createArtifactWorkspace({ ...input, goalId: 'current-goal', runId: 'current-run' })
    const source = await artifacts.create({ tripId: 'trip', goalId: 'previous-goal', runId: 'previous-run', tripContextVersion: 2, type: 'research', schemaVersion: 2, payload: {} })
    await expect(loadWorkspaceArtifact(scope, source.id, 'research', [2])).resolves.toMatchObject({ id: source.id })
    const saved = await saveWorkspaceArtifact(scope, { type: 'travel_guide', schemaVersion: 1, payload: {}, sourceArtifactIds: [source.id] })
    expect(saved).toMatchObject({ tripContextVersion: 2, goalId: 'current-goal', runId: 'current-run', sourceArtifactIds: [source.id] })

    for (const tripContextVersion of [undefined, 1]) {
      const invalid = await artifacts.create({ tripId: 'trip', type: 'research', schemaVersion: 2, payload: {}, ...(tripContextVersion === undefined ? {} : { tripContextVersion }) })
      const code = tripContextVersion === undefined ? 'ARTIFACT_CONTEXT_VERSION_MISSING' : 'ARTIFACT_CONTEXT_VERSION_MISMATCH'
      await expect(loadWorkspaceArtifact(scope, invalid.id, 'research', [2])).rejects.toMatchObject({ code })
      await expect(saveWorkspaceArtifact(scope, { type: 'travel_guide', schemaVersion: 1, payload: {}, sourceArtifactIds: [invalid.id] })).rejects.toMatchObject({ code })
    }
  })

  it('rejects another Trip and a route whose payload was relabeled with a newer envelope version', async () => {
    const { artifacts, input } = setup()
    const scope = await createArtifactWorkspace(input)
    const other = await artifacts.create({ tripId: 'other-trip', tripContextVersion: 2, type: 'route', schemaVersion: 1, payload: {} })
    await expect(loadWorkspaceArtifact(scope, other.id, 'route', [1])).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    const relabeled = await artifacts.create({ tripId: 'trip', tripContextVersion: 2, type: 'route', schemaVersion: 1, payload: { tripContextVersion: 1 } })
    await expect(loadWorkspaceArtifact(scope, relabeled.id, 'route', [1])).rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_VERSION_MISMATCH' })
  })

  it('rejects a stale accepted snapshot and preserves cancellation during the final version read', async () => {
    const { trip, trips, artifacts, input } = setup()
    await expect(createArtifactWorkspace({ ...input, tripContextVersion: 1 }, trip)).rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    const controller = new AbortController()
    const scope = await createArtifactWorkspace({ ...input, signal: controller.signal })
    const get = trips.get.bind(trips)
    trips.get = async id => { const value = await get(id); controller.abort(); return value }
    await expect(saveWorkspaceArtifact(scope, { type: 'research', schemaVersion: 2, payload: {} })).rejects.toThrow()
    expect(await artifacts.listForTrip('trip')).toEqual([])
  })
})
