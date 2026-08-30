import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'

const countryQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  popular: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})

const airportQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  countryCode: z.string().trim().length(2).transform(value => value.toUpperCase()).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
})

export async function registerReferenceDataRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/v1/countries', async request => {
    const query = countryQuerySchema.parse(request.query)
    let builder = context.db.selectFrom('countries')
      .select(['code', 'name_zh', 'name_en', 'region', 'is_popular', 'popularity_rank'])
      .where('active', '=', true)
    if (query.popular === 'true') builder = builder.where('is_popular', '=', true)
    if (query.query) {
      const term = `%${query.query}%`
      builder = builder.where(eb => eb.or([
        eb('code', '=', query.query!.toUpperCase()),
        eb('name_zh', 'ilike', term),
        eb('name_en', 'ilike', term)
      ]))
    }
    const countries = await builder
      .orderBy(sql`popularity_rank nulls last`)
      .orderBy('name_en')
      .limit(query.limit)
      .execute()
    return { countries }
  })

  app.get('/v1/airports', async request => {
    const query = airportQuerySchema.parse(request.query)
    let builder = context.db.selectFrom('airports')
      .leftJoin('cities', 'cities.id', 'airports.city_id')
      .innerJoin('countries', 'countries.code', 'airports.country_code')
      .select([
        'airports.iata_code as iata',
        'airports.icao_code as icao',
        'airports.name_zh',
        'airports.name_en',
        'airports.latitude',
        'airports.longitude',
        'airports.timezone',
        'cities.name_zh as city_name_zh',
        'cities.name_en as city_name_en',
        'countries.code as country_code',
        'countries.name_zh as country_name_zh',
        'countries.name_en as country_name_en'
      ])
      .where('airports.active', '=', true)
    if (query.countryCode) builder = builder.where('airports.country_code', '=', query.countryCode)
    if (query.query) {
      const term = `%${query.query}%`
      const code = query.query.toUpperCase()
      builder = builder.where(eb => eb.or([
        eb('airports.iata_code', '=', code),
        eb('airports.icao_code', '=', code),
        eb('airports.name_zh', 'ilike', term),
        eb('airports.name_en', 'ilike', term),
        eb('cities.name_zh', 'ilike', term),
        eb('cities.name_en', 'ilike', term)
      ]))
    }
    const airports = await builder.orderBy('airports.iata_code').limit(query.limit).execute()
    return { airports }
  })
}
