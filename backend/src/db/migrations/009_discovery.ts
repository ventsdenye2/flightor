import { sql, type Kysely } from 'kysely'
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    create table admin_users (
      id uuid primary key, email text not null unique, password_hash text not null,
      role text not null check (role in ('viewer','reviewer','admin')),
      active boolean not null default true, token_version integer not null default 0,
      created_at timestamptz not null default now()
    );
    create table discovery_runs (
      public_id uuid primary key, status text not null check (status in ('queued','running','succeeded','failed')),
      input_json jsonb not null, candidate_count integer not null default 0,
      error_code text, attempt integer not null default 0,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table discovery_candidates (
      public_id uuid primary key, fingerprint text not null unique,
      status text not null check (status in ('candidate','draft','review','published','stale','expired','archived')),
      category text not null, current_version integer not null default 1, published_version integer,
      source_run_id uuid references discovery_runs(public_id),
      valid_from timestamptz not null, expires_at timestamptz not null, verified_until timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table trip_template_versions (
      candidate_id uuid not null references discovery_candidates(public_id), version integer not null,
      payload_json jsonb not null, action text not null,
      actor_id uuid references admin_users(id), created_at timestamptz not null default now(),
      primary key (candidate_id, version)
    );
    create index discovery_candidates_feed_idx on discovery_candidates (status, expires_at, verified_until);
    create index discovery_runs_created_idx on discovery_runs (created_at desc);
    create table discovery_sources (
      public_id uuid primary key, name text not null, input_json jsonb not null,
      interval_hours integer not null check (interval_hours between 6 and 720), enabled boolean not null default true,
      next_run_at timestamptz not null default now(), last_run_id uuid references discovery_runs(public_id),
      created_at timestamptz not null default now()
    );
    create table explore_seeds (
      user_id bigint not null references users(id) on delete cascade,
      idempotency_key text not null, candidate_id uuid not null references discovery_candidates(public_id),
      template_version integer not null, trip_id bigint not null references trips(id) on delete cascade,
      conversation_id bigint not null references conversations(id) on delete cascade,
      created_at timestamptz not null default now(), primary key (user_id, idempotency_key)
    );
  `).execute(db)
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('drop table explore_seeds; drop table discovery_sources; drop table trip_template_versions; drop table discovery_candidates; drop table discovery_runs; drop table admin_users;').execute(db)
}
