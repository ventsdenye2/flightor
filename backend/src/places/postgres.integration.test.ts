import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import type { Database } from '../db/types.js'
import { up as placeEnrichment } from '../db/migrations/013_place_enrichment.js'
import { NominatimCityLocationResolver } from '../aviation/nominatim-city-resolver.js'
import { PostgresPlaceRepository } from './postgres.js'
import { NominatimProvider } from './nominatim.js'
import type { LocationResolution } from '../aviation/types.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

type IsolatedDatabase = { schema: string; admin: pg.Pool; db: Kysely<Database>; pool: pg.Pool }

suite('Nominatim city cache and lease PostgreSQL integration', () => {
  const fixtures: IsolatedDatabase[] = []

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await fixture.db.destroy()
      await fixture.admin.query(`drop schema if exists "${fixture.schema}" cascade`)
      await fixture.admin.end()
    }
  })

  async function isolatedSchema(): Promise<IsolatedDatabase> {
    const schema = `place_city_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: databaseUrl })
    await admin.query(`create schema "${schema}"`)
    const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 6 })
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    const fixture = { schema, admin, db, pool }
    fixtures.push(fixture)
    await sql.raw(`create table users (id bigint primary key); create table artifacts (public_id uuid primary key);`).execute(db)
    await placeEnrichment(db)
    expect((await sql<{ schema: string }>`select current_schema() as schema`.execute(db)).rows[0]?.schema).toBe(schema)
    return fixture
  }

  function city(id: string, name: string, countryCode = 'JP', checkedAt = '2026-10-06T00:00:00.000Z'): LocationResolution {
    return { matches: [{ id, type: 'city', name, countryCode, latitude: 35.0116, longitude: 135.7681 }],
      verification: { status: 'verified', checkedAt, confidence: 0.9, sources: [{ provider: 'nominatim', reference: name }] } }
  }

  it('round-trips real city resolutions and keeps same-key same-identity concurrent writes stable', async () => {
    const { db } = await isolatedSchema(), repository = new PostgresPlaceRepository(db)
    const key = 'same-city-key', expected = city('osm:relation:987', 'Kyoto')
    await Promise.all([repository.cacheCityQuery(key, expected), repository.cacheCityQuery(key, expected)])
    await expect(repository.cachedCityQuery(key)).resolves.toEqual(expected)
  }, 30_000)

  it('does not silently replace a still-valid OSM identity when concurrent same-key cache writes disagree', async () => {
    const { db } = await isolatedSchema(), repository = new PostgresPlaceRepository(db)
    const key = 'changed-city-identity', accepted = city('osm:relation:987', 'Kyoto')
    await repository.cacheCityQuery(key, accepted)
    await sql`update place_query_cache set expires_at=now()+interval '5 minutes' where query_key=${key}`.execute(db)
    const before = await sql<{ expires_at: string }>`select expires_at::text as expires_at from place_query_cache where query_key=${key}`.execute(db)
    await Promise.all([
      repository.cacheCityQuery(key, city('osm:way:876', 'Kyoto City', 'JP', '2026-10-06T01:00:00.000Z')),
      repository.cacheCityQuery(key, city('osm:relation:765', 'Kyoto', 'CN', '2026-10-06T02:00:00.000Z'))
    ])
    const persisted = await repository.cachedCityQuery(key)
    expect(persisted?.matches.map(match => match.id).sort()).toEqual(['osm:relation:765', 'osm:relation:987', 'osm:way:876'])
    expect(persisted?.matches.find(match => match.id === accepted.matches[0]?.id)).toEqual(accepted.matches[0])
    expect(persisted?.verification).toEqual(accepted.verification)
    const after = await sql<{ expires_at: string }>`select expires_at::text as expires_at from place_query_cache where query_key=${key}`.execute(db)
    expect(after.rows[0]?.expires_at).toBe(before.rows[0]?.expires_at)
  }, 30_000)

  it('keeps a prior object unchanged for the same OSM id and replaces it only after expiry', async () => {
    const { db } = await isolatedSchema(), repository = new PostgresPlaceRepository(db)
    const key = 'same-osm-id', accepted = city('osm:relation:987', 'Kyoto')
    await repository.cacheCityQuery(key, accepted)
    await repository.cacheCityQuery(key, city('osm:relation:987', 'Kyoto-shi', 'CN', '2026-10-06T02:00:00.000Z'))
    await expect(repository.cachedCityQuery(key)).resolves.toEqual(accepted)

    await sql`update place_query_cache set expires_at=now()-interval '1 second' where query_key=${key}`.execute(db)
    const refreshed = city('osm:node:456', 'Kyoto', 'JP', '2026-10-06T03:00:00.000Z')
    await expect(repository.cacheCityQuery(key, refreshed)).resolves.toEqual(refreshed)
    await expect(repository.cachedCityQuery(key)).resolves.toEqual(refreshed)
  }, 30_000)

  it('accepts a later verified identity over a still-valid empty unverified cache without extending its TTL', async () => {
    const { db } = await isolatedSchema(), repository = new PostgresPlaceRepository(db)
    const key = 'empty-unverified-city', empty: LocationResolution = { matches: [], verification: {
      status: 'unverified', checkedAt: '2026-10-06T00:00:00.000Z', confidence: 0, sources: [{ provider: 'nominatim' }] } }
    await repository.cacheCityQuery(key, empty)
    await sql`update place_query_cache set expires_at=now()+interval '5 minutes' where query_key=${key}`.execute(db)
    const before = await sql<{ expires_at: string }>`select expires_at::text as expires_at from place_query_cache where query_key=${key}`.execute(db)
    const verified = city('osm:relation:999', 'Kyoto')
    await expect(repository.cacheCityQuery(key, verified)).resolves.toEqual(verified)
    await expect(repository.cachedCityQuery(key)).resolves.toEqual(verified)
    const after = await sql<{ expires_at: string }>`select expires_at::text as expires_at from place_query_cache where query_key=${key}`.execute(db)
    expect(after.rows[0]?.expires_at).toBe(before.rows[0]?.expires_at)
  }, 30_000)

  it('coalesces cross-instance same-key work through the shared lease and cache; cache hits add no lease', async () => {
    const { db, admin, schema } = await isolatedSchema()
    const secondPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: `${schema}_second`, max: 3 })
    const secondDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: secondPool }) })
    const firstRepository = new PostgresPlaceRepository(db), secondRepository = new PostgresPlaceRepository(secondDb)
    let markStarted!: () => void, unlockResponse!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const responseGate = new Promise<void>(resolve => { unlockResponse = resolve })
    let httpCalls = 0
    const fixtureFetch: typeof fetch = async () => {
      httpCalls += 1
      markStarted()
      await responseGate
      return new Response(JSON.stringify([{ osm_type: 'relation', osm_id: 987, name: 'Kyoto', lat: '35.0116', lon: '135.7681',
        class: 'place', type: 'city', addresstype: 'city', address: { city: 'Kyoto', country: 'Japan', country_code: 'jp' } }]),
      { headers: { 'Content-Type': 'application/json' } })
    }
    const createResolver = (repository: PostgresPlaceRepository) => new NominatimCityLocationResolver(repository,
      new NominatimProvider({ baseUrl: 'https://nominatim.openstreetmap.org', userAgent: 'FlightOR-D6-PG-fixture', fetch: fixtureFetch,
        reserve: (signal, cacheReady) => repository.reserve(signal, cacheReady) }), 'd6-pg-nominatim-city:v1')
    const firstResolver = createResolver(firstRepository), secondResolver = createResolver(secondRepository)

    const first = firstResolver.resolveLocation({ query: 'Kyoto', types: ['city'] })
    let second: Promise<LocationResolution> | undefined
    try {
      await started
      second = secondResolver.resolveLocation({ query: 'Kyoto', types: ['city'] })
      await delay(350)
      expect(httpCalls).toBe(1)
      unlockResponse()
      const [one, two] = await Promise.all([first, second])
      expect(one).toEqual(two)
      expect(one.matches.map(match => match.id)).toEqual(['osm:relation:987'])
      expect(httpCalls).toBe(1)
      const beforeHit = await admin.query<{ count: string }>(`select count(*)::text as count from "${schema}".place_provider_calls`)
      await expect(firstResolver.resolveLocation({ query: 'Kyoto', types: ['city'] })).resolves.toEqual(one)
      const afterHit = await admin.query<{ count: string }>(`select count(*)::text as count from "${schema}".place_provider_calls`)
      expect(afterHit.rows[0]?.count).toBe(beforeHit.rows[0]?.count)
      expect(httpCalls).toBe(1)
      expect(afterHit.rows[0]?.count).toBe('1')
    } finally {
      unlockResponse()
      await Promise.allSettled([first, ...(second ? [second] : [])])
      await secondDb.destroy()
    }
  }, 30_000)
})
