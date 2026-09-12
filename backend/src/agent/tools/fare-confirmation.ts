import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { verificationRecordSchema, type VerificationRecord } from '../../aviation/types.js'
import { type ArtifactRecord } from '../../artifacts/repository.js'
import {
  fareSearchInputSchema,
  fareSearchResultSchema,
  flightSearchArtifactSchema,
  type FareOffer,
  type FareSearchInput,
  type FareSearchResult,
  type FlightSearchArtifact
} from '../../fares/types.js'
import {
  routeSetPayloadSchema,
  type CompleteFlightPath,
  type ConnectionEdge,
  type RouteSetPayload
} from '../../flight-routing/types.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'
import { checkpoint, loadWorkspaceArtifact, saveWorkspaceArtifact, type ArtifactWorkspace } from '../../artifacts/workspace.js'
import { workspaceScope } from './workspace-scope.js'
import { airportTimeToIso } from '../../flight-routing/itinerary.js'

const verificationStatusSchema = z.enum(['verified', 'partially_verified', 'stale', 'unverified'])
const artifactReferenceSchema = z.object({
  id: z.string().uuid(), type: z.literal('flight_search'), schemaVersion: z.literal(1)
}).strict()
const routeArtifactReferenceSchema = z.object({
  id: z.string().uuid(), type: z.literal('route_set'), schemaVersion: z.literal(1)
}).strict()
const fareSummarySchema = z.object({
  amount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/)
}).strict()

export const confirmFlightPriceInputSchema = z.object({
  artifactId: z.string().uuid(),
  offerId: z.string().min(1).max(240)
}).strict()

export const confirmFlightPriceOutputSchema = z.object({
  artifact: artifactReferenceSchema,
  summary: z.object({
    offerId: z.string().min(1).max(240),
    price: fareSummarySchema,
    checkedAt: z.iso.datetime(),
    verificationStatus: verificationStatusSchema
  }).strict()
}).strict()

export const confirmRoutePriceInputSchema = z.object({
  routeArtifactId: z.string().uuid(),
  pathId: z.string().min(1).max(160),
  maxLegs: z.number().int().min(1).max(12).default(12)
}).strict()

export const confirmRoutePriceOutputSchema = z.object({
  artifact: routeArtifactReferenceSchema,
  summary: z.object({
    pathId: z.string().min(1).max(160),
    confirmed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unconfirmed: z.number().int().nonnegative(),
    totalFare: fareSummarySchema.optional(),
    verificationStatus: verificationStatusSchema
  }).strict(),
  warnings: z.array(z.string().max(200)).max(50)
}).strict()

type VerificationStatus = z.infer<typeof verificationStatusSchema>

const FARE_CONFIRMATION_PROVIDER = 'flightor.fare_confirmation'
const MAX_REFRESH_CONCURRENCY = 2
const SUPPORTED_FARE_CURRENCIES = new Set(['CNY', 'USD', 'EUR'])

function sameFareQuery(left: FareSearchInput, right: FareSearchInput): boolean {
  return left.origin === right.origin
    && left.destination === right.destination
    && left.departureDate === right.departureDate
    && left.returnDate === right.returnDate
    && left.currency === right.currency
    && left.travelClass === right.travelClass
}

function offerEndpointsMatch(offer: FareOffer, query: FareSearchInput): boolean {
  const first = offer.segments[0]
  const last = offer.segments[offer.segments.length - 1]
  return first?.origin === query.origin && last?.destination === query.destination
}

function timeIdentity(value: string): string {
  const local = value.trim().replace(' ', 'T')
  return airportTimeToIso(value) ?? (local.length === 16 ? `${local}:00` : local)
}

function sameItinerary(left: FareOffer, right: FareOffer): boolean {
  return left.transferType === right.transferType && left.segments.length === right.segments.length
    && left.segments.every((segment, index) => {
      const other = right.segments[index]!
      return segment.origin === other.origin && segment.destination === other.destination
        && segment.flightNumber.trim().toUpperCase() === other.flightNumber.trim().toUpperCase()
        && segment.airline.trim() === other.airline.trim()
        && timeIdentity(segment.departsAt) === timeIdentity(other.departsAt)
        && timeIdentity(segment.arrivesAt) === timeIdentity(other.arrivesAt)
    })
}

