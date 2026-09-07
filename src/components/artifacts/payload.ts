export type UnknownRecord = Record<string, unknown>

export function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function records(value: unknown, max: number): UnknownRecord[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, max).map(record).filter((item): item is UnknownRecord => item !== undefined)
}

export function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, max).map(text).filter((item): item is string => item !== undefined)
}

export function firstText(...values: unknown[]): string | undefined {
  return values.map(text).find((value): value is string => value !== undefined)
}

export interface DisplaySegment {
  origin?: string
  destination?: string
  departure?: string
  arrival?: string
  flightNumber?: string
}

export interface DisplayOffer {
  id?: string
  amount?: number
  currency?: string
  durationMinutes?: number
  transferType?: string
  airlines: string[]
  segments: DisplaySegment[]
}

export function displayOffer(value: unknown): DisplayOffer | undefined {
  const item = record(value)
  if (!item) return undefined
  const segments = records(item.segments, 12).map(segment => ({
    ...(firstText(segment.origin) ? { origin: firstText(segment.origin) } : {}),
    ...(firstText(segment.destination) ? { destination: firstText(segment.destination) } : {}),
    ...(firstText(segment.departsAt, segment.departureAt) ? { departure: firstText(segment.departsAt, segment.departureAt) } : {}),
    ...(firstText(segment.arrivesAt, segment.arrivalAt) ? { arrival: firstText(segment.arrivesAt, segment.arrivalAt) } : {}),
    ...(firstText(segment.flightNumber, segment.flightNo) ? { flightNumber: firstText(segment.flightNumber, segment.flightNo) } : {})
  }))
  return {
    ...(firstText(item.id) ? { id: firstText(item.id) } : {}),
    ...(numberValue(item.totalAmount) !== undefined ? { amount: numberValue(item.totalAmount) } : {}),
    ...(numberValue(item.totalDurationMinutes) !== undefined ? { durationMinutes: numberValue(item.totalDurationMinutes) } : {}),
    ...(firstText(item.currency) ? { currency: firstText(item.currency) } : {}),
    ...(firstText(item.transferType) ? { transferType: firstText(item.transferType) } : {}),
    airlines: strings(item.airlines, 12).length > 0
      ? strings(item.airlines, 12)
      : records(item.airlines, 12).map(item => firstText(item.name, item.code)).filter((value): value is string => value !== undefined),
    segments
  }
}

export function displayOffers(payload: UnknownRecord): DisplayOffer[] {
  const direct = records(payload.offers, 100)
  const flexible = records(payload.results, 31).flatMap(result => records(result.offers, 100))
  return [...direct, ...flexible].map(displayOffer).filter((item): item is DisplayOffer => item !== undefined).slice(0, 100)
}

export function displayLocation(value: unknown): string | undefined {
  const item = record(value)
  if (!item) return undefined
  return firstText(item.iata, item.name, item.cityCode)
}

export function displayRoute(value: unknown): string | undefined {
  const item = record(value)
  if (!item) return undefined
  const from = displayLocation(item.from)
  const to = displayLocation(item.to)
  if (from && to) return `${from} → ${to}`
  return undefined
}
