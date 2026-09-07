import type { Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { locationRefSchema, locationRefsOverlap, type LocationRef, type VerificationRecord } from '../aviation/types.js'
import {
  topologyQueryInputSchema,
  topologyQueryResultSchema,
  type TopologyCandidate,
  type TopologyQueryInput,
  type TopologyQueryResult,
  type TopologyRepository,
  type TopologySegment
} from './repository.js'

type Row = Record<string, unknown>
type AirportRow = Row & { id: string; iata_code: string | null; city_id: string | null; country_code: string; name_zh: string; name_en: string; latitude: number | null; longitude: number | null; timezone: string | null; active?: boolean }
type CityRow = Row & { id: string; iata_code: string | null; name_zh: string; name_en: string; latitude: number | null; longitude: number | null; timezone: string | null }
type SnapshotRow = Row & { id: string; public_id: string; coverage: unknown; coverage_complete: boolean; activated_at: Date | string | null }
type EdgeRow = Row & { id: string; origin_airport_id: string; destination_airport_id: string; valid_from: string | null; valid_to: string | null; operating_days_mask: number; source: string; last_confirmed_at?: Date | string | null }
type ScheduleRow = Row & { id: string; provider: string; provider_key: string; marketing_carrier_code: string | null; operating_carrier_code: string | null; flight_number: string | null; origin_airport_id: string; destination_airport_id: string; valid_from: string | null; valid_to: string | null; operating_days_mask: number; departure_local: string | null; arrival_local: string | null; arrival_day_offset: number; service_type: string }
type ConnectionRow = Row & { id: string; origin_airport_id: string; destination_airport_id: string; hub_airport_id: string; connection_minutes: number; mct_status: string | null; is_self_connection: boolean; valid_from: string | null; valid_to: string | null; operating_days_mask: number }

const MAX_ROWS = 20_000
const MAX_CANDIDATE_PATHS = 200
const MAX_EXPANDED_STATES = 10_000
const DAY = 86_400_000

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isoDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined
  const raw = value instanceof Date ? value.toISOString() : value
  return raw.slice(0, 10)
}

