import { describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import type { LocationRef, VerificationRecord } from '../../aviation/types.js'
import type { FareSearchResult } from '../../fares/types.js'
import { ParetoRouteOptimizer } from '../../flight-routing/optimizer.js'
import type { CompleteFlightPath, RouteSetPayload } from '../../flight-routing/types.js'
import type { ResearchArtifact } from '../../research-agent/types.js'
import { DeterministicTravelGuideBuilder } from '../../travel-guides/artifact-builder.js'
import type { TravelGuideArtifactPayload } from '../../travel-guides/artifact.js'
import type { TripRoutePlanPayload } from '../../trip-planning/types.js'
import { emptyTripContext, type TripContext } from '../../trips/types.js'
import { createDefaultGoalVerifierRegistry } from './default-verifiers.js'
import { canonicalFingerprint, InMemoryGoalRepository, InMemoryGoalRunRepository } from './repository.js'
import type { GoalIntent } from './types.js'
import { selectedFlightContext } from '../../workspaces/flight-selection.js'

const now = '2026-09-08T00:00:00.000Z'
const pvg: LocationRef = { id: 'airport:PVG', type: 'airport', name: 'Pudong', countryCode: 'CN', iata: 'PVG', cityCode: 'SHA' }
const tokyo: LocationRef = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const osaka: LocationRef = { id: 'city:OSA', type: 'city', name: 'Osaka', countryCode: 'JP', cityCode: 'OSA' }
const verified: VerificationRecord = {
  status: 'verified', checkedAt: now, expiresAt: '2026-12-08T00:00:00.000Z', confidence: 1,
  sources: [{ provider: 'research-search', reference: 'https://example.com/museum' }]
}
const guideIntent: GoalIntent = {
  kind: 'travel_guide',
  parameters: { questions: ['Which museums can I visit?'], researchTypes: ['activity'], maxResults: 10, maxCities: 2, allowPartial: false }
}
const flightIntent: GoalIntent = { kind: 'flight_search', parameters: { requestKey: 'outbound', departureDate: '2026-10-10' } }

async function fixture(intent: GoalIntent = guideIntent, patch: Partial<TripContext> = {}) {
  const ownerId = 'goal-verifier-owner'
  const tripId = 'goal-verifier-trip'
  const trip: TripContext = {
    ...emptyTripContext(tripId), version: 3, travelDays: 5, origin: pvg,
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' },
    destinationIntent: { mode: 'explicit', required: [tokyo], preferred: [], excluded: [] }, ...patch
  }
  const goals = new InMemoryGoalRepository(ownerId)
  const goal = (await goals.create({ ...intent, tripId, createdContextVersion: trip.version, idempotencyKey: 'goal',
    ...(intent.kind === 'route_generation' ? { authorization: { source: 'button' as const, grantedAt: now } } : {}) })).goal
  const runs = new InMemoryGoalRunRepository(ownerId, goals)
  const run = (await runs.create({ goalId: goal.id, tripId, generationId: 'generation', contextVersion: trip.version, contextSnapshot: trip, idempotencyKey: 'run' })).run
  const artifacts = new InMemoryArtifactRepository(ownerId, new Set([tripId]))
  const context = { ownerId, tripId, run, artifacts, currentTrip: trip, now }
  const lineage = { tripId, goalId: goal.id, runId: run.id, tripContextVersion: trip.version }
  return { trip, goal, artifacts, context, lineage, verify: () => createDefaultGoalVerifierRegistry().verify(goal, context) }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

function fare(query: Partial<FareSearchResult['query']> = {}): FareSearchResult {
  return {
    query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-10', currency: 'CNY', travelClass: 1, ...query },
    offers: [], provider: 'verified-fare-provider', checkedAt: now, verification: verified
  }
}

async function storeFare(test: Fixture, result: FareSearchResult = fare()) {
  const id = uuidv7()
  return test.artifacts.create({ ...test.lineage, id, type: 'flight_search', schemaVersion: 1,
    payload: { ...result, id, type: 'flight_search' }, verification: result.verification })
}

async function storeFlexible(test: Fixture, results: FareSearchResult[], failedDates: string[] = []) {
  const id = uuidv7()
  const successfulDates = results.map(result => result.query.departureDate)
  return test.artifacts.create({ ...test.lineage, id, type: 'flight_search', schemaVersion: 2,
    payload: { id, type: 'flight_search', window: { origin: 'PVG', destination: 'NRT', departureDateFrom: '2026-10-09', departureDateTo: '2026-10-11', currency: 'CNY', travelClass: 1 },
      results, successfulDates, failedDates, scannedDates: [...successfulDates, ...failedDates] },
    verification: results.map(result => result.verification) })
}

async function guideData(test: Fixture, options: {
  dayCount?: number
  findingCount?: number
  evidence?: VerificationRecord
  city?: LocationRef
  sourceVersion?: number
  mutateResearch?: (research: ResearchArtifact) => void
} = {}) {
  const city = options.city ?? tokyo
  const dayCount = options.dayCount ?? test.trip.travelDays ?? 5
  const evidence = options.evidence ?? verified
  const sourceVersion = options.sourceVersion ?? test.trip.version
  const destination = await test.artifacts.create({ tripId: test.trip.id, tripContextVersion: sourceVersion,
    type: 'destination_set', schemaVersion: 1, payload: {}, verification: verified })
  const route: TripRoutePlanPayload = {
    kind: 'trip_route_plan', schemaVersion: 1, plannerVersion: 'test', tripContextVersion: sourceVersion, sourceArtifactIds: [destination.id],
    cities: [{ location: city, stayDays: dayCount, role: 'visit', reasons: ['required'] }],
    days: Array.from({ length: dayCount }, (_, index) => ({ day: index + 1, city, activityRefs: [] })),
    stopoverOnly: [], landTransfers: [], unassignedActivityRefs: [], verification: verified, warnings: []
  }
  const routeRecord = await test.artifacts.create({ tripId: test.trip.id, tripContextVersion: sourceVersion,
    type: 'route', schemaVersion: 1, payload: route, sourceArtifactIds: [destination.id], verification: route.verification })
  const research: ResearchArtifact = {
    id: uuidv7(), type: 'research', schemaVersion: 2,
    brief: { destinations: [city], interests: [], questions: ['Museum opening information'], researchTypes: ['activity'], maxResults: 10,
      travelWindow: { from: '2026-10-10', to: '2026-10-14' } },
    findings: Array.from({ length: options.findingCount ?? dayCount }, (_, index) => ({
      id: `finding-${index}`, category: 'activity', destinations: [city], title: `Museum ${index}`, summary: `Verified museum ${index} information.`,
      sources: [{ title: 'Museum', url: 'https://example.com/museum', domain: 'example.com', snippet: 'Museum information.', authority: 'official_venue' }],
      verification: evidence, warnings: []
    })), queryCount: 1, warnings: [], createdAt: now
  }
  options.mutateResearch?.(research)
  await test.artifacts.create({ id: research.id, tripId: test.trip.id, tripContextVersion: sourceVersion,
    type: 'research', schemaVersion: 2, payload: research, verification: evidence })
  const payload = await new DeterministicTravelGuideBuilder().build({ routeArtifactId: routeRecord.id, route, researchArtifacts: [research] })
  const store = (value: TravelGuideArtifactPayload = payload) => test.artifacts.create({ ...test.lineage, type: 'travel_guide', schemaVersion: 1,
    payload: value, sourceArtifactIds: [routeRecord.id, research.id], verification: value.verification })
  return { payload, routeRecord, research, store }
}

describe('default flight-search goal verifier', () => {
  it('waits for an artifact and rejects a malformed payload despite a verified envelope', async () => {
    const test = await fixture(flightIntent)
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['flight_search_artifact'] })
    await test.artifacts.create({ ...test.lineage, type: 'flight_search', schemaVersion: 1, payload: {}, verification: verified })
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: ['flight_search_payload'] })
  })

  it('does not finish an October 10 goal from a November 11 search', async () => {
    const test = await fixture(flightIntent)
    await storeFare(test, fare({ departureDate: '2026-11-11' }))
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['flight_departure_date'], artifactIds: [] })
    const correct = await storeFare(test)
    expect(await test.verify()).toMatchObject({ status: 'satisfied', artifactIds: [correct.id], missing: [] })
  })

  it('matches the frozen origin and required destination while allowing a city airport', async () => {
    const test = await fixture(flightIntent)
    await storeFare(test, fare({ origin: 'PEK', destination: 'KIX' }))
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['flight_origin', 'flight_destination'] })
    await storeFare(test, fare({ destination: 'HND' }))
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('does not collapse two explicitly selected airports in the same city', async () => {
    const nrt: LocationRef = { ...tokyo, id: 'airport:NRT', type: 'airport', iata: 'NRT' }
    const test = await fixture(flightIntent, { destinationIntent: { mode: 'explicit', required: [nrt], preferred: [], excluded: [] } })
    await storeFare(test, fare({ destination: 'HND' }))
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['flight_destination'] })
  })

  it('checks an explicit return date and uses the Trip departure window when no goal date is specified', async () => {
    const test = await fixture({ kind: 'flight_search', parameters: { requestKey: 'roundtrip', returnDate: '2026-10-14' } })
    await storeFare(test, fare({ departureDate: '2026-10-12', returnDate: '2026-10-15' }))
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['flight_departure_date', 'flight_return_date'] })
  })

  it('completes a verified search with no offers without claiming that a ticket was found', async () => {
    const test = await fixture(flightIntent)
    await storeFare(test)
    expect(await test.verify()).toMatchObject({ status: 'satisfied', missing: [] })
  })

  it('accepts the requested exact sample from flexible search even when unrelated dates failed', async () => {
    const test = await fixture(flightIntent)
    await storeFlexible(test, [fare()], ['2026-10-09'])
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('does not satisfy an exact date from only other flexible samples', async () => {
    const test = await fixture(flightIntent)
    await storeFlexible(test, [fare({ departureDate: '2026-10-11' })], ['2026-10-10'])
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['flight_departure_date'] })
  })

  it('keeps incomplete flexible searches partial and rejects contradictory sample metadata', async () => {
    const test = await fixture({ kind: 'flight_search', parameters: { requestKey: 'window' } },
      { departureWindow: { from: '2026-10-09', to: '2026-10-11', precision: 'approximate' } })
    await storeFlexible(test, [fare()], ['2026-10-09'])
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['flight_date_coverage'] })
    const malformed = await fixture(flightIntent)
    await storeFlexible(malformed, [fare()], ['2026-10-10'])
    expect(await malformed.verify()).toMatchObject({ status: 'failed', missing: ['flight_search_date_metadata'] })
  })

  it('rechecks evidence expiry and the current Trip version', async () => {
    const test = await fixture(flightIntent)
    await storeFare(test, { ...fare(), verification: { ...verified, expiresAt: '2026-09-07T00:00:00.000Z' } })
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['verified_evidence'] })
    test.context.currentTrip = { ...test.trip, version: test.trip.version + 1 }
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['current_trip_context'] })
  })
})

