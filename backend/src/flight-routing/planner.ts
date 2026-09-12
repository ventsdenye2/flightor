import { createHash } from 'node:crypto'
import { locationRefKey, locationRefsOverlap, type LocationRef } from '../aviation/types.js'
import { connectionMinimumMinutes, edgeHasAirportChange, edgeLocations, internalTransfers, joinsSeparateOffers, LONG_STOPOVER_MINUTES, pathDurationMinutes, pathHasSelfTransfer, pathTransferCount } from './itinerary.js'
import {
  connectionEdgeSchema,
  flightRoutePlanInputSchema,
  flightRoutePlanResultSchema,
  type ConnectionEdge,
  type CompleteFlightPath,
  type FlightRoutePlanInput,
  type FlightRoutePlanResult,
  type RouteNode,
  type RouteConstraints
} from './types.js'

/** Stable, provider-independent version identifiers for Phase 4 artifacts. */
export const FLIGHT_ROUTE_PLANNER_SERVICE_VERSION = 'flight-route-planner-phase4-v1'

const MAX_EXPANDED_STATES = 10000

function locationKey(value: LocationRef): string {
  // IATA is the graph identity when available.  The complete canonical value
  // is retained as a fallback for city-only references.
  return value.iata ?? value.cityCode ?? locationRefKey(value)
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return locationRefsOverlap(left, right)
}

function uniqueStrings(values: readonly string[], max = 50): string[] {
  return [...new Set(values.filter(Boolean))].sort().slice(0, max)
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY
  return Math.floor((end - start) / 86_400_000) + 1
}

function edgeSortKey(edge: ConnectionEdge): string {
  return [edge.from.iata ?? edge.from.id, edge.to.iata ?? edge.to.id, edge.departureDate, edge.departureAt ?? '', edge.id].join('|')
}

function aggregateVerification(edges: readonly ConnectionEdge[]) {
  const rank = { verified: 0, partially_verified: 1, stale: 2, unverified: 3 } as const
  const worst = edges.reduce((value, edge) => {
    const edgeStatus = edge.availability === 'unknown'
      ? 'unverified'
      : edge.availability === 'partial'
        ? 'partially_verified'
        : edge.verification.status
    return rank[edgeStatus] > rank[value] ? edgeStatus : value
  }, 'verified' as keyof typeof rank)
  const checkedAt = [...edges].map(edge => edge.verification.checkedAt).sort()[0] ?? '1970-01-01T00:00:00.000Z'
  const confidence = edges.reduce((value, edge) => Math.min(value, edge.verification.confidence), 1)
  const sources = new Map<string, { provider: string; reference?: string }>()
  for (const edge of edges) {
    for (const source of edge.verification.sources) {
      const key = `${source.provider}|${source.reference ?? ''}`
      if (!sources.has(key)) {
        sources.set(key, source.reference === undefined ? { provider: source.provider } : { provider: source.provider, reference: source.reference })
      }
    }
  }
  return { status: worst, checkedAt, confidence, sources: [...sources.values()].sort((a, b) => `${a.provider}|${a.reference ?? ''}`.localeCompare(`${b.provider}|${b.reference ?? ''}`)).slice(0, 20) }
}

function edgeHardReason(edge: ConnectionEdge, constraints: RouteConstraints): string | undefined {
  if (edge.transferType === 'self' && !constraints.allowSelfTransfer) return 'self-transfer is not allowed'
  if (edgeHasAirportChange(edge) && !constraints.allowAirportChange) return 'airport change is not allowed'
  const edgeMinimum = connectionMinimumMinutes(edge.transferType === 'self', edgeHasAirportChange(edge), constraints.minTransferMinutes, constraints)
  if (edge.transferMinutes !== undefined && edge.transferMinutes > 0 && edge.transferMinutes < edgeMinimum) return 'minimum transfer time is not met'
  if (edge.transferMinutes !== undefined && edge.transferMinutes > LONG_STOPOVER_MINUTES && !constraints.allowLongStopover) return 'long stopover is not allowed'
  for (const transfer of internalTransfers(edge)) {
    const minimum = connectionMinimumMinutes(edge.transferType === 'self', transfer.arrivalAirport.iata !== transfer.departureAirport.iata, constraints.minTransferMinutes, constraints)
    if (transfer.durationMinutes !== undefined && transfer.durationMinutes < minimum) return 'minimum internal transfer time is not met'
    if (transfer.durationMinutes !== undefined && transfer.durationMinutes > LONG_STOPOVER_MINUTES && !constraints.allowLongStopover) return 'long internal stopover is not allowed'
  }
  return undefined
}

