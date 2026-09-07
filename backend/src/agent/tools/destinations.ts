import { z } from 'zod'
import { locationRefSchema } from '../../aviation/types.js'
import {
  destinationCandidateSchema,
  destinationDiscoveryResultSchema,
  destinationInterestSchema,
  destinationRegionSchema,
  type DestinationCandidate
} from '../../destinations/types.js'
import { resolveDestinationMentions } from '../../destinations/catalog.js'
import { destinationInputForTrip, destinationInterests } from '../../destinations/trip-input.js'
import {
  tripRoutePlanResultSchema
} from '../../trip-planning/types.js'
import { discoverTripDestinations, planTripDays } from '../../trip-planning/workspace.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'
import { recordResolvedLocations } from './resolved-locations.js'
import { workspaceScope } from './workspace-scope.js'

const artifactReferenceSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('destination_set'),
  schemaVersion: z.literal(1)
}).strict()

const routeArtifactReferenceSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('route'),
  schemaVersion: z.literal(1)
}).strict()

const topCandidateSchema = z.object({
  location: locationRefSchema,
  iata: z.string().regex(/^[A-Z]{3}$/).optional(),
  locationId: z.string().min(1).max(128),
  cityZh: z.string().min(1).max(160),
  cityEn: z.string().min(1).max(160),
  score: z.number().finite().min(0).max(1),
  accessibility: z.enum(['direct', 'unknown']),
  reasons: z.array(z.string().min(1).max(240)).max(12)
}).strict()

const topCitySchema = z.object({
  location: locationRefSchema,
  iata: z.string().regex(/^[A-Z]{3}$/).optional(),
  locationId: z.string().min(1).max(128),
  stayDays: z.number().int().min(1).max(60),
  role: z.literal('visit')
}).strict()

export const searchDestinationsInputSchema = z.object({
  regions: z.array(destinationRegionSchema).max(3).default([]),
  interests: z.array(destinationInterestSchema).max(5).default([]),
  limit: z.number().int().min(1).max(50).default(8)
}).strict()

export const recommendDestinationsInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(8)
}).strict()

export const planTripRouteInputSchema = z.object({
  candidateArtifactId: z.string().uuid(),
  maxCities: z.number().int().min(1).max(12).default(6)
}).strict()

const destinationSummarySchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  topCandidates: z.array(topCandidateSchema).max(5),
  verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified'])
}).strict()

export const searchDestinationsOutputSchema = z.object({
  artifact: artifactReferenceSchema,
  summary: destinationSummarySchema,
  warnings: z.array(z.string().min(1).max(240)).max(30)
}).strict()

export const recommendDestinationsOutputSchema = z.object({
  artifact: artifactReferenceSchema,
  summary: destinationSummarySchema,
  warnings: z.array(z.string().min(1).max(240)).max(30)
}).strict()

export const planTripRouteOutputSchema = z.object({
  artifact: routeArtifactReferenceSchema,
  summary: z.object({
    cityCount: z.number().int().nonnegative(),
    dayCount: z.number().int().nonnegative(),
    topCities: z.array(topCitySchema).max(5),
    stopoverOnlyCount: z.number().int().nonnegative(),
    unassignedActivityCount: z.number().int().nonnegative(),
    verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified'])
  }).strict(),
  warnings: z.array(z.string().min(1).max(240)).max(30)
}).strict()

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

function assertCurrent(context: ToolExecutionContext, signal: AbortSignal): void {
  if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Destination operation was cancelled')
}

function topCandidates(candidates: readonly DestinationCandidate[]) {
  return candidates.slice(0, 5).map(candidate => ({
    location: candidate.location,
    ...(candidate.location.iata ? { iata: candidate.location.iata } : {}),
    locationId: candidate.location.id,
    cityZh: candidate.cityZh,
    cityEn: candidate.cityEn,
    score: candidate.score,
    accessibility: candidate.accessibility,
    reasons: candidate.reasons
  }))
}

function addCandidateLocations(context: ToolExecutionContext, candidates: readonly DestinationCandidate[]): void {
  recordResolvedLocations(context, candidates.map(candidate => candidate.location))
}

function destinationSummary(result: z.infer<typeof destinationDiscoveryResultSchema>) {
  return {
    candidateCount: result.candidates.length,
    topCandidates: topCandidates(result.candidates),
    verificationStatus: result.verification.status
  }
}

function assertDiscoveryAvailable(context: ToolExecutionContext): NonNullable<ToolExecutionContext['destinationDiscovery']> {
  if (!context.destinationDiscovery) throw new Error('Destination discovery service is unavailable')
  return context.destinationDiscovery
}

