import { AppError } from '../../lib/errors.js'
import type { AirportRoute, FlightStatus, LocationRef, LocationResolution, ScheduledFlight } from '../types.js'
import type { AviationProvider, AirportLookupInput, AirportRoutesInput, FlightStatusInput, ProviderCallOptions, ResolveLocationInput, ScheduleSearchInput } from './provider.js'

type JsonObject = Record<string, unknown>
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface AeroDataBoxConfig {
  AERODATABOX_API_KEY?: string
  AERODATABOX_BASE_URL?: string
  AERODATABOX_GATEWAY?: 'rapidapi' | 'direct'
  fetch?: FetchLike
  timeoutMs?: number
}
const RAPID_BASE_URL = 'https://aerodatabox.p.rapidapi.com'
const DIRECT_BASE_URL = 'https://api.aerodatabox.com'
const DEFAULT_TIMEOUT_MS = 8_000

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = stringValue(value)
    if (result) return result
  }
  return undefined
}

function upperCode(value: unknown, length?: number): string | undefined {
  const result = stringValue(value)?.toUpperCase()
  return result && (!length || result.length === length) ? result : undefined
}

function nested(value: JsonObject | undefined, key: string): JsonObject | undefined {
  return object(value?.[key])
}

function airportCountry(value: JsonObject): string | undefined {
  const country = nested(value, 'country')
  const code = firstString(value.countryCode, country?.code, country?.countryCode)?.toUpperCase()
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined
}