function pathFeasibility(edges: readonly ConnectionEdge[]): CompleteFlightPath['feasibility'] {
  if (edges.some(edge => edge.availability === 'unknown' || edge.verification.status === 'unverified')) return 'unknown'
  if (edges.some((edge, index) => index > 0 && edge.transferMinutes === undefined && !(edges[index - 1]!.arrivalAt !== undefined && edge.departureAt !== undefined))) return 'partial'
  if (edges.some(edge => internalTransfers(edge).some(transfer => transfer.durationMinutes === undefined)
    || (edge.transferType === 'airline' && edge.protectedConnection === undefined))) return 'partial'
  if (edges.some((edge, index) => index > 0 && joinsSeparateOffers(edges[index - 1]!, edge))) return 'partial'
  if (edges.some(edge => edge.availability === 'partial' || edge.verification.status !== 'verified')) return 'partial'
  return 'feasible'
}

function makePath(edges: readonly ConnectionEdge[], origin: RouteNode, destination: RouteNode, constraints: RouteConstraints): CompleteFlightPath {
  const locations: LocationRef[] = [origin.location]
  for (const edge of edges) locations.push(edge.to)
  const nodes = locations.map((location, index): RouteNode => {
    if (index === 0) return { location, role: 'origin' }
    if (index === locations.length - 1) return { location, role: 'destination' }
    const required = constraints.requiredLocations.some(value => sameLocation(value, location))
    return { location, role: required ? 'visit' : 'stopover' }
  })
  const fareCurrencies = [...new Set(edges.map(edge => edge.fare?.currency).filter((value): value is string => value !== undefined))]
  const allPriced = edges.every(edge => edge.fare !== undefined)
  const allFaresStronglyBound = allPriced && edges.every(edge => edge.fareArtifactId !== undefined && edge.fareOfferId !== undefined)
  const totalFare = allFaresStronglyBound && fareCurrencies.length === 1
    ? { amount: edges.reduce((total, edge) => total + (edge.fare?.amount ?? 0), 0), currency: fareCurrencies[0]! }
    : undefined
  const totalDurationMinutes = pathDurationMinutes(edges)
  const warnings = uniqueStrings([
    ...edges.flatMap(edge => [...edge.warnings, ...edge.reasons]),
    ...(edges.some(edge => edge.availability === 'unknown') ? ['One or more route edges have unknown availability.'] : []),
    ...(edges.some((edge, index) => index > 0 && edge.transferMinutes === undefined && !(edges[index - 1]!.arrivalAt !== undefined && edge.departureAt !== undefined)) ? ['One or more connection times are unknown.'] : []),
    ...(edges.some(edge => internalTransfers(edge).some(transfer => transfer.durationMinutes === undefined)) ? ['One or more internal connection times are unknown.'] : []),
    ...(pathHasSelfTransfer(edges) ? ['This path includes a self-transfer or joins independently quoted offers; through-ticket protection is not established.'] : []),
    ...(!allPriced ? ['Total fare is unavailable because one or more edges are unpriced.'] : []),
    ...(allPriced && !allFaresStronglyBound ? ['Total fare is unavailable because one or more edge quotes lack an immutable fare artifact binding.'] : []),
    ...(allPriced && fareCurrencies.length !== 1 ? ['Total fare is unavailable because edge currencies differ.'] : [])
  ], 50)
  const descriptiveId = `path:${edges.map(edge => edge.id).join('>')}`
  const path: CompleteFlightPath = {
    id: descriptiveId.length <= 160 ? descriptiveId : `path:${createHash('sha256').update(descriptiveId).digest('hex')}`,
    nodes,
    edges: [...edges],
    ...(totalFare === undefined ? {} : { totalFare }),
    ...(totalDurationMinutes === undefined || !Number.isFinite(totalDurationMinutes) ? {} : { totalDurationMinutes }),
    transferCount: pathTransferCount(edges),
    feasibility: pathFeasibility(edges),
    warnings
  }
  // The destination argument is intentionally read here: it prevents callers
  // from accidentally constructing a path with a different terminal node.
  if (!sameLocation(nodes[nodes.length - 1]!.location, destination.location)) throw new Error('Planner produced a path with an incorrect destination')
  return path
}

