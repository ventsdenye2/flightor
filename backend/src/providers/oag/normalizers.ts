type UnknownRecord = Record<string, unknown>

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
}

export interface NormalizedLocation {
  iata: string
  icao: string | null
  type: string
  name: string
  cityCode: string | null
  cityName: string
  countryCode: string
  countryName: string
  latitude: number | null
  longitude: number | null
  timezone: string | null
}

export interface NormalizedSchedule {
  providerKey: string
  origin: string
  destination: string
  marketingCarrierCode: string | null
  operatingCarrierCode: string | null
  flightNumber: string | null
  validFrom: string | null
  validTo: string | null
  operatingDaysMask: number
  departureLocal: string | null
  arrivalLocal: string | null
  arrivalDayOffset: number
  serviceType: string
}

export interface NormalizedConnection {
  providerKey: string
  origin: string
  destination: string
  hub: string
  connectionMinutes: number
  mctStatus: string | null
  isSelfConnection: boolean
  validFrom: string | null
  validTo: string | null
  operatingDaysMask: number
  legs: [NormalizedSchedule, NormalizedSchedule]
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function get(value: unknown, ...paths: string[]): unknown {
  for (const path of paths) {
    let cursor: unknown = value
    for (const part of path.split('.')) cursor = record(cursor)?.[part]
    if (cursor !== undefined && cursor !== null && cursor !== '') return cursor
  }
  return undefined
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function code(value: unknown, length?: number): string | null {
  const candidate = text(record(value)?.iata ?? record(value)?.IATA ?? record(value)?.code ?? value)?.toUpperCase()
  if (!candidate || (length !== undefined && candidate.length !== length)) return null
  return candidate
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function dateOnly(value: unknown): string | null {
  const candidate = text(value)?.slice(0, 10) ?? null
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null
}

function timeOnly(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate) return null
  const match = candidate.match(/(?:T|^)(\d{2}:\d{2})(?::\d{2})?/)
  return match?.[1] ?? null
}

export function operatingDaysMask(value: unknown): number {
  if (!Array.isArray(value) || value.length === 0) return 127
  let mask = 0
  for (const item of value) {
    const day = typeof item === 'number' ? item : DAY_INDEX[String(item).toLowerCase()]
    if (day !== undefined && Number.isInteger(day) && day >= 0 && day <= 6) mask |= 1 << day
  }
  return mask || 127
}

export function responseRecords(value: unknown): unknown[] {
  const root = record(value)
  if (!root) return []
  if (Array.isArray(root.data)) return root.data
  if (root.data !== undefined) return [root.data]
  return [root]
}

export function normalizeLocation(value: unknown): NormalizedLocation | null {
  const iata = code(get(value, 'code.iata', 'Code.Iata', 'iata', 'IataCode'), 3)
  const countryCode = code(get(value, 'place.country.code', 'country.code.iso', 'country.code', 'countryCode', 'CountryCode'), 2)
  if (!iata || !countryCode) return null
  return {
    iata,
    icao: code(get(value, 'code.icao', 'Code.Icao', 'icao', 'IcaoCode')),
    type: text(get(value, 'type', 'Type')) ?? 'AIRPORT',
    name: text(get(value, 'name', 'Name')) ?? iata,
    cityCode: code(get(value, 'place.city.code', 'city.code.iata', 'city.code', 'cityCode', 'CityCode'), 3),
    cityName: text(get(value, 'place.city.name', 'city.name', 'cityName', 'CityName')) ?? '',
    countryCode,
    countryName: text(get(value, 'place.country.name', 'country.name', 'countryName', 'CountryName')) ?? countryCode,
    latitude: finiteNumber(get(value, 'place.latitude.decimalDegrees', 'geo.latitude', 'latitude', 'Latitude')),
    longitude: finiteNumber(get(value, 'place.longitude.decimalDegrees', 'geo.longitude', 'longitude', 'Longitude')),
    timezone: text(get(value, 'timeZone.code.iata', 'timezone.code.iata', 'timeZone.name', 'timezone.name', 'timeZone', 'timezone'))
  }
}

interface ScheduleFallback {
  origin?: string | undefined
  destination?: string | undefined
  date?: string | undefined
  days?: unknown
  sourceKey?: string
}

export function normalizeSchedule(value: unknown, fallback: ScheduleFallback = {}): NormalizedSchedule | null {
  const origin = code(get(value, 'departure.airport.iata', 'Departure.Airport.IATA', 'DepartureAirport'), 3)
    ?? code(fallback.origin, 3)
  const destination = code(get(value, 'arrival.airport.iata', 'Arrival.Airport.IATA', 'ArrivalAirport'), 3)
    ?? code(fallback.destination, 3)
  if (!origin || !destination || origin === destination) return null

  const marketingCarrierCode = code(get(value, 'carrierCode.iata', 'carrier.iata', 'CarrierCode'))
  const operatingCarrierCode = code(get(value, 'codeshare.operatingCarrierCode.iata', 'operatingCarrierCode.iata', 'OperatingCarrierCode'))
    ?? marketingCarrierCode
  const flightNumber = text(get(value, 'flightNumber', 'FlightNumber'))
  const validFrom = dateOnly(get(value, 'effectivePeriod.startDate', 'effectivePeriod.local.startDate', 'EffectivePeriod.StartDate'))
    ?? dateOnly(fallback.date)
  const validTo = dateOnly(get(value, 'effectivePeriod.endDate', 'effectivePeriod.local.endDate', 'EffectivePeriod.EndDate'))
    ?? dateOnly(fallback.date)
  const mask = operatingDaysMask(get(value, 'legDaysOfOperation', 'daysOfOperation', 'DaysOfOperation') ?? fallback.days)
  const fingerprint = text(get(value, 'oagFingerprint', 'schedulesInstanceKey', 'id'))
  const keyParts = [origin, destination, marketingCarrierCode ?? '', flightNumber ?? '', validFrom ?? '', String(mask)]
  return {
    providerKey: fingerprint ?? fallback.sourceKey ?? keyParts.join('|'),
    origin,
    destination,
    marketingCarrierCode,
    operatingCarrierCode,
    flightNumber,
    validFrom,
    validTo,
    operatingDaysMask: mask,
    departureLocal: timeOnly(get(value, 'departure.passengerLocalTime', 'DepartureDateTime')),
    arrivalLocal: timeOnly(get(value, 'arrival.passengerLocalTime', 'ArrivalDateTime')),
    arrivalDayOffset: Math.trunc(finiteNumber(get(value, 'arrivalIntervalDays', 'legArrivalIntervalDays')) ?? 0),
    serviceType: text(get(value, 'serviceTypeCode.iata', 'serviceType', 'ServiceType')) ?? 'passenger'
  }
}

export function normalizeConnection(value: unknown, fallbackDate?: string): NormalizedConnection | null {
  const firstValue = get(value, 'leg1', 'Leg1')
  const secondValue = get(value, 'leg2', 'Leg2')
  if (!firstValue || !secondValue) return null

  const days = get(value, 'daysOfOperation', 'DaysOfOperation')
  const first = normalizeSchedule(firstValue, { date: fallbackDate, days })
  const second = normalizeSchedule(secondValue, { date: fallbackDate, days })
  if (!first || !second || first.destination !== second.origin) return null
  if (new Set([first.origin, first.destination, second.destination]).size !== 3) return null

  const connectionMinutes = Math.trunc(finiteNumber(get(firstValue, 'connectionTime', 'ConnectionTime')) ?? 0)
  if (connectionMinutes < 0) return null
  const validFrom = dateOnly(get(value, 'effectivePeriod.local.startDate', 'effectivePeriod.startDate', 'EffectivePeriod.StartDate'))
    ?? first.validFrom
  const validTo = dateOnly(get(value, 'effectivePeriod.local.endDate', 'effectivePeriod.endDate', 'EffectivePeriod.EndDate'))
    ?? first.validTo
  const providerKey = text(get(value, 'connectionId', 'ConnectionId', 'id'))
    ?? [first.providerKey, second.providerKey, String(connectionMinutes)].join('|')

  return {
    providerKey,
    origin: first.origin,
    destination: second.destination,
    hub: first.destination,
    connectionMinutes,
    mctStatus: text(get(firstValue, 'mctStatus', 'MctStatus')),
    isSelfConnection: Boolean(get(value, 'isSelfConnection', 'IsSelfConnection')),
    validFrom,
    validTo,
    operatingDaysMask: operatingDaysMask(days),
    legs: [first, second]
  }
}
