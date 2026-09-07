import { createHash } from 'node:crypto'
import type { ArtifactRepository } from '../artifacts/repository.js'
import type { AviationProvider } from '../aviation/providers/provider.js'
import type { LocationRef, VerificationRecord } from '../aviation/types.js'
import type { FareProvider } from '../fares/providers/provider.js'
import { executeFlightSearch } from '../fares/search-service.js'
import { AppError } from '../lib/errors.js'
import { sampleDates } from '../search/serpapi.js'
import { connectionEdgeSchema, connectionSearchInputSchema, connectionSearchResultSchema, type ConnectionEdge, type ConnectionSearchService, type ConnectionSearchInput, type RouteServiceContext } from './types.js'

/** Convert a provider's airport-local time using a canonical IANA timezone.
 * Ambiguous/nonexistent DST wall times are omitted rather than guessed. */
export function airportTimeToIso(value: string, timezone?: string): string | undefined {
  const normalized = value.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
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
    for (const delta of [-86400000, 0, 86400000]) {
      const anchor = wall + delta
      const offset = Date.parse(`${format(anchor)}Z`) - anchor
      const instant = wall - offset
      if (format(instant) === target) candidates.add(instant)
    }
    return candidates.size === 1 ? new Date([...candidates][0]!).toISOString() : undefined
  } catch { return undefined }
}

/** Adds real, immutable fare-backed direct flights without requiring topology.
 * Multi-segment through fares must not be split into fictional leg prices. */
export class LiveFareConnectionSearch implements ConnectionSearchService {
  constructor(private readonly dependencies: {
    artifacts: ArtifactRepository
    fares: FareProvider
    aviation: Pick<AviationProvider, 'getAirport'>
    topology: ConnectionSearchService
  }) {}

  async search(rawInput: ConnectionSearchInput, context: RouteServiceContext = {}) {
    const input = connectionSearchInputSchema.parse(rawInput)
    if (!context.tripId || !input.origin.iata || !input.destination.iata) throw new AppError('ROUTE_ORIGIN_REQUIRED', 'Live route search requires an owned trip and airport pair', 422)
    await context.checkpoint?.()
    context.signal?.throwIfAborted()
    const warnings: string[] = []
    const edges: ConnectionEdge[] = []
    const dates = sampleDates(input.window.from, input.window.to, 4)
    const totalDays = 1 + (Date.parse(input.window.to) - Date.parse(input.window.from)) / 86400000
    if (dates.length < totalDays) warnings.push(`Only ${dates.length} departure dates were sampled in the requested window.`)
    const canonical = async (location: LocationRef): Promise<LocationRef> => {
      if (location.timezone) return location
      try {
        const airport = await this.dependencies.aviation.getAirport({ iata: location.iata! }, context)
        return airport && airport.iata === location.iata ? { ...airport, id: location.id } : location
      } catch { return location }
    }
    const [origin, destination] = await Promise.all([canonical(input.origin), canonical(input.destination)])
    let skippedConnections = 0
    let successfulDates = 0
    let firstFailure: unknown
    for (const date of dates) {
      await context.checkpoint?.()
      context.signal?.throwIfAborted()
      try {
        const stored = await executeFlightSearch({ origin: origin.iata!, destination: destination.iata!, departureDate: date, currency: 'CNY', travelClass: 1 }, {
          artifacts: this.dependencies.artifacts, fares: this.dependencies.fares, tripId: context.tripId,
          ...(context.conversationId ? { conversationId: context.conversationId } : {}),
          ...(context.signal ? { signal: context.signal } : {})
        })
        await context.checkpoint?.()
        successfulDates++
        for (const offer of stored.payload.offers) {
          if (offer.segments.length !== 1 || offer.transferType !== 'direct') { skippedConnections++; continue }
          const segment = offer.segments[0]!
          if (segment.origin !== origin.iata || segment.destination !== destination.iata || segment.departsAt.slice(0, 10) !== date) continue
          const departureAt = airportTimeToIso(segment.departsAt, origin.timezone)
          const arrivalAt = airportTimeToIso(segment.arrivesAt, destination.timezone)
          if (departureAt && arrivalAt && Date.parse(arrivalAt) < Date.parse(departureAt)) continue
          const id = `fare:${createHash('sha256').update(`${stored.record.id}:${offer.id}`).digest('hex').slice(0, 32)}`
          const verification = stored.payload.verification
          edges.push(connectionEdgeSchema.parse({
            id, from: origin, to: destination, departureDate: date,
            arrivalDate: /^\d{4}-\d{2}-\d{2}/.test(segment.arrivesAt) ? segment.arrivesAt.slice(0, 10) : undefined,
            departureAt, arrivalAt, durationMinutes: offer.totalDurationMinutes,
            transferType: 'direct', availability: departureAt && arrivalAt && verification.status === 'verified' ? 'verified' : 'partial',
            segments: [{ id: `${id}:0`, from: origin, to: destination, departureAt, arrivalAt, durationMinutes: segment.durationMinutes, marketingCarrier: segment.airline || undefined, flightNumber: segment.flightNumber || undefined, verification }],
            fare: { amount: offer.totalAmount, currency: offer.currency }, fareArtifactId: stored.record.id, fareOfferId: offer.id,
            verification, warnings: ['Price is a search-time quote; recheck before booking.', ...(!departureAt || !arrivalAt ? ['An unambiguous airport-local time could not be established.'] : [])], reasons: ['Live provider quote with immutable fare evidence']
          }))
        }
      } catch (error) {
        await context.checkpoint?.()
        if (context.signal?.aborted) throw error
        firstFailure ??= error
        warnings.push(`Live fare search failed for ${date}.`)
      }
    }
    if (skippedConnections) warnings.push('Multi-segment quoted offers were excluded because this adapter cannot establish leg-price and connection protection evidence.')
    let structural
    try { structural = await this.dependencies.topology.search(input, context) }
    catch (error) {
      await context.checkpoint?.()
      if (context.signal?.aborted) throw error
      warnings.push('Topology candidates are unavailable; live fare coverage only.')
    }
    if (!successfulDates && !structural?.edges.length && firstFailure) throw new AppError('FARE_PROVIDER_UNAVAILABLE', 'Live fares are unavailable', 503)
    const combined = [...edges, ...(structural?.edges ?? [])].slice(0, input.maxCandidates)
    const records = combined.map(edge => edge.verification)
    const verification: VerificationRecord = records.length ? {
      status: combined.every(edge => edge.availability === 'verified' && edge.verification.status === 'verified') ? 'verified' : 'partially_verified',
      checkedAt: records.map(record => record.checkedAt).sort()[0]!, confidence: Math.min(...records.map(record => record.confidence)),
      sources: records.flatMap(record => record.sources).filter((value, index, all) => all.findIndex(other => other.provider === value.provider && other.reference === value.reference) === index).slice(0, 20)
    } : { status: 'unverified', checkedAt: new Date().toISOString(), confidence: 0, sources: [{ provider: 'live-fare-connection-search' }] }
    return connectionSearchResultSchema.parse({
      edges: combined, serviceVersion: 'live-fare-connections-v1', ...(structural?.topologyVersion ? { topologyVersion: structural.topologyVersion } : {}),
      coverageStatus: combined.length ? 'reachable' : 'unknown', verification,
      warnings: [...new Set([...warnings, ...(structural?.warnings ?? [])])].slice(0, 50),
      truncated: dates.length < totalDays || edges.length + (structural?.edges.length ?? 0) > input.maxCandidates || Boolean(structural?.truncated),
      exhausted: false
    })
  }
}
