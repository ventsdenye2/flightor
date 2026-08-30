import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    insert into countries (code, name_zh, name_en, region, is_popular, popularity_rank) values
      ('CN', '中国', 'China', 'East Asia', false, null),
      ('SG', '新加坡', 'Singapore', 'Southeast Asia', true, 1),
      ('MY', '马来西亚', 'Malaysia', 'Southeast Asia', true, 2),
      ('TH', '泰国', 'Thailand', 'Southeast Asia', true, 3),
      ('AE', '阿联酋', 'United Arab Emirates', 'Middle East', true, 4),
      ('QA', '卡塔尔', 'Qatar', 'Middle East', true, 5),
      ('TR', '土耳其', 'Türkiye', 'Europe', true, 6),
      ('JP', '日本', 'Japan', 'East Asia', true, 7),
      ('KR', '韩国', 'South Korea', 'East Asia', true, 8),
      ('FI', '芬兰', 'Finland', 'Europe', true, 9),
      ('GB', '英国', 'United Kingdom', 'Europe', true, 10),
      ('FR', '法国', 'France', 'Europe', true, 11),
      ('DE', '德国', 'Germany', 'Europe', true, 12),
      ('NL', '荷兰', 'Netherlands', 'Europe', true, 13),
      ('US', '美国', 'United States', 'North America', true, 14)
    on conflict (code) do update set
      name_zh = excluded.name_zh,
      name_en = excluded.name_en,
      region = excluded.region,
      is_popular = excluded.is_popular,
      popularity_rank = excluded.popularity_rank,
      updated_at = now();
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    delete from countries where code in ('CN','SG','MY','TH','AE','QA','TR','JP','KR','FI','GB','FR','DE','NL','US');
  `).execute(db)
}
