import { sql } from 'kysely'
import type { Kysely } from 'kysely'
import type { Database, Job } from '../db/types.js'

export async function claimNextJob(db: Kysely<Database>, workerId: string): Promise<Job | undefined> {
  const result = await sql<Job>`
    update jobs
    set status = 'processing',
        locked_by = ${workerId},
        locked_at = now(),
        attempts = attempts + 1,
        updated_at = now()
    where id = (
      select id
      from jobs
      where status = 'pending' and run_at <= now()
      order by run_at, id
      limit 1
      for update skip locked
    )
    returning *
  `.execute(db)
  return result.rows[0]
}

export async function completeJob(db: Kysely<Database>, jobId: string): Promise<void> {
  await db.updateTable('jobs').set({
    status: 'completed',
    completed_at: new Date(),
    locked_by: null,
    locked_at: null,
    updated_at: new Date()
  }).where('id', '=', jobId).execute()
}

export async function failJob(db: Kysely<Database>, job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown worker error'
  const exhausted = job.attempts >= job.max_attempts
  const delaySeconds = Math.min(900, 2 ** Math.max(0, job.attempts - 1) * 15)
  await sql`
    update jobs
    set status = ${exhausted ? 'failed' : 'pending'},
        run_at = case when ${exhausted} then run_at else now() + (${delaySeconds} * interval '1 second') end,
        locked_by = null,
        locked_at = null,
        last_error = ${message},
        updated_at = now()
    where id = ${job.id}::bigint
  `.execute(db)
}

export async function recoverStaleJobs(db: Kysely<Database>): Promise<number> {
  const result = await sql`
    update jobs
    set status = 'pending', locked_by = null, locked_at = null, updated_at = now()
    where status = 'processing' and locked_at < now() - interval '15 minutes'
  `.execute(db)
  return Number(result.numAffectedRows ?? 0)
}
