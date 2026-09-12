import { z } from 'zod'
import { airportTimeViewSchema, projectAirportTime, type AirportTimeView } from '../aviation/airport-time.js'
import { projectUnconfirmedFareFields } from '../fares/presentation.js'
import type { ArtifactRecord } from './repository.js'

export const MAX_AIRPORT_TIME_VIEWS = 8192
const MAX_POINTER_LENGTH = 512
const MAX_PAYLOAD_DEPTH = 32

export const artifactPresentationSchema = z.object({
  schemaVersion: z.literal(1),
  airportTimes: z.record(z.string().max(MAX_POINTER_LENGTH), airportTimeViewSchema),
  unconfirmedFields: z.array(z.string().min(1).max(MAX_POINTER_LENGTH).startsWith('/')).max(MAX_AIRPORT_TIME_VIEWS).optional(),
  truncated: z.boolean()
}).strict().refine(value => Object.keys(value.airportTimes).length <= MAX_AIRPORT_TIME_VIEWS)
export type ArtifactPresentation = z.infer<typeof artifactPresentationSchema>
export type PresentedArtifact = ArtifactRecord & { presentation?: ArtifactPresentation }

type ObjectValue = Record<string, unknown>
function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined
}

/** JSON Pointers are relative to payload, never to the API response envelope. */
function pointer(parent: string, key: string): string {
  return `${parent}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
}

/** Project supported display fields, using their own domain evidence.
 * This pure read requires no provider requests and preserves the stored payload. */
export function projectArtifactPresentation(record: Pick<ArtifactRecord, 'type' | 'schemaVersion' | 'payload'>): ArtifactPresentation | undefined {
  const supported = record.type === 'route_set' ? record.schemaVersion === 1
    : record.type === 'flight_search' && (record.schemaVersion === 1 || record.schemaVersion === 2)
  if (!supported) return undefined
  const airportTimes: Record<string, AirportTimeView> = {}
  let count = 0
  let truncated = false
  const add = (path: string, value: unknown, airport: unknown, providerLocal = false) => {
    if (count >= MAX_AIRPORT_TIME_VIEWS || path.length > MAX_POINTER_LENGTH) { truncated = true; return }
    const location = object(airport)
    airportTimes[path] = projectAirportTime(value, {
      airportIata: location?.iata ?? airport, timezone: location?.timezone, providerLocal
    })
    count++
  }
  const walk = (value: unknown, path: string, depth: number) => {
    if (value === null || typeof value !== 'object') return
    if (depth > MAX_PAYLOAD_DEPTH || path.length > MAX_POINTER_LENGTH || count >= MAX_AIRPORT_TIME_VIEWS) {
      truncated = true
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, pointer(path, String(index)), depth + 1))
      return
    }
    const item = object(value)!
    if (record.type === 'route_set' && object(item.from) && object(item.to)) {
      if ('departureAt' in item) add(pointer(path, 'departureAt'), item.departureAt, item.from)
      if ('arrivalAt' in item) add(pointer(path, 'arrivalAt'), item.arrivalAt, item.to)
    } else if (record.type === 'flight_search' && typeof item.origin === 'string' && typeof item.destination === 'string') {
      if ('departsAt' in item) add(pointer(path, 'departsAt'), item.departsAt, item.origin, true)
      if ('arrivesAt' in item) add(pointer(path, 'arrivesAt'), item.arrivesAt, item.destination, true)
    }
    for (const [key, child] of Object.entries(item)) walk(child, pointer(path, key), depth + 1)
  }
  walk(record.payload, '', 0)
  const unconfirmedFields = record.type === 'flight_search'
    ? projectUnconfirmedFareFields(record.payload, record.schemaVersion) : []
  return { schemaVersion: 1, airportTimes, ...(unconfirmedFields.length ? { unconfirmedFields } : {}), truncated }
}

export function presentArtifact(record: ArtifactRecord): PresentedArtifact {
  const presentation = projectArtifactPresentation(record)
  return presentation ? { ...record, presentation } : record
}

/** Agent-readable copies use the same time and unconfirmed-fact projections as
 * the UI. UTC remains named `instant`, not an unlabelled clock. */
export function artifactReadingContent(record: ArtifactRecord): string {
  const presentation = projectArtifactPresentation(record)
  const unconfirmedFields = new Set(presentation?.unconfirmedFields)
  const copy = (value: unknown, path: string, depth: number): unknown => {
    if (unconfirmedFields.has(path)) return { status: 'unverified', reason: 'legacy_unattributed' }
    const time = presentation?.airportTimes[path]
    if (time) return time
    if (depth > MAX_PAYLOAD_DEPTH || value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((child, index) => copy(child, pointer(path, String(index)), depth + 1))
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child, pointer(path, key), depth + 1)]))
  }
  return JSON.stringify({
    payload: presentation ? copy(record.payload, '', 0) : record.payload,
    verification: record.verification, createdAt: record.createdAt,
    ...(presentation ? { presentation: { schemaVersion: 1, truncated: presentation.truncated } } : {})
  })
}
