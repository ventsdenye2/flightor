import { locationRefsOverlap, type LocationRef, type VerificationRecord } from '../aviation/types.js'
import type { AviationProvider } from '../aviation/providers/provider.js'
import { connectionSearchInputSchema, connectionSearchResultSchema, type ConnectionEdge,
  type ConnectionSearchInput, type ConnectionSearchResult, type ConnectionSearchService,
  type RouteServiceContext } from './types.js'

export const BUDGET_CONNECTION_LIMITS = Object.freeze({
  hubs: 3, departureDates: 2, fareCalls: 14, candidateEdges: 100, topologyEdges: 30, airportLookups: 3,
  baselineEdgesPerDate: 20, leafEdgesPerDate: 8,
})

export type BudgetConnectionMetrics = Readonly<{
  fareCalls: number
  cacheHits: number
  hubCandidates: number
  selectedHubs: string[]
  departureDates: string[]
  candidateEdges: number
  invalidQuoteRejections: number
  missingBindingRejections: number
  truncated: boolean
}>

const DAY = 86_400_000
const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10)
const locationKey = (location: LocationRef) => location.iata ?? location.id
const overlaps = (a: LocationRef, b: LocationRef) => locationRefsOverlap(a, b)
const isExcluded = (location: LocationRef, input: ConnectionSearchInput) =>
  input.excludedLocations.some(excluded => overlaps(location, excluded))

function dates(input: ConnectionSearchInput): string[] {
  return input.window.from === input.window.to ? [input.window.from] : [input.window.from, input.window.to]
}

function hubLocations(options: readonly LocationRef[], input: ConnectionSearchInput): LocationRef[] {
  const seen = new Set<string>()
  return options.filter(location => {
    const key = locationKey(location)
    if (!location.iata || seen.has(key) || overlaps(location, input.origin) || overlaps(location, input.destination) || isExcluded(location, input)) return false
    seen.add(key)
    return true
  })
}

function aggregateVerification(edges: readonly ConnectionEdge[], fallback: VerificationRecord): VerificationRecord {
  if (!edges.length) return fallback
  const records = edges.map(edge => edge.verification)
  return {
    status: records.every(record => record.status === 'verified') ? 'verified' : 'partially_verified',
    checkedAt: records.map(record => record.checkedAt).sort()[0]!,
    confidence: Math.min(...records.map(record => record.confidence)),
    sources: records.flatMap(record => record.sources)
      .filter((source, index, all) => all.findIndex(other => other.provider === source.provider && other.reference === source.reference) === index)
      .slice(0, 20),
  }
}

/** Selects fare-eligible OD/date queries; the existing planner judges transfer
 * feasibility and constructs path totals from the immutable offer bindings. */
export class BoundedBudgetConnectionSearch implements ConnectionSearchService {
  private readonly metrics = new WeakMap<ConnectionSearchResult, BudgetConnectionMetrics>()

  constructor(private readonly dependencies: { live: ConnectionSearchService; topology: ConnectionSearchService;
    aviation?: Pick<AviationProvider, 'resolveLocation' | 'getAirport'>; knownHubIata?: readonly string[] }) {}

  metricsFor(result: ConnectionSearchResult): BudgetConnectionMetrics | undefined { return this.metrics.get(result) }

