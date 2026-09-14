import { z } from 'zod'
import type { ArtifactRecord } from '../artifacts/repository.js'
import { routeSetPayloadSchema, type CompleteFlightPath, type ConnectionEdge } from '../flight-routing/types.js'
import { flexibleFlightSearchArtifactSchema } from '../fares/search-service.js'
import { flightSearchArtifactSchema, type FareOffer, type FareSearchInput } from '../fares/types.js'
import { AppError } from '../lib/errors.js'
import type { TripContext } from '../trips/types.js'
import type { LocationRef } from '../aviation/types.js'
import { airportExactIdentity, cityGroupingCode } from '../locations/identity.js'
import { CURATED_LOCATION_IDENTITY_POLICY } from '../locations/curated-directory.js'

export const layoverPreferenceSchema = z.enum(['airport_only', 'consider_city'])

const offerChoiceSchema = z.object({
  kind: z.literal('offer'), artifactId: z.string().uuid(), offerId: z.string().min(1).max(240),
  layoverPreference: layoverPreferenceSchema.default('airport_only')
}).strict()
const routeChoiceSchema = z.object({
  kind: z.literal('route'), artifactId: z.string().uuid(), routeId: z.string().min(1).max(160),
  layoverPreference: layoverPreferenceSchema.default('airport_only')
}).strict()
export const flightSelectionChoiceSchema = z.discriminatedUnion('kind', [offerChoiceSchema, routeChoiceSchema])
export type FlightSelectionChoice = z.infer<typeof flightSelectionChoiceSchema>

export const savedFlightSelectionSchema = z.discriminatedUnion('kind', [
  offerChoiceSchema.extend({ contextVersion: z.number().int().nonnegative(), revision: z.number().int().positive(), selectedAt: z.iso.datetime() }).strict(),
  routeChoiceSchema.extend({ contextVersion: z.number().int().nonnegative(), revision: z.number().int().positive(), selectedAt: z.iso.datetime() }).strict()
])
export type SavedFlightSelection = z.infer<typeof savedFlightSelectionSchema>

const legacySavedRouteSchema = z.object({
  artifactId: z.string().uuid(), routeId: z.string().min(1).max(160), contextVersion: z.number().int().nonnegative()
}).strict()

export function readSavedFlightSelection(value: unknown): SavedFlightSelection | null {
  const current = savedFlightSelectionSchema.safeParse(value)
  if (current.success) return current.data
  const legacy = legacySavedRouteSchema.safeParse(value)
  return legacy.success ? {
    kind: 'route', ...legacy.data, layoverPreference: 'airport_only', revision: 1,
    selectedAt: '1970-01-01T00:00:00.000Z'
  } : null
}

export function legacySavedRoute(selection: SavedFlightSelection | null) {
  return selection?.kind === 'route'
    ? { artifactId: selection.artifactId, routeId: selection.routeId, contextVersion: selection.contextVersion }
    : null
}

export function sameFlightChoice(selection: SavedFlightSelection | null, choice: FlightSelectionChoice | null): boolean {
  if (!selection || !choice || selection.kind !== choice.kind || selection.artifactId !== choice.artifactId
    || selection.layoverPreference !== choice.layoverPreference) return selection === null && choice === null
  return selection.kind === 'offer' && choice.kind === 'offer'
    ? selection.offerId === choice.offerId
    : selection.kind === 'route' && choice.kind === 'route' && selection.routeId === choice.routeId
}

export interface LayoverWindow {
  afterSegmentIndex: number
  arrivalAirport: string
  departureAirport: string
  arrivesAt?: string
  departsAt?: string
  durationMinutes?: number
  availableMinutes?: number
  overnight: boolean
  airportChange: boolean
  cityOption: 'airport_only' | 'conditional'
  selectedMode: 'airport' | 'conditional_city'
  assumptions: string[]
}

export interface SelectedFlightContext {
  selection: SavedFlightSelection
  query?: FareSearchInput
  offer?: Omit<FareOffer, 'bookingUrl'>
  route?: CompleteFlightPath
  segments: Array<{
    flightNumber?: string
    airline?: string
    origin: string
    destination: string
    departsAt?: string
    arrivesAt?: string
    durationMinutes?: number
  }>
  layoverWindows: LayoverWindow[]
}

