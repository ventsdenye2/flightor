import { locationRefKey, locationRefsOverlap, type LocationRef } from '../aviation/types.js'
import { edgeHasAirportChange, internalTransfers, pathHasSelfTransfer, pathTransferCount } from './itinerary.js'
import {
  routeOptimizationInputSchema,
  routeOptimizationResultSchema,
  type CompleteFlightPath,
  type RouteOptimizationInput,
  type RouteOptimizationResult,
  type RouteScore,
  type RouteWeights,
  type ScoredPath
} from './types.js'

export const ROUTE_OPTIMIZER_SERVICE_VERSION = 'route-optimizer-phase4-v1'
export const ROUTE_OPTIMIZER_ALGORITHM_VERSION = 'pareto-route-optimizer-v1'

const positiveDimensions = ['airfareSaving', 'preferredCityMatch', 'interestMatch', 'eventMatch', 'seasonMatch', 'stopoverPlayability', 'additionalCityValue', 'routeNovelty'] as const
const negativeDimensions = ['totalTravelTime', 'transferCount', 'selfTransferRisk', 'airportChangePenalty', 'backtrackingPenalty', 'deadTimePenalty', 'excessiveComplexity'] as const
type Dimension = typeof positiveDimensions[number] | typeof negativeDimensions[number]

const defaultWeights: Record<Dimension, number> = {
  airfareSaving: 0.15, preferredCityMatch: 0.15, interestMatch: 0.15, eventMatch: 0.05,
  seasonMatch: 0.05, stopoverPlayability: 0.10, additionalCityValue: 0.10, routeNovelty: 0.05,
  totalTravelTime: 0.10, transferCount: 0.10, selfTransferRisk: 0.10,
  airportChangePenalty: 0.10, backtrackingPenalty: 0.05, deadTimePenalty: 0.05, excessiveComplexity: 0.10
}
const PLAYABLE_STOPOVER_MINUTES = 10 * 60
const STRONG_STOPOVER_MINUTES = 18 * 60

function locationKey(value: LocationRef): string {
  return value.iata ?? value.cityCode ?? locationRefKey(value)
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return locationRefsOverlap(left, right)
}

function uniqueStrings(values: readonly string[], max = 50): string[] {
  return [...new Set(values.filter(Boolean))].sort().slice(0, max)
}

function aggregateVerification(paths: readonly CompleteFlightPath[]) {
  const rank = { verified: 0, partially_verified: 1, stale: 2, unverified: 3 } as const
  const edgeVerifications = paths.flatMap(path => path.edges.map(edge => ({ verification: edge.verification, availability: edge.availability, feasibility: path.feasibility })))
  const worst = edgeVerifications.reduce((value, current) => {
    const currentStatus = current.availability === 'unknown' || current.feasibility === 'unknown'
      ? 'unverified'
      : current.availability === 'partial' || current.feasibility === 'partial'
        ? 'partially_verified'
        : current.verification.status
    return rank[currentStatus] > rank[value] ? currentStatus : value
  }, 'verified' as keyof typeof rank)
  const checkedAt = edgeVerifications.map(value => value.verification.checkedAt).sort()[0] ?? '1970-01-01T00:00:00.000Z'
  const confidence = edgeVerifications.reduce((value, current) => Math.min(value, current.verification.confidence), 1)
  const sources = new Map<string, { provider: string; reference?: string }>()
  for (const { verification } of edgeVerifications) for (const source of verification.sources) {
    const key = `${source.provider}|${source.reference ?? ''}`
    if (!sources.has(key)) sources.set(key, source.reference === undefined ? { provider: source.provider } : { provider: source.provider, reference: source.reference })
  }
  return { status: worst, checkedAt, confidence, sources: [...sources.values()].sort((a, b) => `${a.provider}|${a.reference ?? ''}`.localeCompare(`${b.provider}|${b.reference ?? ''}`)).slice(0, 20) }
}

