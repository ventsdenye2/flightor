import { z } from 'zod'
import { locationResolutionSchema, type LocationRef } from '../../aviation/types.js'
import { fareSearchInputSchema } from '../../fares/types.js'
import { fareItinerarySummarySchema, summarizeFareItineraries } from '../../fares/summary.js'
import { executeFlightSearch } from '../../fares/search-service.js'
import { fareAirportSelectorSchema, resolveFareAirportPair } from '../../fares/airport-resolver.js'
import { USER_MEMORY_MAX_BYTES } from '../../memory/repository.js'
import { tripContextPatchSchema, tripContextSchema } from '../../trips/types.js'
import { ToolRegistry, type AgentTool, type ToolExecutionContext } from '../runtime/registry.js'
import { searchFlexibleFlightsTool } from './flexible-flights.js'
import { optimizeRouteTool, planFlightRouteTool, searchConnectionFlightsTool } from './flight-routing.js'
import { searchDestinationsTool, recommendDestinationsTool, planTripRouteTool } from './destinations.js'
import { confirmFlightPriceTool, confirmRoutePriceTool } from './fare-confirmation.js'
import { researchDestinationTool, webResearchTool } from './research.js'
import { buildTravelGuideTool } from './travel-guide.js'
import { saveTravelGuideTool } from './authored-travel-guide.js'
import { getTripArtifactsTool, readArtifactTool } from './artifact-reading.js'
import { canonicalResolvedLocation, recordResolvedLocations } from './resolved-locations.js'
import { cancelGoalTool, declareGoalTool, finishGoalTool, getGoalTool, resumeGoalTool } from './goals.js'
import { startRouteGenerationTool } from './route-generation.js'
import { workspaceScope } from './workspace-scope.js'
import { locationSelectorSchema, type LocationSelector } from '../../locations/selector.js'

const emptyObjectSchema = z.object({}).strict()
const getTripContextOutputSchema = z.object({ tripContext: tripContextSchema }).strict()
// Model arguments select identities; canonical Trip persistence still requires full LocationRefs.
const tripLocationInputSchema = locationSelectorSchema
const groundLegSchema = tripContextSchema.shape.requiredGroundLegs.unwrap().element
const updateTripContextPatchSchema = tripContextPatchSchema.extend({
  origin: tripLocationInputSchema.nullable().optional(),
  destinationIntent: tripContextSchema.shape.destinationIntent.extend({
    required: z.array(tripLocationInputSchema).max(24),
    preferred: z.array(tripLocationInputSchema).max(24),
    excluded: z.array(tripLocationInputSchema).max(24)
  }).optional(),
  locationRoleOverrides: z.array(tripContextSchema.shape.locationRoleOverrides.element.extend({
    location: tripLocationInputSchema
  })).max(32).optional(),
  requiredGroundLegs: z.array(z.object({
    from: tripLocationInputSchema,
    to: tripLocationInputSchema,
    mode: groundLegSchema.shape.mode
  }).strict()).max(24).optional()
}).strict()
const updateTripContextInputSchema = z.object({
  patch: updateTripContextPatchSchema,
  expectedVersion: z.number().int().nonnegative().optional()
}).strict()
const updateTripContextOutputSchema = z.object({
  tripContext: tripContextSchema,
  changed: z.boolean()
}).strict()
const resolveLocationInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  types: z.array(z.enum(['city', 'airport'])).min(1).max(2).optional(),
  limit: z.number().int().min(1).max(10).default(5)
}).strict()
const searchFlightsInputSchema = z.object({
  origin: fareAirportSelectorSchema,
  destination: fareAirportSelectorSchema,
  departureDate: z.iso.date(),
  returnDate: z.iso.date().optional(),
  currency: z.enum(['CNY', 'USD', 'EUR']).default('CNY'),
  travelClass: z.number().int().min(1).max(4).default(1)
}).strict().superRefine((input, context) => {
  if (input.origin.toUpperCase() === input.destination.toUpperCase()) {
    context.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  }
  if (input.returnDate && input.returnDate < input.departureDate) {
    context.addIssue({ code: 'custom', message: 'Return date must not precede departure', path: ['returnDate'] })
  }
})

