import { sql, type Kysely } from 'kysely'
import { v7 as uuidv7 } from 'uuid'
import type { AppContext } from '../app/context.js'
import type { Database, JsonValue } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import {
  normalizeConnection,
  normalizeLocation,
  normalizeSchedule,
  responseRecords,
  type NormalizedConnection,
  type NormalizedLocation,
  type NormalizedSchedule
} from '../providers/oag/normalizers.js'

export interface RouteSyncInput {
  origin: string
  destination: string
  dateFrom: string
  dateTo?: string
  includeConnections?: boolean
  limit?: number
}

interface TopologyVersionRow {
  id: string
  coverage: JsonValue
}

async function ensureAirportStub(db: Kysely<Database>, iata: string): Promise<string> {
  const result = await sql<{ id: string }>`
    insert into airports (iata_code, country_code, name_en, name_zh, active)
    values (${iata}, 'ZZ', ${iata}, '', true)
    on conflict (iata_code) where iata_code is not null
    do update set active = true, updated_at = now()
    returning id
  `.execute(db)
  const id = result.rows[0]?.id
  if (!id) throw new AppError('AIRPORT_UPSERT_FAILED', `Unable to persist airport ${iata}`, 500)
  return String(id)
}

export async function upsertLocation(db: Kysely<Database>, location: NormalizedLocation): Promise<string> {
  await sql`
    insert into countries (code, name_zh, name_en, active)
    values (${location.countryCode}, ${location.countryName}, ${location.countryName}, true)
    on conflict (code) do update set
      name_en = excluded.name_en,
      active = true,
      updated_at = now()
  `.execute(db)

  let cityId: string | null = null
  if (location.cityCode) {
    const city = await sql<{ id: string }>`
      insert into cities (country_code, iata_code, name_zh, name_en, latitude, longitude, timezone)
      values (
        ${location.countryCode}, ${location.cityCode}, '', ${location.cityName || location.cityCode},
        ${location.latitude}, ${location.longitude}, ${location.timezone}
      )
      on conflict (iata_code) where iata_code is not null
      do update set
        country_code = excluded.country_code,
        name_en = excluded.name_en,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        timezone = excluded.timezone,
        updated_at = now()
      returning id
    `.execute(db)
    cityId = city.rows[0]?.id ? String(city.rows[0].id) : null
  }

  const airport = await sql<{ id: string }>`
    insert into airports (
      iata_code, icao_code, city_id, country_code, name_zh, name_en,
      latitude, longitude, timezone, active, source_updated_at
    ) values (
      ${location.iata}, ${location.icao}, ${cityId}::bigint, ${location.countryCode}, '', ${location.name},
      ${location.latitude}, ${location.longitude}, ${location.timezone}, true, now()
    )
    on conflict (iata_code) where iata_code is not null
    do update set
      icao_code = excluded.icao_code,
      city_id = excluded.city_id,
      country_code = excluded.country_code,
      name_en = excluded.name_en,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      timezone = excluded.timezone,
      active = true,
      source_updated_at = now(),
      updated_at = now()
    returning id
  `.execute(db)
  const id = airport.rows[0]?.id
  if (!id) throw new AppError('AIRPORT_UPSERT_FAILED', `Unable to persist airport ${location.iata}`, 500)
  return String(id)
}

function routeCoverage(previous: JsonValue | undefined, input: RouteSyncInput): JsonValue {
  const existing = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? previous
    : {}
  const oldRoutes = Array.isArray(existing.routes)
    ? existing.routes.filter((item): item is string => typeof item === 'string')
    : []
  const route = `${input.origin}-${input.destination}:${input.dateFrom}/${input.dateTo ?? input.dateFrom}`
  return {
    ...existing,
    kind: 'partial',
    routes: [...new Set([...oldRoutes, route])],
    updatedAt: new Date().toISOString()
  }
}

async function copyPreviousVersion(db: Kysely<Database>, previousId: string, nextId: string): Promise<void> {
  await sql`
    insert into schedule_services (
      topology_version_id, provider, provider_key, marketing_carrier_code, operating_carrier_code,
      flight_number, origin_airport_id, destination_airport_id, valid_from, valid_to,
      operating_days_mask, departure_local, arrival_local, arrival_day_offset, service_type
    )
    select ${nextId}::bigint, provider, provider_key, marketing_carrier_code, operating_carrier_code,
      flight_number, origin_airport_id, destination_airport_id, valid_from, valid_to,
      operating_days_mask, departure_local, arrival_local, arrival_day_offset, service_type
    from schedule_services
    where topology_version_id = ${previousId}::bigint
  `.execute(db)
  await sql`
    insert into connection_options (
      topology_version_id, provider, provider_key, origin_airport_id, destination_airport_id,
      hub_airport_id, connection_minutes, mct_status, is_self_connection, valid_from, valid_to,
      operating_days_mask
    )
    select ${nextId}::bigint, provider, provider_key, origin_airport_id, destination_airport_id,
      hub_airport_id, connection_minutes, mct_status, is_self_connection, valid_from, valid_to,
      operating_days_mask
    from connection_options
    where topology_version_id = ${previousId}::bigint
  `.execute(db)
}