function hardValidate(path: CompleteFlightPath): boolean {
  if (path.feasibility === 'unknown' || path.edges.length !== path.nodes.length - 1 || path.transferCount !== pathTransferCount(path.edges)) return false
  if (path.nodes[0]!.role !== 'origin' || path.nodes[path.nodes.length - 1]!.role !== 'destination') return false
  const visited = new Set<string>()
  for (let index = 0; index < path.nodes.length; index++) {
    const node = path.nodes[index]!
    const key = locationKey(node.location)
    if (visited.has(key)) return false
    visited.add(key)
    const edge = path.edges[index]
    if (edge !== undefined && (!sameLocation(edge.from, node.location) || !sameLocation(edge.to, path.nodes[index + 1]!.location))) return false
    if (index > 0) {
      const previous = path.edges[index - 1]!
      if (edge !== undefined && edge.departureDate < (previous.arrivalDate ?? previous.departureDate)) return false
      if (previous.arrivalAt !== undefined && edge?.departureAt !== undefined && Date.parse(edge.departureAt) < Date.parse(previous.arrivalAt)) return false
    }
  }
  const currencies = [...new Set(path.edges.map(edge => edge.fare?.currency).filter((value): value is string => value !== undefined))]
  if (path.totalFare !== undefined && (currencies.length !== 1 || path.edges.some(edge => edge.fare === undefined) || path.totalFare.currency !== currencies[0])) return false
  return true
}

function pathIntermediateLocations(path: CompleteFlightPath): LocationRef[] {
  return path.nodes.slice(1, -1).map(node => node.location)
}

function fareValues(paths: readonly CompleteFlightPath[]): { min: number; max: number; currency?: string; comparable: boolean } {
  const fares = paths.map(path => path.totalFare).filter((fare): fare is NonNullable<CompleteFlightPath['totalFare']> => fare !== undefined)
  const currencies = [...new Set(fares.map(fare => fare.currency))]
  if (fares.length === 0 || currencies.length !== 1) return { min: 0, max: 0, comparable: false }
  const amounts = fares.map(fare => fare.amount)
  return { min: Math.min(...amounts), max: Math.max(...amounts), currency: currencies[0]!, comparable: true }
}

function durationValues(paths: readonly CompleteFlightPath[]): number {
  return Math.max(0, ...paths.map(path => path.totalDurationMinutes ?? 0))
}

function normalizedFare(path: CompleteFlightPath, fares: ReturnType<typeof fareValues>): number {
  if (!fares.comparable || path.totalFare === undefined || path.totalFare.currency !== fares.currency) return 0
  if (fares.max === fares.min) return 1
  return Math.max(0, Math.min(1, (fares.max - path.totalFare.amount) / (fares.max - fares.min)))
}

