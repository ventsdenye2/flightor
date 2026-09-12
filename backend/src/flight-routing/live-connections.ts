import { createHash } from 'node:crypto'
import type { ArtifactRepository } from '../artifacts/repository.js'
import { checkpoint, createArtifactWorkspace } from '../artifacts/workspace.js'
import type { TripContextRepository } from '../trips/repository.js'
import type { AviationProvider } from '../aviation/providers/provider.js'
import { locationRefSchema, locationRefsOverlap, type LocationRef, type VerificationRecord } from '../aviation/types.js'
import type { FareProvider } from '../fares/providers/provider.js'
import { executeFlightSearch } from '../fares/search-service.js'
import { AppError } from '../lib/errors.js'
import { sampleDates } from '../search/serpapi.js'
import { connectionEdgeSchema, connectionSearchInputSchema, connectionSearchResultSchema, type ConnectionEdge, type ConnectionSearchService, type ConnectionSearchInput, type RouteServiceContext, type RouteSegment } from './types.js'
import { airportTimeToIso, edgeLocations, internalTransfers, LONG_STOPOVER_MINUTES } from './itinerary.js'

export { airportTimeToIso } from './itinerary.js'

/** Every provider quote remains one immutable commercial edge, including all
 * connecting flights. Its total price is never allocated to individual legs. */
export class LiveFareConnectionSearch implements ConnectionSearchService {
  constructor(private readonly dependencies: {
    artifacts: ArtifactRepository
    trips: Pick<TripContextRepository, 'get'>
    fares: FareProvider
    aviation: Pick<AviationProvider, 'getAirport'>
    topology: ConnectionSearchService
  }) {}

