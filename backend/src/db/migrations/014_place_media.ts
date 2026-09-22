import { sql, type Kysely } from 'kysely'
export async function up(db: Kysely<unknown>) {
  await sql.raw(`
    create table media_query_cache (query_key text primary key, result_json jsonb not null, expires_at timestamptz not null);
    create table guide_media_bindings (
      user_id bigint not null references users(id) on delete cascade,
      artifact_id uuid not null references artifacts(public_id) on delete cascade,
      content_version text not null, activity_id text not null, result_json jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id,artifact_id,content_version,activity_id));
  `).execute(db)
}
export async function down(db: Kysely<unknown>) { await sql.raw('drop table guide_media_bindings; drop table media_query_cache;').execute(db) }
