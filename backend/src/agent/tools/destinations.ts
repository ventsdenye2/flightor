import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { locationRefKey, type LocationRef } from '../../aviation/types.js'
import {
  destinationCandidateSchema,
  destinationDiscoveryInputSchema,
  destinationDiscoveryResultSchema,
  destinationInterestSchema,
  destinationRegionSchema,
  destinationSetPayloadSchema,
  type DestinationCandidate,
  type DestinationDiscoveryInput
} from '../../destinations/types.js'
import { resolveDestinationMentions } from '../../destinations/catalog.js'
import {
  tripRoutePlanPayloadSchema,
  tripRoutePlanResultSchema
} from '../../trip-planning/types.js'
import type { ArtifactRecord } from '../../artifacts/repository.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'

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
  iata: z.string().regex(/^[A-Z]{3}$/).optional(),
  locationId: z.string().min(1).max(128),
  cityZh: z.string().min(1).max(160),
  cityEn: z.string().min(1).max(160),
  score: z.number().finite().min(0).max(1),
  accessibility: z.enum(['direct', 'unknown']),
  reasons: z.array(z.string().min(1).max(240)).max(12)
}).strict()

const topCitySchema = z.object({
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

function locationCode(location: LocationRef): string | undefined {
  const code = location.iata ?? location.cityCode
  return code?.trim().toUpperCase()
}

function codesFromLocations(values: readonly LocationRef[]): string[] {
  return uniqueStrings(values.map(locationCode).filter((value): value is string => value !== undefined))
}

function visitLocations(context: Awaited<ReturnType<ToolExecutionContext['trips']['get']>>): LocationRef[] {
  if (!context) return []
  return context.locationRoleOverrides.filter(item => item.role === 'visit').map(item => item.location)
}

function avoidLocations(context: Awaited<ReturnType<ToolExecutionContext['trips']['get']>>): LocationRef[] {
  if (!context) return []
  return context.locationRoleOverrides.filter(item => item.role === 'avoid').map(item => item.location)
}

function interestsFromTrip(values: readonly string[]): Array<z.infer<typeof destinationInterestSchema>> {
  return uniqueStrings(values)
    .map(value => destinationInterestSchema.safeParse(value))
    .filter((result): result is { success: true; data: z.infer<typeof destinationInterestSchema> } => result.success)
    .map(result => result.data)
}

function assertCurrent(context: ToolExecutionContext, signal: AbortSignal): void {
  if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Destination operation was cancelled')
}

function discoveryInput(
  context: Awaited<ReturnType<ToolExecutionContext['trips']['get']>>,
  filter: { regions?: readonly z.infer<typeof destinationRegionSchema>[]; interests?: readonly z.infer<typeof destinationInterestSchema>[]; limit: number },
  preferredFromMemory: readonly string[] = []
): DestinationDiscoveryInput {
  if (!context) throw new Error('Active trip context was not found')
  return destinationDiscoveryInputSchema.parse({
    regions: [...(filter.regions ?? [])],
    interests: [...(filter.interests ?? [])],
    requiredIatas: codesFromLocations([...context.destinationIntent.required, ...visitLocations(context)]),
    preferredIatas: uniqueStrings([
      ...codesFromLocations(context.destinationIntent.preferred),
      ...preferredFromMemory
    ]),
    excludedIatas: codesFromLocations([...context.destinationIntent.excluded, ...avoidLocations(context)]),
    ...(context.origin ? { origin: context.origin } : {}),
    limit: filter.limit
  })
}

function topCandidates(candidates: readonly DestinationCandidate[]) {
  return candidates.slice(0, 5).map(candidate => ({
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
  for (const candidate of candidates) context.resolvedLocationKeys?.add(locationRefKey(candidate.location))
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

async function persistDestinationSet(
  context: ToolExecutionContext,
  kind: 'destination_candidates' | 'destination_recommendations',
  query: DestinationDiscoveryInput,
  result: z.infer<typeof destinationDiscoveryResultSchema>,
  signal: AbortSignal
): Promise<{ id: string; summary: ReturnType<typeof destinationSummary> }> {
  assertCurrent(context, signal)
  const id = uuidv7()
  const payload = destinationSetPayloadSchema.parse({
    kind,
    schemaVersion: 1,
    serviceVersion: result.serviceVersion,
    query,
    candidates: result.candidates,
    verification: result.verification,
    warnings: result.warnings
  })
  assertCurrent(context, signal)
  const stored = await context.artifacts.create({
    id,
    tripId: context.tripId,
    conversationId: context.conversationId,
    type: 'destination_set',
    schemaVersion: 1,
    payload,
    verification: result.verification
  })
  addCandidateLocations(context, result.candidates)
  return { id: stored.id, summary: destinationSummary(result) }
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
    const serviceInput = discoveryInput(trip, input)
    const service = assertDiscoveryAvailable(context)
    const result = destinationDiscoveryResultSchema.parse(await service.discover(serviceInput, { signal }))
    assertCurrent(context, signal)
    const stored = await persistDestinationSet(context, 'destination_candidates', serviceInput, result, signal)
    return {
      artifact: { id: stored.id, type: 'destination_set', schemaVersion: 1 },
      summary: stored.summary,
      warnings: result.warnings
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
    const serviceInput = discoveryInput(trip, {
      regions: [],
      interests: interestsFromTrip(trip.interests),
      limit: input.limit
    }, memoryPreferred)
    assertCurrent(context, signal)
    const service = assertDiscoveryAvailable(context)
    const result = destinationDiscoveryResultSchema.parse(await service.discover(serviceInput, { signal }))
    assertCurrent(context, signal)
    const stored = await persistDestinationSet(context, 'destination_recommendations', serviceInput, result, signal)
    return {
      artifact: { id: stored.id, type: 'destination_set', schemaVersion: 1 },
      summary: stored.summary,
      warnings: result.warnings
    }
  }
}

async function loadDestinationSet(context: ToolExecutionContext, artifactId: string): Promise<{ record: ArtifactRecord; payload: z.infer<typeof destinationSetPayloadSchema> }> {
  const record = await context.artifacts.get(artifactId)
  if (!record || record.tripId !== context.tripId) throw new Error('Source destination artifact was not found')
  if (record.type !== 'destination_set' || record.schemaVersion !== 1) throw new Error('Source artifact is not a supported destination set')
  const payload = destinationSetPayloadSchema.parse(record.payload)
  if (payload.kind !== 'destination_candidates' && payload.kind !== 'destination_recommendations') {
    throw new Error('Source destination artifact has an invalid kind')
  }
  return { record, payload }
}

function routeSummary(result: z.infer<typeof tripRoutePlanResultSchema>) {
  return {
    cityCount: result.cities.length,
    dayCount: result.days.length,
    topCities: result.cities.slice(0, 5).map(city => ({
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
    const source = await loadDestinationSet(context, input.candidateArtifactId)
    assertCurrent(context, signal)
    const planner = context.tripRoutePlanner
    if (!planner) throw new Error('Trip route planner is unavailable')
    const routeInput = {
      candidates: source.payload.candidates,
      tripContext: trip,
      maxCities: input.maxCities
    }
    const result = tripRoutePlanResultSchema.parse(await planner.plan(routeInput, { signal }))
    assertCurrent(context, signal)
    const id = uuidv7()
    const payload = tripRoutePlanPayloadSchema.parse({
      ...result,
      kind: 'trip_route_plan',
      schemaVersion: 1,
      sourceArtifactIds: [source.record.id],
      tripContextVersion: trip.version
    })
    assertCurrent(context, signal)
    const stored = await context.artifacts.create({
      id,
      tripId: context.tripId,
      conversationId: context.conversationId,
      type: 'route',
      schemaVersion: 1,
      payload,
      verification: result.verification
    })
    return {
      artifact: { id: stored.id, type: 'route', schemaVersion: 1 },
      summary: routeSummary(result),
      warnings: result.warnings
    }
  }
}

export {
  artifactReferenceSchema as destinationArtifactReferenceSchema,
  routeArtifactReferenceSchema,
  topCandidateSchema,
  topCitySchema
}
