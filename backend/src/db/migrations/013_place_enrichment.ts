import { sql, type Kysely } from 'kysely'
export async function up(db:Kysely<unknown>){await sql.raw(`
 create table place_query_cache (query_key text primary key, result_json jsonb not null, expires_at timestamptz not null);
 create table guide_place_bindings (
  user_id bigint not null references users(id) on delete cascade,
  artifact_id uuid not null references artifacts(public_id) on delete cascade,
  content_version text not null, activity_id text not null, result_json jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,artifact_id,content_version,activity_id));
 create table place_provider_calls (
  id uuid primary key, started_at timestamptz not null default now(), finished_at timestamptz,
  lease_until timestamptz not null, status text not null default 'reserved');
 create index place_provider_calls_started_idx on place_provider_calls(started_at);
 `).execute(db)}
export async function down(db:Kysely<unknown>){await sql.raw('drop table guide_place_bindings; drop table place_query_cache; drop table place_provider_calls;').execute(db)}
