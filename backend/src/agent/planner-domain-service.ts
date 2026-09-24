import type { ArtifactRepository } from '../artifacts/repository.js'
import type { ConversationRepository } from '../conversations/repository.js'
import { AppError } from '../lib/errors.js'
import { finalizeGuide } from '../travel-guides/finalization-service.js'
import type { GuideFinalizer } from '../travel-guides/finalization.js'
import type { PublicationLocale } from '../travel-guides/finalization-schema.js'
import type { TripRepository } from '../trips/repository.js'
import type { PlannerServicePort, PlannerTurnInput, SelectedFlightReader } from './planner-service.js'

export interface PlannerDomainDependencies {
  ownerId?: string
  trips: TripRepository
  conversations: ConversationRepository
  artifacts: ArtifactRepository
  flightSelections?: SelectedFlightReader
  /** Explicit, lazy model dependency used only by the localization command. */
  createFinalizer: () => Pick<GuideFinalizer, 'generate'>
}

/** Shared domain reads and explicit localization; this service has no Agent loop. */
export class PlannerDomainService implements Pick<PlannerServicePort, 'validateTurn' | 'publicationContext' | 'localizeGuide'> {
  constructor(private readonly dependencies: PlannerDomainDependencies) {}

  async localizeGuide(id: string, locale: PublicationLocale, retryRevision?: number) {
    const record = await this.dependencies.artifacts.get(id)
    if (!record || record.type !== 'travel_guide') throw new AppError('RESOURCE_NOT_FOUND', 'Guide not found', 404)
    const assertCurrent = async () => {
      const trip = await this.dependencies.trips.get(record.tripId)
      const selected = await this.dependencies.flightSelections?.getSelectedFlight(record.tripId)
      if (!trip || trip.version !== record.tripContextVersion || selected?.selection.revision !== (record.payload as { flightSelection?: { revision: number } }).flightSelection?.revision) {
        throw new AppError('PUBLICATION_CONTENT_CHANGED', 'Trip or flight selection changed', 409)
      }
    }
    return finalizeGuide({ ownerId: this.dependencies.ownerId ?? record.tripId, record, artifacts: this.dependencies.artifacts,
      finalizer: this.dependencies.createFinalizer(), locale, localization: true, assertCurrent,
      ...(retryRevision === undefined ? {} : { retryRevision }) })
  }

  /** Repositories are owner scoped; validation happens before accepting async work. */
  async validateTurn(input: Pick<PlannerTurnInput, 'tripId' | 'conversationId' | 'signal'>) {
    input.signal?.throwIfAborted()
    const trip = await this.dependencies.trips.getTrip(input.tripId)
    input.signal?.throwIfAborted()
    if (!trip) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    const conversation = await this.dependencies.conversations.get(input.conversationId)
    input.signal?.throwIfAborted()
    if (!conversation || conversation.tripId !== input.tripId) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Conversation was not found', 404)
    }
    return trip
  }

  /** Publication must reflect current domain versions, including later user edits. */
  async publicationContext(input: Pick<PlannerTurnInput, 'tripId' | 'conversationId'>) {
    const trip = await this.validateTurn(input)
    const selected = await this.dependencies.flightSelections?.getSelectedFlight(input.tripId)
    return { tripContextVersion: trip.context.version, selectedFlightRevision: selected?.selection.revision }
  }
}