  async search(rawInput: ConnectionSearchInput, context: RouteServiceContext = {}): Promise<ConnectionSearchResult> {
    const input = connectionSearchInputSchema.parse(rawInput)
    const departureDates = dates(input)
    const warnings: string[] = []
    const allEdges: ConnectionEdge[] = []
    const cache = new Map<string, Promise<ConnectionSearchResult>>()
    let fareCalls = 0, cacheHits = 0, invalidQuoteRejections = 0, missingBindingRejections = 0
    let truncated = departureDates.length < 1 + (Date.parse(input.window.to) - Date.parse(input.window.from)) / DAY
    const check = async () => { await context.checkpoint?.(); context.signal?.throwIfAborted() }
    const query = async (origin: LocationRef, destination: LocationRef, date: string, maxCandidates: number): Promise<ConnectionSearchResult> => {
      const key = `${locationKey(origin)}|${locationKey(destination)}|${date}`
      const prior = cache.get(key)
      if (prior) { cacheHits++; return prior }
      if (fareCalls >= BUDGET_CONNECTION_LIMITS.fareCalls) throw new Error('BOUNDED_FARE_CALL_LIMIT')
      await check()
      fareCalls++
      const promise = this.dependencies.live.search({ ...input, origin, destination, window: { from: date, to: date },
        preferredLocations: [], maxCandidates }, context)
      cache.set(key, promise)
      return promise
    }
    const include = (result: ConnectionSearchResult, origin: LocationRef, destination: LocationRef, date: string): ConnectionEdge[] => {
      const accepted: ConnectionEdge[] = []
      for (const edge of result.edges) {
        if (edge.from.iata !== origin.iata || edge.to.iata !== destination.iata || edge.departureDate !== date) { invalidQuoteRejections++; continue }
        if ([edge.from, edge.to, ...(edge.segments?.flatMap(segment => [segment.from, segment.to]) ?? [])]
          .some(location => isExcluded(location, input))) { invalidQuoteRejections++; continue }
        if (!edge.fare || !edge.fareArtifactId || !edge.fareOfferId) { missingBindingRejections++; continue }
        allEdges.push(edge)
        accepted.push(edge)
      }
      warnings.push(...result.warnings)
      truncated ||= result.truncated
      return accepted
    }

    let firstFailure: unknown
    for (const date of departureDates) {
      try { include(await query(input.origin, input.destination, date, BUDGET_CONNECTION_LIMITS.baselineEdgesPerDate), input.origin, input.destination, date) }
      catch (error) { await check(); firstFailure ??= error; warnings.push(`Live fare search failed for ${date}.`) }
    }

    let topology: ConnectionSearchResult | undefined
    if (input.acceptsSelfTransfer) {
      try {
        await check()
        topology = await this.dependencies.topology.search({ ...input, maxCandidates: BUDGET_CONNECTION_LIMITS.topologyEdges }, context)
      } catch (error) { await check(); warnings.push('Topology hub candidates are unavailable.') }
    }
    const hubOptions: LocationRef[] = []
    let airportLookupsUsed = 0
    if (input.acceptsSelfTransfer) {
      for (const preferred of input.preferredLocations.slice(0, BUDGET_CONNECTION_LIMITS.airportLookups)) {
        if (preferred.type === 'airport' && preferred.iata) { hubOptions.push(preferred); continue }
        if (!this.dependencies.aviation || airportLookupsUsed >= BUDGET_CONNECTION_LIMITS.airportLookups) continue
        try {
          await check()
          airportLookupsUsed++
          const resolved = await this.dependencies.aviation.resolveLocation({ query: preferred.name, types: ['airport'], limit: 3 }, context)
          await check()
          hubOptions.push(...resolved.matches.filter(match => match.type === 'airport' && !!match.iata
            && (!preferred.cityCode || !match.cityCode || match.cityCode === preferred.cityCode)))
        } catch (error) { await check(); warnings.push('A preferred city could not be resolved to an airport.') }
      }
      hubOptions.push(...(topology?.edges ?? []).flatMap(edge => [edge.from, edge.to, ...(edge.segments?.flatMap(segment => [segment.from, segment.to]) ?? [])]))
      if (hubLocations(hubOptions, input).length < BUDGET_CONNECTION_LIMITS.hubs && this.dependencies.aviation) {
        for (const iata of (this.dependencies.knownHubIata ?? []).slice(0, BUDGET_CONNECTION_LIMITS.airportLookups)) {
          if (airportLookupsUsed >= BUDGET_CONNECTION_LIMITS.airportLookups) break
          if (!/^[A-Z]{3}$/.test(iata)) continue
          try {
            await check()
            airportLookupsUsed++
            const airport = await this.dependencies.aviation.getAirport({ iata }, context)
            await check()
            if (airport?.type === 'airport' && airport.iata === iata) hubOptions.push(airport)
          } catch (error) { await check(); warnings.push('A configured hub could not be confirmed as an airport.') }
        }
      }
    }
    const candidates = input.acceptsSelfTransfer ? hubLocations(hubOptions, input) : []
    const hubs = candidates.slice(0, BUDGET_CONNECTION_LIMITS.hubs)
    truncated ||= candidates.length > hubs.length
    for (const hub of hubs) {
      const firstLegEdges: ConnectionEdge[] = []
      for (const date of departureDates) {
        try {
          const result = await query(input.origin, hub, date, BUDGET_CONNECTION_LIMITS.leafEdgesPerDate)
          firstLegEdges.push(...include(result, input.origin, hub, date))
        } catch (error) { await check(); firstFailure ??= error; warnings.push(`First-leg fare search failed for ${date}.`) }
      }
      const onwardDates = [...new Set(firstLegEdges.map(edge => edge.arrivalDate ?? edge.arrivalAt?.slice(0, 10) ?? edge.departureDate))]
        .sort().slice(0, BUDGET_CONNECTION_LIMITS.departureDates)
      if (input.acceptsLongStopover && onwardDates.length === 1) onwardDates.push(nextDate(onwardDates[0]!))
      for (const date of onwardDates.slice(0, BUDGET_CONNECTION_LIMITS.departureDates)) {
        try { include(await query(hub, input.destination, date, BUDGET_CONNECTION_LIMITS.leafEdgesPerDate), hub, input.destination, date) }
        catch (error) { await check(); firstFailure ??= error; warnings.push(`Onward fare search failed for ${date}.`) }
      }
    }
    await check()
    if (!allEdges.length && firstFailure) throw firstFailure
    const uniqueEdges = [...new Map(allEdges.map(edge => [edge.id, edge])).values()]
    const limit = Math.min(input.maxCandidates, BUDGET_CONNECTION_LIMITS.candidateEdges)
    truncated ||= uniqueEdges.length > limit
    const edges = uniqueEdges.slice(0, limit)
    const fallback = topology?.verification ?? {
      status: 'unverified' as const, checkedAt: new Date().toISOString(), confidence: 0,
      sources: [{ provider: 'bounded-budget-connection-search' }],
    }
    const result = connectionSearchResultSchema.parse({
      edges, serviceVersion: 'bounded-budget-connections-v1',
      ...(topology?.topologyVersion ? { topologyVersion: topology.topologyVersion } : {}),
      coverageStatus: edges.length ? 'reachable' : 'unknown',
      verification: aggregateVerification(edges, fallback),
      warnings: [...new Set(warnings)].slice(0, 50), truncated, exhausted: !truncated,
    })
    this.metrics.set(result, Object.freeze({ fareCalls, cacheHits, hubCandidates: candidates.length,
      selectedHubs: hubs.map(locationKey), departureDates, candidateEdges: edges.length,
      invalidQuoteRejections, missingBindingRejections, truncated }))
    return result
  }
}
