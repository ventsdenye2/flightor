import type { ArtifactRecord, ArtifactType } from '../artifacts/repository.js'
import type { Trip } from '../trips/repository.js'
import type { TripContext } from '../trips/types.js'
import type { PublicationLocale } from '../travel-guides/finalization-schema.js'
import type { SelectedFlightContext } from '../workspaces/flight-selection.js'
import type { GoalDelivery } from './goals/completion.js'
import type { AgentActivityObserver } from './runtime/activity.js'

export interface SelectedFlightReader {
  getSelectedFlight(tripId: string): Promise<SelectedFlightContext | null>
}

export interface PlannerTurnInput {
  locale?: PublicationLocale
  requestId: string
  tripId: string
  conversationId: string
  message: string
  generationId: string
  signal?: AbortSignal
  onActivity?: AgentActivityObserver
}

export interface PlannerTurnResult {
  reply: string
  tripVersion: number
  tripContext: TripContext
  artifactRefs: Array<{ id: string; type: ArtifactType; schemaVersion: number }>
  memoryChanged: boolean
  warnings: string[]
  stopReason: string
  delivery: GoalDelivery
}

export interface PlannerPublicationContext {
  tripContextVersion: number
  selectedFlightRevision: number | undefined
}

/** The Agent API depends on domain behavior, never a particular execution engine. */
export interface PlannerServicePort {
  validateTurn(input: Pick<PlannerTurnInput, 'tripId' | 'conversationId' | 'signal'>): Promise<Trip>
  publicationContext(input: Pick<PlannerTurnInput, 'tripId' | 'conversationId'>): Promise<PlannerPublicationContext>
  localizeGuide(id: string, locale: PublicationLocale, retryRevision?: number): Promise<ArtifactRecord>
  runTurn(input: PlannerTurnInput): Promise<PlannerTurnResult>
}
