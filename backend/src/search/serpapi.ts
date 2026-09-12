import { createHash } from 'node:crypto'

type UnknownRecord = Record<string, unknown>

export interface FlightSearchInput {
  origin: string
  destination: string
  originCandidates: string[]
  destinationCandidates: string[]
  departDate: string
  departDateEnd?: string | undefined
  stayRange?: [number, number] | undefined
  currency: string
}

export interface FlightSegment {
  flightNo: string
  airline: string
  origin: string
  destination: string
  departTime: string
  arriveTime: string
  duration: number
  aircraft?: string | undefined
}

export interface FlightOption {
  id: string
  segments: FlightSegment[]
  totalPrice: number
  totalDuration?: number
  airline: string
  transferType: 'direct' | 'airline'
  departDate: string
  deepLink: string
  layovers?: FlightLayover[]
  hub?: { iata: string; city: string; layoverMinutes?: number; baggageRecheck?: boolean } | undefined
}

export interface FlightLayover {
  afterSegmentIndex: number
  airport: string
  departureAirport?: string
  durationMinutes?: number
  overnight?: boolean
  airportChange?: boolean
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapSegment(value: unknown): FlightSegment | null {
  const item = record(value)
  const departure = record(item?.departure_airport)
  const arrival = record(item?.arrival_airport)
  const origin = stringValue(departure?.id).toUpperCase()
  const destination = stringValue(arrival?.id).toUpperCase()
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination
    || !stringValue(departure?.time).trim() || !stringValue(arrival?.time).trim()) return null
  const aircraft = stringValue(item?.airplane)
  return {
    flightNo: stringValue(item?.flight_number),
    airline: stringValue(item?.airline),
    origin,
    destination,
    departTime: stringValue(departure?.time),
    arriveTime: stringValue(arrival?.time),
    duration: numberValue(item?.duration),
    ...(aircraft ? { aircraft } : {})
  }
}

export function mapSerpItinerary(value: unknown, input: FlightSearchInput, date: string): FlightOption | null {
  const item = record(value)
  const flights = Array.isArray(item?.flights) ? item.flights : []
  const mapped = flights.map(mapSegment)
  // A total fare belongs to the entire itinerary, never a subset of valid legs.
  if (mapped.length === 0 || mapped.length > 12 || mapped.some(segment => segment === null)) return null
  const segments = mapped as FlightSegment[]
  const price = numberValue(item?.price)
  if (segments.length === 0 || price <= 0) return null
  const rawLayovers = Array.isArray(item?.layovers) ? item.layovers : []
  const layovers: FlightLayover[] = []
  for (let index = 1; index < segments.length; index += 1) {
    const airport = segments[index - 1]!.destination
    const departureAirport = segments[index]!.origin
    const reported = record(rawLayovers[index - 1])
    const reportedAirport = stringValue(reported?.id).toUpperCase()
    const matches = reportedAirport === airport || reportedAirport === departureAirport
    const airportChange = airport !== departureAirport
    // Preserve provider-indicated airport changes, but reject disconnected data.
    if (airportChange && !matches) return null
    const duration = matches && typeof reported?.duration === 'number' && Number.isFinite(reported.duration) && reported.duration >= 0
      ? Math.trunc(reported.duration) : undefined
    layovers.push({
      afterSegmentIndex: index - 1, airport,
      ...(airportChange ? { departureAirport, airportChange: true } : {}),
      ...(duration !== undefined ? { durationMinutes: duration } : {}),
      ...(matches && typeof reported?.overnight === 'boolean' ? { overnight: reported.overnight } : {})
    })
  }
  const reportedDuration = typeof item?.total_duration === 'number' && Number.isFinite(item.total_duration) && item.total_duration >= 0
    ? Math.trunc(item.total_duration) : undefined
  const completeDurations = flights.every(flight => typeof record(flight)?.duration === 'number'
    && Number.isFinite(record(flight)!.duration) && Number(record(flight)!.duration) >= 0)
    && layovers.every(layover => layover.durationMinutes !== undefined)
  const totalDuration = reportedDuration ?? (completeDurations
    ? segments.reduce((sum, segment) => sum + segment.duration, 0) + layovers.reduce((sum, layover) => sum + layover.durationMinutes!, 0)
    : undefined)
  const airlines = [...new Set(segments.map(segment => segment.airline).filter(Boolean))]
  const option: FlightOption = {
    id: `gf-${date}-${segments.map(segment => segment.flightNo || `${segment.origin}${segment.destination}`).join('-')}-${Math.round(price)}`,
    segments,
    totalPrice: Math.round(price),
    ...(totalDuration !== undefined ? { totalDuration } : {}),
    airline: airlines.join(' + '),
    transferType: segments.length === 1 ? 'direct' : 'airline',
    departDate: date,
    deepLink: `https://www.google.com/travel/flights?q=flights+from+${input.origin}+to+${input.destination}+on+${date}`
  }
  if (segments.length > 1) {
    option.layovers = layovers
    const layover = layovers[0]!
    option.hub = {
      iata: layover.airport,
      city: stringValue(record(rawLayovers[0])?.name),
      ...(layover.durationMinutes !== undefined ? { layoverMinutes: layover.durationMinutes } : {})
    }
  }
  return option
}