const hasOffset = (value: string) => /(?:z|[+-]\d{2}:\d{2})$/i.test(value)
const minuteDifference = (left: string, right: string) => {
  const value = Math.round((Date.parse(right) - Date.parse(left)) / 60_000)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

type SelectionSegment = SelectedFlightContext['segments'][number]
type DeclaredLayover = {
  afterSegmentIndex: number
  durationMinutes?: number | undefined
  overnight?: boolean | undefined
  airportChange?: boolean | undefined
}

function layoverWindowsForSegments(
  segments: readonly SelectionSegment[],
  preference: SavedFlightSelection['layoverPreference'],
  declaredLayovers: readonly DeclaredLayover[] = []
): LayoverWindow[] {
  const declared = new Map(declaredLayovers.map(value => [value.afterSegmentIndex, value]))
  return segments.slice(0, -1).map((segment, index) => {
    const next = segments[index + 1]!
    const metadata = declared.get(index)
    const durationMinutes = metadata?.durationMinutes ?? (segment.arrivesAt && next.departsAt
      ? minuteDifference(segment.arrivesAt, next.departsAt) : undefined)
    const airportChange = metadata?.airportChange === true || segment.destination !== next.origin
    const timezoneKnown = Boolean(segment.arrivesAt && next.departsAt && hasOffset(segment.arrivesAt) && hasOffset(next.departsAt))
    const availableMinutes = durationMinutes === undefined ? undefined : Math.max(0, durationMinutes - 90 - 180)
    const cityEligible = durationMinutes !== undefined && durationMinutes >= 480 && !airportChange && timezoneKnown && availableMinutes !== undefined && availableMinutes >= 240
    const assumptions = [
      '按下机及必要手续预留 90 分钟',
      '按返场、安检及登机预留 180 分钟',
      ...(timezoneKnown ? [] : ['时区信息不足，不能确认市区游玩窗口']),
      ...(airportChange ? ['涉及换机场，不建议安排市区游玩'] : []),
      '入境资格、行李处理和地面交通需另行确认'
    ]
    return {
      afterSegmentIndex: index,
      arrivalAirport: segment.destination,
      departureAirport: next.origin,
      ...(segment.arrivesAt ? { arrivesAt: segment.arrivesAt } : {}),
      ...(next.departsAt ? { departsAt: next.departsAt } : {}),
      ...(durationMinutes === undefined ? {} : { durationMinutes }),
      ...(availableMinutes === undefined ? {} : { availableMinutes }),
      overnight: metadata?.overnight === true || Boolean(segment.arrivesAt && next.departsAt
        && segment.arrivesAt.slice(0, 10) !== next.departsAt.slice(0, 10)),
      airportChange,
      cityOption: cityEligible ? 'conditional' as const : 'airport_only' as const,
      selectedMode: preference === 'consider_city' && cityEligible ? 'conditional_city' as const : 'airport' as const,
      assumptions
    }
  })
}

function offerSegments(offer: FareOffer): SelectedFlightContext['segments'] {
  return offer.segments.map(segment => ({
    flightNumber: segment.flightNumber, airline: segment.airline,
    origin: segment.origin, destination: segment.destination,
    departsAt: segment.departsAt, arrivesAt: segment.arrivesAt,
    durationMinutes: segment.durationMinutes
  }))
}

function edgeSegments(edge: ConnectionEdge): SelectedFlightContext['segments'] {
  if (edge.segments?.length) return edge.segments.map(segment => ({
    ...(segment.flightNumber ? { flightNumber: segment.flightNumber } : {}),
    ...(segment.marketingCarrier ? { airline: segment.marketingCarrier } : {}),
    origin: segment.from.iata ?? segment.from.id,
    destination: segment.to.iata ?? segment.to.id,
    ...(segment.departureAt ? { departsAt: segment.departureAt } : {}),
    ...(segment.arrivalAt ? { arrivesAt: segment.arrivalAt } : {}),
    ...(segment.durationMinutes === undefined ? {} : { durationMinutes: segment.durationMinutes })
  }))
  return [{
    origin: edge.from.iata ?? edge.from.id, destination: edge.to.iata ?? edge.to.id,
    ...(edge.departureAt ? { departsAt: edge.departureAt } : {}),
    ...(edge.arrivalAt ? { arrivesAt: edge.arrivalAt } : {}),
    ...(edge.durationMinutes === undefined ? {} : { durationMinutes: edge.durationMinutes })
  }]
}

function routeLayoverWindows(path: CompleteFlightPath, preference: SavedFlightSelection['layoverPreference']): LayoverWindow[] {
  const windows: LayoverWindow[] = []
  let segmentOffset = 0
  for (const edge of path.edges) {
    const segments = edgeSegments(edge)
    windows.push(...layoverWindowsForSegments(segments, preference, (edge.layovers ?? []).map(layover => ({
      ...layover, airportChange: edge.airportChange
    }))).map(window => ({ ...window, afterSegmentIndex: window.afterSegmentIndex + segmentOffset })))
    segmentOffset += segments.length
  }
  return windows
}

function findOffer(record: ArtifactRecord, offerId: string): { offer: FareOffer; query: FareSearchInput } | undefined {
  if (record.type !== 'flight_search') return
  if (record.schemaVersion === 1) {
    const payload = flightSearchArtifactSchema.safeParse(record.payload)
    const offer = payload.success ? payload.data.offers.find(value => value.id === offerId) : undefined
    return payload.success && offer ? { offer, query: payload.data.query } : undefined
  }
  if (record.schemaVersion === 2) {
    const payload = flexibleFlightSearchArtifactSchema.safeParse(record.payload)
    if (!payload.success) return
    for (const result of payload.data.results) {
      const offer = result.offers.find(value => value.id === offerId)
      if (offer) return { offer, query: result.query }
    }
  }
}

export function assertFlightChoice(record: ArtifactRecord, choice: FlightSelectionChoice, currentContextVersion: number): void {
  if (record.tripContextVersion !== currentContextVersion) {
    throw new AppError(choice.kind === 'route' ? 'STALE_ROUTE_SELECTION' : 'STALE_FLIGHT_SELECTION', 'Trip conditions changed; search again before choosing this flight', 409)
  }
  if (choice.kind === 'offer') {
    if (!findOffer(record, choice.offerId)) throw new AppError('INVALID_FLIGHT_SELECTION', 'Choose an offer from this flight search', 400)
    return
  }
  const parsed = record.type === 'route_set' && record.schemaVersion === 1 ? routeSetPayloadSchema.safeParse(record.payload) : undefined
  if (!parsed?.success || parsed.data.kind !== 'optimized_routes' || !parsed.data.representatives.some(value => value.path.id === choice.routeId)) {
    throw new AppError('INVALID_ROUTE_SELECTION', 'Choose a generated route from this trip', 400)
  }
}

export function selectedFlightContext(selection: SavedFlightSelection, record: ArtifactRecord): SelectedFlightContext {
  if (selection.artifactId !== record.id) throw new AppError('RESOURCE_NOT_FOUND', 'Selected flight source was not found', 404)
  if (selection.kind === 'offer') {
    const found = findOffer(record, selection.offerId)
    if (!found) throw new AppError('INVALID_FLIGHT_SELECTION', 'Selected offer no longer exists in its source snapshot', 409)
    const { bookingUrl: _bookingUrl, ...offer } = found.offer
    const segments = offerSegments(found.offer)
    return {
      selection, query: found.query, offer, segments,
      layoverWindows: layoverWindowsForSegments(segments, selection.layoverPreference, found.offer.layovers)
    }
  }
  const payload = routeSetPayloadSchema.parse(record.payload)
  const route = payload.kind === 'optimized_routes'
    ? payload.representatives.find(value => value.path.id === selection.routeId)?.path
    : undefined
  if (!route) throw new AppError('INVALID_ROUTE_SELECTION', 'Selected route no longer exists in its source snapshot', 409)
  return {
    selection, route, segments: route.edges.flatMap(edgeSegments),
    layoverWindows: routeLayoverWindows(route, selection.layoverPreference)
  }
}

function locationMatchesAirport(location: LocationRef, airport: string): boolean {
  return location.type === 'airport'
    ? airportExactIdentity(location) === `airport:${airport}`
    : cityGroupingCode(location, CURATED_LOCATION_IDENTITY_POLICY) === cityGroupingCode(airport, CURATED_LOCATION_IDENTITY_POLICY)
}

function exactWindowMatches(window: TripContext['departureWindow'], date: string): boolean {
  return window?.precision === 'exact' && window.from === date && (window.to === undefined || window.to === date)
}

/**
 * A confirmed fare snapshot may survive preference-only Trip edits. The
 * exception is intentionally limited to the exact persisted offer and the
 * flight search inputs that the current Trip can still prove unchanged.
 */
export function isCompatibleSelectedFlightSource(
  record: ArtifactRecord,
  selectedFlight: SelectedFlightContext,
  currentTrip: TripContext
): boolean {
  const selection = selectedFlight.selection
  if (selection.kind !== 'offer' || selection.artifactId !== record.id
    || selection.contextVersion !== record.tripContextVersion) return false
  try {
    const restored = selectedFlightContext(selection, record)
    const query = restored.query
    if (!query || !currentTrip.origin || !locationMatchesAirport(currentTrip.origin, query.origin)
      || !exactWindowMatches(currentTrip.departureWindow, query.departureDate)) return false
    const required = currentTrip.destinationIntent.required
    if (required.length !== 1 || !locationMatchesAirport(required[0]!, query.destination)) return false
    if (query.returnDate === undefined ? currentTrip.returnWindow !== undefined
      : !exactWindowMatches(currentTrip.returnWindow, query.returnDate)) return false
    if (currentTrip.budget?.currency !== undefined && currentTrip.budget.currency !== query.currency) return false
    return restored.offer?.id === selection.offerId
  } catch {
    return false
  }
}