function offerMatchesEdge(offer: FareOffer, edge: ConnectionEdge): boolean {
  // Legacy direct route snapshots can lack segment detail. An opaque edge can
  // never establish identity for a connecting itinerary.
  if (!edge.segments) return offer.segments.length === 1 && offer.transferType === 'direct' && edge.transferType !== 'airline'
  if (edge.segments.length !== offer.segments.length) return false
  // Legacy single-segment topology edges label the preceding connection. That
  // label cannot become evidence of protection for a new quoted itinerary.
  if (offer.segments.length > 1 && edge.transferType !== offer.transferType
    && !(edge.transferType === 'protected' && offer.protectedConnection === true)) return false
  return edge.segments.every((segment, index) => {
    const quoted = offer.segments[index]!
    return segment.from.iata === quoted.origin && segment.to.iata === quoted.destination
      && (segment.flightNumber === undefined || segment.flightNumber.trim().toUpperCase() === quoted.flightNumber.trim().toUpperCase())
      && (segment.marketingCarrier === undefined || segment.marketingCarrier.trim() === quoted.airline.trim())
      && (segment.departureAt === undefined || timeIdentity(segment.departureAt) === airportTimeToIso(quoted.departsAt, segment.from.timezone))
      && (segment.arrivalAt === undefined || timeIdentity(segment.arrivalAt) === airportTimeToIso(quoted.arrivesAt, segment.to.timezone))
  })
}

function validateRefreshResult(result: unknown, query: FareSearchInput, offerId: string, sourceOffer?: FareOffer): {
  result: FareSearchResult
  offer: FareOffer
} {
  const parsed = fareSearchResultSchema.parse(result)
  if (!sameFareQuery(parsed.query, query)) throw new Error('Fare provider returned a different query')
  for (const offer of parsed.offers) {
    if (!offerEndpointsMatch(offer, query)) throw new Error('Fare provider returned a different route')
  }
  const offer = parsed.offers.find(item => item.id === offerId)
  if (!offer) throw new Error('The requested fare offer is no longer available')
  if (sourceOffer && !sameItinerary(sourceOffer, offer)) throw new Error('The refreshed fare has a different itinerary')
  return { result: parsed, offer }
}

function appendSources(
  verification: VerificationRecord,
  sourceArtifactId: string,
  offerId: string,
  snapshotId?: string
): VerificationRecord {
  const additions = [
    { provider: FARE_CONFIRMATION_PROVIDER, reference: `source-artifact:${sourceArtifactId}` },
    { provider: FARE_CONFIRMATION_PROVIDER, reference: `source-offer:${offerId}` },
    ...(snapshotId ? [{ provider: FARE_CONFIRMATION_PROVIDER, reference: `snapshot:${snapshotId}` }] : [])
  ]
  // Preserve confirmation provenance even if the provider already returned
  // the maximum number of source records permitted by the shared schema.
  const sources: VerificationRecord['sources'] = [...additions]
  for (const source of verification.sources) {
    const key = `${source.provider}|${source.reference}`
    if (!sources.some(item => `${item.provider}|${item.reference ?? ''}` === key)) sources.push(source)
  }
  return verificationRecordSchema.parse({ ...verification, sources: sources.slice(0, 20) })
}

function forcePartiallyVerified(verification: VerificationRecord): VerificationRecord {
  if (verification.status === 'verified') return { ...verification, status: 'partially_verified' }
  return verification
}

function warning(value: string): string {
  return value.slice(0, 200)
}

function uniqueWarnings(values: readonly string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const item = warning(value)
    if (!seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
    if (result.length >= 50) break
  }
  return result
}

function isCancelled(context: ToolExecutionContext, signal: AbortSignal): boolean {
  return signal.aborted || context.isGenerationCurrent?.() === false
}

function assertCurrent(context: ToolExecutionContext, signal: AbortSignal): void {
  if (isCancelled(context, signal)) throw new Error('Fare confirmation was cancelled')
}

