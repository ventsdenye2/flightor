import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../artifacts/repository.js'
import { InMemoryConversationRepository } from '../conversations/repository.js'
import { InMemoryTripRepository } from '../trips/repository.js'
import type { SelectedFlightContext } from '../workspaces/flight-selection.js'
import { PlannerDomainService } from './planner-domain-service.js'

async function fixture() {
  const trips = new InMemoryTripRepository(), trip = await trips.create()
  const owned = new Set([trip.id]), ownerId = 'domain-owner'
  const conversations = new InMemoryConversationRepository(ownerId, owned)
  const conversation = await conversations.create({ tripId: trip.id })
  const artifacts = new InMemoryArtifactRepository(ownerId, owned)
  const generate = vi.fn(), createFinalizer = vi.fn(() => ({ generate }))
  const dependencies = { ownerId, trips, conversations, artifacts, createFinalizer }
  return { ...dependencies, trip, conversation, generate, dependencies,
    service: new PlannerDomainService(dependencies), input: { tripId: trip.id, conversationId: conversation.id } }
}

describe('engine independent Planner domain service', () => {
  it('validates owner-scoped Trip/conversation and returns current versions without constructing a model', async () => {
    const f = await fixture()
    expect(await f.service.validateTurn(f.input)).toEqual(f.trip)
    expect(await f.service.publicationContext(f.input)).toEqual({ tripContextVersion: 0, selectedFlightRevision: undefined })
    await f.trips.update(f.trip.id, { notes: ['Preserve the existing day plan'] }, 0)
    const flightSelections = { getSelectedFlight: vi.fn().mockResolvedValue({ selection: { revision: 3 } } as SelectedFlightContext) }
    const service = new PlannerDomainService({ ...f.dependencies, flightSelections })
    expect(await service.publicationContext(f.input)).toEqual({ tripContextVersion: 1, selectedFlightRevision: 3 })
    expect(f.createFinalizer).not.toHaveBeenCalled()
    expect(f.generate).not.toHaveBeenCalled()
  })

  it('rejects missing, foreign and mismatched conversations before accepting a turn', async () => {
    const f = await fixture()
    const other = await f.trips.create()
    await expect(f.service.validateTurn({ ...f.input, tripId: 'missing' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(f.service.validateTurn({ ...f.input, conversationId: 'foreign' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(f.service.validateTurn({ ...f.input, tripId: other.id })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(f.createFinalizer).not.toHaveBeenCalled()
  })

  it('checks cancellation after an asynchronous owner lookup', async () => {
    const f = await fixture(), controller = new AbortController()
    vi.spyOn(f.trips, 'getTrip').mockImplementation(async () => { controller.abort(); return f.trip })
    const readConversation = vi.spyOn(f.conversations, 'get')
    await expect(f.service.validateTurn({ ...f.input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(readConversation).not.toHaveBeenCalled()
  })

  it('requires a current owned guide for explicit localization and never generates stale text', async () => {
    const f = await fixture()
    await expect(f.service.localizeGuide('foreign', 'en')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    const record = await f.artifacts.create({ tripId: f.trip.id, tripContextVersion: 0, type: 'travel_guide', schemaVersion: 1, payload: {} })
    await f.trips.update(f.trip.id, { notes: ['New context'] }, 0)
    await expect(f.service.localizeGuide(record.id, 'en')).rejects.toMatchObject({ code: 'PUBLICATION_CONTENT_CHANGED' })
    expect(f.generate).not.toHaveBeenCalled()
    const service = new PlannerDomainService({ ...f.dependencies, flightSelections: {
      getSelectedFlight: async () => ({ selection: { revision: 2 } } as SelectedFlightContext)
    } })
    const fresh = await f.artifacts.create({ tripId: f.trip.id, tripContextVersion: 1, type: 'travel_guide', schemaVersion: 1,
      payload: { flightSelection: { revision: 1 } } })
    await expect(service.localizeGuide(fresh.id, 'zh')).rejects.toMatchObject({ code: 'PUBLICATION_CONTENT_CHANGED' })
    expect(f.generate).not.toHaveBeenCalled()
  })
})
