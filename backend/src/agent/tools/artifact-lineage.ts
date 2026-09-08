import type { CreateArtifactInput } from '../../artifacts/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'

export function toolArtifactLineage(
  context: ToolExecutionContext,
  sourceArtifactIds: readonly string[] = []
): Pick<CreateArtifactInput, 'goalId' | 'runId' | 'tripContextVersion' | 'sourceArtifactIds'> {
  return {
    ...(context.activeGoalId ? { goalId: context.activeGoalId } : {}),
    ...(context.activeGoalRunId ? { runId: context.activeGoalRunId } : {}),
    ...(context.activeGoalContextVersion === undefined ? {} : { tripContextVersion: context.activeGoalContextVersion }),
    sourceArtifactIds
  }
}