function emptyFailureVerification(edge: ConnectionEdge, reason: string): VerificationRecord {
  return verificationRecordSchema.parse({
    status: 'unverified',
    checkedAt: new Date().toISOString(),
    confidence: 0,
    sources: [
      ...edge.verification.sources,
      { provider: FARE_CONFIRMATION_PROVIDER, reference: `edge:${edge.id}:${reason}` }
    ].slice(0, 20)
  })
}

function degradedAvailability(edge: ConnectionEdge): ConnectionEdge['availability'] {
  // The route schema intentionally disallows an unknown protected edge.  It is
  // still not verified, so partial is the least misleading valid state there.
  return edge.transferType === 'protected' ? 'partial' : 'unknown'
}

function locationIata(edge: ConnectionEdge): { origin?: string; destination?: string } {
  return {
    ...(edge.from.iata ? { origin: edge.from.iata } : {}),
    ...(edge.to.iata ? { destination: edge.to.iata } : {})
  }
}

function queryMatchesEdge(query: FareSearchInput, edge: ConnectionEdge): boolean {
  const { origin, destination } = locationIata(edge)
  return origin !== undefined
    && destination !== undefined
    && query.origin === origin
    && query.destination === destination
    && query.departureDate === edge.departureDate
}

function weakQueryForEdge(edge: ConnectionEdge): FareSearchInput | undefined {
  const { origin, destination } = locationIata(edge)
  if (origin === undefined || destination === undefined) return undefined
  const currency = edge.fare?.currency ?? 'CNY'
  if (!SUPPORTED_FARE_CURRENCIES.has(currency)) return undefined
  return fareSearchInputSchema.parse({
    origin, destination, departureDate: edge.departureDate, currency, travelClass: 1
  })
}

async function loadFlightArtifact(
  scope: ArtifactWorkspace,
  artifactId: string
): Promise<{ record: ArtifactRecord; payload: FlightSearchArtifact }> {
  const record = await loadWorkspaceArtifact(scope, artifactId, 'flight_search', [1])
  const payload = flightSearchArtifactSchema.parse(record.payload)
  if (payload.id !== record.id) throw new Error('Fare artifact payload id does not match its record')
  return { record, payload }
}

function selectedPath(payload: RouteSetPayload, pathId: string): CompleteFlightPath {
  if (payload.kind === 'flight_paths') {
    const path = payload.paths.find(item => item.id === pathId)
    if (!path) throw new Error('The requested route path was not found')
    return path
  }
  if (payload.kind === 'optimized_routes') {
    const representative = payload.representatives.find(item => item.path.id === pathId)
    if (!representative) throw new Error('The requested route path was not found')
    return representative.path
  }
  throw new Error('Route confirmation requires flight paths or optimized routes')
}

async function loadRouteArtifact(
  scope: ArtifactWorkspace,
  artifactId: string,
  pathId: string
): Promise<{ record: ArtifactRecord; payload: RouteSetPayload; path: CompleteFlightPath }> {
  const record = await loadWorkspaceArtifact(scope, artifactId, 'route_set', [1])
  const payload = routeSetPayloadSchema.parse(record.payload)
  if (payload.kind !== 'flight_paths' && payload.kind !== 'optimized_routes') {
    throw new Error('Route confirmation requires flight paths or optimized routes')
  }
  return { record, payload, path: selectedPath(payload, pathId) }
}

type RefreshCandidate = {
  edgeIndex: number
  edge: ConnectionEdge
  offerId: string
  query?: FareSearchInput
  sourceArtifactId?: string
  sourceOffer?: FareOffer
  weak: boolean
  preparation: 'refresh' | 'failed' | 'unconfirmed'
  preparationWarning?: string
}

type RefreshOutcome = {
  edgeIndex: number
  edge: ConnectionEdge
  offerId?: string
  weak: boolean
  kind: 'confirmed' | 'failed' | 'unconfirmed'
  result?: FareSearchResult
  offer?: FareOffer
  sourceArtifactId?: string
  message: string
  snapshotId?: string
  snapshotVerification?: VerificationRecord
}