function scorePath(path: CompleteFlightPath, allPaths: readonly CompleteFlightPath[], preferred: readonly LocationRef[], interests: readonly LocationRef[]): { values: Record<Dimension, number>; unknown: boolean } {
  const intermediate = pathIntermediateLocations(path)
  const fares = fareValues(allPaths)
  const maxDuration = durationValues(allPaths)
  const maxTransfers = Math.max(1, ...allPaths.map(candidate => candidate.transferCount))
  const preferredCount = intermediate.filter(location => preferred.some(value => sameLocation(value, location))).length
  const interestCount = intermediate.filter(location => interests.some(value => sameLocation(value, location))).length
  const knownTransfers = path.edges.filter(edge => edge.transferMinutes !== undefined)
  const internalConnections = path.edges.flatMap(internalTransfers)
  const playableStopovers = knownTransfers.filter(edge => (edge.transferMinutes ?? 0) >= PLAYABLE_STOPOVER_MINUTES).length
  const unknownAvailability = path.edges.some(edge => edge.availability === 'unknown' || edge.verification.status === 'unverified')
  const unknownDuration = path.totalDurationMinutes === undefined
  const unknownTransfer = (path.edges.some(edge => edge.transferMinutes === undefined) && path.edges.length > 1)
    || internalConnections.some(transfer => transfer.durationMinutes === undefined)
  const unknownProtection = path.edges.some(edge => edge.transferType === 'airline' && edge.protectedConnection === undefined)
  const coords = path.nodes.map(node => [node.location.latitude, node.location.longitude] as const)
  let reverseSegments = 0
  for (let index = 2; index < coords.length; index++) {
    const [aLat, aLon] = coords[index - 2]!, [bLat, bLon] = coords[index - 1]!, [cLat, cLon] = coords[index]!
    if ([aLat, aLon, bLat, bLon, cLat, cLon].every(value => value !== undefined)) {
      const firstLat = bLat! - aLat!, firstLon = bLon! - aLon!, secondLat = cLat! - bLat!, secondLon = cLon! - bLon!
      if (firstLat * secondLat + firstLon * secondLon < 0) reverseSegments++
    }
  }
  const values: Record<Dimension, number> = {
    airfareSaving: normalizedFare(path, fares),
    preferredCityMatch: intermediate.length === 0 ? 0 : preferredCount / intermediate.length,
    interestMatch: intermediate.length === 0 ? 0 : interestCount / intermediate.length,
    eventMatch: 0,
    seasonMatch: 0,
    stopoverPlayability: playableStopovers === 0
      ? 0
      : Math.min(1, knownTransfers.reduce((sum, edge) => {
        const minutes = edge.transferMinutes ?? 0
        if (minutes < PLAYABLE_STOPOVER_MINUTES) return sum
        return sum + (minutes >= STRONG_STOPOVER_MINUTES ? 1 : 0.6)
      }, 0) / Math.max(1, path.edges.length - 1)),
    additionalCityValue: Math.min(1, intermediate.length / 3),
    routeNovelty: intermediate.length === 0 ? 0 : new Set(intermediate.map(locationKey)).size / intermediate.length,
    totalTravelTime: unknownDuration ? 1 : maxDuration === 0 ? 0 : Math.min(1, (path.totalDurationMinutes ?? maxDuration) / maxDuration),
    transferCount: Math.min(1, path.transferCount / maxTransfers),
    selfTransferRisk: pathHasSelfTransfer(path.edges) ? 1 : unknownAvailability || unknownProtection ? 0.5 : 0,
    airportChangePenalty: path.edges.some(edgeHasAirportChange) ? 1 : unknownAvailability ? 0.5 : 0,
    backtrackingPenalty: coords.every(value => value[0] !== undefined && value[1] !== undefined)
      ? Math.min(1, reverseSegments / Math.max(1, coords.length - 2))
      : path.nodes.length > 2 ? 0.5 : 0,
    deadTimePenalty: unknownTransfer ? 0.5 : Math.min(1, Math.max(0,
      ...knownTransfers.map(edge => Math.max(0, (edge.transferMinutes ?? 0) - STRONG_STOPOVER_MINUTES)),
      ...internalConnections.map(transfer => Math.max(0, (transfer.durationMinutes ?? 0) - STRONG_STOPOVER_MINUTES))) / STRONG_STOPOVER_MINUTES),
    excessiveComplexity: Math.min(1, path.transferCount / 4) + (path.feasibility === 'partial' ? 0.05 : 0)
  }
  values.excessiveComplexity = Math.min(1, values.excessiveComplexity)
  return { values, unknown: unknownAvailability || unknownDuration || unknownTransfer || unknownProtection || !fares.comparable }
}

function effectiveWeights(weights: RouteWeights): Record<Dimension, number> {
  const raw: Record<Dimension, number> = { ...defaultWeights }
  for (const dimension of [...positiveDimensions, ...negativeDimensions] as Dimension[]) {
    const value = weights[dimension]
    if (value !== undefined) raw[dimension] = value
  }
  if (weights.complexity !== undefined && weights.excessiveComplexity === undefined) raw.excessiveComplexity = weights.complexity
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0)
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, total === 0 ? 0 : value / total])) as Record<Dimension, number>
}

