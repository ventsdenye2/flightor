import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table trips add column workspace_version integer not null default 0 check (workspace_version >= 0), add column saved_route_json jsonb`.execute(db)
  await sql`alter table trips drop constraint trips_status_check`.execute(db)
  await sql`alter table trips add constraint trips_status_check check (status in ('planning', 'generated', 'saved', 'archived'))`.execute(db)
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update trips set status = 'generated' where status = 'saved'`.execute(db)
  await sql`alter table trips drop constraint trips_status_check`.execute(db)
  await sql`alter table trips add constraint trips_status_check check (status in ('planning', 'generated', 'archived'))`.execute(db)
  await sql`alter table trips drop column workspace_version, drop column saved_route_json`.execute(db)
}