function prepareCandidate(
  edge: ConnectionEdge,
  edgeIndex: number,
  sourceArtifact?: { record: ArtifactRecord; payload: FlightSearchArtifact }
): RefreshCandidate {
  const offerId = edge.fareOfferId
  if (offerId === undefined) {
    return {
      edgeIndex, edge, offerId: '', weak: false, preparation: 'unconfirmed',
      preparationWarning: `Edge ${edge.id} has no fare offer binding; fare remains unconfirmed.`
    }
  }

  if (edge.fareArtifactId !== undefined) {
    if (sourceArtifact === undefined) {
      return {
        edgeIndex, edge, offerId, weak: false, preparation: 'failed',
        preparationWarning: `Fare binding failed for edge ${edge.id}; its source artifact is unavailable.`
      }
    }
    const sourceOffer = sourceArtifact.payload.offers.find(item => item.id === offerId)
    if (sourceOffer === undefined || !offerEndpointsMatch(sourceOffer, sourceArtifact.payload.query) || !offerMatchesEdge(sourceOffer, edge)) {
      return {
        edgeIndex, edge, offerId, weak: false, preparation: 'failed',
        preparationWarning: `Fare binding failed for edge ${edge.id}; its source offer is unavailable.`
      }
    }
    if (!queryMatchesEdge(sourceArtifact.payload.query, edge)) {
      return {
        edgeIndex, edge, offerId, weak: false, preparation: 'failed',
        preparationWarning: `Fare binding failed for edge ${edge.id}; its source query does not match the route edge.`
      }
    }
    return {
      edgeIndex, edge, offerId, weak: false, preparation: 'refresh', query: sourceArtifact.payload.query,
      sourceArtifactId: sourceArtifact.record.id, sourceOffer
    }
  }

  const query = weakQueryForEdge(edge)
  if (query === undefined) {
    return {
      edgeIndex, edge, offerId, weak: true, preparation: 'unconfirmed',
      preparationWarning: `Edge ${edge.id} has no canonical airport fare binding; fare remains unconfirmed.`
    }
  }
  return {
    edgeIndex, edge, offerId, weak: true, preparation: 'refresh', query,
    preparationWarning: `Weak fare binding was used for edge ${edge.id}; the route cannot be fully verified.`
  }
}

/**
 * A module-level limiter keeps confirmation calls bounded even when two route
 * tools happen to execute at the same time in the same process.
 */
class RefreshLimiter {
  private active = 0
  private readonly queue: Array<{
    signal: AbortSignal
    resolve: (release: () => void) => void
    reject: (reason: unknown) => void
    onAbort: () => void
  }> = []

  async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Fare confirmation was cancelled'))
    return new Promise<() => void>((resolve, reject) => {
      let settled = false
      const waiter = {
        signal,
        resolve: (release: () => void) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve(release)
        },
        reject: (reason: unknown) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          reject(reason)
        },
        onAbort: () => {
          if (settled) return
          this.remove(waiter)
          waiter.reject(signal.reason instanceof Error ? signal.reason : new Error('Fare confirmation was cancelled'))
        }
      }
      const onAbort = waiter.onAbort
      this.queue.push(waiter)
      this.drain()
      if (!settled) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private remove(target: { resolve: (release: () => void) => void }): void {
    const index = this.queue.findIndex(item => item.resolve === target.resolve)
    if (index >= 0) this.queue.splice(index, 1)
  }

  private drain(): void {
    while (this.active < MAX_REFRESH_CONCURRENCY && this.queue.length > 0) {
      const waiter = this.queue.shift()!
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason instanceof Error ? waiter.signal.reason : new Error('Fare confirmation was cancelled'))
        continue
      }
      this.active++
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true
        this.active--
        this.drain()
      })
    }
  }
}

const refreshLimiter = new RefreshLimiter()

