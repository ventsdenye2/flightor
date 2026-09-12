/** Observable execution events only. Never contains model text or tool arguments. */
export type AgentActivity =
  | { type: 'model_start' | 'model_end' | 'finalizing' }
  | { type: 'tool_start' | 'tool_end'; toolName: string; toolCallId: string }

export type AgentActivityObserver = (activity: AgentActivity) => void

export function emitActivity(observer: AgentActivityObserver | undefined, activity: AgentActivity): void {
  // Telemetry must not change Planner execution or persistence.
  try { observer?.(activity) } catch { /* best effort */ }
}
