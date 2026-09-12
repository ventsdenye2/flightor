import type { FareProvider } from '../fares/providers/provider.js'
import { fareSearchResultSchema, type FareOffer } from '../fares/types.js'
import { locationRefsOverlap, type VerificationRecord } from '../aviation/types.js'
import {
  connectionEdgeSchema,
  connectionSearchInputSchema,
  connectionSearchResultSchema,
  type ConnectionEdge,
  type ConnectionSearchInput,
  type ConnectionSearchResult,
  type ConnectionSearchService,
  type RouteServiceContext
} from './types.js'
import type { TopologyCandidate, TopologyRepository } from '../topology/repository.js'

const DEFAULT_MAX_FARE_LOOKUPS = 12
const SERVICE_VERSION = 'phase4-connection-search-v1'

export interface ProductionConnectionSearchOptions {
  fareProvider?: FareProvider
  maxFareLookups?: number
  serviceVersion?: string
}

function unique(items: string[]): string[] { return [...new Set(items.filter(Boolean))] }
function nowVerification(status: VerificationRecord['status'] = 'unverified'): VerificationRecord {
  return { status, checkedAt: new Date().toISOString(), confidence: status === 'verified' ? 0.95 : 0.3, sources: [{ provider: 'connection-search' }] }
}
function weakFareVerification(base: VerificationRecord, fareRecords: readonly VerificationRecord[]): VerificationRecord {
  if (fareRecords.length === 0) return base
  const checkedAt = [base, ...fareRecords].map(record => record.checkedAt).sort()[0]!
  const confidence = Math.min(0.7, base.confidence, ...fareRecords.map(record => record.confidence))
  const sources = new Map<string, VerificationRecord['sources'][number]>()
  for (const source of [base, ...fareRecords].flatMap(record => record.sources)) {
    const key = `${source.provider}|${source.reference ?? ''}`
    if (!sources.has(key)) sources.set(key, source)
  }
  return {
    status: 'partially_verified', checkedAt, confidence,
    sources: [...sources.values()].slice(0, 20)
  }
}
function locationMatches(a: ConnectionSearchInput['origin'], b: ConnectionSearchInput['origin']): boolean {
  return locationRefsOverlap(a, b)
}
function preferredCandidate(candidate: TopologyCandidate, input: ConnectionSearchInput): boolean {
  return candidate.segments.slice(0, -1).some(segment => input.preferredLocations.some(location => locationMatches(location, segment.to)))
}
function excludedCandidate(candidate: TopologyCandidate, input: ConnectionSearchInput): boolean {
  return candidate.segments.slice(0, -1).some(segment => input.excludedLocations.some(location => locationMatches(location, segment.to)))
}
function edgeAvailability(candidate: TopologyCandidate, segment: TopologyCandidate['segments'][number]): ConnectionEdge['availability'] {
  if (candidate.verification.status === 'verified' && candidate.segments.every(segment => segment.verification.status === 'verified')) return 'verified'
  if (candidate.verification.status === 'unverified') return candidate.transferType === 'protected' ? 'partial' : 'unknown'
  if (segment.serviceDate === undefined || segment.departureAt === undefined || segment.arrivalAt === undefined) return 'partial'
  return 'partial'
}
function fareMatches(candidate: Pick<TopologyCandidate, 'origin' | 'destination'>, offer: FareOffer): boolean {
  const first = offer.segments[0]
  const last = offer.segments[offer.segments.length - 1]
  // Topology edges represent one physical flight. A complete connecting quote
  // must enter through LiveFareConnectionSearch, never price a single topology leg.
  return offer.segments.length === 1 && offer.transferType === 'direct'
    && !!first && !!last && first.origin === candidate.origin.iata && last.destination === candidate.destination.iata
}

export class ProductionConnectionSearchService implements ConnectionSearchService {
  private readonly fareProvider: FareProvider | undefined
  private readonly maxFareLookups: number
  private readonly serviceVersion: string

  constructor(private readonly topology: TopologyRepository, fareProviderOrOptions?: FareProvider | ProductionConnectionSearchOptions, options: ProductionConnectionSearchOptions = {}) {
    if (fareProviderOrOptions && 'searchFlights' in fareProviderOrOptions) {
      this.fareProvider = fareProviderOrOptions
      this.maxFareLookups = Math.min(12, Math.max(0, options.maxFareLookups ?? DEFAULT_MAX_FARE_LOOKUPS))
      this.serviceVersion = options.serviceVersion ?? SERVICE_VERSION
    } else {
      const resolved = fareProviderOrOptions ?? {}
      this.fareProvider = resolved.fareProvider
      this.maxFareLookups = Math.min(12, Math.max(0, resolved.maxFareLookups ?? DEFAULT_MAX_FARE_LOOKUPS))
      this.serviceVersion = resolved.serviceVersion ?? SERVICE_VERSION
    }
  }

