import type { LocationRef } from '../aviation/types.js'
import type { ConnectionEdge } from './types.js'

export const LONG_STOPOVER_MINUTES = 10 * 60
export const DEFAULT_SELF_TRANSFER_MINUTES = 8 * 60
export const DEFAULT_AIRPORT_CHANGE_MINUTES = 12 * 60

/** Product buffers from ADR 0004; they are not airline/immigration guarantees. */
export function connectionMinimumMinutes(selfTransfer: boolean, airportChange: boolean, ordinaryMinimum = 45,
  policy: { minSelfTransferMinutes?: number | undefined; minAirportChangeMinutes?: number | undefined } = {}): number {
  return Math.max(ordinaryMinimum,
    selfTransfer ? policy.minSelfTransferMinutes ?? DEFAULT_SELF_TRANSFER_MINUTES : 0,
    airportChange ? policy.minAirportChangeMinutes ?? DEFAULT_AIRPORT_CHANGE_MINUTES : 0)
}

/** Use one duration definition for hard constraints and displayed path totals. */
export function pathDurationMinutes(edges: readonly ConnectionEdge[]): number | undefined {
  if (edges.length === 0) return undefined
  const departure = edges[0]!.departureAt, arrival = edges.at(-1)!.arrivalAt
  if (departure && arrival) return Math.round((Date.parse(arrival) - Date.parse(departure)) / 60_000)
  let total = 0
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index]!
    if (edge.durationMinutes === undefined) return undefined
    total += edge.durationMinutes
    if (index > 0) {
      const previous = edges[index - 1]!
      const connection = previous.arrivalAt && edge.departureAt
        ? Math.round((Date.parse(edge.departureAt) - Date.parse(previous.arrivalAt)) / 60_000)
        : edge.transferMinutes
      if (connection === undefined) return undefined
      total += connection
    }
  }
  return total
}

/** A quoted edge is a commercial unit; its physical flights remain distinct. */
export function pathTransferCount(edges: readonly ConnectionEdge[]): number {
  return Math.max(0, edges.reduce((count, edge) => count + (edge.segments?.length ?? 1), 0) - 1)
}

export function edgeLocations(edge: ConnectionEdge): LocationRef[] {
  return [edge.from, ...(edge.segments ?? []).flatMap(segment => [segment.from, segment.to]), edge.to]
}

export function internalTransfers(edge: ConnectionEdge): Array<{ arrivalAirport: LocationRef; departureAirport: LocationRef; durationMinutes?: number }> {
  return (edge.segments ?? []).slice(1).map((next, index) => {
    const previous = edge.segments![index]!
    const reported = edge.layovers?.find(layover => layover.afterSegmentIndex === index)?.durationMinutes
    const durationMinutes = previous.arrivalAt && next.departureAt
      ? Math.round((Date.parse(next.departureAt) - Date.parse(previous.arrivalAt)) / 60_000)
      : reported
    return { arrivalAirport: previous.to, departureAirport: next.from, ...(durationMinutes === undefined ? {} : { durationMinutes }) }
  })
}

export function edgeHasAirportChange(edge: ConnectionEdge): boolean {
  return edge.airportChange === true || internalTransfers(edge).some(transfer => transfer.arrivalAirport.iata !== transfer.departureAirport.iata)
}

/** Distinct immutable offers do not establish a through-ticket between edges. */
export function joinsSeparateOffers(previous: ConnectionEdge, next: ConnectionEdge): boolean {
  return previous.fareArtifactId !== undefined && next.fareArtifactId !== undefined
    && (previous.fareArtifactId !== next.fareArtifactId || previous.fareOfferId !== next.fareOfferId)
}

export function pathHasSelfTransfer(edges: readonly ConnectionEdge[]): boolean {
  return edges.some((edge, index) => edge.transferType === 'self' || (index > 0 && joinsSeparateOffers(edges[index - 1]!, edge)))
}

/** Convert airport-local times only with canonical timezone evidence.
 * Ambiguous/nonexistent DST wall times are retained as unknown. */
export function airportTimeToIso(value: string, timezone?: string): string | undefined {
  const normalized = value.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    const time = Date.parse(normalized)
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined
  }
  if (!timezone || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)) return undefined
  const target = normalized.length === 16 ? `${normalized}:00` : normalized
  const wall = Date.parse(`${target}Z`)
  if (!Number.isFinite(wall)) return undefined
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    const format = (timestamp: number) => {
      const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]))
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
    }
    const candidates = new Set<number>()
    for (const delta of [-86_400_000, 0, 86_400_000]) {
      const anchor = wall + delta
      const offset = Date.parse(`${format(anchor)}Z`) - anchor
      const instant = wall - offset
      if (format(instant) === target) candidates.add(instant)
    }
    return candidates.size === 1 ? new Date([...candidates][0]!).toISOString() : undefined
  } catch { return undefined }
}
