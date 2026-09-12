import type { FlightLayover } from '../types/flight'

interface ConnectionSegment {
  origin?: string
  destination?: string
  departureAt?: string
  arrivalAt?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function instantMillis(value: string | undefined): number {
  // Unzoned provider-local clocks cannot be interpreted in the user's device timezone.
  return value && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN
}

/** Airport identities come from the adjacent segments; provider metadata adds timing and flags. */
export function flightConnections(segments: readonly ConnectionSegment[], supplied?: unknown): FlightLayover[] {
  const metadata = new Map<number, Record<string, unknown>>()
  for (const value of Array.isArray(supplied) ? supplied.slice(0, 11) : []) {
    const item = record(value)
    if (item && Number.isInteger(item.afterSegmentIndex) && !metadata.has(Number(item.afterSegmentIndex))) {
      metadata.set(Number(item.afterSegmentIndex), item)
    }
  }
  return segments.slice(0, -1).flatMap((segment, index) => {
    const next = segments[index + 1]
    if (!segment.destination || !next?.origin) return []
    const candidate = metadata.get(index)
    const item = candidate?.airport === segment.destination
      && (candidate.departureAirport === undefined || candidate.departureAirport === next.origin) ? candidate : undefined
    const arrival = instantMillis(segment.arrivalAt)
    const departure = instantMillis(next.departureAt)
    const elapsed = Number.isFinite(arrival) && Number.isFinite(departure) && departure >= arrival
      ? Math.round((departure - arrival) / 60_000) : undefined
    const durationMinutes = Number.isInteger(item?.durationMinutes) && Number(item?.durationMinutes) >= 0
      ? Number(item?.durationMinutes) : elapsed
    const airportChange = segment.destination !== next.origin || item?.airportChange === true
    return [{
      afterSegmentIndex: index,
      airport: segment.destination,
      ...(airportChange ? { departureAirport: next.origin, airportChange: true } : {}),
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      ...(typeof item?.overnight === 'boolean' ? { overnight: item.overnight } : {})
    }]
  })
}

export function flightPath(segments: readonly ConnectionSegment[]): string {
  const airports: string[] = []
  for (const segment of segments) {
    for (const airport of [segment.origin, segment.destination]) {
      if (airport && airports[airports.length - 1] !== airport) airports.push(airport)
    }
  }
  return airports.join(' → ')
}

export function connectionLabel(connection: FlightLayover, locale: 'zh' | 'en' = 'zh'): string {
  const airports = connection.airportChange && connection.departureAirport && connection.departureAirport !== connection.airport
    ? `${connection.airport} → ${connection.departureAirport}` : connection.airport
  const duration = connection.durationMinutes === undefined
    ? (locale === 'zh' ? '衔接时间待确认' : 'Connection time unconfirmed')
    : locale === 'zh' ? `衔接 ${connection.durationMinutes} 分钟` : `${connection.durationMinutes} min connection`
  return [airports, duration, ...(connection.airportChange ? [locale === 'zh' ? '需换机场' : 'Airport change'] : []),
    ...(connection.overnight ? [locale === 'zh' ? '过夜中转' : 'Overnight connection'] : [])].join(' · ')
}

export function flightTypeLabel(transferType: string | undefined, segmentCount: number): string {
  const label = transferType === 'airline' ? '航司联程' : transferType === 'self' ? '自行中转'
    : transferType === 'direct' && segmentCount === 1 ? '直飞' : '航班行程'
  return segmentCount > 1 ? `${label} · ${segmentCount - 1} 次中转` : label
}

export function baggageLabel(baggageRecheck: boolean | undefined, locale: 'zh' | 'en' = 'zh'): string {
  if (baggageRecheck === undefined) return locale === 'zh' ? '行李直挂/重托运待确认' : 'Baggage transfer/recheck unconfirmed'
  if (baggageRecheck) return locale === 'zh' ? '供应商标记需提取行李并重新托运' : 'Provider indicates baggage recheck is required'
  return locale === 'zh' ? '供应商标记无需重新托运行李，请以出票规则为准' : 'Provider indicates no baggage recheck; confirm ticket rules'
}
