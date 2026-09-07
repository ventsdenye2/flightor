import { sql } from 'kysely'
import type { Kysely } from 'kysely'

/** Durable, user-scoped state for an explicitly requested route generation. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    create table route_generation_runs (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint not null references users(id) on delete cascade,
      trip_id bigint not null references trips(id) on delete cascade,
      conversation_id bigint references conversations(id) on delete set null,
      idempotency_key text not null,
      request_hash char(64) not null,
      context_json jsonb not null,
      context_version integer not null check (context_version >= 0),
      status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      progress_stage text not null default 'queued' check (progress_stage in ('queued', 'searching_connections', 'planning_paths', 'optimizing_routes', 'persisting_artifacts', 'completed', 'failed', 'cancelled')),
      progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
      result_artifact_id bigint references artifacts(id) on delete set null,
      error_code text,
      error_message text,
      warnings_json jsonb not null default '[]'::jsonb,
      started_at timestamptz,
      finished_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, trip_id, idempotency_key)
    );
    create index route_generation_runs_user_created_idx
      on route_generation_runs (user_id, created_at desc);
    create index route_generation_runs_trip_created_idx
      on route_generation_runs (trip_id, created_at desc);
    create index route_generation_runs_status_idx
      on route_generation_runs (status, updated_at);
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('drop table if exists route_generation_runs').execute(db)
}
