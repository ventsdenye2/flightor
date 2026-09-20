import { createArtifactWorkspace, type ArtifactWorkspace } from '../../artifacts/workspace.js'
import type { TripContext } from '../../trips/types.js'
import type { ToolExecutionContext } from '../runtime/registry.js'

export async function workspaceScope(context: ToolExecutionContext, signal: AbortSignal, snapshot?: TripContext): Promise<ArtifactWorkspace & { requestId: string }> {
  const scope = await createArtifactWorkspace({ artifacts: context.artifacts, trips: context.trips, tripId: context.tripId, conversationId: context.conversationId, signal,
    ...(context.ownerId ? { ownerId: context.ownerId } : {}),
    ...(context.activeGoalId ? { goalId: context.activeGoalId } : {}),
    ...(context.activeGoalRunId ? { runId: context.activeGoalRunId } : {}),
    ...(context.activeGoalContextVersion === undefined ? {} : { tripContextVersion: context.activeGoalContextVersion }),
    ...(context.selectedFlight ? { selectedFlight: context.selectedFlight } : {}),
    ...(context.assertFlightSelectionCurrent ? { assertFlightSelectionCurrent: context.assertFlightSelectionCurrent } : {}),
    ...(context.onArtifactCommitted ? { onArtifactCommitted: context.onArtifactCommitted } : {}),
    ...(context.isGenerationCurrent ? { isCurrent: context.isGenerationCurrent } : {}) }, snapshot)
  return { ...scope, requestId: context.requestId }
}
