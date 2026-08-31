import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    insert into countries (code, name_zh, name_en, region, active)
    values ('ZZ', '待补充', 'Unknown', null, false)
    on conflict (code) do nothing;
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    delete from countries
    where code = 'ZZ'
      and not exists (select 1 from airports where country_code = 'ZZ');
  `).execute(db)
}
