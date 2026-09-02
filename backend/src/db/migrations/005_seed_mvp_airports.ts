import { sql, type Kysely } from 'kysely'
import { MVP_AIRPORTS, MVP_COUNTRIES } from '../seed-data/mvp-airports.js'

function esc(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function countryValues(): string {
  return MVP_COUNTRIES
    .map(country => `(${esc(country.code)}, ${esc(country.nameZh)}, ${esc(country.nameEn)}, ${country.region ? esc(country.region) : 'NULL'})`)
    .join(',\n')
}

function cityValues(): string {
  const cities = new Map<string, typeof MVP_AIRPORTS[number]>()
  for (const airport of MVP_AIRPORTS) {
    if (!cities.has(airport.cityIata)) cities.set(airport.cityIata, airport)
  }
  return [...cities.values()]
    .map(city => `(${esc(city.cityIata)}, ${esc(city.countryCode)}, ${esc(city.cityZh)}, ${esc(city.cityEn)}, ${city.lat}, ${city.lng})`)
    .join(',\n')
}

function airportValues(): string {
  return MVP_AIRPORTS
    .map(airport => `(${esc(airport.iata)}, ${esc(airport.cityIata)}, ${esc(airport.countryCode)}, ${esc(airport.nameZh)}, ${esc(airport.nameEn)}, ${airport.lat}, ${airport.lng}, true)`)
    .join(',\n')
}

function aliasValues(): string {
  const rows: string[] = []
  for (const airport of MVP_AIRPORTS) {
    for (const alias of airport.aliases) {
      rows.push(`(${esc(airport.iata)}, 'all', ${esc(alias)})`)
    }
  }
  return rows.join(',\n')
}

/**
 * Build the airport seed statement separately so the city foreign key cannot
 * accidentally receive the city IATA string instead of cities.id.
 */
export function buildAirportInsertSql(): string {
  return `
    insert into airports (iata_code, city_id, country_code, name_zh, name_en, latitude, longitude, active)
    select v.iata_code, c.id, v.country_code, v.name_zh, v.name_en, v.latitude, v.longitude, v.active
    from (values ${airportValues()}) as v(iata_code, city_iata, country_code, name_zh, name_en, latitude, longitude, active)
    join cities c on c.iata_code = v.city_iata
    on conflict (iata_code) where iata_code is not null do update set
      city_id = coalesce(airports.city_id, excluded.city_id),
      name_zh = coalesce(nullif(airports.name_zh, ''), excluded.name_zh),
      name_en = coalesce(nullif(airports.name_en, ''), excluded.name_en),
      latitude = coalesce(airports.latitude, excluded.latitude),
      longitude = coalesce(airports.longitude, excluded.longitude),
      timezone = coalesce(airports.timezone, excluded.timezone),
      updated_at = now();
  `
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    insert into countries (code, name_zh, name_en, region) values
      ${countryValues()}
    on conflict (code) do nothing;
  `).execute(db)

  await sql.raw(`
    insert into cities (iata_code, country_code, name_zh, name_en, latitude, longitude) values
      ${cityValues()}
    on conflict (iata_code) where iata_code is not null do nothing;
  `).execute(db)

  await sql.raw(buildAirportInsertSql()).execute(db)

  if (aliasValues().length > 0) {
    await sql.raw(`
      insert into airport_aliases (airport_id, locale, alias, alias_normalized)
      select a.id, v.locale, v.alias, lower(v.alias)
      from (values ${aliasValues()}) as v(iata_code, locale, alias)
      join airports a on a.iata_code = v.iata_code
      on conflict (airport_id, locale, alias_normalized) do nothing;
    `).execute(db)
  }
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Intentionally a no-op. The schema has no migration/source marker on seed
  // rows, so deleting aliases could remove rows that predated this migration;
  // airports, cities and countries may also be referenced by business data.
}
