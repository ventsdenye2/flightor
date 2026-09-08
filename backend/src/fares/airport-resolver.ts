import { z } from 'zod'
import { airportExactIdentity } from '../locations/identity.js'
import { locationRefSchema, type LocationRef } from '../aviation/types.js'
import type { AviationProvider } from '../aviation/providers/provider.js'
import { AppError } from '../lib/errors.js'

export const fareAirportSelectorSchema = z.string().trim().min(1).max(160)
export type FareAirportSelector = z.infer<typeof fareAirportSelectorSchema>

export interface ResolveFareAirportPairInput {
  origin: FareAirportSelector
  destination: FareAirportSelector
}

export interface ResolveFareAirportPairOptions {
  trustedLocations?: Iterable<LocationRef>
  signal?: AbortSignal
}

function iataForSelector(selector: FareAirportSelector, trustedLocations: Iterable<LocationRef>): string {
  const normalized = selector.trim()
  if (/^[A-Za-z]{3}$/.test(normalized)) return normalized.toUpperCase()
  const matches = [...trustedLocations].filter(location => location.id === normalized && location.type === 'airport' && location.iata)
  if (matches.length === 1) return matches[0]!.iata!
  throw new AppError('AIRPORT_SELECTOR_INVALID', 'Airport selector must be an IATA code or a trusted airport handle', 422)
}

async function resolveAirport(aviation: AviationProvider, iata: string, signal?: AbortSignal): Promise<LocationRef & { type: 'airport'; iata: string }> {
  signal?.throwIfAborted()
  const raw = await aviation.getAirport({ iata }, { ...(signal ? { signal } : {}) })
  signal?.throwIfAborted()
  const parsed = locationRefSchema.safeParse(raw)
  if (!parsed.success || parsed.data.type !== 'airport' || parsed.data.iata !== iata) {
    throw new AppError('AIRPORT_NOT_FOUND', `Airport ${iata} was not resolved by the authoritative aviation capability`, 422)
  }
  return parsed.data as LocationRef & { type: 'airport'; iata: string }
}

/**
 * Resolve model-selected codes/handles back to authoritative airport facts
 * before a paid fare provider is called. Descriptive model fields are never
 * accepted by this boundary.
 */
export async function resolveFareAirportPair(
  aviation: AviationProvider,
  rawInput: ResolveFareAirportPairInput,
  options: ResolveFareAirportPairOptions = {}
): Promise<{ origin: LocationRef & { type: 'airport'; iata: string }; destination: LocationRef & { type: 'airport'; iata: string } }> {
  const input = z.object({ origin: fareAirportSelectorSchema, destination: fareAirportSelectorSchema }).strict().parse(rawInput)
  const trusted = options.trustedLocations ?? []
  const originIata = iataForSelector(input.origin, trusted)
  const destinationIata = iataForSelector(input.destination, trusted)
  if (originIata === destinationIata) throw new AppError('ORIGIN_DESTINATION_SAME', 'Origin and destination airports must differ', 422)
  const [origin, destination] = await Promise.all([
    resolveAirport(aviation, originIata, options.signal),
    resolveAirport(aviation, destinationIata, options.signal)
  ])
  if (airportExactIdentity(origin) === airportExactIdentity(destination)) {
    throw new AppError('ORIGIN_DESTINATION_SAME', 'Origin and destination airports must differ', 422)
  }
  return { origin, destination }
}
