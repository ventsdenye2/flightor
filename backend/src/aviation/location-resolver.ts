import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { locationResolutionSchema, type LocationRef, type LocationResolution } from './types.js'
import type { ProviderCallOptions, ResolveLocationInput } from './providers/provider.js'

export interface LocationResolver {
  resolveLocation(input: ResolveLocationInput, options?: ProviderCallOptions): Promise<LocationResolution>
}

export class PostgresLocationResolver implements LocationResolver {
  constructor(private readonly db: Kysely<Database>) {}

  async resolveLocation(input: ResolveLocationInput, options: ProviderCallOptions = {}): Promise<LocationResolution> {
    options.signal?.throwIfAborted()
    const query = input.query.trim()
    const upper = query.toUpperCase()
    const term = `%${query}%`
    const limit = Math.max(1, Math.min(input.limit ?? 20, 20))
    const types = new Set(input.types ?? ['city', 'airport'])
    const matches: LocationRef[] = []

    if (types.has('city')) {
      const rows = await this.db.selectFrom('cities')
        .select(['id', 'country_code', 'iata_code', 'name_zh', 'name_en', 'latitude', 'longitude', 'timezone'])
        .where(eb => eb.or([
          eb('iata_code', '=', upper), eb('name_zh', 'ilike', term), eb('name_en', 'ilike', term)
        ]))
        .orderBy('iata_code').orderBy('name_en').limit(limit).execute()
      for (const row of rows) matches.push({
        id: row.id, type: 'city', name: row.name_en || row.name_zh,
        countryCode: row.country_code,
        ...(row.iata_code ? { cityCode: row.iata_code } : {}),
        ...(row.latitude === null ? {} : { latitude: row.latitude }),
        ...(row.longitude === null ? {} : { longitude: row.longitude }),
        ...(row.timezone === null ? {} : { timezone: row.timezone })
      })
    }

    if (types.has('airport') && matches.length < limit) {
      const rows = await this.db.selectFrom('airports')
        .leftJoin('cities', 'cities.id', 'airports.city_id')
        .select([
          'airports.id as id', 'airports.country_code as country_code',
          'airports.iata_code as iata_code', 'airports.name_zh as name_zh',
          'airports.name_en as name_en', 'airports.latitude as latitude',
          'airports.longitude as longitude', 'airports.timezone as timezone',
          'cities.iata_code as city_code'
        ])
        .where('airports.active', '=', true)
        .where(eb => eb.or([
          eb('airports.iata_code', '=', upper), eb('airports.icao_code', '=', upper),
          eb('airports.name_zh', 'ilike', term), eb('airports.name_en', 'ilike', term),
          eb('cities.name_zh', 'ilike', term), eb('cities.name_en', 'ilike', term)
        ]))
        .orderBy('airports.iata_code').limit(limit - matches.length).execute()
      for (const row of rows) {
        if (!row.iata_code) continue
        matches.push({
          id: row.id, type: 'airport', name: row.name_en || row.name_zh,
          countryCode: row.country_code, iata: row.iata_code,
          ...(row.city_code ? { cityCode: row.city_code } : {}),
          ...(row.latitude === null ? {} : { latitude: row.latitude }),
          ...(row.longitude === null ? {} : { longitude: row.longitude }),
          ...(row.timezone === null ? {} : { timezone: row.timezone })
        })
      }
    }
    options.signal?.throwIfAborted()
    const checkedAt = new Date().toISOString()
    return locationResolutionSchema.parse({
      matches: matches.slice(0, limit),
      verification: {
        status: matches.length ? 'verified' : 'unverified', checkedAt,
        confidence: matches.length ? 0.95 : 0,
        sources: [{ provider: 'flightor-reference-data', reference: query }]
      }
    })
  }
}
