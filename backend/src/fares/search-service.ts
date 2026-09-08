import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import type { ArtifactRecord } from '../artifacts/repository.js'
import { checkpoint, saveWorkspaceArtifact, type ArtifactWorkspace } from '../artifacts/workspace.js'
import type { FareProvider, FlexibleFareSearchInput } from './providers/provider.js'
import {
  fareSearchInputSchema,
  fareSearchResultSchema,
  flightSearchArtifactSchema,
  type FareSearchInput,
  type FareSearchResult,
  type FlightSearchArtifact
} from './types.js'

export interface FlightSearchDomainContext extends ArtifactWorkspace {
  fares: FareProvider
}

export interface StoredFlightSearch<TPayload> {
  record: ArtifactRecord
  payload: TPayload
}

export interface FlexibleFlightSearchArtifact {
  id: string
  type: 'flight_search'
  window: FlexibleFareSearchInput
  results: FareSearchResult[]
  scannedDates: string[]
  successfulDates: string[]
  failedDates: string[]
}

/** Runtime boundary for every flexible-search caller, including internal tools. */
export const flexibleFareSearchInputSchema = z.object({
  origin: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  departureDateFrom: z.iso.date(),
  departureDateTo: z.iso.date(),
  returnDate: z.iso.date().optional(),
  currency: z.enum(['CNY', 'USD', 'EUR']),
  travelClass: z.number().int().min(1).max(4)
}).strict().superRefine((input, context) => {
  if (input.origin === input.destination) {
    context.addIssue({ code: 'custom', message: 'Origin and destination must differ', path: ['destination'] })
  }
  const days = (Date.parse(`${input.departureDateTo}T00:00:00Z`) - Date.parse(`${input.departureDateFrom}T00:00:00Z`)) / 86_400_000
  if (days < 0 || days > 30) {
    context.addIssue({ code: 'custom', message: 'Departure window must be between 1 and 31 calendar days', path: ['departureDateTo'] })
  }
  if (input.returnDate && input.returnDate < input.departureDateTo) {
    context.addIssue({ code: 'custom', message: 'Return date must not precede the departure window', path: ['returnDate'] })
  }
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

function assertMatchingResult(result: FareSearchResult, query: FareSearchInput): void {
  if (result.query.origin !== query.origin
    || result.query.destination !== query.destination
    || result.query.departureDate !== query.departureDate
    || result.query.returnDate !== query.returnDate
    || result.query.currency !== query.currency
    || result.query.travelClass !== query.travelClass) {
    throw new Error('Fare provider returned a result for a different query')
  }
  for (const offer of result.offers) {
    const first = offer.segments[0]
    const last = offer.segments[offer.segments.length - 1]
    if (first?.origin !== query.origin || last?.destination !== query.destination) {
      throw new Error('Fare provider returned an offer for a different route')
    }
  }
}

/** Canonical exact-date search used by both the Planner tool and product UI. */
export async function executeFlightSearch(
  rawInput: FareSearchInput,
  context: FlightSearchDomainContext
): Promise<StoredFlightSearch<FlightSearchArtifact>> {
  const query = fareSearchInputSchema.parse(rawInput)
  await checkpoint(context)
  const result = fareSearchResultSchema.parse(await context.fares.searchFlights(query, context.signal ? { signal: context.signal } : undefined))
  assertMatchingResult(result, query)
  const id = uuidv7()
  const payload = flightSearchArtifactSchema.parse({ ...result, id, type: 'flight_search' })
  const record = await saveWorkspaceArtifact(context, {
    id,
    type: 'flight_search',
    schemaVersion: 1,
    payload,
    verification: payload.verification
  })
  return { record, payload }
}

function sameFlexibleQuery(result: FareSearchResult, query: FlexibleFareSearchInput): boolean {
  return result.query.origin === query.origin
    && result.query.destination === query.destination
    && result.query.currency === query.currency
    && result.query.travelClass === query.travelClass
    && result.query.returnDate === query.returnDate
    && result.query.departureDate >= query.departureDateFrom
    && result.query.departureDate <= query.departureDateTo
}

/** Canonical bounded-window search used by both the Planner tool and product UI. */
export async function executeFlexibleFlightSearch(
  rawQuery: FlexibleFareSearchInput,
  context: FlightSearchDomainContext
): Promise<StoredFlightSearch<FlexibleFlightSearchArtifact>> {
  const query = flexibleFareSearchInputSchema.parse(rawQuery)
  await checkpoint(context)
  const providerResult = await context.fares.searchFlexibleFlights(query, context.signal ? { signal: context.signal } : undefined)
  const results = providerResult.results.map(result => fareSearchResultSchema.parse(result))
  for (const result of results) {
    if (!sameFlexibleQuery(result, query)) throw new Error('Fare provider returned a result for a different flexible query')
    assertMatchingResult(result, result.query)
  }
  const scannedDates = [...new Set(providerResult.scannedDates)].sort()
  const successfulDates = [...new Set(results.map(result => result.query.departureDate))].sort()
  const failedDates = [...new Set(providerResult.failedDates)].sort()
  const scanned = new Set(scannedDates)
  for (const date of scannedDates) {
    if (date < query.departureDateFrom || date > query.departureDateTo) {
      throw new Error('Fare provider returned a sampled date outside the requested window')
    }
  }
  for (const date of [...successfulDates, ...failedDates]) {
    if (!scanned.has(date)) throw new Error('Fare provider returned inconsistent sampled-date metadata')
  }
  if (successfulDates.some(date => failedDates.includes(date))) {
    throw new Error('Fare provider marked a sampled date as both successful and failed')
  }
  if (results.length === 0 && failedDates.length > 0) throw new Error('Fare provider failed every sampled date')
  const id = uuidv7()
  const payload: FlexibleFlightSearchArtifact = {
    id,
    type: 'flight_search',
    window: query,
    results,
    scannedDates,
    successfulDates,
    failedDates
  }
  const record = await saveWorkspaceArtifact(context, {
    id,
    type: 'flight_search',
    schemaVersion: 2,
    payload,
    verification: results.map(result => result.verification)
  })
  return { record, payload }
}
