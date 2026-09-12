import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { locationRefKey, locationRefSchema, type LocationRef } from '../../aviation/types.js'
import {
  connectionSearchInputSchema,
  connectionSearchResultSchema,
  flightRoutePlanResultSchema,
  routeConstraintsSchema,
  routeNodeSchema,
  routeOptimizationResultSchema,
  routeWeightsSchema,
  routeSetPayloadSchema,
  type CompleteFlightPath,
  type RouteSetPayload
} from '../../flight-routing/types.js'
import type { ArtifactRecord } from '../../artifacts/repository.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'
import { loadWorkspaceArtifact, saveWorkspaceArtifact, type ArtifactWorkspace } from '../../artifacts/workspace.js'
import { workspaceScope } from './workspace-scope.js'

const MAX_WINDOW_DAYS = 31
const artifactReferenceSchema = z.object({
  id: z.string().uuid(), type: z.literal('route_set'), schemaVersion: z.literal(1)
}).strict()
const canonicalAirportSchema = locationRefSchema.refine(
  value => value.type === 'airport' && value.iata !== undefined,
  'Route search requires a canonical airport reference with an IATA code'
)
const dateWindowSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).strict().superRefine((window, context) => {
  const from = Date.parse(`${window.from}T00:00:00Z`)
  const to = Date.parse(`${window.to}T00:00:00Z`)
  if (to < from) context.addIssue({ code: 'custom', message: 'Window end must not precede start', path: ['to'] })
  if ((to - from) / 86_400_000 > MAX_WINDOW_DAYS - 1) {
    context.addIssue({ code: 'custom', message: `Window must be at most ${MAX_WINDOW_DAYS} calendar days`, path: ['to'] })
  }
})

export const searchConnectionFlightsInputSchema = z.object({
  origin: canonicalAirportSchema,
  destination: canonicalAirportSchema,
  window: dateWindowSchema,
  preferredLocations: z.array(locationRefSchema).max(24).default([]),
  excludedLocations: z.array(locationRefSchema).max(24).default([]),
  acceptsSelfTransfer: z.boolean().default(false),
  acceptsLongStopover: z.boolean().default(false),
  maxCandidates: z.number().int().min(1).max(500).default(100)
}).strict().superRefine((input, context) => {
  if (input.origin.iata === input.destination.iata) {
    context.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  }
})

const edgeSummarySchema = z.object({
  id: z.string().min(1).max(160),
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  departureDate: z.iso.date(),
  transferType: z.enum(['direct', 'airline', 'protected', 'self']),
  availability: z.enum(['verified', 'partial', 'unknown'])
}).strict()

export const searchConnectionFlightsOutputSchema = z.object({
  artifact: artifactReferenceSchema,
  summary: z.object({
    edgeCount: z.number().int().nonnegative(),
    availabilityCounts: z.object({
      verified: z.number().int().nonnegative(),
      partial: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative()
    }).strict(),
    topEdges: z.array(edgeSummarySchema).max(5),
    verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified']),
    truncated: z.boolean(),
    exhausted: z.boolean()
  }).strict(),
  warnings: z.array(z.string().max(200)).max(50)
}).strict()

export const planFlightRouteInputSchema = z.object({
  candidateArtifactId: z.string().uuid(),
  nodes: z.array(routeNodeSchema).min(2).max(24),
  window: dateWindowSchema,
  maxPaths: z.number().int().min(1).max(200).default(50)
}).strict()

