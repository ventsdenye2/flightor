import { sql, type Kysely } from 'kysely'

/** Tie the explicit route-generation job to its durable planning Goal attempt. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    alter table route_generation_runs
      add column planning_goal_id bigint references planning_goals(id) on delete set null,
      add column planning_goal_run_id bigint references planning_goal_runs(id) on delete set null,
      add constraint route_generation_goal_run_requires_goal check (
        planning_goal_run_id is null or planning_goal_id is not null
      );
    create index route_generation_runs_goal_idx
      on route_generation_runs (planning_goal_id, created_at desc)
      where planning_goal_id is not null;
    create unique index route_generation_runs_goal_run_idx
      on route_generation_runs (planning_goal_run_id)
      where planning_goal_run_id is not null;
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    drop index if exists route_generation_runs_goal_run_idx;
    drop index if exists route_generation_runs_goal_idx;
    alter table route_generation_runs
      drop constraint if exists route_generation_goal_run_requires_goal,
      drop column if exists planning_goal_run_id,
      drop column if exists planning_goal_id;
  `).execute(db)
}