async function upsertSchedule(
  db: Kysely<Database>,
  topologyVersionId: string,
  airportIds: Map<string, string>,
  schedule: NormalizedSchedule
): Promise<void> {
  await db.insertInto('schedule_services').values({
    topology_version_id: topologyVersionId,
    provider: 'oag',
    provider_key: schedule.providerKey,
    marketing_carrier_code: schedule.marketingCarrierCode,
    operating_carrier_code: schedule.operatingCarrierCode,
    flight_number: schedule.flightNumber,
    origin_airport_id: airportIds.get(schedule.origin)!,
    destination_airport_id: airportIds.get(schedule.destination)!,
    valid_from: schedule.validFrom,
    valid_to: schedule.validTo,
    operating_days_mask: schedule.operatingDaysMask,
    departure_local: schedule.departureLocal,
    arrival_local: schedule.arrivalLocal,
    arrival_day_offset: schedule.arrivalDayOffset,
    service_type: schedule.serviceType
  }).onConflict(oc => oc.columns(['provider', 'provider_key', 'topology_version_id']).doUpdateSet({
    marketing_carrier_code: schedule.marketingCarrierCode,
    operating_carrier_code: schedule.operatingCarrierCode,
    flight_number: schedule.flightNumber,
    origin_airport_id: airportIds.get(schedule.origin)!,
    destination_airport_id: airportIds.get(schedule.destination)!,
    valid_from: schedule.validFrom,
    valid_to: schedule.validTo,
    operating_days_mask: schedule.operatingDaysMask,
    departure_local: schedule.departureLocal,
    arrival_local: schedule.arrivalLocal,
    arrival_day_offset: schedule.arrivalDayOffset,
    service_type: schedule.serviceType,
    updated_at: new Date()
  })).execute()
}

async function upsertConnection(
  db: Kysely<Database>,
  topologyVersionId: string,
  airportIds: Map<string, string>,
  connection: NormalizedConnection
): Promise<void> {
  await db.insertInto('connection_options').values({
    topology_version_id: topologyVersionId,
    provider: 'oag',
    provider_key: connection.providerKey,
    origin_airport_id: airportIds.get(connection.origin)!,
    destination_airport_id: airportIds.get(connection.destination)!,
    hub_airport_id: airportIds.get(connection.hub)!,
    connection_minutes: connection.connectionMinutes,
    mct_status: connection.mctStatus,
    is_self_connection: connection.isSelfConnection,
    valid_from: connection.validFrom,
    valid_to: connection.validTo,
    operating_days_mask: connection.operatingDaysMask
  }).onConflict(oc => oc.columns(['provider', 'provider_key', 'topology_version_id']).doUpdateSet({
    origin_airport_id: airportIds.get(connection.origin)!,
    destination_airport_id: airportIds.get(connection.destination)!,
    hub_airport_id: airportIds.get(connection.hub)!,
    connection_minutes: connection.connectionMinutes,
    mct_status: connection.mctStatus,
    is_self_connection: connection.isSelfConnection,
    valid_from: connection.validFrom,
    valid_to: connection.validTo,
    operating_days_mask: connection.operatingDaysMask
  })).execute()
}

async function buildVersion(
  context: AppContext,
  input: RouteSyncInput,
  schedules: NormalizedSchedule[],
  connections: NormalizedConnection[]
): Promise<{ topologyVersion: string; rowsWritten: number }> {
  return context.db.transaction().execute(async trx => {
    const previous = await trx.selectFrom('topology_versions')
      .select(['id', 'coverage'])
      .where('status', '=', 'active')
      .executeTakeFirst() as TopologyVersionRow | undefined
    const publicId = uuidv7()
    const next = await trx.insertInto('topology_versions').values({
      public_id: publicId,
      source: 'oag',
      status: 'building',
      coverage: routeCoverage(previous?.coverage, input),
      coverage_complete: false,
      activated_at: null
    }).returning('id').executeTakeFirstOrThrow()

    if (previous) await copyPreviousVersion(trx, previous.id, next.id)

    const allSchedules = [...schedules, ...connections.flatMap(item => item.legs)]
    const codes = new Set<string>()
    for (const schedule of allSchedules) {
      codes.add(schedule.origin)
      codes.add(schedule.destination)
    }
    for (const connection of connections) codes.add(connection.hub)
    const airportIds = new Map<string, string>()
    for (const iata of codes) airportIds.set(iata, await ensureAirportStub(trx, iata))

    for (const schedule of allSchedules) await upsertSchedule(trx, next.id, airportIds, schedule)
    for (const connection of connections) await upsertConnection(trx, next.id, airportIds, connection)

    await sql`
      insert into route_edges (
        topology_version_id, origin_airport_id, destination_airport_id, valid_from, valid_to,
        operating_days_mask, weekly_frequency, source, last_confirmed_at
      )
      select topology_version_id, origin_airport_id, destination_airport_id, valid_from, valid_to,
        bit_or(operating_days_mask), least(32767, count(*))::smallint, 'oag', now()
      from schedule_services
      where topology_version_id = ${next.id}::bigint
      group by topology_version_id, origin_airport_id, destination_airport_id, valid_from, valid_to
    `.execute(trx)

    if (previous) {
      await trx.updateTable('topology_versions').set({ status: 'retired' }).where('id', '=', previous.id).execute()
    }
    await trx.updateTable('topology_versions').set({
      status: 'active',
      activated_at: new Date()
    }).where('id', '=', next.id).execute()
    return { topologyVersion: publicId, rowsWritten: allSchedules.length + connections.length }
  })
}

