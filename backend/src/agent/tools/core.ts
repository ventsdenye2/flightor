import { createHash } from 'node:crypto'
import { z } from 'zod'
import { locationRefKey, locationRefSchema, locationResolutionSchema, type LocationRef } from '../../aviation/types.js'
import { fareSearchInputSchema, fareSearchResultSchema, flightSearchArtifactSchema } from '../../fares/types.js'
import { tripContextPatchSchema, tripContextSchema } from '../../trips/types.js'
import { ToolRegistry, type AgentTool } from '../runtime/registry.js'

const emptyObjectSchema = z.object({}).strict()
const getTripContextOutputSchema = z.object({ tripContext: tripContextSchema }).strict()
const updateTripContextInputSchema = z.object({
  patch: tripContextPatchSchema,
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
const searchableLocationSchema = locationRefSchema.refine(
  value => value.type === 'airport' && value.iata !== undefined,
  'Flight search requires a canonical airport reference with an IATA code'
)
const searchFlightsInputSchema = z.object({
  origin: searchableLocationSchema,
  destination: searchableLocationSchema,
  departureDate: z.iso.date(),
  returnDate: z.iso.date().optional(),
  currency: z.enum(['CNY', 'USD', 'EUR']).default('CNY'),
  travelClass: z.number().int().min(1).max(4).default(1)
}).strict().superRefine((input, context) => {
  const originCode = input.origin.iata ?? input.origin.cityCode
  const destinationCode = input.destination.iata ?? input.destination.cityCode
  if (originCode === destinationCode) {
    context.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  }
  if (input.returnDate && input.returnDate < input.departureDate) {
    context.addIssue({ code: 'custom', message: 'Return date must not precede departure', path: ['returnDate'] })
  }
})

function artifactId(value: unknown): string {
  return `artifact_fs_${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`
}

function sameFareQuery(
  left: z.infer<typeof fareSearchInputSchema>,
  right: z.infer<typeof fareSearchInputSchema>
): boolean {
  return left.origin === right.origin
    && left.destination === right.destination
    && left.departureDate === right.departureDate
    && left.returnDate === right.returnDate
    && left.currency === right.currency
    && left.travelClass === right.travelClass
}

function tripLocations(value: z.infer<typeof tripContextSchema>): LocationRef[] {
  return [
    ...(value.origin ? [value.origin] : []),
    ...value.destinationIntent.required,
    ...value.destinationIntent.preferred,
    ...value.destinationIntent.excluded,
    ...value.locationRoleOverrides.map(item => item.location)
  ]
}

function patchLocations(value: z.infer<typeof tripContextPatchSchema>): LocationRef[] {
  return [
    ...(value.origin ? [value.origin] : []),
    ...(value.destinationIntent?.required ?? []),
    ...(value.destinationIntent?.preferred ?? []),
    ...(value.destinationIntent?.excluded ?? []),
    ...(value.locationRoleOverrides ?? []).map(item => item.location)
  ]
}

function rememberLocations(context: { resolvedLocationKeys?: Set<string> }, values: readonly LocationRef[]): void {
  for (const value of values) context.resolvedLocationKeys?.add(locationRefKey(value))
}

function assertTrustedLocations(
  context: { resolvedLocationKeys?: Set<string> },
  values: readonly LocationRef[],
  existing: readonly LocationRef[] = []
): void {
  const allowed = new Set([
    ...(context.resolvedLocationKeys ?? []),
    ...existing.map(locationRefKey)
  ])
  for (const value of values) {
    if (!allowed.has(locationRefKey(value))) throw new Error('Location reference was not resolved by an authoritative provider')
  }
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
  description: 'Apply explicit current-trip constraints or preferences. This never changes long-term User Memory.',
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
    assertTrustedLocations(context, patchLocations(input.patch), tripLocations(current))
    if (Object.keys(input.patch).length === 0) {
      return { tripContext: current, changed: false }
    }
    const tripContext = await context.trips.update(context.tripId, input.patch, input.expectedVersion, {
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
  z.infer<typeof flightSearchArtifactSchema>
> = {
  name: 'search_flights',
  description: 'Search current fare options for one canonical airport leg. Prices and flight facts must come from this tool, never model memory.',
  inputSchema: searchFlightsInputSchema,
  outputSchema: flightSearchArtifactSchema,
  costClass: 'paid',
  costUnits: 4,
  sideEffect: 'none',
  // Fare search depends on location facts established by earlier tool results.
  // Keeping it ordered prevents same-batch resolve/search ledger races.
  parallelSafe: false,
  timeoutMs: 35_000,
  provider: 'fare_provider',
  async execute(input, context, signal) {
    assertTrustedLocations(context, [input.origin, input.destination])
    const query = fareSearchInputSchema.parse({
      origin: input.origin.iata,
      destination: input.destination.iata,
      departureDate: input.departureDate,
      ...(input.returnDate ? { returnDate: input.returnDate } : {}),
      currency: input.currency,
      travelClass: input.travelClass
    })
    const result = fareSearchResultSchema.parse(await context.fares.searchFlights(query, { signal }))
    if (!sameFareQuery(result.query, query)) {
      throw new Error('Fare provider returned a result for a different query')
    }
    for (const offer of result.offers) {
      const first = offer.segments[0]
      const last = offer.segments[offer.segments.length - 1]
      if (first?.origin !== query.origin || last?.destination !== query.destination) {
        throw new Error('Fare provider returned an offer for a different route')
      }
    }
    return {
      ...result,
      id: artifactId({ query: result.query, checkedAt: result.checkedAt, provider: result.provider }),
      type: 'flight_search' as const
    }
  }
}

export function createCoreToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(getTripContextTool)
    .register(updateTripContextTool)
    .register(resolveLocationTool)
    .register(searchFlightsTool)
}

export {
  getTripContextOutputSchema,
  resolveLocationInputSchema,
  searchFlightsInputSchema,
  updateTripContextInputSchema,
  updateTripContextOutputSchema
}