async function refreshCandidate(
  candidate: RefreshCandidate,
  context: ToolExecutionContext,
  signal: AbortSignal
): Promise<RefreshOutcome> {
  if (candidate.preparation !== 'refresh' || candidate.query === undefined || candidate.offerId === '') {
    return {
      edgeIndex: candidate.edgeIndex, edge: candidate.edge, ...(candidate.offerId ? { offerId: candidate.offerId } : {}),
      weak: candidate.weak,
      kind: candidate.preparation === 'failed' ? 'failed' : 'unconfirmed',
      message: candidate.preparationWarning ?? `Edge ${candidate.edge.id} remains unconfirmed`
    }
  }
  assertCurrent(context, signal)
  try {
    const raw = await refreshLimiter.run(signal, () => context.fares.refreshFlight({ offerId: candidate.offerId!, query: candidate.query! }, { signal }))
    assertCurrent(context, signal)
    const validated = validateRefreshResult(raw, candidate.query, candidate.offerId, candidate.sourceOffer)
    if (!offerMatchesEdge(validated.offer, candidate.edge)) throw new Error('Refreshed fare does not match the complete route itinerary')
    return {
      edgeIndex: candidate.edgeIndex, edge: candidate.edge, offerId: candidate.offerId,
      weak: candidate.weak, kind: 'confirmed', result: validated.result, offer: validated.offer,
      ...(candidate.sourceArtifactId ? { sourceArtifactId: candidate.sourceArtifactId } : {}),
      message: candidate.preparationWarning ?? ''
    }
  } catch (error) {
    if (isCancelled(context, signal)) throw new Error('Fare confirmation was cancelled')
    return {
      edgeIndex: candidate.edgeIndex, edge: candidate.edge, offerId: candidate.offerId,
      weak: candidate.weak, kind: 'failed',
      message: `Fare confirmation failed for edge ${candidate.edge.id}.`
    }
  }
}

async function refreshCandidates(
  candidates: readonly RefreshCandidate[],
  context: ToolExecutionContext,
  signal: AbortSignal
): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      assertCurrent(context, signal)
      const index = next++
      if (index >= candidates.length) return
      outcomes[index] = await refreshCandidate(candidates[index]!, context, signal)
    }
  }
  const workerCount = Math.min(MAX_REFRESH_CONCURRENCY, candidates.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return outcomes
}

async function persistFareSnapshot(
  scope: ArtifactWorkspace,
  result: FareSearchResult,
  sourceArtifactId: string,
  offerId: string,
  weak: boolean
): Promise<{ id: string; payload: FlightSearchArtifact }> {
  const id = uuidv7()
  let verification = appendSources(result.verification, sourceArtifactId, offerId)
  if (weak) verification = forcePartiallyVerified(verification)
  const payload = flightSearchArtifactSchema.parse({ ...result, id, type: 'flight_search', verification })
  const stored = await saveWorkspaceArtifact(scope, {
    id, sourceArtifactIds: [sourceArtifactId],
    type: 'flight_search', schemaVersion: 1, payload, verification
  })
  return { id: stored.id, payload }
}

function applyOutcome(
  edge: ConnectionEdge,
  outcome: RefreshOutcome,
  snapshot?: { id: string; payload: FlightSearchArtifact }
): ConnectionEdge {
  if (outcome.kind === 'confirmed' && outcome.offer !== undefined && outcome.result !== undefined && snapshot !== undefined) {
    const verification = appendSources(
      snapshot.payload.verification,
      outcome.sourceArtifactId ?? `route-edge:${edge.id}`,
      outcome.offer.id,
      snapshot.id
    )
    const availability: ConnectionEdge['availability'] = outcome.weak || verification.status !== 'verified'
      || edge.availability !== 'verified' || (edge.transferType === 'airline' && outcome.offer.protectedConnection === undefined)
      ? 'partial' : 'verified'
    const warnings = uniqueWarnings([
      ...edge.warnings,
      ...(outcome.weak ? [outcome.message] : [])
    ])
    const { protectedConnection: _previousProtection, baggageRecheck: _previousBaggage, ...withoutBookingFacts } = edge
    return {
      ...withoutBookingFacts,
      ...(outcome.offer.protectedConnection === undefined ? {} : { protectedConnection: outcome.offer.protectedConnection }),
      ...(outcome.offer.baggageRecheck === undefined ? {} : { baggageRecheck: outcome.offer.baggageRecheck }),
      fare: { amount: outcome.offer.totalAmount, currency: outcome.offer.currency },
      fareArtifactId: snapshot.id,
      fareOfferId: outcome.offer.id,
      availability,
      verification,
      warnings
    }
  }

  const { fare: _fare, ...withoutFare } = edge
  const reason = outcome.kind === 'unconfirmed' ? 'unconfirmed' : 'failed'
  return {
    ...withoutFare,
    availability: degradedAvailability(edge),
    verification: emptyFailureVerification(edge, reason),
    warnings: uniqueWarnings([...edge.warnings, outcome.message])
  }
}