function scoreAndExplain(path: CompleteFlightPath, values: Record<Dimension, number>, weights: Record<Dimension, number>, unknown: boolean): ScoredPath {
  const positive = positiveDimensions.reduce((sum, dimension) => sum + values[dimension] * weights[dimension], 0)
  const negative = negativeDimensions.reduce((sum, dimension) => sum + values[dimension] * weights[dimension], 0)
  const score: RouteScore = {
    ...values,
    complexity: values.excessiveComplexity,
    total: Math.max(-1, Math.min(1, positive - negative))
  }
  const reasons: Record<Dimension, string> = {
    airfareSaving: 'Compared with priced candidates in the same currency.', preferredCityMatch: 'Matches preferred intermediate locations.', interestMatch: 'Matches interest intermediate locations.', eventMatch: 'No event evidence was supplied.', seasonMatch: 'No seasonal evidence was supplied.', stopoverPlayability: 'Uses known playability-friendly stopover windows.', additionalCityValue: 'Adds distinct intermediate locations.', routeNovelty: 'Counts distinct intermediate locations.', totalTravelTime: 'Normalized against the longest known candidate.', transferCount: 'Normalized transfer count penalty.', selfTransferRisk: 'Self-transfer risk from edge policy facts.', airportChangePenalty: 'Airport-change penalty from edge facts.', backtrackingPenalty: 'Reverse geographic movement from known coordinates.', deadTimePenalty: 'Long or unknown connection-time penalty.', excessiveComplexity: 'Transfer and partial-feasibility complexity penalty.'
  }
  const breakdown = ([...positiveDimensions, ...negativeDimensions] as Dimension[]).map(dimension => ({
    dimension,
    value: values[dimension],
    weight: weights[dimension],
    contribution: positiveDimensions.includes(dimension as typeof positiveDimensions[number]) ? values[dimension] * weights[dimension] : -values[dimension] * weights[dimension],
    direction: positiveDimensions.includes(dimension as typeof positiveDimensions[number]) ? 'positive' as const : 'negative' as const,
    reason: reasons[dimension]
  }))
  const tradeoffs = negativeDimensions.filter(dimension => values[dimension] > 0).sort((a, b) => values[b] - values[a] || a.localeCompare(b)).slice(0, 5).map(dimension => `${dimension}=${values[dimension].toFixed(3)}`)
  const warnings = uniqueStrings([
    ...path.warnings,
    ...(unknown ? ['Some route facts are unknown; conservative score penalties were applied.'] : [])
  ])
  return { path, score, badges: [], explanation: { scoreBreakdown: breakdown, hardConstraintsSatisfied: ['Path structure and endpoints are valid.', 'No location cycle is present.', 'Path feasibility is feasible or partial.'], tradeoffs, warnings } }
}

function dominates(left: RouteScore, right: RouteScore): boolean {
  let strict = false
  for (const dimension of positiveDimensions) {
    if (left[dimension] < right[dimension]) return false
    if (left[dimension] > right[dimension]) strict = true
  }
  for (const dimension of negativeDimensions) {
    if (left[dimension] > right[dimension]) return false
    if (left[dimension] < right[dimension]) strict = true
  }
  return strict
}

function lexicalPathId(candidate: ScoredPath): string { return candidate.path.id }