export async function syncOagLocation(context: AppContext, airportCode: string): Promise<NormalizedLocation> {
  const response = await context.providers.oag.locations({ airportCode, limit: 1 })
  const location = responseRecords(response).map(normalizeLocation).find(item => item?.iata === airportCode.toUpperCase())
  if (!location) throw new AppError('OAG_LOCATION_NOT_FOUND', `OAG returned no usable location for ${airportCode}`, 404)
  await context.db.transaction().execute(trx => upsertLocation(trx, location))
  return location
}

export async function syncOagRoute(context: AppContext, rawInput: RouteSyncInput) {
  const input: RouteSyncInput = {
    origin: rawInput.origin.toUpperCase(),
    destination: rawInput.destination.toUpperCase(),
    dateFrom: rawInput.dateFrom,
    includeConnections: rawInput.includeConnections ?? true,
    limit: Math.min(1000, Math.max(1, rawInput.limit ?? 100))
  }
  if (rawInput.dateTo) input.dateTo = rawInput.dateTo
  const run = await context.db.insertInto('sync_runs').values({
    public_id: uuidv7(),
    provider: 'oag',
    dataset: 'route',
    status: 'running',
    cursor_json: input as unknown as JsonValue,
    error_summary: null,
    started_at: new Date(),
    finished_at: null
  }).returning(['id', 'public_id']).executeTakeFirstOrThrow()

  try {
    const [scheduleResult, connectionResult] = await Promise.allSettled([
      context.providers.oag.schedules(input),
      input.includeConnections ? context.providers.oag.connections(input) : Promise.resolve({ data: [] })
    ])
    // Production Schedules subscriptions can remain pending while Flight Info Trial is active.
    // Use Flight Info as an MVP-safe direct-flight fallback instead of losing the whole route sync.
    const flightInfoResult = scheduleResult.status === 'rejected'
      ? await Promise.allSettled([
          context.providers.oag.flightInfo({
            origin: input.origin,
            destination: input.destination,
            date: input.dateFrom,
            ...(input.limit !== undefined ? { limit: input.limit } : {})
          })
        ]).then(results => results[0]!)
      : undefined
    if (
      scheduleResult.status === 'rejected'
      && flightInfoResult?.status === 'rejected'
      && connectionResult.status === 'rejected'
    ) {
      throw scheduleResult.reason
    }
    const scheduleResponse = scheduleResult.status === 'fulfilled'
      ? scheduleResult.value
      : flightInfoResult?.status === 'fulfilled'
        ? flightInfoResult.value
        : {}
    const schedules = responseRecords(scheduleResponse)
      .map(item => normalizeSchedule(item, { origin: input.origin, destination: input.destination, date: input.dateFrom }))
      .filter((item): item is NormalizedSchedule => item !== null)
    const connections = responseRecords(connectionResult.status === 'fulfilled' ? connectionResult.value : {})
      .map(item => normalizeConnection(item, input.dateFrom))
      .filter((item): item is NormalizedConnection => item !== null)
    const providerWarnings = [
      ...(scheduleResult.status === 'rejected' ? ['oag_schedules_unavailable'] : []),
      ...(scheduleResult.status === 'rejected' && flightInfoResult?.status === 'fulfilled' ? ['oag_flight_info_fallback'] : []),
      ...(flightInfoResult?.status === 'rejected' ? ['oag_flight_info_unavailable'] : []),
      ...(connectionResult.status === 'rejected' ? ['oag_connections_unavailable'] : [])
    ]
    const result = await buildVersion(context, input, schedules, connections)
    await sql`
      update sync_runs set status = 'completed', rows_seen = ${schedules.length + connections.length},
        rows_written = ${result.rowsWritten}, finished_at = now()
      where id = ${run.id}::bigint
    `.execute(context.db)
    return {
      syncRunId: run.public_id,
      topologyVersion: result.topologyVersion,
      schedules: schedules.length,
      connections: connections.length,
      rowsWritten: result.rowsWritten,
      providerWarnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown OAG sync error'
    await context.db.updateTable('sync_runs').set({
      status: 'failed',
      error_summary: message,
      finished_at: new Date()
    }).where('id', '=', run.id).execute()
    throw error
  }
}
