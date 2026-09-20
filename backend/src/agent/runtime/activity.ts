export interface CommittedArtifactRef {
  id: string
  type: 'flight_search' | 'travel_guide'
  schemaVersion: number
  tripContextVersion: number
  presentationHint: 'flight_cards' | 'travel_guide'
}

/** Observable execution events only. Never contains model text, payloads or tool arguments. */
export type AgentActivity =
  | { type: 'model_start' | 'model_end' | 'finalizing' }
  | { type: 'tool_start' | 'tool_end'; toolName: string; toolCallId: string }
  | { type: 'artifact_committed'; tripId: string; conversationId: string; generationId: string;
      artifact: CommittedArtifactRef; selectedFlightRevision?: number }

export type AgentActivityObserver = (activity: AgentActivity) => void

export function emitActivity(observer: AgentActivityObserver | undefined, activity: AgentActivity): void {
  // Telemetry must not change Planner execution or persistence.
  try { observer?.(activity) } catch { /* best effort */ }
}
