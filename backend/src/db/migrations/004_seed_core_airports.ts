import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    insert into airports (iata_code, country_code, name_zh, name_en, latitude, longitude) values
      ('SZX', 'CN', '深圳宝安国际机场', 'Shenzhen Baoan International Airport', 22.6393, 113.8107),
      ('CAN', 'CN', '广州白云国际机场', 'Guangzhou Baiyun International Airport', 23.3924, 113.2988),
      ('PVG', 'CN', '上海浦东国际机场', 'Shanghai Pudong International Airport', 31.1443, 121.8083),
      ('PEK', 'CN', '北京首都国际机场', 'Beijing Capital International Airport', 40.0799, 116.6031),
      ('LHR', 'GB', '伦敦希思罗机场', 'London Heathrow Airport', 51.4700, -0.4543),
      ('SIN', 'SG', '新加坡樟宜机场', 'Singapore Changi Airport', 1.3644, 103.9915),
      ('KUL', 'MY', '吉隆坡国际机场', 'Kuala Lumpur International Airport', 2.7456, 101.7099),
      ('BKK', 'TH', '曼谷素万那普机场', 'Bangkok Suvarnabhumi Airport', 13.6900, 100.7501),
      ('DOH', 'QA', '多哈哈马德国际机场', 'Hamad International Airport', 25.2731, 51.6081),
      ('DXB', 'AE', '迪拜国际机场', 'Dubai International Airport', 25.2532, 55.3657),
      ('IST', 'TR', '伊斯坦布尔机场', 'Istanbul Airport', 41.2753, 28.7519),
      ('HEL', 'FI', '赫尔辛基万塔机场', 'Helsinki Airport', 60.3172, 24.9633)
    on conflict (iata_code) where iata_code is not null do update set
      country_code = excluded.country_code,
      name_zh = excluded.name_zh,
      name_en = excluded.name_en,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      updated_at = now();
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    delete from airports
    where iata_code in ('SZX','CAN','PVG','PEK','LHR','SIN','KUL','BKK','DOH','DXB','IST','HEL')
      and not exists (select 1 from schedule_services where origin_airport_id = airports.id or destination_airport_id = airports.id)
      and not exists (select 1 from route_edges where origin_airport_id = airports.id or destination_airport_id = airports.id);
  `).execute(db)
}