export function itinerariesFromSerpResponse(value: unknown, input: FlightSearchInput, date: string): FlightOption[] {
  const root = record(value)
  const raw = [
    ...(Array.isArray(root?.best_flights) ? root.best_flights : []),
    ...(Array.isArray(root?.other_flights) ? root.other_flights : [])
  ]
  return raw.map(item => mapSerpItinerary(item, input, date)).filter((item): item is FlightOption => item !== null)
}

export function sampleDates(dateFrom: string, dateTo = dateFrom, limit = 4): string[] {
  const start = Date.parse(`${dateFrom}T00:00:00Z`)
  const end = Date.parse(`${dateTo}T00:00:00Z`)
  const days = Math.max(0, Math.round((end - start) / 86_400_000))
  const count = Math.min(days + 1, limit)
  const dates = Array.from({ length: count }, (_, index) => {
    const offset = Math.round(days * index / Math.max(1, count - 1))
    return new Date(start + offset * 86_400_000).toISOString().slice(0, 10)
  })
  return [...new Set(dates)]
}

export function returnDateFor(date: string, stayRange?: [number, number]): string | undefined {
  if (!stayRange) return undefined
  const stayDays = Math.round((stayRange[0] + stayRange[1]) / 2)
  return new Date(Date.parse(`${date}T00:00:00Z`) + stayDays * 86_400_000).toISOString().slice(0, 10)
}

export function flightSearchCacheKey(input: FlightSearchInput): string {
  return `flight-search:v1:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`
}

export function buildFlightSearchResponse(
  options: FlightOption[],
  metadata: { dates: string[]; fetched: number; failedDates: string[]; cacheHit: boolean }
) {
  const seen = new Set<string>()
  const unique = options.filter(option => {
    const key = `${option.segments.map(segment => `${segment.flightNo}:${segment.departTime}`).join('|')}:${option.totalPrice}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((left, right) => left.totalPrice - right.totalPrice)
  return {
    direct: unique.filter(option => option.transferType === 'direct').slice(0, 20),
    selfTransfer: [],
    airlineTransfer: unique.filter(option => option.transferType === 'airline').slice(0, 20),
    metadata: {
      searchId: `gf-${Date.now()}`,
      cacheTime: new Date().toISOString(),
      priceDisclaimer: 'Google Flights 实时报价（人民币），以实际购买为准',
      provider: 'serpapi',
      scanned: metadata.dates.length,
      fetched: metadata.fetched,
      failedDates: metadata.failedDates,
      cacheHit: metadata.cacheHit
    }
  }
}
