import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { AppError } from '../lib/errors.js'

const querySchema = z.object({
  origin: z.string().length(3).transform(value => value.toUpperCase()),
  destination: z.string().length(3).transform(value => value.toUpperCase()),
  date: z.iso.date(),
  maxTransfers: z.number().int().min(0).max(2).default(2),
  preferredCountries: z.array(z.string().length(2)).max(50).default([]),
  excludedCountries: z.array(z.string().length(2)).max(50).default([]),
  minConnectionMinutes: z.number().int().min(60).max(1440).default(60),
  preferredConnectionMinutes: z.number().int().min(60).max(10080).default(720)
}).transform(input => ({
  ...input,
  preferredCountries: [...new Set(input.preferredCountries.map(code => code.toUpperCase()))],
  excludedCountries: [...new Set(input.excludedCountries.map(code => code.toUpperCase()))]
})).superRefine((input, ctx) => {
  const overlap = input.preferredCountries.filter(code => input.excludedCountries.includes(code))
  if (overlap.length > 0) ctx.addIssue({ code: 'custom', message: 'A country cannot be preferred and excluded' })
  if (input.preferredConnectionMinutes < input.minConnectionMinutes) {
    ctx.addIssue({ code: 'custom', message: 'Preferred connection time cannot be below the safety minimum' })
  }
})

interface VersionRow {
  id: string
  public_id: string
  source: string
  coverage_complete: boolean
  activated_at: Date | null
}

interface AirportRow {
  id: string
  iata_code: string
  country_code: string
}

interface PathRow {
  airport_ids: string[]
  flights: number
}

interface ConnectionRow {
  hub_airport_id: string
  connection_minutes: number
  is_self_connection: boolean
  mct_status: string | null
}

