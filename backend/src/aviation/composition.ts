import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import type { AppEnv } from '../config/env.js'
import type { AviationProvider } from './providers/provider.js'
import { CompositeAviationProvider } from './providers/composite.js'
import { PostgresLocationResolver } from './location-resolver.js'
import { NominatimCityLocationResolver } from './nominatim-city-resolver.js'
import { NominatimProvider } from '../places/nominatim.js'
import { PostgresPlaceRepository } from '../places/postgres.js'

export function createCompositeAviationProvider(db: Kysely<Database>, primary: AviationProvider, env: Pick<AppEnv,
  'PLACES_NOMINATIM_URL' | 'PLACES_USER_AGENT' | 'PLACES_PROXY_URL'>): CompositeAviationProvider {
  const local = new PostgresLocationResolver(db)
  let cityFallback: NominatimCityLocationResolver | undefined
  if (env.PLACES_NOMINATIM_URL && env.PLACES_USER_AGENT) {
    const repository = new PostgresPlaceRepository(db)
    const provider = new NominatimProvider({ baseUrl: env.PLACES_NOMINATIM_URL, userAgent: env.PLACES_USER_AGENT,
      proxyUrl: env.PLACES_PROXY_URL, reserve: (signal, cacheReady) => repository.reserve(signal, cacheReady) })
    cityFallback = new NominatimCityLocationResolver(repository, provider, `${env.PLACES_NOMINATIM_URL}:aviation-city-v1`)
  }
  return new CompositeAviationProvider(primary, local, cityFallback)
}