describe('default travel-guide goal verifier', () => {
  it('requires all fixed calendar days even when travelDays was not separately supplied', async () => {
    const test = await fixture()
    delete test.trip.travelDays
    delete test.context.run.contextSnapshot.travelDays
    test.trip.departureWindow = { from: '2026-10-12', to: '2026-10-12', precision: 'exact' }
    test.trip.returnWindow = { from: '2026-10-14', to: '2026-10-14', precision: 'exact' }
    test.context.run.contextSnapshot = structuredClone(test.trip)
    const guide = await guideData(test, { dayCount: 2, mutateResearch: research => { research.brief.travelWindow = { from: '2026-10-12', to: '2026-10-14' } } })
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['guide_day_coverage'] })
  })

  it('rejects a historical guide whose dates contradict its accepted duration', async () => {
    const test = await fixture(guideIntent, {
      travelDays: 2,
      departureWindow: { from: '2026-10-12', to: '2026-10-13', precision: 'exact' },
      returnWindow: { from: '2026-10-14', to: '2026-10-14', precision: 'exact' }
    })
    const guide = await guideData(test)
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: ['trip_dates_inconsistent'], artifactIds: [] })
  })

  it('does not equate verified evidence with a complete five-day itinerary', async () => {
    const test = await fixture()
    const guide = await guideData(test, { findingCount: 1 })
    expect(guide.payload.days.map(day => day.items.length)).toEqual([1, 0, 0, 0, 0])
    expect(guide.payload.verification.status).toBe('verified')
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['guide_daily_activity_coverage'] })
  })

  it('satisfies a complete guide from compatible persisted sources, without requiring a particular tool order', async () => {
    const test = await fixture()
    const guide = await guideData(test)
    const record = await guide.store()
    expect(await test.verify()).toEqual({ status: 'satisfied', artifactIds: [record.id], missing: [], warnings: [] })
  })

  it('accepts only the current confirmed offer as an older guide source', async () => {
    const test = await fixture()
    const guide = await guideData(test)
    const flightId = uuidv7()
    const offer = {
      id: 'confirmed-offer',
      segments: [{ flightNumber: 'FX1', airline: 'Fixture Air', origin: 'PVG', destination: 'NRT',
        departsAt: '2026-10-10T09:00:00+08:00', arrivesAt: '2026-10-10T14:00:00+09:00', durationMinutes: 240 }],
      totalAmount: 3200, currency: 'CNY', airlines: ['Fixture Air'], transferType: 'direct' as const
    }
    const flight = await test.artifacts.create({ id: flightId, tripId: test.trip.id, tripContextVersion: test.trip.version - 1,
      type: 'flight_search', schemaVersion: 1, payload: {
        id: flightId, type: 'flight_search', query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-10', currency: 'CNY', travelClass: 1 },
        offers: [offer], provider: 'fixture', checkedAt: now, verification: verified
      } })
    const selection = { kind: 'offer' as const, artifactId: flight.id, offerId: offer.id, layoverPreference: 'airport_only' as const,
      contextVersion: test.trip.version - 1, revision: 1, selectedAt: now }
    test.context.selectedFlight = selectedFlightContext(selection, flight)
    const destinationId = (guide.routeRecord.payload as TripRoutePlanPayload).sourceArtifactIds[0]!
    const routeId = uuidv7()
    const routePayload = { ...(guide.routeRecord.payload as TripRoutePlanPayload), sourceArtifactIds: [destinationId, flight.id] }
    const route = await test.artifacts.create({ ...test.lineage, id: routeId, type: 'route', schemaVersion: 1,
      payload: routePayload, sourceArtifactIds: routePayload.sourceArtifactIds,
      isSourceContextCompatible: source => source.id === flight.id })
    const payload: TravelGuideArtifactPayload = {
      ...guide.payload, routeArtifactId: route.id,
      sourceArtifactIds: [route.id, destinationId, guide.research.id, flight.id],
      flightSelection: { kind: 'offer', artifactId: flight.id, choiceId: offer.id, revision: 1, selectedAt: now }
    }
    const record = await test.artifacts.create({ ...test.lineage, type: 'travel_guide', schemaVersion: 1,
      payload, sourceArtifactIds: payload.sourceArtifactIds,
      isSourceContextCompatible: source => source.id === flight.id })
    expect(await test.verify()).toMatchObject({ status: 'satisfied', artifactIds: [record.id] })

    test.context.selectedFlight = selectedFlightContext({ ...selection, revision: 2 }, flight)
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: ['guide_flight_selection_stale'] })
  })

  it.each([false, true])('keeps daily coverage mandatory when allowPartial=%s', async allowPartial => {
    const test = await fixture({ ...guideIntent, parameters: { ...guideIntent.parameters, allowPartial } })
    const guide = await guideData(test, { findingCount: 1 })
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['guide_daily_activity_coverage'] })
  })

  it.each([false, true])('applies allowPartial=%s to evidence quality without rewriting evidence status', async allowPartial => {
    const test = await fixture({ ...guideIntent, parameters: { ...guideIntent.parameters, allowPartial } })
    const guide = await guideData(test, { evidence: { ...verified, status: 'partially_verified', confidence: 0.6 } })
    await guide.store()
    expect(guide.payload.verification.status).toBe('partially_verified')
    expect(await test.verify()).toMatchObject({ status: allowPartial ? 'satisfied' : 'partial',
      missing: allowPartial ? [] : ['verified_evidence'], warnings: ['evidence_partially_verified'] })
  })

  it('rejects an old five-day route repackaged as the current ten-day Trip version', async () => {
    const test = await fixture(guideIntent, { travelDays: 10 })
    const guide = await guideData(test, { dayCount: 5, sourceVersion: test.trip.version - 1 })
    // Simulate a historical invalid record; the current repository also rejects creating this lineage.
    test.artifacts.listForRun = async () => [{ ...test.lineage, id: uuidv7(), type: 'travel_guide', schemaVersion: 1,
      payload: guide.payload, sourceArtifactIds: [guide.routeRecord.id, guide.research.id], verification: guide.payload.verification,
      createdAt: now, updatedAt: now }]
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: ['guide_source_scope'] })
  })

  it('checks requested day count even if all source envelopes carry the current version', async () => {
    const test = await fixture(guideIntent, { travelDays: 10 })
    const guide = await guideData(test, { dayCount: 5 })
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['guide_day_coverage']) })
  })

  it('checks required cities, excluded cities, and requested research categories', async () => {
    const test = await fixture({ ...guideIntent, parameters: { ...guideIntent.parameters, researchTypes: ['activity', 'event'] } },
      { destinationIntent: { mode: 'explicit', required: [tokyo], preferred: [], excluded: [osaka] } })
    const guide = await guideData(test, { city: osaka })
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial',
      missing: expect.arrayContaining(['guide_required_city_coverage', 'guide_excluded_city', 'guide_research_type:event']) })
  })

  it('does not accept evidence collected for a different travel window', async () => {
    const test = await fixture()
    const guide = await guideData(test, { mutateResearch: research => { research.brief.travelWindow = { from: '2026-09-01', to: '2026-09-05' } } })
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['research_travel_window'] })
  })

  it('rechecks persisted finding expiry rather than trusting a copied verified status', async () => {
    const test = await fixture()
    const guide = await guideData(test, { evidence: { ...verified, expiresAt: '2026-09-07T00:00:00.000Z' } })
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['eligible_research_evidence', 'guide_daily_activity_coverage']) })
  })

  it('rejects a guide item whose text or verification no longer matches its source finding', async () => {
    const test = await fixture()
    const guide = await guideData(test)
    guide.payload.days[0]!.items[0]!.description = 'Unsupported claim.'
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: expect.arrayContaining(['guide_item_evidence_mismatch']) })
  })

  it('rejects a missing or inaccessible source without accepting its copied evidence', async () => {
    const test = await fixture()
    const guide = await guideData(test)
    await guide.store()
    const get = test.artifacts.get.bind(test.artifacts)
    test.artifacts.get = async id => id === guide.research.id ? undefined : get(id)
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: ['guide_source_scope'] })
  })

  it('checks the declared result bound and explicitly requested activities', async () => {
    const test = await fixture({ ...guideIntent, parameters: { ...guideIntent.parameters, maxResults: 2 } },
      { mustIncludeEvents: [{ id: 'requested-event', title: 'Required event' }] })
    const guide = await guideData(test)
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['guide_result_limit', 'guide_required_activity_coverage']) })
  })

  it('rejects duplicate day numbers and does not reuse one finding to fill multiple days', async () => {
    const test = await fixture()
    const guide = await guideData(test)
    guide.payload.days[1]!.day = 1
    await guide.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['guide_day_coverage']) })
    const duplicate = await fixture()
    const duplicateGuide = await guideData(duplicate)
    duplicateGuide.payload.days[1]!.items = structuredClone(duplicateGuide.payload.days[0]!.items)
    await duplicateGuide.store()
    expect(await duplicate.verify()).toMatchObject({ status: 'failed', missing: ['guide_duplicate_evidence'] })
  })
})

