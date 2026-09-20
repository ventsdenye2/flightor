import type { ToolExecutionContext } from '../runtime/registry.js'
import { addArtifactRef, addLocationHandle } from './working-set.js'

/** Shared by ordinary runtime observation and pre-completion business operations. */
export async function syncActiveGoalWorkingSet(context: ToolExecutionContext, outcome: {
  ok: boolean; artifactIds: readonly string[]
}, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (!outcome.ok || !context.activeGoalRunId || !context.goalRunRepository) return
  const run = await context.goalRunRepository.get(context.activeGoalRunId)
  signal.throwIfAborted()
  if (!run || run.status !== 'running') return
  let workingSet = run.workingSet
  const observedAt = new Date().toISOString()
  for (const id of outcome.artifactIds) {
    const artifact = await context.artifacts.getForScope(id, {
      tripId: context.tripId,
      ...(context.activeGoalId ? { goalId: context.activeGoalId } : {}),
      runId: run.id, tripContextVersion: run.contextVersion
    })
    signal.throwIfAborted()
    if (!artifact) continue
    workingSet = addArtifactRef(workingSet, { id: artifact.id, type: artifact.type, schemaVersion: artifact.schemaVersion, observedAt })
  }
  for (const location of context.resolvedLocations?.values() ?? []) {
    workingSet = addLocationHandle(workingSet, { id: location.id, kind: location.type, observedAt })
  }
  if (JSON.stringify(workingSet) !== JSON.stringify(run.workingSet)) {
    signal.throwIfAborted()
    await context.goalRunRepository.update(run.id, run.revision, { status: 'running', workingSet })
  }
}