function parseInput(input: FlightRoutePlanInput): FlightRoutePlanInput {
  return flightRoutePlanInputSchema.parse(input)
}

export class DeterministicFlightRoutePlanner {
  async plan(input: FlightRoutePlanInput, context?: { signal?: AbortSignal }): Promise<FlightRoutePlanResult> {
    const normalized = parseInput(input)
    if (context?.signal?.aborted) throw new Error('Route planning aborted')
    const origin = normalized.nodes.find(node => node.role === 'origin') ?? normalized.nodes[0]!
    const destination = [...normalized.nodes].reverse().find(node => node.role === 'destination') ?? normalized.nodes[normalized.nodes.length - 1]!
    const constraints = normalized.constraints
    const originKey = locationKey(origin.location)
    const destinationKey = locationKey(destination.location)
    const excluded = constraints.excludedLocations
    const required = constraints.requiredLocations
    const inputEndpointsExcluded = excluded.some(location => sameLocation(location, origin.location) || sameLocation(location, destination.location))
    const adjacency = new Map<string, ConnectionEdge[]>()
    for (const rawEdge of normalized.edges) {
      const edge = connectionEdgeSchema.parse(rawEdge)
      const key = locationKey(edge.from)
      const current = adjacency.get(key) ?? []
      current.push(edge)
      adjacency.set(key, current)
    }
    for (const values of adjacency.values()) values.sort((a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b)))

    const paths: CompleteFlightPath[] = []
    let truncated = false
    let exhausted = true
    let foundExtraPath = false
    let expandedStates = 0
    const visited = new Set<string>([originKey])
    const edgeStack: ConnectionEdge[] = []