async function routeData(test: Fixture, patch: Partial<CompleteFlightPath> = {}) {
  const destination: LocationRef = { ...tokyo, id: 'airport:NRT', type: 'airport', iata: 'NRT' }
  const path: CompleteFlightPath = {
    id: 'complete-path', nodes: [{ location: pvg, role: 'origin' }, { location: destination, role: 'destination' }],
    edges: [{ id: 'direct', from: pvg, to: destination, departureDate: '2026-10-10', transferType: 'direct',
      availability: 'verified', verification: verified, warnings: [], reasons: [] }],
    transferCount: 0, feasibility: 'feasible', warnings: [], ...patch
  }
  const source = await test.artifacts.create({ ...test.lineage, type: 'route_set', schemaVersion: 1, sourceArtifactIds: [],
    payload: { kind: 'flight_paths', schemaVersion: 1, serviceVersion: 'test', algorithmVersion: 'test', sourceArtifactIds: [],
      paths: [path], verification: verified, warnings: [], truncated: false, exhausted: true }, verification: verified })
  const optimization = await new ParetoRouteOptimizer().optimize({ paths: [path], weights: {}, preferredLocations: [], interestLocations: [], maxRepresentatives: 3 })
  const payload: Extract<RouteSetPayload, { kind: 'optimized_routes' }> = { ...optimization, kind: 'optimized_routes', schemaVersion: 1, sourceArtifactIds: [source.id] }
  const store = () => test.artifacts.create({ ...test.lineage, type: 'route_set', schemaVersion: 1, payload,
    sourceArtifactIds: [source.id], verification: payload.verification })
  return { payload, path, store }
}

