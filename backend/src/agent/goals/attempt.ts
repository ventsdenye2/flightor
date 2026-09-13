import { AppError } from '../../lib/errors.js'
import type { GoalRunRepository } from './repository.js'

/** End only this operation's attempt; the durable Goal remains resumable. */
export async function closeGoalRunAttempt(scope: {
  ownerId: string
  tripId: string
  generationId: string
  runs: GoalRunRepository
  signal?: AbortSignal
}, input: { goalId: string; runId: string; status: 'failed' | 'cancelled' }): Promise<void> {
  for (let retry = 0; retry < 3; retry += 1) {
    scope.signal?.throwIfAborted()
    const run = await scope.runs.get(input.runId)
    scope.signal?.throwIfAborted()
    // Background route jobs and other turns own their own execution lifetime.
    if (!run || run.ownerId !== scope.ownerId || run.tripId !== scope.tripId
      || run.goalId !== input.goalId || run.generationId !== scope.generationId || run.status !== 'running') return
    try {
      await scope.runs.update(run.id, run.revision, { status: input.status })
      return
    } catch (error) {
      // Re-read after a concurrent working-set write or terminal completion.
      if (!(error instanceof AppError) || error.code !== 'GOAL_RUN_REVISION_CONFLICT' || retry === 2) throw error
    }
  }
}