export async function registerTopologyRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/reachability/query', async request => {
    const input = querySchema.parse(request.body)
    if (input.origin === input.destination) {
      throw new AppError('INVALID_ROUTE', 'Origin and destination must be different', 400)
    }
    const version = await sql<VersionRow>`
      select id, public_id, source, coverage_complete, activated_at
      from topology_versions
      where status = 'active'
      limit 1
    `.execute(context.db).then(result => result.rows[0])
    if (!version) {
      return {
        status: 'unknown',
        reason: 'no_active_topology',
        origin: input.origin,
        destination: input.destination,
        date: input.date,
        paths: []
      }
    }

    const preferredCountries = new Set(input.preferredCountries)
    const excludedCountries = new Set(input.excludedCountries)
    if (request.headers.authorization) {
      const identity = await authenticateRequest(request, context)
      const preferences = await context.db.selectFrom('transit_country_preferences')
        .select(['country_code', 'preference'])
        .where('user_id', '=', identity.userId)
        .execute()
      for (const preference of preferences) {
        if (preference.preference === 'preferred') preferredCountries.add(preference.country_code)
        if (preference.preference === 'excluded') excludedCountries.add(preference.country_code)
      }
    }
    for (const code of excludedCountries) preferredCountries.delete(code)

    const airports = await sql<AirportRow>`
      select id, iata_code, country_code
      from airports
      where active = true and iata_code in (${input.origin}, ${input.destination})
    `.execute(context.db)
    const byCode = new Map(airports.rows.map(row => [row.iata_code, row.id]))
    const originId = byCode.get(input.origin)
    const destinationId = byCode.get(input.destination)
    if (!originId || !destinationId) {
      return {
        status: 'unknown',
        reason: 'airport_not_in_dataset',
        origin: input.origin,
        destination: input.destination,
        date: input.date,
        paths: [],
        topologyVersion: version.public_id
      }
    }

    const maxFlights = input.maxTransfers + 1
    const result = await sql<PathRow>`
      with recursive paths(current_airport_id, airport_ids, flights) as (
        select ${originId}::bigint, array[${originId}::bigint], 0
        union all
        select edge.destination_airport_id, paths.airport_ids || edge.destination_airport_id, paths.flights + 1
        from paths
        join route_edges edge
          on edge.origin_airport_id = paths.current_airport_id
         and edge.topology_version_id = ${version.id}::bigint
        where paths.flights < ${maxFlights}
          and not edge.destination_airport_id = any(paths.airport_ids)
          and (edge.valid_from is null or edge.valid_from <= ${input.date}::date)
          and (edge.valid_to is null or edge.valid_to >= ${input.date}::date)
          and (edge.operating_days_mask & (1 << extract(dow from ${input.date}::date)::integer)) <> 0
          and (edge.destination_airport_id = ${destinationId}::bigint or paths.flights + 1 < ${maxFlights})
      )
      select airport_ids, flights
      from paths
      where current_airport_id = ${destinationId}::bigint and flights between 1 and ${maxFlights}
      order by flights
      limit 50
    `.execute(context.db)

    const allIds = [...new Set(result.rows.flatMap(row => row.airport_ids.map(String)))]
    const pathAirports = allIds.length === 0
      ? []
      : await context.db.selectFrom('airports').select(['id', 'iata_code', 'country_code']).where('id', 'in', allIds).execute()
    const airportById = new Map(pathAirports.map(row => [String(row.id), row]))
    const connectionRows = await sql<ConnectionRow>`
      select hub_airport_id, connection_minutes, is_self_connection, mct_status
      from connection_options
      where topology_version_id = ${version.id}::bigint
        and origin_airport_id = ${originId}::bigint
        and destination_airport_id = ${destinationId}::bigint
        and (valid_from is null or valid_from <= ${input.date}::date)
        and (valid_to is null or valid_to >= ${input.date}::date)
        and (operating_days_mask & (1 << extract(dow from ${input.date}::date)::integer)) <> 0
    `.execute(context.db)
    const connectionsByHub = new Map<string, ConnectionRow[]>()
    for (const row of connectionRows.rows) {
      const key = String(row.hub_airport_id)
      connectionsByHub.set(key, [...(connectionsByHub.get(key) ?? []), row])
    }

    const paths = result.rows.flatMap(row => {
      const airportRows = row.airport_ids.map(id => airportById.get(String(id))).filter((item): item is NonNullable<typeof item> => Boolean(item))
      if (airportRows.length !== row.airport_ids.length) return []
      const hubs = airportRows.slice(1, -1)
      if (hubs.some(hub => excludedCountries.has(hub.country_code))) return []

      const reasons: string[] = []
      const warnings: string[] = []
      const preferredHubs = hubs.filter(hub => preferredCountries.has(hub.country_code))
      if (preferredHubs.length > 0) reasons.push('preferred_transit_country')
      let score = 100 - (row.flights - 1) * 12 + preferredHubs.length * 18
      let connection: null | {
        minutes: number
        isSelfConnection: boolean
        mctStatus: string | null
        stopoverPlayable: boolean
      } = null

      if (hubs.length === 1) {
        const candidates = connectionsByHub.get(String(hubs[0]!.id)) ?? []
        const safe = candidates
          .filter(item => item.connection_minutes >= Math.max(input.minConnectionMinutes, item.is_self_connection ? 240 : 60))
          .sort((a, b) => a.connection_minutes - b.connection_minutes)
        if (candidates.length > 0 && safe.length === 0) return []
        const selected = safe[0]
        if (selected) {
          const excess = Math.max(0, selected.connection_minutes - input.preferredConnectionMinutes)
          score -= Math.min(35, excess / 60 * 2)
          if (excess > 0) warnings.push('long_connection')
          if (selected.is_self_connection) {
            score -= 15
            warnings.push('self_connection')
          }
          connection = {
            minutes: selected.connection_minutes,
            isSelfConnection: selected.is_self_connection,
            mctStatus: selected.mct_status,
            stopoverPlayable: selected.connection_minutes >= 360
          }
          if (connection.stopoverPlayable) reasons.push('stopover_playable')
        } else {
          warnings.push('connection_time_not_verified')
        }
      } else if (hubs.length > 1) {
        warnings.push('connection_time_not_verified')
      }

      return [{
        airports: airportRows.map(airport => airport.iata_code),
        transitCountries: hubs.map(hub => hub.country_code),
        transfers: row.flights - 1,
        score: Math.round(score * 100) / 100,
        connection,
        reasons,
        warnings
      }]
    }).sort((a, b) => b.score - a.score || a.transfers - b.transfers)
    const status = paths.length > 0 ? 'reachable' : version.coverage_complete ? 'unreachable' : 'unknown'
    return {
      status,
      reason: paths.length > 0 ? 'path_found' : version.coverage_complete ? 'no_path_in_complete_coverage' : 'no_path_in_partial_coverage',
      origin: input.origin,
      destination: input.destination,
      date: input.date,
      paths,
      truncated: result.rows.length === 50,
      topologyVersion: version.public_id,
      source: version.source,
      freshness: version.activated_at
    }
  })
}
