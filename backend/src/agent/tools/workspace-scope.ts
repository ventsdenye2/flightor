import type { ArtifactWorkspace } from '../../artifacts/workspace.js'
import type { ToolExecutionContext } from '../runtime/registry.js'

export function workspaceScope(context: ToolExecutionContext, signal: AbortSignal): ArtifactWorkspace & { requestId: string } {
  return { artifacts: context.artifacts, tripId: context.tripId, conversationId: context.conversationId, requestId: context.requestId, signal,
    ...(context.isGenerationCurrent ? { isCurrent: context.isGenerationCurrent } : {}) }
}