function pathWithConfirmedEdges(
  path: CompleteFlightPath,
  outcomes: readonly RefreshOutcome[],
  snapshots: ReadonlyMap<number, { id: string; payload: FlightSearchArtifact }>
): CompleteFlightPath {
  const outcomeByIndex = new Map(outcomes.map(outcome => [outcome.edgeIndex, outcome]))
  const edges = path.edges.map((edge, index) => {
    const outcome = outcomeByIndex.get(index)
    if (outcome === undefined) return edge
    return applyOutcome(edge, outcome, snapshots.get(index))
  })

  const confirmedWithFare = edges.every((edge, index) => {
    const outcome = outcomeByIndex.get(index)
    return outcome?.kind === 'confirmed' && snapshots.has(index) && edge.fare !== undefined
  })
  const currencies = [...new Set(edges.map(edge => edge.fare?.currency).filter((value): value is string => value !== undefined))]
  const totalFare = confirmedWithFare && currencies.length === 1
    ? { amount: edges.reduce((total, edge) => total + (edge.fare?.amount ?? 0), 0), currency: currencies[0]! }
    : undefined

  const feasibility: CompleteFlightPath['feasibility'] = edges.some(edge => edge.verification.status === 'unverified' || edge.availability === 'unknown')
    ? 'unknown'
    : edges.some(edge => edge.availability === 'partial' || edge.verification.status !== 'verified')
      ? 'partial'
      : path.feasibility
  const pathWarnings = uniqueWarnings([
    ...path.warnings,
    ...outcomes.filter(outcome => outcome.message.length > 0).map(outcome => outcome.message),
    ...(totalFare === undefined ? ['Total fare is unavailable because not every edge has a newly confirmed fare in one currency.'] : [])
  ])
  const { totalFare: _oldTotalFare, ...withoutTotalFare } = path
  return {
    ...withoutTotalFare,
    edges,
    feasibility,
    warnings: pathWarnings,
    ...(totalFare === undefined ? {} : { totalFare })
  }
}

function pathsInPayload(payload: RouteSetPayload): CompleteFlightPath[] {
  return payload.kind === 'flight_paths'
    ? payload.paths
    : payload.kind === 'optimized_routes'
      ? payload.representatives.map(item => item.path)
      : []
}

const statusRank: Record<VerificationStatus, number> = {
  verified: 0, partially_verified: 1, stale: 2, unverified: 3
}

function edgeStatus(edge: ConnectionEdge): VerificationStatus {
  if (edge.availability === 'unknown' || edge.verification.status === 'unverified') return 'unverified'
  if (edge.availability === 'partial' || edge.verification.status === 'partially_verified') return 'partially_verified'
  return edge.verification.status
}