  async search(rawInput: ConnectionSearchInput, context: RouteServiceContext = {}) {
    const input = connectionSearchInputSchema.parse(rawInput)
    if (!context.tripId || !input.origin.iata || !input.destination.iata) throw new AppError('ROUTE_ORIGIN_REQUIRED', 'Live route search requires an owned trip and airport pair', 422)
    await context.checkpoint?.()
    context.signal?.throwIfAborted()
    const scope = context.artifactWorkspace ?? await createArtifactWorkspace({
      artifacts: this.dependencies.artifacts,
      trips: this.dependencies.trips,
      tripId: context.tripId,
      ...(context.conversationId ? { conversationId: context.conversationId } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.checkpoint ? { assertActive: context.checkpoint } : {})
    })
    if (scope.tripId !== context.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Artifact workspace does not belong to this Trip', 404)
    await checkpoint(scope)
    const warnings: string[] = []
    const edges: ConnectionEdge[] = []
    const dates = sampleDates(input.window.from, input.window.to, 4)
    const totalDays = 1 + (Date.parse(input.window.to) - Date.parse(input.window.from)) / 86400000
    if (dates.length < totalDays) warnings.push(`Only ${dates.length} departure dates were sampled in the requested window.`)
    const airportCache = new Map<string, Promise<LocationRef | undefined>>()
    let airportLookups = 0
    const canonical = (iata: string, known?: LocationRef): Promise<LocationRef | undefined> => {
      const cached = airportCache.get(iata)
      if (cached) return cached
      const load = async (): Promise<LocationRef | undefined> => {
        if (known?.timezone && known.type === 'airport') return known
        // The result set is bounded, and repeated hubs share one authoritative lookup.
        if (airportLookups >= 48) return known?.type === 'airport' ? known : undefined
        airportLookups++
        try {
          await checkpoint(scope)
          const raw = await this.dependencies.aviation.getAirport({ iata }, context)
          await checkpoint(scope)
          const parsed = locationRefSchema.safeParse(raw)
          if (parsed.success && parsed.data.type === 'airport' && parsed.data.iata === iata) {
            return known ? { ...parsed.data, id: known.id } : parsed.data
          }
        } catch {
          await checkpoint(scope)
        }
        return known?.type === 'airport' ? known : undefined
      }
      const pending = load()
      airportCache.set(iata, pending)
      return pending
    }
    const [origin, destination] = await Promise.all([canonical(input.origin.iata, input.origin), canonical(input.destination.iata, input.destination)])
    if (!origin || !destination) throw new AppError('ROUTE_ORIGIN_REQUIRED', 'Live route search requires canonical airport endpoints', 422)
    let unresolvedOffers = 0
    let invalidOffers = 0
    let successfulDates = 0
    let firstFailure: unknown
    for (const date of dates) {
      await checkpoint(scope)
      context.signal?.throwIfAborted()
      try {
        const stored = await executeFlightSearch({ origin: origin.iata!, destination: destination.iata!, departureDate: date, currency: 'CNY', travelClass: 1 }, {
          ...scope, fares: this.dependencies.fares
        })
        await checkpoint(scope)
        successfulDates++
        for (const offer of stored.payload.offers) {
          const first = offer.segments[0]!, last = offer.segments.at(-1)!
          if (first.origin !== origin.iata || last.destination !== destination.iata || first.departsAt.slice(0, 10) !== date) continue
          if (offer.transferType === 'self' && !input.acceptsSelfTransfer) continue
          const airports = new Map<string, LocationRef>()
          for (const iata of new Set(offer.segments.flatMap(segment => [segment.origin, segment.destination]))) {
            const airport = await canonical(iata)
            if (airport) airports.set(iata, airport)
          }
          if (offer.segments.some(segment => !airports.has(segment.origin) || !airports.has(segment.destination))) { unresolvedOffers++; continue }
          const id = `fare:${createHash('sha256').update(`${stored.record.id}:${offer.id}`).digest('hex').slice(0, 32)}`
          const verification = stored.payload.verification
          const segments: RouteSegment[] = offer.segments.map((segment, index) => {
            const from = airports.get(segment.origin)!, to = airports.get(segment.destination)!
            return {
              id: `${id}:${index}`, from, to,
              departureAt: airportTimeToIso(segment.departsAt, from.timezone), arrivalAt: airportTimeToIso(segment.arrivesAt, to.timezone),
              durationMinutes: segment.durationMinutes, marketingCarrier: segment.airline || undefined,
              flightNumber: segment.flightNumber || undefined, verification
            }
          })
          const departureAt = segments[0]!.departureAt, arrivalAt = segments.at(-1)!.arrivalAt
          const airportChange = segments.slice(1).some((segment, index) => segment.from.iata !== segments[index]!.to.iata)
          const completeTimes = segments.every(segment => segment.departureAt && segment.arrivalAt)
          const connectionProtectionUnknown = segments.length > 1 && offer.protectedConnection === undefined
          const parsed = connectionEdgeSchema.safeParse({
            id, from: origin, to: destination, departureDate: date,
            arrivalDate: /^\d{4}-\d{2}-\d{2}/.test(last.arrivesAt) ? last.arrivesAt.slice(0, 10) : undefined,
            departureAt, arrivalAt, durationMinutes: offer.totalDurationMinutes,
            transferType: offer.transferType, airportChange,
            ...(offer.protectedConnection === undefined ? {} : { protectedConnection: offer.protectedConnection }),
            ...(offer.baggageRecheck === undefined ? {} : { baggageRecheck: offer.baggageRecheck }),
            availability: completeTimes && !connectionProtectionUnknown && !airportChange && verification.status === 'verified' ? 'verified' : 'partial',
            segments,
            ...(offer.layovers ? { layovers: offer.layovers.map(layover => ({ afterSegmentIndex: layover.afterSegmentIndex,
              ...(layover.durationMinutes === undefined ? {} : { durationMinutes: layover.durationMinutes }),
              ...(layover.overnight === undefined ? {} : { overnight: layover.overnight }) })) } : {}),
            fare: { amount: offer.totalAmount, currency: offer.currency }, fareArtifactId: stored.record.id, fareOfferId: offer.id,
            verification, warnings: [
              'Price is a search-time quote; recheck before booking.',
              ...(!completeTimes ? ['One or more airport-local times could not be established unambiguously.'] : []),
              ...(connectionProtectionUnknown ? ['Connection protection is not established by this quoted itinerary.'] : []),
              ...(segments.length > 1 && offer.baggageRecheck === undefined ? ['Baggage transfer and recheck requirements are unknown.'] : []),
              ...(airportChange ? ['This itinerary requires an airport change.'] : [])
            ], reasons: ['Complete provider quote with immutable fare evidence']
          })
          if (!parsed.success) { invalidOffers++; continue }
          if (edgeLocations(parsed.data).some(location => input.excludedLocations.some(excluded => locationRefsOverlap(location, excluded)))) continue
          if (!input.acceptsLongStopover && internalTransfers(parsed.data).some(transfer => (transfer.durationMinutes ?? 0) > LONG_STOPOVER_MINUTES)) continue
          edges.push(parsed.data)
        }
      } catch (error) {
        await checkpoint(scope)
        if (context.signal?.aborted) throw error
        firstFailure ??= error
        warnings.push(`Live fare search failed for ${date}.`)
      }
    }
    if (unresolvedOffers) warnings.push('Some complete quotes could not enter route comparison because a connecting airport could not be resolved authoritatively; original fare evidence is preserved.')
    if (invalidOffers) warnings.push('Some complete quotes have inconsistent itinerary timing or airport structure and were excluded from route comparison.')
    let structural
    try { structural = await this.dependencies.topology.search(input, context) }
    catch (error) {
      await checkpoint(scope)
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
      edges: combined, serviceVersion: 'live-fare-connections-v2', ...(structural?.topologyVersion ? { topologyVersion: structural.topologyVersion } : {}),
      coverageStatus: combined.length ? 'reachable' : 'unknown', verification,
      warnings: [...new Set([...warnings, ...(structural?.warnings ?? [])])].slice(0, 50),
      truncated: dates.length < totalDays || edges.length + (structural?.edges.length ?? 0) > input.maxCandidates || Boolean(structural?.truncated),
      exhausted: false
    })
  }
}