describe('default route-generation goal verifier', () => {
  const intent: GoalIntent = { kind: 'route_generation', parameters: { requestKey: 'route' } }

  it('checks excluded airports inside a complete airline fare instead of looking only at visit nodes', async () => {
    const hub: LocationRef = { id: 'airport:ICN', type: 'airport', name: 'Incheon', iata: 'ICN', countryCode: 'KR' }
    const test = await fixture(intent, { destinationIntent: { mode: 'explicit', required: [tokyo], preferred: [], excluded: [hub] } })
    const seed = await routeData(test)
    const edge = seed.path.edges[0]!
    const route = await routeData(test, { edges: [{ ...edge, transferType: 'airline', protectedConnection: true,
      segments: [
        { id: 'first', from: pvg, to: hub, verification: verified },
        { id: 'second', from: hub, to: edge.to, verification: verified }
      ], layovers: [{ afterSegmentIndex: 0, durationMinutes: 120 }]
    }], transferCount: 1 })
    await route.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['route_excluded_location']) })
  })

  it('requires physical transfer counts and preserves long-stopover consent for an airline edge', async () => {
    const test = await fixture(intent)
    const seed = await routeData(test)
    const edge = seed.path.edges[0]!
    const hub: LocationRef = { id: 'airport:ICN', type: 'airport', name: 'Incheon', iata: 'ICN', countryCode: 'KR' }
    const route = await routeData(test, { edges: [{ ...edge, transferType: 'airline',
      segments: [{ id: 'first', from: pvg, to: hub, verification: verified }, { id: 'second', from: hub, to: edge.to, verification: verified }],
      layovers: [{ afterSegmentIndex: 0, durationMinutes: 700 }]
    }], transferCount: 0 })
    // Simulate an older persisted optimizer result with incorrect transfer metadata.
    // Current optimization already rejects it; Goal verification must also check it.
    route.payload.representatives = [{ ...seed.payload.representatives[0]!, path: route.path }]
    await route.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['route_transfer_count', 'route_long_stopover_policy']) })
  })

  it('requires a nonempty optimized set and does not accept intermediate paths as completion', async () => {
    const test = await fixture(intent)
    const route = await routeData(test)
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['optimized_routes_artifact'] })
    route.payload.representatives = []
    await route.store()
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['route_representatives'] })
  })

  it('verifies a supported path and its persisted source independently of any model narration', async () => {
    const test = await fixture(intent)
    const route = await routeData(test)
    const record = await route.store()
    expect(await test.verify()).toMatchObject({ status: 'satisfied', missing: [], artifactIds: [record.id] })
  })

  it('checks the snapshot departure window and origin even for a verified optimized artifact', async () => {
    const test = await fixture(intent, { origin: { ...pvg, id: 'airport:PEK', iata: 'PEK' },
      departureWindow: { from: '2026-11-11', to: '2026-11-11', precision: 'exact' } })
    const route = await routeData(test)
    await route.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['route_origin', 'route_departure_date']) })
  })

  it('checks the required destination and rejects substituted representative paths', async () => {
    const test = await fixture(intent, { destinationIntent: { mode: 'explicit', required: [osaka], preferred: [], excluded: [] } })
    const route = await routeData(test)
    await route.store()
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['route_required_location_coverage', 'route_destination']) })
    const substituted = await fixture(intent)
    const wrong = await routeData(substituted)
    wrong.payload.representatives[0]!.path.edges[0]!.departureDate = '2026-10-11'
    await wrong.store()
    expect(await substituted.verify()).toMatchObject({ status: 'failed', missing: ['route_path_lineage'] })
  })

  it('rejects a fake optimized payload and rechecks expired edge evidence', async () => {
    const malformed = await fixture(intent)
    await malformed.artifacts.create({ ...malformed.lineage, type: 'route_set', schemaVersion: 1,
      payload: { kind: 'optimized_routes', representatives: ['fake'] }, verification: verified })
    expect(await malformed.verify()).toMatchObject({ status: 'failed', missing: ['route_set_payload'] })
    const stale = await fixture(intent)
    const route = await routeData(stale)
    stale.context.now = '2027-01-01T00:00:00.000Z'
    await route.store()
    expect(await stale.verify()).toMatchObject({ status: 'partial', missing: expect.arrayContaining(['verified_evidence']) })
  })
})

