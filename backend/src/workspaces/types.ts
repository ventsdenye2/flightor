import { z } from 'zod'
import type { Trip } from '../trips/repository.js'
import type { Conversation } from '../conversations/repository.js'
import type { ArtifactType } from '../artifacts/repository.js'
import type { summarizeTrip } from '../routes/agent-cloud.js'
import type { RouteGenerationRunView } from '../route-generation/contracts.js'
import type { GoalDelivery } from '../agent/goals/completion.js'
import { flightSelectionChoiceSchema, type SavedFlightSelection } from './flight-selection.js'

export const savedRouteSchema = z.object({ artifactId: z.string().uuid(), routeId: z.string().min(1).max(160), contextVersion: z.number().int().nonnegative() }).strict()
export type SavedRoute = z.infer<typeof savedRouteSchema>
export const workspacePatchSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['planning', 'archived']).optional(),
  savedRoute: z.object({ artifactId: z.string().uuid(), routeId: z.string().min(1).max(160) }).strict().nullable().optional(),
  selectedFlight: flightSelectionChoiceSchema.nullable().optional()
}).strict()
  .refine(v => v.title !== undefined || v.status !== undefined || v.savedRoute !== undefined || v.selectedFlight !== undefined, 'No change supplied')
  .refine(v => !(v.savedRoute !== undefined && v.selectedFlight !== undefined), 'Provide only one flight selection field')
export type WorkspacePatch = z.infer<typeof workspacePatchSchema>
export interface WorkspaceTrip {
  id: string; title: string; status: Trip['status']; version: number
  contextVersion: number; savedRoute: SavedRoute | null; selectedFlight: SavedFlightSelection | null; createdAt: string; updatedAt: string
}
export interface WorkspaceArtifactRef { id: string; type: ArtifactType; schemaVersion: number; presentationHint: string }
export interface WorkspaceMessage { id: string; role: 'user' | 'assistant'; content: string; artifactRefs: WorkspaceArtifactRef[]; createdAt: string; delivery?: GoalDelivery; stopReason?: string; warnings?: string[] }
export interface TripWorkspace {
  trip: WorkspaceTrip; tripContextSummary: ReturnType<typeof summarizeTrip>
  conversations: Conversation[]; conversationId: string | null
  messages: WorkspaceMessage[]; artifactRefs: WorkspaceArtifactRef[]
  routeGeneration?: RouteGenerationRunView
}
export interface WorkspaceRepository {
  list(input: { limit: number; before?: string; status?: Trip['status'] }): Promise<{ trips: WorkspaceTrip[]; nextCursor: string | null }>
  get(tripId: string, conversationId?: string, locale?: 'zh' | 'en'): Promise<TripWorkspace>
  update(tripId: string, input: WorkspacePatch): Promise<WorkspaceTrip>
}
