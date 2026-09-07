import { sql } from 'kysely'
import type { Kysely } from 'kysely'
import type { Database, Job, JsonValue } from '../db/types.js'

export async function enqueueJob(
  db: Kysely<Database>,
  type: string,
  payload: JsonValue,
  options: { runAt?: Date; maxAttempts?: number } = {}
): Promise<string> {
  const result = await db.insertInto('jobs').values({
    type,
    payload,
    run_at: options.runAt ?? new Date(),
    max_attempts: options.maxAttempts ?? 5,
    locked_by: null,
    locked_at: null,
    last_error: null,
    completed_at: null
  }).returning('id').executeTakeFirstOrThrow()
  return result.id
}

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

/** Keeps a legitimately long-running job from being reclaimed by another worker. */
export async function heartbeatJob(db: Kysely<Database>, jobId: string, workerId: string): Promise<boolean> {
  const result = await db.updateTable('jobs').set({
    locked_at: new Date(),
    updated_at: new Date()
  })
    .where('id', '=', jobId)
    .where('status', '=', 'processing')
    .where('locked_by', '=', workerId)
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
}

export async function failJob(db: Kysely<Database>, job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown worker error'
  const exhausted = job.attempts >= job.max_attempts
  const delaySeconds = Math.min(900, 2 ** Math.max(0, job.attempts - 1) * 15)
  await sql`
    with updated_job as (
      update jobs
      set status = ${exhausted ? 'failed' : 'pending'},
          run_at = case when ${exhausted} then run_at else now() + (${delaySeconds} * interval '1 second') end,
          locked_by = null,
          locked_at = null,
          last_error = ${message},
          updated_at = now()
      where id = ${job.id}::bigint
      returning type, payload
    )
    update route_generation_runs as run
    set status = 'failed',
        progress_stage = 'failed',
        progress_percent = 100,
        error_code = 'ROUTE_GENERATION_WORKER_EXHAUSTED',
        error_message = 'Route generation failed after worker retries.',
        finished_at = now(),
        updated_at = now()
    where ${exhausted}
      and run.status in ('queued', 'running')
      and run.public_id::text = (
        select updated_job.payload->>'runId'
        from updated_job
        where updated_job.type = 'route_generation'
      )
  `.execute(db)
}

export async function recoverStaleJobs(db: Kysely<Database>): Promise<number> {
  const result = await sql`
    update jobs as job
    set status = 'pending',
        run_at = case
          when job.type = 'route_generation' then greatest(
            now(),
            coalesce((
              select run.updated_at + interval '15 minutes'
              from route_generation_runs as run
              where run.public_id::text = job.payload->>'runId'
            ), now())
          )
          else now()
        end,
        locked_by = null,
        locked_at = null,
        updated_at = now()
    where job.status = 'processing'
      and job.locked_at < now() - interval '15 minutes'
  `.execute(db)
  return Number(result.numAffectedRows ?? 0)
}