describe('default Trip Context update goal verifier', () => {
  it('accepts a same-value setter only with an exact run-scoped persisted receipt for every requested field', async () => {
    const test = await fixture({ kind: 'trip_context_update', parameters: { fields: ['budget', 'notes'] } },
      { budget: { amount: 1200, currency: 'CNY', scope: 'trip' } })
    test.context.currentTrip = { ...test.trip, version: 4 }
    expect(await test.verify()).toMatchObject({ status: 'pending' })
    const receipt = { ownerId: test.context.ownerId, tripId: test.trip.id, runId: test.context.run.id,
      generationId: test.context.run.generationId, contextVersion: 4,
      fieldHashes: { budget: canonicalFingerprint({ value: test.trip.budget }), notes: canonicalFingerprint({ value: test.trip.notes }) } }
    test.context.run.workingSet.tripUpdateReceipt = receipt
    expect(await test.verify()).toMatchObject({ status: 'satisfied' })
    for (const invalid of [
      { ...receipt, contextVersion: 3 }, { ...receipt, ownerId: 'other-owner' },
      { ...receipt, runId: uuidv7() }, { ...receipt, generationId: 'other-generation' },
      { ...receipt, tripId: 'other-trip' },
      { ...receipt, fieldHashes: { budget: receipt.fieldHashes.budget } },
      { ...receipt, fieldHashes: { ...receipt.fieldHashes, budget: canonicalFingerprint({ value: { amount: 1500, currency: 'CNY', scope: 'trip' } }) } }
    ]) {
      test.context.run.workingSet.tripUpdateReceipt = invalid
      expect(await test.verify()).toMatchObject({ status: 'pending' })
    }
    test.context.run.workingSet.tripUpdateReceipt = receipt
    test.context.currentTrip.version = 5
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['trip_update_receipt_stale'] })
    test.context.currentTrip.budget = { amount: 1300, currency: 'CNY', scope: 'trip' }
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['trip_update_receipt_stale'] })
    // Legacy records without an attested setter retain their original rule.
    delete test.context.run.workingSet.tripUpdateReceipt
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['trip_field:notes'] })
  })

  it('does not turn absent requested fields into an empty satisfied set', async () => {
    const test = await fixture({ kind: 'trip_context_update', parameters: { fields: ['budget'] } })
    test.context.currentTrip = { ...test.trip, version: 4, notes: ['unrelated change'] }
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['trip_field:budget'] })
  })

  it('strictly rejects invalid goal fields instead of filtering them away', async () => {
    const test = await fixture({ kind: 'trip_context_update', parameters: { fields: ['budget'] } })
    test.goal.parameters = { fields: ['not_a_trip_field'] }
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: ['goal_parameters'] })
    test.goal.parameters = { fields: [] }
    expect(await test.verify()).toMatchObject({ status: 'failed', missing: ['goal_parameters'] })
  })

  it('counts both setting and removing a canonical optional field as changes', async () => {
    const set = await fixture({ kind: 'trip_context_update', parameters: { fields: ['budget'] } })
    set.context.currentTrip = { ...set.trip, version: 4, budget: { amount: 5000, currency: 'CNY', scope: 'airfare' } }
    expect(await set.verify()).toMatchObject({ status: 'satisfied' })
    const remove = await fixture({ kind: 'trip_context_update', parameters: { fields: ['origin'] } })
    const { origin: _origin, ...withoutOrigin } = remove.trip
    remove.context.currentTrip = { ...withoutOrigin, version: 4 }
    expect(await remove.verify()).toMatchObject({ status: 'satisfied' })
  })

  it('requires a newer persisted version and reports exactly the fields still unchanged', async () => {
    const test = await fixture({ kind: 'trip_context_update', parameters: { fields: ['budget', 'notes'] } })
    expect(await test.verify()).toMatchObject({ status: 'pending', missing: ['trip_context_version'] })
    test.context.currentTrip = { ...test.trip, version: 4, notes: ['changed'] }
    expect(await test.verify()).toMatchObject({ status: 'partial', missing: ['trip_field:budget'] })
  })
})
