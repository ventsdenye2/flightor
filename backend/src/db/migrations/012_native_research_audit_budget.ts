import { sql, type Kysely } from 'kysely'

/** Shared USD budget and immutable-attribution audit for the opt-in native research provider. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    create table research_budgets (
      id text primary key check (length(id) between 1 and 160),
      currency char(3) not null default 'USD' check (currency = 'USD'),
      limit_usd_micros bigint not null check (limit_usd_micros >= 0),
      reserved_usd_micros bigint not null default 0 check (reserved_usd_micros >= 0),
      settled_usd_micros bigint not null default 0 check (settled_usd_micros >= 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (reserved_usd_micros + settled_usd_micros <= limit_usd_micros)
    );
    create table research_generation_audits (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      budget_id text not null references research_budgets(id) on delete restrict,
      user_id bigint not null references users(id) on delete restrict,
      request_id text not null check (length(request_id) between 1 and 160),
      generation_id uuid not null,
      trip_id bigint not null references trips(id) on delete restrict,
      conversation_id bigint references conversations(id) on delete set null,
      goal_id bigint references planning_goals(id) on delete set null,
      goal_run_id bigint references planning_goal_runs(id) on delete set null,
      trip_context_version integer not null check (trip_context_version >= 0),
      provider text not null check (length(provider) between 1 and 80),
      model text not null check (length(model) between 1 and 160),
      status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
      reserved_usd_micros bigint not null check (reserved_usd_micros > 0),
      settled_usd_micros bigint check (settled_usd_micros >= 0 and settled_usd_micros <= reserved_usd_micros),
      request_json jsonb not null,
      receipt_json jsonb,
      normalization_json jsonb,
      error_json jsonb,
      artifact_id bigint references artifacts(id) on delete restrict,
      delivered_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, generation_id),
      check ((artifact_id is null) = (delivered_at is null))
    );
    create index research_generation_audits_owner_request_idx on research_generation_audits (user_id, request_id, created_at desc);
    create index research_generation_audits_artifact_idx on research_generation_audits (artifact_id) where artifact_id is not null;
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    drop table if exists research_generation_audits;
    drop table if exists research_budgets;
  `).execute(db)
}
