import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { AppError } from '../lib/errors.js'

const querySchema = z.object({
  origin: z.string().length(3).transform(value => value.toUpperCase()),
  destination: z.string().length(3).transform(value => value.toUpperCase()),
  date: z.iso.date(),
  maxTransfers: z.number().int().min(0).max(2).default(2)
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
}

interface PathRow {
  airport_ids: string[]
  flights: number
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

    const airports = await sql<AirportRow>`
      select id, iata_code
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
      : await context.db.selectFrom('airports').select(['id', 'iata_code']).where('id', 'in', allIds).execute()
    const codeById = new Map(pathAirports.map(row => [String(row.id), row.iata_code]))
    const paths = result.rows.map(row => ({
      airports: row.airport_ids.map(id => codeById.get(String(id))).filter((code): code is string => Boolean(code)),
      transfers: row.flights - 1
    }))
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
