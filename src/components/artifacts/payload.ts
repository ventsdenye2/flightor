import { airportTimeDisplay, isUnconfirmedField, type AirportTimePresentation } from '../../services/airportTime'
import { flightConnections } from '../../services/flightConnections'
import type { FlightLayover } from '../../types/flight'

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

const guideTimeLabels: Record<string, string> = { morning: '上午', afternoon: '下午', evening: '晚上', flexible: '灵活安排' }

export function displayGuideTime(value: unknown): string | undefined {
  return typeof value === 'string' ? guideTimeLabels[value] : undefined
}

export interface DisplaySegment {
  origin?: string
  destination?: string
  departure?: string
  arrival?: string
  departureAt?: string
  arrivalAt?: string
  flightNumber?: string
  airline?: string
  durationMinutes?: number
}

export interface DisplayOffer {
  id?: string
  amount?: number
  currency?: string
  durationMinutes?: number
  transferType?: string
  airlines: string[]
  segments: DisplaySegment[]
  layovers: FlightLayover[]
  baggageRecheck?: boolean
}

export function displayOffer(value: unknown, presentation?: AirportTimePresentation, pointer = ''): DisplayOffer | undefined {
  const item = record(value)
  if (!item) return undefined
  const segments = (Array.isArray(item.segments) ? item.segments.slice(0, 12) : []).flatMap((raw, index) => {
    const segment = record(raw)
    if (!segment) return []
    return [{
      ...(firstText(segment.origin) ? { origin: firstText(segment.origin) } : {}),
      ...(firstText(segment.destination) ? { destination: firstText(segment.destination) } : {}),
      departure: airportTimeDisplay(firstText(segment.departsAt, segment.departureAt), presentation, `${pointer}/segments/${index}/${segment.departsAt !== undefined ? 'departsAt' : 'departureAt'}`),
      arrival: airportTimeDisplay(firstText(segment.arrivesAt, segment.arrivalAt), presentation, `${pointer}/segments/${index}/${segment.arrivesAt !== undefined ? 'arrivesAt' : 'arrivalAt'}`),
      departureAt: firstText(segment.departsAt, segment.departureAt),
      arrivalAt: firstText(segment.arrivesAt, segment.arrivalAt),
      airline: firstText(segment.airline, segment.marketingCarrier),
      durationMinutes: numberValue(segment.durationMinutes),
      ...(firstText(segment.flightNumber, segment.flightNo) ? { flightNumber: firstText(segment.flightNumber, segment.flightNo) } : {})
    }]
  })
  return {
    ...(firstText(item.id) ? { id: firstText(item.id) } : {}),
    ...(numberValue(item.totalAmount) !== undefined ? { amount: numberValue(item.totalAmount) } : {}),
    ...(numberValue(item.totalDurationMinutes) !== undefined ? { durationMinutes: numberValue(item.totalDurationMinutes) } : {}),
    ...(firstText(item.currency) ? { currency: firstText(item.currency) } : {}),
    ...(firstText(item.transferType) ? { transferType: firstText(item.transferType) } : {}),
    airlines: strings(item.airlines, 12).length > 0
      ? strings(item.airlines, 12)
      : records(item.airlines, 12).map(item => firstText(item.name, item.code)).filter((value): value is string => value !== undefined),
    segments,
    layovers: flightConnections(segments, item.layovers),
    ...(typeof item.baggageRecheck === 'boolean' && !isUnconfirmedField(presentation, `${pointer}/baggageRecheck`) ? { baggageRecheck: item.baggageRecheck } : {})
  }
}

function offerEntries(payload: UnknownRecord): Array<{ value: unknown; pointer: string }> {
  const direct = (Array.isArray(payload.offers) ? payload.offers.slice(0, 100) : [])
    .map((value, index) => ({ value, pointer: `/offers/${index}` }))
  const flexible = (Array.isArray(payload.results) ? payload.results.slice(0, 31) : []).flatMap((raw, resultIndex) => {
    const result = record(raw)
    return (Array.isArray(result?.offers) ? result.offers.slice(0, 100) : [])
      .map((value, index) => ({ value, pointer: `/results/${resultIndex}/offers/${index}` }))
  })
  return [...direct, ...flexible]
}

export function displayOffers(payload: UnknownRecord, presentation?: AirportTimePresentation): DisplayOffer[] {
  return offerEntries(payload).map(({ value, pointer }) => displayOffer(value, presentation, pointer))
    .filter((item): item is DisplayOffer => item !== undefined).slice(0, 100)
}

/** Detail links can select any returned date window offer, beyond the preview limit. */
export function displayOfferById(payload: UnknownRecord, offerId: string, presentation?: AirportTimePresentation): DisplayOffer | undefined {
  const entry = offerEntries(payload).find(({ value }) => record(value)?.id === offerId)
  return entry ? displayOffer(entry.value, presentation, entry.pointer) : undefined
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