const searchFlightsOutputSchema = z.object({
  artifact: z.object({ id: z.string().uuid(), type: z.literal('flight_search'), schemaVersion: z.literal(1) }).strict(),
  summary: z.object({
    origin: z.string().regex(/^[A-Z]{3}$/),
    destination: z.string().regex(/^[A-Z]{3}$/),
    departureDate: z.iso.date(),
    offerCount: z.number().int().nonnegative(),
    itineraries: fareItinerarySummarySchema,
    lowestFare: z.object({ amount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
    checkedAt: z.iso.datetime(),
    provider: z.string().min(1),
    verificationStatus: z.string().min(1)
  }).strict()
}).strict()

const getUserMemoryOutputSchema = z.object({
  enabled: z.boolean(),
  markdown: z.string().optional(),
  version: z.number().int().nonnegative()
}).strict()

const updateUserMemoryInputSchema = z.object({
  markdown: z.string().max(USER_MEMORY_MAX_BYTES),
  expectedVersion: z.number().int().nonnegative()
}).strict()

function tripLocations(value: z.infer<typeof tripContextSchema>): LocationRef[] {
  return [
    ...(value.origin ? [value.origin] : []),
    ...value.destinationIntent.required,
    ...value.destinationIntent.preferred,
    ...value.destinationIntent.excluded,
    ...value.locationRoleOverrides.map(item => item.location),
    ...value.requiredGroundLegs.flatMap(leg => [leg.from, leg.to])
  ]
}

function rememberLocations(context: { resolvedLocationKeys?: Set<string> }, values: readonly LocationRef[]): void {
  recordResolvedLocations(context, values)
}

/** Resolve every Trip location position at one boundary, before any repository mutation. */
function canonicalTripPatch(
  patch: z.infer<typeof updateTripContextPatchSchema>,
  context: ToolExecutionContext,
  current: z.infer<typeof tripContextSchema>
): z.infer<typeof tripContextPatchSchema> {
  const authority: ToolExecutionContext = {
    ...context,
    resolvedLocationKeys: new Set(context.resolvedLocationKeys),
    resolvedLocations: new Map()
  }
  // Existing owned Trip facts are valid across turns; fresh server resolutions win for the same identity.
  recordResolvedLocations(authority, tripLocations(current))
  recordResolvedLocations(authority, [...(context.resolvedLocations?.values() ?? [])])
  const resolve = (location: LocationSelector) => canonicalResolvedLocation(authority, location)
  return tripContextPatchSchema.parse({
    ...patch,
    ...(patch.origin == null ? {} : { origin: resolve(patch.origin) }),
    ...(patch.destinationIntent ? { destinationIntent: {
      ...patch.destinationIntent,
      required: patch.destinationIntent.required.map(resolve),
      preferred: patch.destinationIntent.preferred.map(resolve),
      excluded: patch.destinationIntent.excluded.map(resolve)
    } } : {}),
    ...(patch.locationRoleOverrides ? { locationRoleOverrides: patch.locationRoleOverrides.map(item => ({
      ...item, location: resolve(item.location)
    })) } : {}),
    ...(patch.requiredGroundLegs ? { requiredGroundLegs: patch.requiredGroundLegs.map(leg => ({
      ...leg, from: resolve(leg.from), to: resolve(leg.to)
    })) } : {})
  })
}

const getTripContextTool: AgentTool<
  z.infer<typeof emptyObjectSchema>,
  z.infer<typeof getTripContextOutputSchema>
> = {
  name: 'get_trip_context',
  description: 'Read the authoritative context for the active trip. The trip identity is supplied by the runtime, not by tool arguments.',
  inputSchema: emptyObjectSchema,
  outputSchema: getTripContextOutputSchema,
  costClass: 'free',
  costUnits: 0,
  sideEffect: 'none',
  parallelSafe: true,
  timeoutMs: 2_000,
  async execute(_input, context) {
    const tripContext = await context.trips.get(context.tripId)
    if (!tripContext) throw new Error('Active trip context was not found')
    rememberLocations(context, tripLocations(tripContext))
    return { tripContext }
  }
}

const updateTripContextTool: AgentTool<
  z.infer<typeof updateTripContextInputSchema>,
  z.infer<typeof updateTripContextOutputSchema>
> = {
  name: 'update_trip_context',
  description: 'Apply explicit current-trip constraints or preferences. For origin, destinationIntent required/preferred/excluded, locationRoleOverrides.location, and requiredGroundLegs from/to, pass exact canonical location id STRINGS from resolve_location, destination discovery, or the current Trip. The server restores all location facts; do not copy location descriptions. This never changes long-term User Memory.',
  inputSchema: updateTripContextInputSchema,
  outputSchema: updateTripContextOutputSchema,
  costClass: 'free',
  costUnits: 0,
  sideEffect: 'state',
  parallelSafe: false,
  timeoutMs: 2_000,
  async execute(input, context, signal) {
    if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('Trip context update was cancelled')
    const current = await context.trips.get(context.tripId)
    if (!current) throw new Error('Active trip context was not found')
    const patch = canonicalTripPatch(input.patch, context, current)
    if (Object.keys(input.patch).length === 0) {
      return { tripContext: current, changed: false }
    }
    const tripContext = await context.trips.update(context.tripId, patch, input.expectedVersion ?? current.version, {
      signal,
      ...(context.isGenerationCurrent ? { isCurrent: context.isGenerationCurrent } : {})
    })
    return { tripContext, changed: true }
  }
}

const resolveLocationTool: AgentTool<
  z.infer<typeof resolveLocationInputSchema>,
  z.infer<typeof locationResolutionSchema>
> = {
  name: 'resolve_location',
  description: 'Resolve a user-supplied place name into verified FlightOR city or airport references. Use this before treating an airport code as fact.',
  inputSchema: resolveLocationInputSchema,
  outputSchema: locationResolutionSchema,
  costClass: 'cheap',
  costUnits: 1,
  sideEffect: 'none',
  parallelSafe: true,
  timeoutMs: 12_000,
  provider: 'aviation_provider',
  async execute(input, context, signal) {
    const resolution = locationResolutionSchema.parse(await context.aviation.resolveLocation({
      query: input.query,
      limit: input.limit,
      ...(input.types ? { types: input.types } : {})
    }, { signal }))
    rememberLocations(context, resolution.matches)
    return resolution
  }
}

const searchFlightsTool: AgentTool<
  z.infer<typeof searchFlightsInputSchema>,
  z.infer<typeof searchFlightsOutputSchema>
> = {
  name: 'search_flights',
  description: 'Search current fare options for one airport leg. Pass each endpoint as an IATA code or an airport id returned by resolve_location. The server resolves both selectors back to authoritative airport facts before any paid fare call; never pass names or copied location objects.',
  inputSchema: searchFlightsInputSchema,
  outputSchema: searchFlightsOutputSchema,
  costClass: 'paid',
  costUnits: 4,
  sideEffect: 'state',
  // Fare search depends on location facts established by earlier tool results.
  // Keeping it ordered prevents same-batch resolve/search ledger races.
  parallelSafe: false,
  timeoutMs: 35_000,
  provider: 'fare_provider',
  async execute(input, context, signal) {
    const scope = await workspaceScope(context, signal)
    const airports = await resolveFareAirportPair(context.aviation, {
      origin: input.origin,
      destination: input.destination
    }, { ...(context.resolvedLocations ? { trustedLocations: context.resolvedLocations.values() } : {}), signal })
    rememberLocations(context, [airports.origin, airports.destination])
    const query = fareSearchInputSchema.parse({
      origin: airports.origin.iata,
      destination: airports.destination.iata,
      departureDate: input.departureDate,
      ...(input.returnDate ? { returnDate: input.returnDate } : {}),
      currency: input.currency,
      travelClass: input.travelClass
    })
    const { record: stored, payload: artifact } = await executeFlightSearch(query, {
      ...scope,
      fares: context.fares,
    })
    const lowest = [...artifact.offers].sort((left, right) => left.totalAmount - right.totalAmount)[0]
    return {
      artifact: { id: stored.id, type: 'flight_search', schemaVersion: 1 },
      summary: {
        origin: artifact.query.origin,
        destination: artifact.query.destination,
        departureDate: artifact.query.departureDate,
        offerCount: artifact.offers.length,
        itineraries: summarizeFareItineraries(artifact.offers),
        ...(lowest ? { lowestFare: { amount: lowest.totalAmount, currency: lowest.currency } } : {}),
        checkedAt: artifact.checkedAt,
        provider: artifact.provider,
        verificationStatus: artifact.verification.status
      }
    }
  }
}

const getUserMemoryTool: AgentTool<Record<string, never>, z.infer<typeof getUserMemoryOutputSchema>> = {
  name: 'get_user_memory',
  description: 'Read the authenticated user’s long-term Memory only when Memory is enabled. This is separate from current-trip context.',
  inputSchema: emptyObjectSchema,
  outputSchema: getUserMemoryOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'none', parallelSafe: true, timeoutMs: 2_000,
  async execute(_input, context) {
    const memory = await context.memory.getForAgent()
    return memory
      ? { enabled: true, markdown: memory.markdown, version: memory.version }
      : { enabled: false, version: (await context.memory.get()).version }
  }
}

const updateUserMemoryTool: AgentTool<z.infer<typeof updateUserMemoryInputSchema>, z.infer<typeof getUserMemoryOutputSchema>> = {
  name: 'update_user_memory',
  description: 'Replace enabled User Memory after the Planner has identified an explicit long-term preference. Never use for trip-local facts.',
  inputSchema: updateUserMemoryInputSchema,
  outputSchema: getUserMemoryOutputSchema,
  costClass: 'free', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 2_000,
  async execute(input, context, signal) {
    if (signal.aborted || context.isGenerationCurrent?.() === false) throw new Error('User Memory update was cancelled')
    const current = await context.memory.get()
    if (!current.enabled) throw Object.assign(new Error('User Memory is disabled'), { code: 'USER_MEMORY_DISABLED' })
    const memory = await context.memory.updateMarkdown(input.markdown, input.expectedVersion)
    return { enabled: memory.enabled, markdown: memory.markdown, version: memory.version }
  }
}

export function createCoreToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(declareGoalTool)
    .register(getGoalTool)
    .register(resumeGoalTool)
    .register(finishGoalTool)
    .register(cancelGoalTool)
    .register(startRouteGenerationTool)
    .register(getTripArtifactsTool)
    .register(readArtifactTool)
    .register(getTripContextTool)
    .register(updateTripContextTool)
    .register(resolveLocationTool)
    .register(searchFlightsTool)
    .register(searchFlexibleFlightsTool)
    .register(confirmFlightPriceTool)
    .register(searchConnectionFlightsTool)
    .register(planFlightRouteTool)
    .register(optimizeRouteTool)
    .register(confirmRoutePriceTool)
    .register(searchDestinationsTool)
    .register(recommendDestinationsTool)
    .register(planTripRouteTool)
    .register(researchDestinationTool)
    .register(webResearchTool)
    .register(buildTravelGuideTool)
    .register(saveTravelGuideTool)
    .register(getUserMemoryTool)
    .register(updateUserMemoryTool)
}

/**
 * Conversation runtime vocabulary. The explicit start operation may enqueue
 * the deterministic engine, while its internal connection/path/optimization
 * tools remain unavailable to the Planner.
 */
export function createPlannerToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(declareGoalTool)
    .register(getGoalTool)
    .register(resumeGoalTool)
    .register(finishGoalTool)
    .register(cancelGoalTool)
    .register(startRouteGenerationTool)
    .register(getTripArtifactsTool)
    .register(readArtifactTool)
    .register(getTripContextTool)
    .register(updateTripContextTool)
    .register(resolveLocationTool)
    .register(searchFlightsTool)
    .register(searchFlexibleFlightsTool)
    .register(confirmFlightPriceTool)
    .register(searchDestinationsTool)
    .register(recommendDestinationsTool)
    .register(planTripRouteTool)
    .register(researchDestinationTool)
    .register(webResearchTool)
    .register(saveTravelGuideTool)
    .register(getUserMemoryTool)
    .register(updateUserMemoryTool)
}

export {
  getTripContextOutputSchema,
  resolveLocationInputSchema,
  searchFlightsInputSchema,
  searchFlightsOutputSchema,
  getUserMemoryOutputSchema,
  updateUserMemoryInputSchema,
  updateTripContextInputSchema,
  updateTripContextOutputSchema
}