    const canUseEdge = (edge: ConnectionEdge): boolean => {
      // This is the departure window, not an arrival deadline. Overnight
      // arrivals and onward connections may occur after its last date.
      if (edgeStack.length === 0 && (edge.departureDate < normalized.window.from || edge.departureDate > normalized.window.to)) return false
      if (excluded.some(location => edgeLocations(edge).some(candidate => sameLocation(location, candidate)))) return false
      if (edgeHardReason(edge, constraints) !== undefined) return false
      const transferCount = pathTransferCount([...edgeStack, edge])
      if (transferCount > constraints.maxTransfers) return false
      if (constraints.maxStops !== undefined && transferCount > constraints.maxStops) return false
      const previous = edgeStack[edgeStack.length - 1]
      if (previous !== undefined) {
        if (joinsSeparateOffers(previous, edge) && !constraints.allowSelfTransfer) return false
        if (previous.arrivalAt !== undefined && edge.departureAt !== undefined && Date.parse(edge.departureAt) < Date.parse(previous.arrivalAt)) return false
        if (edge.departureDate < (previous.arrivalDate ?? previous.departureDate)) return false
        const knownGapMinutes = previous.arrivalAt !== undefined && edge.departureAt !== undefined
          ? Math.round((Date.parse(edge.departureAt) - Date.parse(previous.arrivalAt)) / 60_000)
          : undefined
        const connectionMinutes = knownGapMinutes ?? edge.transferMinutes
        const minimum = connectionMinimumMinutes(edge.transferType === 'self' || joinsSeparateOffers(previous, edge),
          previous.to.iata !== edge.from.iata || (edge.segments?.length ?? 1) === 1 && edge.airportChange === true,
          constraints.minTransferMinutes, constraints)
        if (connectionMinutes !== undefined && connectionMinutes > 0 && connectionMinutes < minimum) return false
        if (connectionMinutes !== undefined && connectionMinutes > LONG_STOPOVER_MINUTES && !constraints.allowLongStopover) return false
        if (connectionMinutes === undefined && constraints.minTransferMinutes > 0) {
          // An unknown MCT is not rejected; it is retained as a conservative
          // partial path and called out in its warning metadata.
        }
      }
      const nextKey = locationKey(edge.to)
      if (visited.has(nextKey)) return false
      if (constraints.maxTravelDays !== undefined) {
        const endDate = edge.arrivalDate ?? edge.departureDate
        const startDate = edgeStack[0]?.departureDate ?? edge.departureDate
        if (daysBetween(startDate, endDate) > constraints.maxTravelDays) return false
      }
      return true
    }

    const visit = (currentKey: string): void => {
      if (context?.signal?.aborted) throw new Error('Route planning aborted')
      if (expandedStates >= MAX_EXPANDED_STATES) {
        truncated = true
        exhausted = false
        return
      }
      expandedStates++
      if (foundExtraPath) return
      for (const edge of adjacency.get(currentKey) ?? []) {
        if (!canUseEdge(edge)) continue
        const nextKey = locationKey(edge.to)
        visited.add(nextKey)
        edgeStack.push(edge)
        if (nextKey === destinationKey) {
          const visitedLocations = [origin.location, ...edgeStack.map(value => value.to)]
          const hasRequired = required.every(value => visitedLocations.some(location => sameLocation(value, location)))
          const totalDays = daysBetween(edgeStack[0]!.departureDate, edge.arrivalDate ?? edge.departureDate)
          const duration = pathDurationMinutes(edgeStack)
          if (hasRequired && (constraints.maxTravelDays === undefined || totalDays <= constraints.maxTravelDays) && (constraints.maxTotalDurationMinutes === undefined || (duration !== undefined && duration <= constraints.maxTotalDurationMinutes))) {
            if (paths.length < normalized.maxPaths) paths.push(makePath(edgeStack, origin, destination, constraints))
            else {
              foundExtraPath = true
              truncated = true
              exhausted = false
            }
          }
        } else {
          visit(nextKey)
        }
        edgeStack.pop()
        visited.delete(nextKey)
        if (foundExtraPath || expandedStates >= MAX_EXPANDED_STATES) break
      }
    }

    if (!inputEndpointsExcluded) visit(originKey)
    const edgeWarnings = normalized.edges.filter(edge => edge.availability !== 'verified' || edge.verification.status !== 'verified').map(edge => `Edge ${edge.id} has partial or unknown verification.`)
    const warnings = uniqueStrings([
      ...edgeWarnings,
      ...(inputEndpointsExcluded ? ['Origin or destination is excluded.'] : []),
      ...(truncated ? ['Planner bounds were reached before all candidates were examined.'] : [])
    ])
    const verification = aggregateVerification(normalized.edges)
    const result = {
      paths,
      serviceVersion: FLIGHT_ROUTE_PLANNER_SERVICE_VERSION,
      verification,
      warnings,
      truncated,
      exhausted
    }
    return flightRoutePlanResultSchema.parse(result)
  }
}

export function createFlightRoutePlanner(): DeterministicFlightRoutePlanner {
  return new DeterministicFlightRoutePlanner()
}