export const searchDestinationsTool: AgentTool<
  z.infer<typeof searchDestinationsInputSchema>,
  z.infer<typeof searchDestinationsOutputSchema>
> = {
  name: 'search_destinations',
  description: 'Search the bounded curated destination directory using explicit region and interest filters. Returns a destination-set artifact with conservative accessibility metadata.',
  inputSchema: searchDestinationsInputSchema,
  outputSchema: searchDestinationsOutputSchema,
  costClass: 'cheap',
  costUnits: 1,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 15_000,
  provider: 'destination_discovery',
  async execute(input, context, signal) {
    assertCurrent(context, signal)
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Active trip context was not found')
    assertCurrent(context, signal)
    const serviceInput = destinationInputForTrip(trip, input)
    const service = assertDiscoveryAvailable(context)
    const { record, payload } = await discoverTripDestinations(
      serviceInput, service, workspaceScope(context, signal), 'destination_candidates'
    )
    addCandidateLocations(context, payload.candidates)
    return {
      artifact: { id: record.id, type: 'destination_set', schemaVersion: 1 },
      summary: destinationSummary(payload),
      warnings: payload.warnings
    }
  }
}

export const recommendDestinationsTool: AgentTool<
  z.infer<typeof recommendDestinationsInputSchema>,
  z.infer<typeof recommendDestinationsOutputSchema>
> = {
  name: 'recommend_destinations',
  description: 'Recommend destinations from the active trip and enabled User Memory. Current-trip exclusions and avoid overrides are hard constraints; Memory city mentions are soft preferences only.',
  inputSchema: recommendDestinationsInputSchema,
  outputSchema: recommendDestinationsOutputSchema,
  costClass: 'cheap',
  costUnits: 1,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 15_000,
  provider: 'destination_discovery',
  async execute(input, context, signal) {
    assertCurrent(context, signal)
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Active trip context was not found')
    const memory = await context.memory.getForAgent()
    assertCurrent(context, signal)
    const memoryPreferred = memory
      ? resolveDestinationMentions(memory.markdown).map(profile => profile.iata)
      : []
    const serviceInput = destinationInputForTrip(trip, {
      regions: [],
      interests: destinationInterests(trip.interests),
      limit: input.limit
    }, memoryPreferred)
    const service = assertDiscoveryAvailable(context)
    const { record, payload } = await discoverTripDestinations(
      serviceInput, service, workspaceScope(context, signal), 'destination_recommendations'
    )
    addCandidateLocations(context, payload.candidates)
    return {
      artifact: { id: record.id, type: 'destination_set', schemaVersion: 1 },
      summary: destinationSummary(payload),
      warnings: payload.warnings
    }
  }
}

function routeSummary(result: z.infer<typeof tripRoutePlanResultSchema>) {
  return {
    cityCount: result.cities.length,
    dayCount: result.days.length,
    topCities: result.cities.slice(0, 5).map(city => ({
      location: city.location,
      ...(city.location.iata ? { iata: city.location.iata } : {}),
      locationId: city.location.id,
      stayDays: city.stayDays,
      role: city.role
    })),
    stopoverOnlyCount: result.stopoverOnly.length,
    unassignedActivityCount: result.unassignedActivityRefs.length,
    verificationStatus: result.verification.status
  }
}

export const planTripRouteTool: AgentTool<
  z.infer<typeof planTripRouteInputSchema>,
  z.infer<typeof planTripRouteOutputSchema>
> = {
  name: 'plan_trip_route',
  description: 'Build a deterministic visit/day structure from an owner-scoped destination-set artifact and the active Trip Context. It does not search flights or invent land-transfer, activity, visa, or fare facts.',
  inputSchema: planTripRouteInputSchema,
  outputSchema: planTripRouteOutputSchema,
  costClass: 'cheap',
  costUnits: 1,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 15_000,
  provider: 'trip_route_planner',
  async execute(input, context, signal) {
    assertCurrent(context, signal)
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Active trip context was not found')
    const planner = context.tripRoutePlanner
    if (!planner) throw new Error('Trip route planner is unavailable')
    const { record, payload } = await planTripDays({
      candidateArtifactId: input.candidateArtifactId,
      trip,
      maxCities: input.maxCities
    }, planner, workspaceScope(context, signal))
    return {
      artifact: { id: record.id, type: 'route', schemaVersion: 1 },
      summary: routeSummary(payload),
      warnings: payload.warnings
    }
  }
}

export {
  artifactReferenceSchema as destinationArtifactReferenceSchema,
  routeArtifactReferenceSchema,
  topCandidateSchema,
  topCitySchema
}