function isoDateTime(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function dateRangeOverlaps(from: string | null, to: string | null, window: { from: string; to: string }): boolean {
  return (!to || to >= window.from) && (!from || from <= window.to)
}

function dayBit(date: string): number {
  // The ingestion normalizer uses Sunday=0 through Saturday=6.
  return 1 << new Date(`${date}T00:00:00Z`).getUTCDay()
}

function hasOperatingDay(mask: number | null | undefined, window: { from: string; to: string }): boolean {
  const value = Number.isInteger(mask) ? Number(mask) : 127
  for (let current = new Date(`${window.from}T00:00:00Z`); current <= new Date(`${window.to}T00:00:00Z`); current = new Date(current.valueOf() + DAY)) {
    if ((value & dayBit(current.toISOString().slice(0, 10))) !== 0) return true
  }
  return false
}

function firstOperatingDate(
  row: { valid_from?: string | null; valid_to?: string | null; operating_days_mask?: number },
  window: { from: string; to: string }
): string | undefined {
  const value = Number.isInteger(row.operating_days_mask) ? Number(row.operating_days_mask) : 127
  for (let current = new Date(`${window.from}T00:00:00Z`); current <= new Date(`${window.to}T00:00:00Z`); current = new Date(current.valueOf() + DAY)) {
    const date = current.toISOString().slice(0, 10)
    if ((!row.valid_from || date >= row.valid_from) && (!row.valid_to || date <= row.valid_to) && (value & dayBit(date)) !== 0) return date
  }
  return undefined
}

function active(row: { valid_from?: string | null; valid_to?: string | null; operating_days_mask?: number }, window: { from: string; to: string }): boolean {
  return dateRangeOverlaps(row.valid_from ?? null, row.valid_to ?? null, window) && hasOperatingDay(row.operating_days_mask, window)
}

function localDurationMinutes(schedule: ScheduleRow | undefined): number | undefined {
  if (!schedule?.departure_local || !schedule.arrival_local || !Number.isInteger(schedule.arrival_day_offset)) return undefined
  const departure = schedule.departure_local.match(/^(\d{2}):(\d{2})/)?.slice(1).map(Number)
  const arrival = schedule.arrival_local.match(/^(\d{2}):(\d{2})/)?.slice(1).map(Number)
  if (!departure || !arrival || departure.length !== 2 || arrival.length !== 2) return undefined
  const minutes = (arrival[0]! * 60 + arrival[1]! + schedule.arrival_day_offset * 1440) - (departure[0]! * 60 + departure[1]!)
  return minutes >= 0 ? minutes : undefined
}

function verification(snapshot: SnapshotRow, source: string): VerificationRecord {
  const checkedAt = isoDateTime(snapshot.activated_at) ?? new Date(0).toISOString()
  return {
    status: snapshot.coverage_complete ? 'verified' : 'partially_verified',
    checkedAt,
    confidence: snapshot.coverage_complete ? 0.95 : 0.65,
    sources: [{ provider: source || 'postgres-topology', reference: snapshot.public_id }]
  }
}

function locationForAirport(airport: AirportRow, city?: CityRow): LocationRef | undefined {
  const iata = text(airport.iata_code)?.toUpperCase()
  if (!iata || !airport.id || !/^[A-Z0-9]{3}$/.test(iata)) return undefined
  const value: LocationRef = {
    id: String(airport.id), type: 'airport', name: text(airport.name_en) ?? text(airport.name_zh) ?? iata,
    countryCode: String(airport.country_code || 'ZZ').toUpperCase(), iata,
    cityCode: city?.iata_code ? String(city.iata_code).toUpperCase() : undefined,
    latitude: airport.latitude ?? city?.latitude ?? undefined,
    longitude: airport.longitude ?? city?.longitude ?? undefined,
    timezone: airport.timezone ?? city?.timezone ?? undefined
  }
  const parsed = locationRefSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function sameLocation(a: LocationRef, b: LocationRef): boolean {
  return locationRefsOverlap(a, b)
}

function rowName(row: Row): string { return String(row.id ?? '') }

interface Leg {
  id: string
  from: string
  to: string
  segment: TopologySegment
  valid_from: string | null
  valid_to: string | null
  operating_days_mask: number
  arrival_day_offset: number
}

export class PostgresTopologyRepository implements TopologyRepository {
  constructor(private readonly db: Kysely<Database>, private readonly maxRows = MAX_ROWS) {}

  async findCandidates(rawInput: TopologyQueryInput, options: { signal?: AbortSignal } = {}): Promise<TopologyQueryResult> {
    const input = topologyQueryInputSchema.parse(rawInput)
    options.signal?.throwIfAborted()

    const snapshot = await (this.db as any).selectFrom('topology_versions')
      .selectAll().where('status', '=', 'active').orderBy('activated_at', 'desc').executeTakeFirst() as SnapshotRow | undefined
    if (!snapshot) {
      return topologyQueryResultSchema.parse({ coverageStatus: 'unknown', candidates: [], warnings: ['No active topology snapshot is available'], truncated: false, exhausted: true })
    }
    const snapshotVerification = verification(snapshot, String(snapshot.source ?? 'postgres-topology'))
    const snapshotResult = {
      id: String(snapshot.public_id ?? snapshot.id),
      coverage: snapshot.coverage_complete ? 'complete' : (typeof snapshot.coverage === 'object' && String((snapshot.coverage as Row)?.kind) === 'unknown' ? 'unknown' : 'partial'),
      activatedAt: isoDateTime(snapshot.activated_at), verification: snapshotVerification
    }

    const rowLimit = this.maxRows + 1
    const [airportRows, cityRows, rawRouteRows, rawScheduleRows, rawConnectionRows] = await Promise.all([
      (this.db as any).selectFrom('airports').selectAll().where('active', '=', true).orderBy('id').limit(rowLimit).execute() as Promise<AirportRow[]>,
      (this.db as any).selectFrom('cities').selectAll().orderBy('id').limit(rowLimit).execute() as Promise<CityRow[]>,
      (this.db as any).selectFrom('route_edges').selectAll().where('topology_version_id', '=', snapshot.id).orderBy('id').limit(rowLimit).execute() as Promise<EdgeRow[]>,
      (this.db as any).selectFrom('schedule_services').selectAll().where('topology_version_id', '=', snapshot.id).orderBy('id').limit(rowLimit).execute() as Promise<ScheduleRow[]>,
      (this.db as any).selectFrom('connection_options').selectAll().where('topology_version_id', '=', snapshot.id).orderBy('id').limit(rowLimit).execute() as Promise<ConnectionRow[]>
    ])
    options.signal?.throwIfAborted()
    const sourceTruncated = [airportRows, cityRows, rawRouteRows, rawScheduleRows, rawConnectionRows].some(rows => rows.length > this.maxRows)
    const airports = airportRows.slice(0, this.maxRows)
    const cities = cityRows.slice(0, this.maxRows)
    const routeRows = rawRouteRows.slice(0, this.maxRows)
    const scheduleRows = rawScheduleRows.slice(0, this.maxRows)
    const connectionRows = rawConnectionRows.slice(0, this.maxRows)

    const cityById = new Map(cities.map(city => [String(city.id), city]))
    const airportById = new Map<string, LocationRef>()
    const airportIdsByLocation = new Map<string, string>()
    for (const row of airports) {
      const location = locationForAirport(row, cityById.get(String(row.city_id ?? '')))
      if (!location) continue
      airportById.set(String(row.id), location)
      airportIdsByLocation.set(location.iata ?? location.id, String(row.id))
    }
    const resolveInput = (location: LocationRef): string | undefined => {
      if (location.iata && airportIdsByLocation.has(location.iata)) return airportIdsByLocation.get(location.iata)
      if (airportById.has(location.id)) return location.id
      const cityCode = location.cityCode ?? (location.type === 'city' ? location.iata : undefined)
      if (cityCode) return [...airportById.entries()].find(([, value]) => value.cityCode === cityCode)?.[0]
      return undefined
    }
    const originId = resolveInput(input.origin)
    const destinationId = resolveInput(input.destination)
    const excluded = input.excludedLocations.filter(location => !sameLocation(location, input.origin) && !sameLocation(location, input.destination))
    const isExcluded = (location: LocationRef): boolean => excluded.some(item => sameLocation(item, location))
    const preferred = (location: LocationRef): boolean => input.preferredLocations.some(item => sameLocation(item, location))
    if (!originId || !destinationId || originId === destinationId) {
      return topologyQueryResultSchema.parse({
        snapshot: snapshotResult, coverageStatus: 'unknown', candidates: [],
        warnings: [
          'Origin or destination is not present in the active topology',
          ...(sourceTruncated ? [`Topology row read bound ${this.maxRows} reached`] : [])
        ],
        truncated: sourceTruncated, exhausted: !sourceTruncated
      })
    }

    const scheduleByPair = new Map<string, ScheduleRow[]>()
    for (const row of scheduleRows) {
      if (!active(row, input.window) || !airportById.has(row.origin_airport_id) || !airportById.has(row.destination_airport_id)) continue
      const key = `${row.origin_airport_id}>${row.destination_airport_id}`
      const values = scheduleByPair.get(key) ?? []
      values.push(row)
      scheduleByPair.set(key, values)
    }
    for (const values of scheduleByPair.values()) values.sort((a, b) => String(a.id || a.provider_key).localeCompare(String(b.id || b.provider_key)))
    const legs = new Map<string, Leg[]>()
    const pushLeg = (from: string, to: string, row: EdgeRow | ScheduleRow): void => {
      const fromLocation = airportById.get(from), toLocation = airportById.get(to)
      if (!fromLocation || !toLocation || from === to || !active(row, input.window)) return
      const schedules = 'provider_key' in row ? [row as ScheduleRow] : (scheduleByPair.get(`${from}>${to}`) ?? [])
      const source = schedules[0]
      const id = source ? `schedule:${source.id || source.provider_key}` : `route:${row.id}`
      const effectiveService = source ?? row
      const segment: TopologySegment = {
        id, from: fromLocation, to: toLocation,
        serviceDate: firstOperatingDate(effectiveService, input.window),
        durationMinutes: localDurationMinutes(source),
        marketingCarrier: source?.marketing_carrier_code ?? undefined, operatingCarrier: source?.operating_carrier_code ?? undefined,
        flightNumber: source?.flight_number ?? undefined, verification: snapshotVerification
      }
      const list = legs.get(`${from}>${to}`) ?? []
      if (!list.some(existing => existing.id === id)) list.push({
        id, from, to, segment,
        valid_from: effectiveService.valid_from,
        valid_to: effectiveService.valid_to,
        operating_days_mask: effectiveService.operating_days_mask,
        arrival_day_offset: source ? Math.max(0, source.arrival_day_offset) : 0
      })
      legs.set(`${from}>${to}`, list)
    }
    for (const row of routeRows) pushLeg(row.origin_airport_id, row.destination_airport_id, row)
    for (const row of scheduleRows) pushLeg(row.origin_airport_id, row.destination_airport_id, row)
    for (const list of legs.values()) list.sort((a, b) => a.id.localeCompare(b.id))

    const optionsByPair = new Map<string, ConnectionRow[]>()
    for (const row of connectionRows) {
      if (!active(row, input.window)) continue
      const key = `${row.origin_airport_id}>${row.destination_airport_id}`
      const values = optionsByPair.get(key) ?? []
      values.push(row)
      optionsByPair.set(key, values)
    }
    for (const values of optionsByPair.values()) values.sort((a, b) => String(a.id).localeCompare(String(b.id)))

    type Path = { legs: Leg[]; options: ConnectionRow[] }
    const paths: Path[] = []
    const maxPaths = Math.min(input.limit, MAX_CANDIDATE_PATHS)
    let stopped = false
    let expandedStates = 0
    const visit = (current: string, path: Leg[], used: Set<string>): void => {
      if (stopped) return
      if (path.length > input.maxTransfers + 1) return
      const outgoing = [...legs.entries()].filter(([key]) => key.startsWith(`${current}>`)).flatMap(([, values]) => values)
      outgoing.sort((a, b) => `${preferred(airportById.get(a.to)! ? airportById.get(a.to)! : input.destination) ? 0 : 1}:${a.id}`.localeCompare(`${preferred(airportById.get(b.to)! ? airportById.get(b.to)! : input.destination) ? 0 : 1}:${b.id}`))
      for (const leg of outgoing) {
        expandedStates += 1
        if (expandedStates > MAX_EXPANDED_STATES) { stopped = true; return }
        if (used.has(leg.to) || (leg.to !== destinationId && isExcluded(airportById.get(leg.to)!))) continue
        const nextPath = [...path, leg]
        if (leg.to === destinationId) {
          const pairOptions = nextPath.length === 2 ? optionsByPair.get(`${nextPath[0]!.from}>${nextPath[1]!.to}`) ?? [] : []
          const option = pairOptions.find(candidate => candidate.hub_airport_id === nextPath[0]!.to) ?? pairOptions[0]
          const isSelfTransfer = nextPath.length > 1 && (!option || option.is_self_connection)
          if (isSelfTransfer && !input.acceptsSelfTransfer) continue
          if (option && option.connection_minutes > 600 && !input.acceptsLongStopover) continue
          paths.push({ legs: nextPath, options: option ? [option] : [] })
          if (paths.length >= maxPaths) { stopped = true; return }
        } else if (nextPath.length <= input.maxTransfers) {
          const nextUsed = new Set(used); nextUsed.add(leg.to)
          visit(leg.to, nextPath, nextUsed)
        }
      }
    }
    visit(originId, [], new Set([originId]))
    paths.sort((a, b) => {
      const preferredA = a.legs.slice(0, -1).filter(leg => preferred(airportById.get(leg.to)!)).length
      const preferredB = b.legs.slice(0, -1).filter(leg => preferred(airportById.get(leg.to)!)).length
      return preferredB - preferredA || a.legs.length - b.legs.length || a.legs.map(leg => leg.id).join('|').localeCompare(b.legs.map(leg => leg.id).join('|'))
    })
    const candidates: TopologyCandidate[] = paths.flatMap(path => {
      let nextServiceDate = input.window.from
      const segments: TopologySegment[] = []
      for (const leg of path.legs) {
        const serviceDate = firstOperatingDate(leg, { from: nextServiceDate, to: input.window.to })
        if (serviceDate === undefined) return []
        segments.push({ ...leg.segment, serviceDate })
        nextServiceDate = new Date(Date.parse(`${serviceDate}T00:00:00Z`) + leg.arrival_day_offset * DAY).toISOString().slice(0, 10)
      }
      const transferMinutes = path.options.map(option => option.connection_minutes)
      const transferType = path.legs.length === 1
        ? 'direct'
        : path.options.length > 0 && path.options.every(option => !option.is_self_connection)
          ? 'protected'
          : 'self'
      const warnings = path.legs.length > 1 && path.options.length === 0 ? ['Connection protection is unknown'] : []
      const candidateVerification = path.legs.length > 1 && path.options.length === 0
        ? { ...snapshotVerification, status: 'partially_verified' as const, confidence: Math.min(snapshotVerification.confidence, 0.55) }
        : snapshotVerification
      return [{
        id: `topology:${snapshotResult.id}:${path.legs.map(leg => leg.id).join('|')}`,
        origin: airportById.get(path.legs[0]!.from)!, destination: airportById.get(path.legs[path.legs.length - 1]!.to)!,
        segments, transferMinutes, transferType,
        airportChange: undefined, verification: candidateVerification, warnings
      }]
    })
    const warnings: string[] = []
    if (stopped) warnings.push(`Topology search bound reached (${maxPaths} paths or ${MAX_EXPANDED_STATES} expanded states)`)
    if (sourceTruncated) warnings.push(`Topology row read bound ${this.maxRows} reached`)
    const uniqueWarnings = [...new Set(warnings)]
    return topologyQueryResultSchema.parse({
      snapshot: snapshotResult,
      coverageStatus: candidates.length ? 'reachable' : snapshot.coverage_complete && !sourceTruncated && !stopped ? 'unreachable' : 'unknown',
      candidates, warnings: uniqueWarnings,
      truncated: stopped || sourceTruncated,
      exhausted: !stopped && !sourceTruncated
    })
  }
}

export { PostgresTopologyRepository as ProductionTopologyRepository }
