import { sql, type Kysely } from 'kysely'

/** Durable, user-scoped goals and frozen-context execution runs. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    create table planning_goals (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint not null references users(id) on delete cascade,
      trip_id bigint not null references trips(id) on delete cascade,
      conversation_id bigint references conversations(id) on delete set null,
      idempotency_key text not null,
      request_hash char(64) not null,
      kind text not null check (kind in ('travel_guide', 'flight_search', 'trip_context_update', 'route_generation')),
      parameters_json jsonb not null,
      created_context_version integer not null check (created_context_version >= 0),
      authorization_source text check (authorization_source in ('button', 'explicit_user_message')),
      authorization_granted_at timestamptz,
      status text not null default 'pending' check (status in ('pending', 'satisfied', 'partial', 'failed', 'cancelled')),
      revision integer not null default 0 check (revision >= 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz,
      unique (user_id, trip_id, idempotency_key),
      check ((authorization_source is null) = (authorization_granted_at is null))
    );
    create index planning_goals_user_updated_idx on planning_goals (user_id, updated_at desc);
    create index planning_goals_trip_status_idx on planning_goals (trip_id, status, updated_at desc);
    create index planning_goals_conversation_idx on planning_goals (conversation_id) where conversation_id is not null;

    create table planning_goal_runs (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      goal_id bigint not null references planning_goals(id) on delete cascade,
      user_id bigint not null references users(id) on delete cascade,
      trip_id bigint not null references trips(id) on delete cascade,
      conversation_id bigint references conversations(id) on delete set null,
      generation_id text not null,
      idempotency_key text not null,
      request_hash char(64) not null,
      context_version integer not null check (context_version >= 0),
      context_json jsonb not null,
      status text not null default 'running' check (status in ('running', 'satisfied', 'partial', 'failed', 'cancelled')),
      working_set_json jsonb not null default '{"artifactRefs":[],"locationHandles":[]}'::jsonb,
      revision integer not null default 0 check (revision >= 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz,
      unique (goal_id, idempotency_key)
    );
    create unique index planning_goal_runs_one_running_idx
      on planning_goal_runs (goal_id) where status = 'running';
    create index planning_goal_runs_goal_updated_idx on planning_goal_runs (goal_id, updated_at desc);
    create index planning_goal_runs_trip_context_idx on planning_goal_runs (trip_id, context_version, updated_at desc);
    create index planning_goal_runs_user_updated_idx on planning_goal_runs (user_id, updated_at desc);

    -- Existing artifacts remain valid and unscoped. New artifacts may carry
    -- durable goal provenance and the exact context version that produced them.
    alter table artifacts
      add column goal_id bigint references planning_goals(id) on delete set null,
      add column goal_run_id bigint references planning_goal_runs(id) on delete set null,
      add column trip_context_version integer check (trip_context_version is null or trip_context_version >= 0),
      add column source_artifact_ids_json jsonb not null default '[]'::jsonb,
      add constraint run_requires_goal check (
        goal_run_id is null or goal_id is not null
      );
    create index artifacts_goal_idx on artifacts (goal_id, created_at desc) where goal_id is not null;
    create index artifacts_goal_run_idx on artifacts (goal_run_id, created_at desc) where goal_run_id is not null;
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    drop index if exists artifacts_goal_run_idx;
    drop index if exists artifacts_goal_idx;
    alter table artifacts
      drop constraint if exists run_requires_goal,
      drop column if exists source_artifact_ids_json,
      drop column if exists trip_context_version,
      drop column if exists goal_run_id,
      drop column if exists goal_id;
    drop table if exists planning_goal_runs;
    drop table if exists planning_goals;
  `).execute(db)
}
