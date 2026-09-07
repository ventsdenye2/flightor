import { describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { ProductionConnectionSearchService } from '../flight-routing/connection-search.js'
import { DeterministicFlightRoutePlanner } from '../flight-routing/planner.js'
import { PostgresTopologyRepository } from './postgres.js'

type Row = Record<string, any>
class Select {
  private filters: Array<[string, string, unknown]> = []
  private limitValue: number | undefined
  constructor(private readonly db: FakeDb, private readonly table: string) {}
  selectAll() { return this }
  select() { return this }
  where(column: string, op: string, value: unknown) { this.filters.push([column, op, value]); return this }
  orderBy() { return this }
  limit(value: number) { this.limitValue = value; return this }
  private rows() {
    const rows = this.db.tables[this.table].filter(row => this.filters.every(([column, op, value]) => {
      const key = column.split('.').at(-1)!
      return op === '=' ? row[key] === value : true
    }))
    return this.limitValue === undefined ? rows : rows.slice(0, this.limitValue)
  }
  async execute() { return this.rows() }
  async executeTakeFirst() { return this.rows()[0] }
}
class FakeDb {
  tables: Record<string, Row[]> = { topology_versions: [], airports: [], cities: [], route_edges: [], schedule_services: [], connection_options: [] }
  selectFrom(table: string) { return new Select(this, table) }
}
const db = (value: FakeDb) => value as unknown as Kysely<Database>
const input = {
  origin: { id: 'a', type: 'airport' as const, name: 'A', countryCode: 'CN', iata: 'AAA' },
  destination: { id: 'c', type: 'airport' as const, name: 'C', countryCode: 'JP', iata: 'CCC' },
  window: { from: '2026-10-04', to: '2026-10-10' }, preferredLocations: [], excludedLocations: [],
  acceptsSelfTransfer: false, acceptsLongStopover: false, maxTransfers: 2, limit: 100
}
const snapshot = { id: '1', public_id: 'topology-1', source: 'test', status: 'active', coverage: { kind: 'complete' }, coverage_complete: true, activated_at: '2026-09-07T00:00:00.000Z' }
const airport = (id: string, iata: string, country_code = 'CN', city_id: string | null = null) => ({ id, iata_code: iata, city_id, country_code, name_en: iata, name_zh: iata, latitude: null, longitude: null, timezone: null, active: true })
const city = (id: string, iata_code: string, country_code = 'JP') => ({ id, iata_code, country_code, name_en: iata_code, name_zh: iata_code, latitude: null, longitude: null, timezone: null })

describe('PostgresTopologyRepository', () => {
  it('returns direct and two-transfer candidates with stable ordering and complete coverage semantics', async () => {
    const value = new FakeDb()
    value.tables.topology_versions.push(snapshot)
    value.tables.airports.push(airport('a', 'AAA'), airport('b', 'BBB'), airport('c', 'CCC', 'JP'))
    value.tables.route_edges.push(
      { id: 'z-direct', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' },
      { id: 'a-ab', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'b', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' },
      { id: 'b-bc', topology_version_id: '1', origin_airport_id: 'b', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' }
    )
    value.tables.connection_options.push({ id: 'conn-a-b-c', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'c', hub_airport_id: 'b', connection_minutes: 120, mct_status: 'II', is_self_connection: false, valid_from: null, valid_to: null, operating_days_mask: 127 })
    const result = await new PostgresTopologyRepository(db(value)).findCandidates(input)
    expect(result.coverageStatus).toBe('reachable')
    expect(result.candidates.map(candidate => candidate.segments.map(segment => segment.to.iata).join('>'))).toEqual(['CCC', 'BBB>CCC'])
    expect(result.candidates[0]?.transferType).toBe('direct')
    expect(result.snapshot?.coverage).toBe('complete')
  })

  it('does not call a partial miss unreachable and honors hard excluded hubs', async () => {
    const value = new FakeDb()
    value.tables.topology_versions.push({ ...snapshot, coverage_complete: false, coverage: { kind: 'partial' } })
    value.tables.airports.push(airport('a', 'AAA'), airport('b', 'BBB'), airport('c', 'CCC', 'JP'))
    value.tables.route_edges.push({ id: 'a-b', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'b', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' }, { id: 'b-c', topology_version_id: '1', origin_airport_id: 'b', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' })
    const result = await new PostgresTopologyRepository(db(value)).findCandidates({ ...input, excludedLocations: [{ id: 'b', type: 'airport', name: 'B', countryCode: 'CN', iata: 'BBB' }] })
    expect(result.candidates).toHaveLength(0)
    expect(result.coverageStatus).toBe('unknown')
  })

  it('reports bounded source reads as unknown instead of false unreachable', async () => {
    const value = new FakeDb()
    value.tables.topology_versions.push(snapshot)
    value.tables.airports.push(airport('a', 'AAA'), airport('b', 'BBB'), airport('c', 'CCC', 'JP'))
    const result = await new PostgresTopologyRepository(db(value), 1).findCandidates(input)
    expect(result).toMatchObject({ coverageStatus: 'unknown', truncated: true, exhausted: false })
    expect(result.warnings.join(' ')).toContain('row read bound')
  })

  it('resolves the first concrete operating day instead of assuming the window start', async () => {
    const value = new FakeDb()
    value.tables.topology_versions.push(snapshot)
    value.tables.airports.push(airport('a', 'AAA'), airport('c', 'CCC', 'JP'))
    // 2026-10-04 is Sunday; Monday-only service first operates on 2026-10-05.
    value.tables.route_edges.push({ id: 'monday-only', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: 1 << 1, source: 'test' })
    const result = await new PostgresTopologyRepository(db(value)).findCandidates(input)
    expect(result.candidates[0]?.segments[0]?.serviceDate).toBe('2026-10-05')
  })

  it('materializes later legs on the earliest operating day after the prior leg', async () => {
    const value = new FakeDb()
    value.tables.topology_versions.push(snapshot)
    value.tables.airports.push(airport('a', 'AAA'), airport('b', 'BBB'), airport('c', 'CCC', 'JP'))
    // Window starts Sunday. A→B is Tuesday-only; B→C runs Monday and Wednesday.
    value.tables.route_edges.push(
      { id: 'tuesday-ab', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'b', valid_from: null, valid_to: null, operating_days_mask: 1 << 2, source: 'test' },
      { id: 'monday-wednesday-bc', topology_version_id: '1', origin_airport_id: 'b', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: (1 << 1) | (1 << 3), source: 'test' }
    )
    value.tables.connection_options.push({ id: 'conn-a-b-c', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'c', hub_airport_id: 'b', connection_minutes: 120, mct_status: 'II', is_self_connection: false, valid_from: null, valid_to: null, operating_days_mask: 127 })

    const topology = new PostgresTopologyRepository(db(value))
    const result = await topology.findCandidates({ ...input, window: { from: '2026-10-04', to: '2026-10-07' } })

    expect(result.candidates[0]?.segments.map(segment => segment.serviceDate)).toEqual(['2026-10-06', '2026-10-07'])

    const connections = await new ProductionConnectionSearchService(topology, { maxFareLookups: 0 }).search({
      origin: input.origin, destination: input.destination,
      window: { from: '2026-10-04', to: '2026-10-07' }, preferredLocations: [], excludedLocations: [],
      acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 20
    })
    const planned = await new DeterministicFlightRoutePlanner().plan({
      nodes: [{ location: input.origin, role: 'origin' }, { location: input.destination, role: 'destination' }],
      edges: connections.edges, window: { from: '2026-10-04', to: '2026-10-07' }, constraints: {}, maxPaths: 20
    })
    expect(planned.paths[0]?.edges.map(edge => edge.departureDate)).toEqual(['2026-10-06', '2026-10-07'])
  })

  it('uses city codes for preferred ranking and hard hub exclusion across constituent airports', async () => {
    const value = new FakeDb()
    value.tables.topology_versions.push(snapshot)
    value.tables.cities.push(city('tokyo', 'TYO'))
    value.tables.airports.push(airport('a', 'AAA'), airport('b', 'NRT', 'JP', 'tokyo'), airport('c', 'CCC', 'JP'))
    value.tables.route_edges.push(
      { id: 'z-direct', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' },
      { id: 'a-via-nrt', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'b', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' },
      { id: 'b-from-nrt', topology_version_id: '1', origin_airport_id: 'b', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' }
    )
    value.tables.connection_options.push({ id: 'conn-a-b-c', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'c', hub_airport_id: 'b', connection_minutes: 120, mct_status: 'II', is_self_connection: false, valid_from: null, valid_to: null, operating_days_mask: 127 })
    const tokyo = { id: 'tokyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
    const topology = new PostgresTopologyRepository(db(value))

    const preferred = await topology.findCandidates({ ...input, preferredLocations: [tokyo] })
    expect(preferred.candidates[0]?.segments.map(segment => segment.to.iata)).toEqual(['NRT', 'CCC'])

    const excluded = await new ProductionConnectionSearchService(topology, { maxFareLookups: 0 }).search({
      origin: input.origin, destination: input.destination, window: input.window,
      preferredLocations: [], excludedLocations: [tokyo], acceptsSelfTransfer: false, acceptsLongStopover: false, maxCandidates: 20
    })
    expect(excluded.edges.map(edge => `${edge.from.iata}>${edge.to.iata}`)).toEqual(['AAA>CCC'])
  })

  it('does not extend one connection option into a falsely protected two-transfer path', async () => {
    const value = new FakeDb()
    value.tables.topology_versions.push(snapshot)
    value.tables.airports.push(airport('a', 'AAA'), airport('b', 'BBB'), airport('d', 'DDD'), airport('c', 'CCC', 'JP'))
    value.tables.route_edges.push(
      { id: 'a-b', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'b', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' },
      { id: 'b-d', topology_version_id: '1', origin_airport_id: 'b', destination_airport_id: 'd', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' },
      { id: 'd-c', topology_version_id: '1', origin_airport_id: 'd', destination_airport_id: 'c', valid_from: null, valid_to: null, operating_days_mask: 127, source: 'test' }
    )
    value.tables.connection_options.push({ id: 'only-first-transfer', topology_version_id: '1', origin_airport_id: 'a', destination_airport_id: 'c', hub_airport_id: 'b', connection_minutes: 120, mct_status: 'II', is_self_connection: false, valid_from: null, valid_to: null, operating_days_mask: 127 })
    const blocked = await new PostgresTopologyRepository(db(value)).findCandidates(input)
    expect(blocked.candidates).toHaveLength(0)
    const allowed = await new PostgresTopologyRepository(db(value)).findCandidates({ ...input, acceptsSelfTransfer: true })
    expect(allowed.candidates[0]).toMatchObject({ transferType: 'self', verification: { status: 'partially_verified' } })
  })
})