  async search(rawInput: ConnectionSearchInput, context: RouteServiceContext = {}): Promise<ConnectionSearchResult> {
    const input = connectionSearchInputSchema.parse(rawInput)
    await context.checkpoint?.()
    context.signal?.throwIfAborted()
    const topologyResult = await this.topology.findCandidates({
      origin: input.origin, destination: input.destination, window: input.window,
      preferredLocations: input.preferredLocations, excludedLocations: input.excludedLocations,
      acceptsSelfTransfer: input.acceptsSelfTransfer, acceptsLongStopover: input.acceptsLongStopover,
      maxTransfers: 2, limit: Math.min(500, input.maxCandidates)
    }, context)
    await context.checkpoint?.()
    context.signal?.throwIfAborted()

    const warnings = [...topologyResult.warnings]
    const candidates = topologyResult.candidates
      .filter(candidate => !excludedCandidate(candidate, input))
      .filter(candidate => input.acceptsSelfTransfer || candidate.transferType !== 'self')
      .slice(0, input.maxCandidates)
    const eligibleCount = topologyResult.candidates
      .filter(candidate => !excludedCandidate(candidate, input))
      .filter(candidate => input.acceptsSelfTransfer || candidate.transferType !== 'self').length
    const ordered = [...candidates].sort((a, b) => {
      const preferredDifference = Number(preferredCandidate(b, input)) - Number(preferredCandidate(a, input))
      return preferredDifference || a.id.localeCompare(b.id)
    })
    const edges: ConnectionEdge[] = []
    for (const candidate of ordered) {
      const warningsForEdge = [...candidate.warnings]
      for (let index = 0; index < candidate.segments.length; index++) {
        const segment = candidate.segments[index]!
        const { serviceDate: _serviceDate, ...routeSegment } = segment
        const hasExactSchedule = segment.departureAt !== undefined && segment.arrivalAt !== undefined
        const availability = hasExactSchedule ? edgeAvailability(candidate, segment) : 'partial'
        const scheduleWarnings = [
          ...warningsForEdge,
          ...(segment.serviceDate === undefined
            ? ['A concrete operating date is unavailable; the query-window start is only a search anchor.']
            : segment.departureAt === undefined || segment.arrivalAt === undefined
              ? ['Operating date is verified, but exact departure/arrival times are unavailable.']
              : [])
        ]
        const edge = connectionEdgeSchema.parse({
          id: `${candidate.id}:${segment.id}:${index}`,
          from: segment.from, to: segment.to,
          departureDate: segment.serviceDate ?? segment.departureAt?.slice(0, 10) ?? input.window.from,
          arrivalDate: segment.arrivalAt?.slice(0, 10),
          departureAt: segment.departureAt, arrivalAt: segment.arrivalAt,
          durationMinutes: segment.durationMinutes,
          transferMinutes: index > 0 ? candidate.transferMinutes[index - 1] : undefined,
          transferType: index === 0 ? 'direct' : candidate.transferType,
          airportChange: index > 0 ? candidate.airportChange : undefined,
          segments: [routeSegment], availability,
          verification: segment.verification, warnings: scheduleWarnings,
          reasons: [preferredCandidate(candidate, input) ? 'preferred-location' : 'general-topology']
        })
        edges.push(edge)
      }
    }
    const expandedEdgeCount = edges.length
    if (edges.length > input.maxCandidates) edges.length = input.maxCandidates

    let fareLookups = 0
    const fareVerifications: VerificationRecord[] = []
    for (const edge of edges) {
      if (!this.fareProvider || fareLookups >= this.maxFareLookups || !edge.from.iata || !edge.to.iata) break
      await context.checkpoint?.()
      context.signal?.throwIfAborted()
      fareLookups += 1
      try {
        const result = fareSearchResultSchema.parse(await this.fareProvider.searchFlights({ origin: edge.from.iata, destination: edge.to.iata, departureDate: edge.departureDate, currency: 'CNY', travelClass: 1 }, context))
        await context.checkpoint?.()
        const offer = result.offers.find(candidate => fareMatches({ origin: edge.from, destination: edge.to }, candidate))
        if (offer) {
          const weakBindingWarning = edge.transferType === 'protected'
            ? 'Segment quote does not prove protected through-ticketing and is excluded from route totals.'
            : 'Fare quote has no immutable source artifact binding and is excluded from route totals.'
          edge.fare = { amount: offer.totalAmount, currency: offer.currency }
          edge.fareOfferId = offer.id
          edge.availability = 'partial'
          edge.warnings = unique([...edge.warnings, weakBindingWarning])
          warnings.push(weakBindingWarning)
          fareVerifications.push(result.verification)
        }
      } catch (error) {
        if (context.signal?.aborted || (error instanceof Error && error.message === 'ROUTE_GENERATION_CANCELLED')) throw error
        const message = 'Fare enrichment failed; structural candidate preserved'
        warnings.push(message)
        edge.warnings = unique([...edge.warnings, message])
        if (edge.availability === 'verified') edge.availability = 'partial'
      }
    }

    const topologyVerification = topologyResult.snapshot?.verification ?? edges[0]?.verification ?? nowVerification('unverified')
    // Offer IDs without an immutable FlightSearchArtifact are useful evidence,
    // but never strong enough to verify an itinerary or publish a route total.
    let verification = weakFareVerification(topologyVerification, fareVerifications)
    if (edges.some(edge => edge.availability !== 'verified') && verification.status === 'verified') {
      verification = { ...verification, status: 'partially_verified', confidence: Math.min(verification.confidence, 0.7) }
    }
    const result = {
      edges, serviceVersion: this.serviceVersion, topologyVersion: topologyResult.snapshot?.id,
      coverageStatus: topologyResult.coverageStatus, verification,
      warnings: unique(warnings),
      truncated: topologyResult.truncated || eligibleCount > input.maxCandidates || expandedEdgeCount > input.maxCandidates,
      exhausted: topologyResult.exhausted && eligibleCount <= input.maxCandidates && expandedEdgeCount <= input.maxCandidates
    }
    return connectionSearchResultSchema.parse(result)
  }
}

export { ProductionConnectionSearchService as ConnectionSearchServiceProduction }