const fareSummarySchema = z.object({ amount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict()
const pathSummarySchema = z.object({
  id: z.string().min(1).max(160),
  locations: z.array(z.string().min(1).max(128)).min(2).max(32),
  transferCount: z.number().int().nonnegative(),
  feasibility: z.enum(['feasible', 'partial', 'unknown']),
  totalFare: fareSummarySchema.optional()
}).strict()

export const planFlightRouteOutputSchema = z.object({
  artifact: artifactReferenceSchema,
  summary: z.object({
    pathCount: z.number().int().nonnegative(),
    topPaths: z.array(pathSummarySchema).max(5),
    verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified']),
    truncated: z.boolean(),
    exhausted: z.boolean()
  }).strict(),
  warnings: z.array(z.string().max(200)).max(50)
}).strict()

export const optimizeRouteInputSchema = z.object({
  pathArtifactId: z.string().uuid(),
  weights: routeWeightsSchema.default({}),
  maxRepresentatives: z.number().int().min(1).max(50).default(10)
}).strict()

const representativeSummarySchema = z.object({
  path: pathSummarySchema,
  totalScore: z.number().finite(),
  badges: z.array(z.enum(['cheapest', 'balanced', 'most_fun', 'best_match'])).max(4)
}).strict()

export const optimizeRouteOutputSchema = z.object({
  artifact: artifactReferenceSchema,
  summary: z.object({
    paretoFrontierCount: z.number().int().nonnegative(),
    representativeCount: z.number().int().nonnegative(),
    rejectedCandidateCount: z.number().int().nonnegative(),
    representatives: z.array(representativeSummarySchema).max(5),
    verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified']),
    truncated: z.boolean(),
    exhausted: z.boolean()
  }).strict(),
  warnings: z.array(z.string().max(200)).max(50)
}).strict()

function assertTrustedLocations(context: ToolExecutionContext, values: readonly LocationRef[]): void {
  const allowed = context.resolvedLocationKeys ?? new Set<string>()
  for (const value of values) {
    if (!allowed.has(locationRefKey(value))) {
      throw new Error('Location reference was not resolved by an authoritative provider')
    }
  }
}

function locationCode(location: LocationRef): string {
  return location.iata ?? location.cityCode ?? location.id
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return locationCode(left) === locationCode(right)
}

function uniqueLocations(values: readonly LocationRef[]): LocationRef[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = locationRefKey(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pathSummary(path: CompleteFlightPath) {
  return {
    id: path.id,
    locations: path.nodes.map(node => locationCode(node.location)),
    transferCount: path.transferCount,
    feasibility: path.feasibility,
    ...(path.totalFare ? { totalFare: path.totalFare } : {})
  }
}

async function loadRouteSet(
  scope: ArtifactWorkspace,
  artifactId: string,
  expectedKind: RouteSetPayload['kind']
): Promise<{ record: ArtifactRecord; payload: RouteSetPayload }> {
  const record = await loadWorkspaceArtifact(scope, artifactId, 'route_set', [1])
  const payload = routeSetPayloadSchema.parse(record.payload)
  if (payload.kind !== expectedKind) throw new Error(`Source route artifact must contain ${expectedKind}`)
  return { record, payload }
}

export const searchConnectionFlightsTool: AgentTool<
  z.infer<typeof searchConnectionFlightsInputSchema>, z.infer<typeof searchConnectionFlightsOutputSchema>
> = {
  name: 'search_connection_flights',
  description: 'Search bounded, verified connection-edge candidates through the deterministic FlightOR connection service.',
  inputSchema: searchConnectionFlightsInputSchema,
  outputSchema: searchConnectionFlightsOutputSchema,
  costClass: 'expensive', costUnits: 6, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 45_000, provider: 'connection_service',
  async execute(input, context, signal) {
    assertTrustedLocations(context, [input.origin, input.destination, ...input.preferredLocations, ...input.excludedLocations])
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Trip context was not found')
    const scope = await workspaceScope(context, signal, trip)
    const avoided = trip.locationRoleOverrides.filter(item => item.role === 'avoid').map(item => item.location)
    const serviceInput = connectionSearchInputSchema.parse({
      ...input,
      preferredLocations: uniqueLocations(trip.destinationIntent.preferred),
      excludedLocations: uniqueLocations([...trip.destinationIntent.excluded, ...avoided]),
      acceptsSelfTransfer: trip.transferPreferences.acceptsSelfTransfer ?? false,
      acceptsLongStopover: trip.transferPreferences.acceptsLongStopover ?? false
    })
    const result = connectionSearchResultSchema.parse(await context.connectionSearch.search(serviceInput, { signal, tripId: scope.tripId, artifactWorkspace: scope }))
    const id = uuidv7()
    const payload = routeSetPayloadSchema.parse({
      kind: 'connection_edges', schemaVersion: 1,
      serviceVersion: result.serviceVersion, algorithmVersion: result.serviceVersion,
      sourceArtifactIds: [],
      query: { origin: serviceInput.origin, destination: serviceInput.destination, window: serviceInput.window },
      edges: result.edges, verification: result.verification,
      warnings: result.warnings, truncated: result.truncated, exhausted: result.exhausted
    })
    const stored = await saveWorkspaceArtifact(scope, {
      id,
      type: 'route_set', schemaVersion: 1, payload, verification: result.verification
    })
    const availabilityCounts = result.edges.reduce((counts, edge) => {
      counts[edge.availability] += 1
      return counts
    }, { verified: 0, partial: 0, unknown: 0 })
    return {
      artifact: { id: stored.id, type: 'route_set', schemaVersion: 1 },
      summary: {
        edgeCount: result.edges.length, availabilityCounts,
        topEdges: result.edges.slice(0, 5).map(edge => ({
          id: edge.id, from: locationCode(edge.from), to: locationCode(edge.to),
          departureDate: edge.departureDate, transferType: edge.transferType, availability: edge.availability
        })),
        verificationStatus: result.verification.status,
        truncated: result.truncated, exhausted: result.exhausted
      },
      warnings: result.warnings
    }
  }
}

export const planFlightRouteTool: AgentTool<
  z.infer<typeof planFlightRouteInputSchema>, z.infer<typeof planFlightRouteOutputSchema>
> = {
  name: 'plan_flight_route',
  description: 'Build complete bounded flight paths from a trusted connection-edge artifact. This performs no provider discovery.',
  inputSchema: planFlightRouteInputSchema,
  outputSchema: planFlightRouteOutputSchema,
  costClass: 'cheap', costUnits: 1, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 15_000, provider: 'flight_route_planner',
  async execute(input, context, signal) {
    assertTrustedLocations(context, input.nodes.map(node => node.location))
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Trip context was not found')
    const scope = await workspaceScope(context, signal, trip)
    const source = await loadRouteSet(scope, input.candidateArtifactId, 'connection_edges')
    if (source.payload.kind !== 'connection_edges') throw new Error('Source route artifact has an invalid kind')
    const originNode = input.nodes.find(node => node.role === 'origin') ?? input.nodes[0]!
    const destinationNode = [...input.nodes].reverse().find(node => node.role === 'destination') ?? input.nodes[input.nodes.length - 1]!
    if (!sameLocation(originNode.location, source.payload.query.origin)
      || !sameLocation(destinationNode.location, source.payload.query.destination)
      || input.window.from !== source.payload.query.window.from
      || input.window.to !== source.payload.query.window.to) {
      throw new Error('Route plan request does not match the source connection query')
    }
    const visitOverrides = trip.locationRoleOverrides.filter(item => item.role === 'visit').map(item => item.location)
    const avoidOverrides = trip.locationRoleOverrides.filter(item => item.role === 'avoid').map(item => item.location)
    const constraints = routeConstraintsSchema.parse({
      requiredLocations: uniqueLocations([...trip.destinationIntent.required, ...visitOverrides]),
      excludedLocations: uniqueLocations([...trip.destinationIntent.excluded, ...avoidOverrides]),
      allowSelfTransfer: trip.transferPreferences.acceptsSelfTransfer ?? false,
      allowAirportChange: trip.transferPreferences.acceptsAirportChange ?? false,
      allowLongStopover: trip.transferPreferences.acceptsLongStopover ?? false,
      ...(trip.travelDays ? { maxTravelDays: trip.travelDays } : {})
    })
    const result = flightRoutePlanResultSchema.parse(await context.flightRoutePlanner.plan({
      nodes: input.nodes, edges: source.payload.edges, window: input.window,
      constraints, maxPaths: input.maxPaths
    }, { signal }))
    const id = uuidv7()
    const payload = routeSetPayloadSchema.parse({
      kind: 'flight_paths', schemaVersion: 1,
      serviceVersion: result.serviceVersion, algorithmVersion: result.serviceVersion,
      sourceArtifactIds: [source.record.id], paths: result.paths,
      verification: result.verification, warnings: result.warnings,
      truncated: result.truncated, exhausted: result.exhausted
    })
    const stored = await saveWorkspaceArtifact(scope, {
      id, sourceArtifactIds: [source.record.id],
      type: 'route_set', schemaVersion: 1, payload, verification: result.verification
    })
    return {
      artifact: { id: stored.id, type: 'route_set', schemaVersion: 1 },
      summary: {
        pathCount: result.paths.length,
        topPaths: result.paths.slice(0, 5).map(pathSummary),
        verificationStatus: result.verification.status,
        truncated: result.truncated, exhausted: result.exhausted
      },
      warnings: result.warnings
    }
  }
}

export const optimizeRouteTool: AgentTool<
  z.infer<typeof optimizeRouteInputSchema>, z.infer<typeof optimizeRouteOutputSchema>
> = {
  name: 'optimize_route',
  description: 'Select deterministic Pareto representatives from a trusted complete-path artifact. This performs no discovery or fare calls.',
  inputSchema: optimizeRouteInputSchema,
  outputSchema: optimizeRouteOutputSchema,
  costClass: 'cheap', costUnits: 1, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 15_000, provider: 'route_optimizer',
  async execute(input, context, signal) {
    const trip = await context.trips.get(context.tripId)
    if (!trip) throw new Error('Trip context was not found')
    const scope = await workspaceScope(context, signal, trip)
    const source = await loadRouteSet(scope, input.pathArtifactId, 'flight_paths')
    if (source.payload.kind !== 'flight_paths') throw new Error('Source route artifact has an invalid kind')
    const weights = Object.fromEntries(
      Object.entries(input.weights).filter((entry): entry is [string, number] => entry[1] !== undefined)
    )
    const result = routeOptimizationResultSchema.parse(await context.routeOptimizer.optimize({
      paths: source.payload.paths, weights,
      preferredLocations: uniqueLocations(trip.destinationIntent.preferred),
      interestLocations: [],
      maxRepresentatives: input.maxRepresentatives
    }, { signal }))
    const id = uuidv7()
    const payload = routeSetPayloadSchema.parse({
      kind: 'optimized_routes', schemaVersion: 1,
      serviceVersion: result.serviceVersion, algorithmVersion: result.algorithmVersion,
      sourceArtifactIds: [source.record.id], representatives: result.representatives,
      paretoFrontierCount: result.paretoFrontierCount,
      rejectedCandidateCount: result.rejectedCandidateCount,
      verification: result.verification, warnings: result.warnings,
      truncated: result.truncated, exhausted: result.exhausted
    })
    const stored = await saveWorkspaceArtifact(scope, {
      id, sourceArtifactIds: [source.record.id],
      type: 'route_set', schemaVersion: 1, payload, verification: result.verification
    })
    return {
      artifact: { id: stored.id, type: 'route_set', schemaVersion: 1 },
      summary: {
        paretoFrontierCount: result.paretoFrontierCount,
        representativeCount: result.representatives.length,
        rejectedCandidateCount: result.rejectedCandidateCount,
        representatives: result.representatives.slice(0, 5).map(item => ({
          path: pathSummary(item.path), totalScore: item.score.total, badges: item.badges
        })),
        verificationStatus: result.verification.status,
        truncated: result.truncated, exhausted: result.exhausted
      },
      warnings: result.warnings
    }
  }
}