function airport(value: unknown, fallbackId?: string): LocationRef | undefined {
  const item = object(value)
  const name = firstString(item?.fullName, item?.name, item?.shortName)
  const iata = upperCode(item?.iata, 3)
  const icao = upperCode(item?.icao, 4)
  const countryCode = item ? airportCountry(item) : undefined
  const id = iata ?? icao ?? fallbackId
  if (!item || !name || !id || !countryCode) return undefined
  const location = nested(item, 'location')
  const latitude = numberValue(location?.lat ?? location?.latitude)
  const longitude = numberValue(location?.lon ?? location?.lng ?? location?.longitude)
  const timezone = firstString(item.timeZone, item.timezone)
  return {
    id,
    type: 'airport',
    name,
    countryCode,
    ...(iata ? { iata } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(timezone ? { timezone } : {})
  }
}

function responseItems(value: unknown, keys: string[] = ['items']): unknown[] {
  if (Array.isArray(value)) return value
  const item = object(value)
  for (const key of keys) {
    if (Array.isArray(item?.[key])) return item[key] as unknown[]
  }
  return []
}

function dateTime(value: unknown): string | undefined {
  const item = object(value)
  return firstString(item?.local, item?.utc, value)?.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
}

function movement(value: unknown): JsonObject | undefined {
  return object(value)
}

function flightNumber(value: JsonObject): string | undefined {
  return firstString(value.number, value.flightNumber)
}

function flightOrigin(value: JsonObject): string | undefined {
  const departure = movement(value.departure)
  const airportValue = airport(nested(departure, 'airport'))
  return airportValue?.iata ?? upperCode(nested(departure, 'airport')?.iata, 3)
}

function flightDestination(value: JsonObject): string | undefined {
  const arrival = movement(value.arrival)
  const airportValue = airport(nested(arrival, 'airport'))
  return airportValue?.iata ?? upperCode(nested(arrival, 'airport')?.iata, 3)
}

function flightStatusValue(value: unknown): FlightStatus['status'] {
  const status = firstString(value)?.toLowerCase().replace(/[ _-]/g, '')
  if (status === 'scheduled' || status === 'expected') return 'scheduled'
  if (status === 'active' || status === 'departed' || status === 'airborne' || status === 'ontime' || status === 'enroute') return 'active'
  if (status === 'landed' || status === 'arrived' || status === 'completed') return 'landed'
  if (status === 'cancelled' || status === 'canceled' || status === 'diverted' || status === 'likelycancelled') return 'cancelled'
  return 'unknown'
}

function normalizeSchedule(value: unknown, departureAirport?: string): ScheduledFlight | undefined {
  const item = object(value)
  if (!item) return undefined
  const number = flightNumber(item)
  const departure = movement(item.departure) ?? movement(item.movement)
  const arrival = movement(item.arrival)
  const depAirport = airport(nested(departure, 'airport'))
  const arrAirport = airport(nested(arrival, 'airport'))
  // FIDS omits the queried airport from the departure movement.
  const originIata = depAirport?.iata ?? departureAirport
  const destinationIata = arrAirport?.iata
  if (!number || !originIata || !destinationIata) return undefined
  const airline = nested(item, 'airline')
  const departureLocal = dateTime(departure?.scheduledTime)
  const arrivalLocal = dateTime(arrival?.scheduledTime)
  const marketingCarrier = firstString(airline?.iata, airline?.icao)
  const operatingCarrier = firstString(item.operatingCarrier, item.operatingAirline)
  const id = firstString(item.id) ?? `${number}:${departureLocal ?? ''}:${arrivalLocal ?? ''}`
  return {
    id,
    originIata: originIata.toUpperCase(),
    destinationIata: destinationIata.toUpperCase(),
    ...(departureLocal ? { departureLocal } : {}),
    ...(arrivalLocal ? { arrivalLocal } : {}),
    ...(marketingCarrier ? { marketingCarrier } : {}),
    ...(operatingCarrier ? { operatingCarrier } : {}),
    flightNumber: number
  }
}

export class AeroDataBoxProvider implements AviationProvider {
  readonly name = 'aerodatabox'
  private readonly fetcher: FetchLike
  private readonly baseUrl: string
  private readonly gateway: 'rapidapi' | 'direct'

  constructor(private readonly config: AeroDataBoxConfig) {
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = (config.AERODATABOX_BASE_URL ?? (config.AERODATABOX_GATEWAY === 'direct' ? DIRECT_BASE_URL : RAPID_BASE_URL)).replace(/\/+$/, '')
    this.gateway = config.AERODATABOX_GATEWAY ?? (this.baseUrl.includes('rapidapi') ? 'rapidapi' : 'direct')
  }

  private requireConfigured(): void {
    if (!this.config.AERODATABOX_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'AeroDataBox is not configured', 503)
  }

  private async request(path: string, options?: ProviderCallOptions): Promise<unknown> {
    this.requireConfigured()
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.gateway === 'rapidapi') {
      headers['X-RapidAPI-Key'] = this.config.AERODATABOX_API_KEY as string
      headers['X-RapidAPI-Host'] = new URL(this.baseUrl).host
    } else {
      headers['X-Api-Key'] = this.config.AERODATABOX_API_KEY as string
    }
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      let response: Response
      try {
        response = await this.fetcher(url, { method: 'GET', headers, signal: controller.signal })
      } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
          if (!timedOut && options?.signal?.aborted) throw new AppError('PROVIDER_CANCELLED', 'AeroDataBox request was cancelled', 499)
          throw new AppError('PROVIDER_TIMEOUT', 'AeroDataBox request timed out', 504)
        }
        throw new AppError('PROVIDER_NETWORK_ERROR', 'AeroDataBox request failed', 503)
      }
      if (response.status === 204) return undefined
      if (!response.ok) throw this.httpError(response.status)
      try {
        return await response.json() as unknown
      } catch {
        throw new AppError('PROVIDER_MALFORMED_RESPONSE', 'AeroDataBox returned malformed JSON', 502)
      }
    } finally {
      clearTimeout(timeout)
      options?.signal?.removeEventListener('abort', onAbort)
    }
  }

  private httpError(status: number): AppError {
    if (status === 400) return new AppError('PROVIDER_BAD_REQUEST', 'AeroDataBox rejected the request', 400)
    if (status === 401) return new AppError('PROVIDER_UNAUTHORIZED', 'AeroDataBox authorization failed', 502)
    if (status === 429) return new AppError('PROVIDER_RATE_LIMITED', 'AeroDataBox rate limit exceeded', 429)
    if (status === 451) return new AppError('PROVIDER_RESTRICTED', 'AeroDataBox request is restricted', 451)
    if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'AeroDataBox is temporarily unavailable', 503)
    return new AppError('PROVIDER_HTTP_ERROR', 'AeroDataBox request failed', 502, { status })
  }

  async resolveLocation(input: ResolveLocationInput, options?: ProviderCallOptions): Promise<LocationResolution> {
    const query = input.query.trim()
    const checkedAt = new Date().toISOString()
    const cityOnly = input.types?.length === 1 && input.types[0] === 'city'
    if (query.length < 3 || cityOnly) return { matches: [], verification: { status: 'partially_verified', checkedAt, confidence: 0, sources: [{ provider: this.name, reference: query || 'empty' }] } }
    const limit = Math.max(1, Math.min(input.limit ?? 20, 20))
    const params = new URLSearchParams({ q: query, limit: String(limit), withSearchByCode: 'true' })
    const payload = await this.request(`/airports/search/term?${params.toString()}`, options)
    const matches = responseItems(payload).map(value => airport(value)).filter((value): value is LocationRef => Boolean(value)).slice(0, limit)
    return { matches, verification: { status: matches.length ? 'verified' : 'unverified', checkedAt, confidence: matches.length ? 0.9 : 0, sources: [{ provider: this.name, reference: query }] } }
  }

  async getAirport(input: AirportLookupInput, options?: ProviderCallOptions): Promise<LocationRef | undefined> {
    const code = input.iata.trim().toUpperCase()
    if (!/^[A-Z]{3,4}$/.test(code)) return undefined
    const payload = await this.request(`/airports/${code.length === 4 ? 'icao' : 'iata'}/${encodeURIComponent(code)}`, options)
    return airport(payload, code)
  }

  async getAirportRoutes(input: AirportRoutesInput, options?: ProviderCallOptions): Promise<AirportRoute[]> {
    const originCode = input.origin.trim().toUpperCase()
    if (!/^[A-Z]{3,4}$/.test(originCode)) return []
    const [origin, payload] = await Promise.all([
      this.getAirport({ iata: originCode }, options),
      this.request(`/airports/${originCode.length === 4 ? 'icao' : 'iata'}/${encodeURIComponent(originCode)}/stats/routes/daily`, options)
    ])
    if (!origin) return []
    const routes = object(payload)?.routes
    if (!Array.isArray(routes)) return []
    return routes.map(value => {
      const item = object(value)
      const destination = airport(item?.destination)
      return destination ? { origin, destination } satisfies AirportRoute : undefined
    }).filter((value): value is AirportRoute => Boolean(value))
  }

  async getSchedules(input: ScheduleSearchInput, options?: ProviderCallOptions): Promise<ScheduledFlight[]> {
    const origin = input.origin.trim().toUpperCase()
    const destination = input.destination.trim().toUpperCase()
    if (!/^[A-Z]{3,4}$/.test(origin) || !/^[A-Z]{3,4}$/.test(destination)) return []
    const end = input.dateTo ?? input.dateFrom
    const startMs = Date.parse(`${input.dateFrom}T00:00:00Z`)
    const endMs = Date.parse(`${end}T00:00:00Z`)
    if (![input.dateFrom, end].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) || !Number.isFinite(startMs) || !Number.isFinite(endMs)
      || new Date(startMs).toISOString().slice(0, 10) !== input.dateFrom || new Date(endMs).toISOString().slice(0, 10) !== end
      || endMs < startMs || endMs - startMs >= 7 * 86400000) throw new AppError('INVALID_SCHEDULE_RANGE', 'Schedule range must contain one to seven valid dates', 400)
    const originIata = origin.length === 3 ? origin : (await this.getAirport({ iata: origin }, options))?.iata
    const destinationIata = destination.length === 3 ? destination : (await this.getAirport({ iata: destination }, options))?.iata
    if (!originIata || !destinationIata) return []
    const flights = new Map<string, ScheduledFlight>()
    for (let day = startMs; day <= endMs; day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10)
      for (const [from, to] of [['00:00', '12:00'], ['12:00', '23:59']]) {
        const payload = await this.request(`/flights/airports/${origin.length === 4 ? 'icao' : 'iata'}/${encodeURIComponent(origin)}/${encodeURIComponent(`${date}T${from}`)}/${encodeURIComponent(`${date}T${to}`)}?direction=Departure&withLeg=true&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false`, options)
        for (const value of responseItems(payload, ['departures'])) {
          const flight = normalizeSchedule(value, originIata)
          if (flight?.originIata === originIata && flight.destinationIata === destinationIata) flights.set(flight.id, flight)
        }
      }
    }
    return [...flights.values()]
  }

  async getFlightStatus(input: FlightStatusInput, options?: ProviderCallOptions): Promise<FlightStatus | undefined> {
    const rawNumber = firstString(input.flightNumber)
    const carrier = upperCode(input.carrierCode)
    const number = rawNumber && carrier && /^\d/.test(rawNumber) ? `${carrier}${rawNumber}` : rawNumber
    if (!number) return undefined
    const date = input.date ? `/${encodeURIComponent(input.date)}` : ''
    const payload = await this.request(`/flights/number/${encodeURIComponent(number)}${date}${date ? '?dateLocalRole=Both' : ''}`, options)
    const item = responseItems(payload).map(value => object(value)).find((value): value is JsonObject => Boolean(value))
    if (!item) return undefined
    const departure = movement(item.departure)
    const arrival = movement(item.arrival)
    const originIata = flightOrigin(item)
    const destinationIata = flightDestination(item)
    const scheduledDeparture = dateTime(departure?.scheduledTime)
    const scheduledArrival = dateTime(arrival?.scheduledTime)
    return {
      id: firstString(item.id) ?? `${number}:${date || 'nearest'}`,
      status: flightStatusValue(item.status),
      ...(originIata ? { originIata } : {}),
      ...(destinationIata ? { destinationIata } : {}),
      ...(scheduledDeparture ? { scheduledDeparture } : {}),
      ...(scheduledArrival ? { scheduledArrival } : {}),
      updatedAt: firstString(item.lastUpdatedUtc, item.updatedAt) ?? new Date().toISOString()
    }
  }
}