function aggregateVerification(
  original: VerificationRecord,
  payload: RouteSetPayload,
  selectedPathId: string,
  outcomes: readonly RefreshOutcome[],
  confirmedCount: number,
  newArtifactIds: readonly string[]
): VerificationRecord {
  const selectedOutcomeByIndex = new Map(outcomes.map(outcome => [outcome.edgeIndex, outcome]))
  const statuses: VerificationStatus[] = [original.status]
  const confidences = [original.confidence]
  const sources = [...original.sources]
  for (const path of pathsInPayload(payload)) {
    const selected = path.id === selectedPathId
    for (let index = 0; index < path.edges.length; index++) {
      const edge = path.edges[index]!
      const outcome = selected ? selectedOutcomeByIndex.get(index) : undefined
      // A failed edge is represented as unverified at edge level.  Once at
      // least one other leg is newly confirmed, route-level status is partial
      // rather than claiming the whole selected route is unusable.
      const status = outcome !== undefined && outcome.kind !== 'confirmed' && confirmedCount > 0
        ? 'partially_verified'
        : edgeStatus(edge)
      statuses.push(status)
      confidences.push(edge.verification.confidence)
      sources.push(...edge.verification.sources)
    }
  }
  const hasWeak = outcomes.some(outcome => outcome.kind === 'confirmed' && outcome.weak)
  const hasFailure = outcomes.some(outcome => outcome.kind === 'failed' || outcome.kind === 'unconfirmed')
  let status = statuses.reduce<VerificationStatus>((worst, value) => statusRank[value] > statusRank[worst] ? value : worst, 'verified')
  if (confirmedCount === 0) status = 'unverified'
  else if (hasWeak || hasFailure) status = statusRank[status] > statusRank.partially_verified ? status : 'partially_verified'
  for (const id of newArtifactIds) sources.push({ provider: FARE_CONFIRMATION_PROVIDER, reference: `snapshot:${id}` })
  const uniqueSources: VerificationRecord['sources'] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const key = `${source.provider}|${source.reference ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueSources.push(source.reference === undefined ? { provider: source.provider } : { provider: source.provider, reference: source.reference })
    }
  }
  return verificationRecordSchema.parse({
    status,
    checkedAt: new Date().toISOString(),
    confidence: Math.max(0, Math.min(1, Math.min(...confidences))),
    sources: uniqueSources.slice(0, 20)
  })
}

function replaceSelectedPath(payload: RouteSetPayload, pathId: string, updated: CompleteFlightPath): RouteSetPayload {
  if (payload.kind === 'flight_paths') {
    return { ...payload, paths: payload.paths.map(path => path.id === pathId ? updated : path) }
  }
  if (payload.kind === 'optimized_routes') {
    return {
      ...payload,
      representatives: payload.representatives.map(item => item.path.id === pathId ? { ...item, path: updated } : item)
    }
  }
  throw new Error('Route confirmation requires flight paths or optimized routes')
}

async function prepareCandidates(
  scope: ArtifactWorkspace,
  path: CompleteFlightPath
): Promise<RefreshCandidate[]> {
  const candidates: RefreshCandidate[] = []
  for (let edgeIndex = 0; edgeIndex < path.edges.length; edgeIndex++) {
    const edge = path.edges[edgeIndex]!
    if (edge.fareArtifactId !== undefined && edge.fareOfferId !== undefined) {
      let sourceArtifact: { record: ArtifactRecord; payload: FlightSearchArtifact } | undefined
      try {
        sourceArtifact = await loadFlightArtifact(scope, edge.fareArtifactId)
      } catch {
        sourceArtifact = undefined
      }
      candidates.push(prepareCandidate(edge, edgeIndex, sourceArtifact))
    } else {
      candidates.push(prepareCandidate(edge, edgeIndex))
    }
  }
  return candidates
}

export const confirmFlightPriceTool: AgentTool<
  z.infer<typeof confirmFlightPriceInputSchema>, z.infer<typeof confirmFlightPriceOutputSchema>
> = {
  name: 'confirm_flight_price',
  description: 'Refresh one selected fare from an owner-scoped flight-search artifact without changing its original snapshot.',
  inputSchema: confirmFlightPriceInputSchema,
  outputSchema: confirmFlightPriceOutputSchema,
  costClass: 'paid', costUnits: 4, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 35_000, provider: 'fare_provider',
  async execute(input, context, signal) {
    const scope = await workspaceScope(context, signal)
    const source = await loadFlightArtifact(scope, input.artifactId)
    const sourceOffer = source.payload.offers.find(item => item.id === input.offerId)
    if (sourceOffer === undefined) throw new Error('The requested fare offer was not found')
    if (!offerEndpointsMatch(sourceOffer, source.payload.query)) throw new Error('Source fare offer endpoints do not match its query')
    await checkpoint(scope)
    const raw = await refreshLimiter.run(signal, () => context.fares.refreshFlight({ offerId: input.offerId, query: source.payload.query }, { signal }))
    assertCurrent(context, signal)
    const validated = validateRefreshResult(raw, source.payload.query, input.offerId, sourceOffer)
    assertCurrent(context, signal)
    const stored = await persistFareSnapshot(scope, validated.result, source.record.id, input.offerId, false)
    return {
      artifact: { id: stored.id, type: 'flight_search', schemaVersion: 1 },
      summary: {
        offerId: validated.offer.id,
        price: { amount: validated.offer.totalAmount, currency: validated.offer.currency },
        checkedAt: validated.result.checkedAt,
        verificationStatus: stored.payload.verification.status
      }
    }
  }
}

export const confirmRoutePriceTool: AgentTool<
  z.infer<typeof confirmRoutePriceInputSchema>, z.infer<typeof confirmRoutePriceOutputSchema>
> = {
  name: 'confirm_route_price',
  description: 'Refresh bounded fare-critical legs of an owner-scoped route path and create an immutable successor route-set artifact.',
  inputSchema: confirmRoutePriceInputSchema,
  outputSchema: confirmRoutePriceOutputSchema,
  costClass: 'expensive', costUnits: 8, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 60_000, provider: 'fare_provider',
  async execute(input, context, signal) {
    const scope = await workspaceScope(context, signal)
    const requestedMaxLegs = input.maxLegs ?? 12
    const source = await loadRouteArtifact(scope, input.routeArtifactId, input.pathId)
    const fareLegCount = source.path.edges.filter(edge => edge.fareOfferId !== undefined).length
    if (fareLegCount > requestedMaxLegs) throw new Error('Route fare confirmation exceeds maxLegs')
    assertCurrent(context, signal)

    const candidates = await prepareCandidates(scope, source.path)
    const outcomes = await refreshCandidates(candidates, context, signal)
    assertCurrent(context, signal)

    const snapshots = new Map<number, { id: string; payload: FlightSearchArtifact }>()
    for (const outcome of outcomes) {
      if (outcome.kind !== 'confirmed' || outcome.result === undefined || outcome.offerId === undefined) continue
      const snapshot = await persistFareSnapshot(
        scope,
        outcome.result,
        outcome.sourceArtifactId ?? source.record.id,
        outcome.offerId,
        outcome.weak
      )
      outcome.snapshotId = snapshot.id
      outcome.snapshotVerification = snapshot.payload.verification
      snapshots.set(outcome.edgeIndex, snapshot)
    }
    assertCurrent(context, signal)

    const updatedPath = pathWithConfirmedEdges(source.path, outcomes, snapshots)
    const successorWithoutVerification = replaceSelectedPath(source.payload, input.pathId, updatedPath)
    const confirmedCount = outcomes.filter(outcome => outcome.kind === 'confirmed' && snapshots.has(outcome.edgeIndex)).length
    const failedCount = outcomes.filter(outcome => outcome.kind === 'failed').length
    const unconfirmedCount = outcomes.filter(outcome => outcome.kind === 'unconfirmed').length
    const newArtifactIds = outcomes.map(outcome => outcome.snapshotId).filter((id): id is string => id !== undefined)
    const verification = aggregateVerification(
      source.payload.verification,
      successorWithoutVerification,
      input.pathId,
      outcomes,
      confirmedCount,
      newArtifactIds
    )
    const routeWarnings = uniqueWarnings([
      ...source.payload.warnings,
      ...outcomes.filter(outcome => outcome.message.length > 0).map(outcome => outcome.message),
      ...(updatedPath.totalFare === undefined ? ['Total fare omitted because not every route edge has a newly confirmed fare in one currency.'] : [])
    ])
    // Keep the route being confirmed and every newly created fare snapshot
    // ahead of older provenance when the shared 50-reference bound is full.
    const sourceArtifactIds = [...new Set([source.record.id, ...newArtifactIds, ...source.payload.sourceArtifactIds])].slice(0, 50)
    const successorPayload = routeSetPayloadSchema.parse({
      ...successorWithoutVerification,
      sourceArtifactIds,
      verification,
      warnings: routeWarnings
    })
    assertCurrent(context, signal)
    const id = uuidv7()
    const stored = await saveWorkspaceArtifact(scope, {
      id, sourceArtifactIds,
      type: 'route_set', schemaVersion: 1, payload: successorPayload, verification
    })
    assertCurrent(context, signal)
    return {
      artifact: { id: stored.id, type: 'route_set', schemaVersion: 1 },
      summary: {
        pathId: input.pathId,
        confirmed: confirmedCount,
        failed: failedCount,
        unconfirmed: unconfirmedCount,
        ...(updatedPath.totalFare === undefined ? {} : { totalFare: updatedPath.totalFare }),
        verificationStatus: verification.status
      },
      warnings: routeWarnings
    }
  }
}
