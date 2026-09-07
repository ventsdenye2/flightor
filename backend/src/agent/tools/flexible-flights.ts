import { z } from 'zod'
import { locationRefKey, locationRefSchema, type LocationRef } from '../../aviation/types.js'
import { fareSearchResultSchema } from '../../fares/types.js'
import type { FlexibleFareSearchInput } from '../../fares/providers/provider.js'
import { executeFlexibleFlightSearch } from '../../fares/search-service.js'
import type { AgentTool } from '../runtime/registry.js'
import type { ToolExecutionContext } from '../runtime/registry.js'

const searchableLocationSchema = locationRefSchema.refine(
  value => value.type === 'airport' && value.iata !== undefined,
  'Flight search requires a canonical airport reference with an IATA code'
)

export const searchFlexibleFlightsInputSchema = z.object({
  origin: searchableLocationSchema,
  destination: searchableLocationSchema,
  departureDateFrom: z.iso.date(),
  departureDateTo: z.iso.date(),
  returnDate: z.iso.date().optional(),
  currency: z.enum(['CNY', 'USD', 'EUR']).default('CNY'),
  travelClass: z.number().int().min(1).max(4).default(1)
}).strict().superRefine((input, context) => {
  const from = Date.parse(`${input.departureDateFrom}T00:00:00Z`)
  const to = Date.parse(`${input.departureDateTo}T00:00:00Z`)
  const days = (to - from) / 86_400_000
  const origin = input.origin.iata
  const destination = input.destination.iata
  if (origin === destination) context.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  if (days < 0) context.addIssue({ code: 'custom', message: 'Departure date window must not be reversed', path: ['departureDateTo'] })
  if (days > 30) context.addIssue({ code: 'custom', message: 'Departure window must be at most 31 calendar days', path: ['departureDateTo'] })
  if (input.returnDate && input.returnDate < input.departureDateTo) context.addIssue({ code: 'custom', message: 'Return date must not precede the departure window', path: ['returnDate'] })
})

export const flexibleFlightSearchArtifactSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('flight_search'),
  window: z.object({
    origin: z.string().regex(/^[A-Z]{3}$/),
    destination: z.string().regex(/^[A-Z]{3}$/),
    departureDateFrom: z.iso.date(),
    departureDateTo: z.iso.date(),
    returnDate: z.iso.date().optional(),
    currency: z.enum(['CNY', 'USD', 'EUR']),
    travelClass: z.number().int().min(1).max(4)
  }).strict(),
  results: z.array(fareSearchResultSchema).max(31),
  scannedDates: z.array(z.iso.date()).max(31),
  successfulDates: z.array(z.iso.date()).max(31),
  failedDates: z.array(z.iso.date()).max(31)
}).strict()

export const searchFlexibleFlightsOutputSchema = z.object({
  artifact: z.object({ id: z.string().uuid(), type: z.literal('flight_search'), schemaVersion: z.literal(2) }).strict(),
  summary: z.object({
    origin: z.string().regex(/^[A-Z]{3}$/), destination: z.string().regex(/^[A-Z]{3}$/),
    departureDateFrom: z.iso.date(), departureDateTo: z.iso.date(),
    scannedDates: z.array(z.iso.date()).max(31), successfulDates: z.array(z.iso.date()).max(31), failedDates: z.array(z.iso.date()).max(31),
    offerCount: z.number().int().nonnegative(),
    lowestFare: z.object({ amount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/), departureDate: z.iso.date() }).strict().optional(),
    checkedAt: z.iso.datetime(), provider: z.string().min(1),
    verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified'])
  }).strict()
}).strict()

function key(location: LocationRef): string { return location.iata ?? location.cityCode ?? '' }
function trusted(context: ToolExecutionContext, locations: LocationRef[]): void {
  const allowed = context.resolvedLocationKeys ?? new Set<string>()
  for (const location of locations) {
    if (!allowed.has(locationRefKey(location))) {
      throw new Error('Location reference was not resolved by an authoritative provider')
    }
  }
}

export const searchFlexibleFlightsTool: AgentTool<z.infer<typeof searchFlexibleFlightsInputSchema>, z.infer<typeof searchFlexibleFlightsOutputSchema>> = {
  name: 'search_flexible_flights',
  description: 'Search normalized fare options within a bounded departure-date window.',
  inputSchema: searchFlexibleFlightsInputSchema,
  outputSchema: searchFlexibleFlightsOutputSchema,
  costClass: 'paid', costUnits: 4, sideEffect: 'state', parallelSafe: false, timeoutMs: 35_000, provider: 'fare_provider',
  async execute(input, context, signal) {
    trusted(context, [input.origin, input.destination])
    const query: FlexibleFareSearchInput = { origin: key(input.origin), destination: key(input.destination), departureDateFrom: input.departureDateFrom, departureDateTo: input.departureDateTo, ...(input.returnDate ? { returnDate: input.returnDate } : {}), currency: input.currency, travelClass: input.travelClass }
    const { record: stored, payload: rawArtifact } = await executeFlexibleFlightSearch(query, {
      fares: context.fares, artifacts: context.artifacts,
      tripId: context.tripId, conversationId: context.conversationId,
      signal, ...(context.isGenerationCurrent ? { isCurrent: context.isGenerationCurrent } : {})
    })
    const artifact = flexibleFlightSearchArtifactSchema.parse(rawArtifact)
    const { results, scannedDates, successfulDates, failedDates } = artifact
    const offers = results.flatMap(result => result.offers)
    const lowest = results.flatMap(result => result.offers.map(offer => ({ offer, departureDate: result.query.departureDate }))).sort((a, b) => a.offer.totalAmount - b.offer.totalAmount)[0]
    const checkedAt = results.map(result => result.checkedAt).sort().at(-1) ?? new Date().toISOString()
    const provider = results[0]?.provider ?? context.fares.name
    const statuses = results.map(result => result.verification.status)
    const verificationStatus = results.length === 0
      ? 'unverified'
      : statuses.includes('unverified')
        ? 'unverified'
        : statuses.includes('stale')
          ? 'stale'
          : failedDates.length > 0 || statuses.some(status => status !== 'verified')
            ? 'partially_verified'
            : 'verified'
    return { artifact: { id: stored.id, type: 'flight_search', schemaVersion: 2 }, summary: { origin: query.origin, destination: query.destination, departureDateFrom: query.departureDateFrom, departureDateTo: query.departureDateTo, scannedDates, successfulDates, failedDates, offerCount: offers.length, ...(lowest ? { lowestFare: { amount: lowest.offer.totalAmount, currency: lowest.offer.currency, departureDate: lowest.departureDate } } : {}), checkedAt, provider, verificationStatus } }
  }
}