export class ParetoRouteOptimizer {
  async optimize(input: RouteOptimizationInput): Promise<RouteOptimizationResult> {
    const normalized = routeOptimizationInputSchema.parse(input)
    const accepted: CompleteFlightPath[] = []
    let rejectedCandidateCount = 0
    for (const path of normalized.paths) {
      if (hardValidate(path)) accepted.push(path)
      else rejectedCandidateCount++
    }
    const weights = effectiveWeights(normalized.weights)
    const scored = accepted.map(path => {
      const result = scorePath(path, accepted, normalized.preferredLocations, normalized.interestLocations)
      return scoreAndExplain(path, result.values, weights, result.unknown)
    }).sort((left, right) => lexicalPathId(left).localeCompare(lexicalPathId(right)))
    const frontier = scored.filter(candidate => !scored.some(other => other !== candidate && dominates(other.score, candidate.score)))
    rejectedCandidateCount += scored.length - frontier.length
    const frontierSorted = [...frontier].sort((left, right) => lexicalPathId(left).localeCompare(lexicalPathId(right)))
    const choose = (compare: (left: ScoredPath, right: ScoredPath) => number): ScoredPath | undefined => frontierSorted.reduce<ScoredPath | undefined>((best, candidate) => best === undefined || compare(candidate, best) < 0 ? candidate : best, undefined)
    const cheapest = choose((left, right) => {
      const leftFare = left.path.totalFare?.amount ?? Number.POSITIVE_INFINITY
      const rightFare = right.path.totalFare?.amount ?? Number.POSITIVE_INFINITY
      return leftFare - rightFare || lexicalPathId(left).localeCompare(lexicalPathId(right))
    })
    const balanced = choose((left, right) => right.score.total - left.score.total || lexicalPathId(left).localeCompare(lexicalPathId(right)))
    const mostFun = choose((left, right) => {
      const leftValue = left.score.preferredCityMatch + left.score.interestMatch + left.score.eventMatch + left.score.seasonMatch + left.score.stopoverPlayability + left.score.additionalCityValue + left.score.routeNovelty - left.score.excessiveComplexity
      const rightValue = right.score.preferredCityMatch + right.score.interestMatch + right.score.eventMatch + right.score.seasonMatch + right.score.stopoverPlayability + right.score.additionalCityValue + right.score.routeNovelty - right.score.excessiveComplexity
      return rightValue - leftValue || lexicalPathId(left).localeCompare(lexicalPathId(right))
    })
    const bestMatch = choose((left, right) => {
      const leftValue = left.score.preferredCityMatch + left.score.interestMatch + left.score.eventMatch + left.score.seasonMatch
      const rightValue = right.score.preferredCityMatch + right.score.interestMatch + right.score.eventMatch + right.score.seasonMatch
      return rightValue - leftValue || lexicalPathId(left).localeCompare(lexicalPathId(right))
    })
    const badgeCandidates: Array<['cheapest' | 'balanced' | 'most_fun' | 'best_match', ScoredPath | undefined]> = [['cheapest', cheapest], ['balanced', balanced], ['most_fun', mostFun], ['best_match', bestMatch]]
    const representatives = new Map<string, ScoredPath>()
    let truncated = false
    for (const [badge, candidate] of badgeCandidates) {
      if (candidate === undefined) continue
      const existing = representatives.get(candidate.path.id)
      if (existing !== undefined) {
        if (!existing.badges.includes(badge)) existing.badges.push(badge)
      } else if (representatives.size < normalized.maxRepresentatives) {
        representatives.set(candidate.path.id, { ...candidate, badges: [badge] })
      } else {
        truncated = true
      }
    }
    const warnings = uniqueStrings([
      ...(normalized.paths.some(path => path.feasibility === 'unknown') ? ['Unknown-feasibility candidates were rejected before scoring.'] : []),
      ...(scored.some(candidate => candidate.explanation.warnings.length > 0) ? ['Some score dimensions used conservative unknown penalties.'] : []),
      ...(truncated ? ['Representative bound was reached.'] : [])
    ])
    const result = {
      representatives: [...representatives.values()],
      paretoFrontierCount: frontierSorted.length,
      rejectedCandidateCount,
      serviceVersion: ROUTE_OPTIMIZER_SERVICE_VERSION,
      algorithmVersion: ROUTE_OPTIMIZER_ALGORITHM_VERSION,
      verification: aggregateVerification(normalized.paths),
      warnings,
      truncated,
      exhausted: !truncated
    }
    return routeOptimizationResultSchema.parse(result)
  }
}

export function createRouteOptimizer(): ParetoRouteOptimizer {
  return new ParetoRouteOptimizer()
}
