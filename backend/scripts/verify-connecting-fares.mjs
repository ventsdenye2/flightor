import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { env } from '../dist/config/env.js'
import { db } from '../dist/db/index.js'
import { createProviders } from '../dist/providers/index.js'
import { CompositeAviationProvider } from '../dist/aviation/providers/composite.js'
import { PostgresLocationResolver } from '../dist/aviation/location-resolver.js'
import { InMemoryArtifactRepository } from '../dist/artifacts/repository.js'
import { InMemoryTripContextRepository } from '../dist/trips/repository.js'
import { emptyTripContext } from '../dist/trips/types.js'
import { fareSearchResultSchema } from '../dist/fares/types.js'
import { LiveFareConnectionSearch } from '../dist/flight-routing/live-connections.js'
import { DeterministicFlightRoutePlanner } from '../dist/flight-routing/planner.js'
import { ParetoRouteOptimizer } from '../dist/flight-routing/optimizer.js'
import { summarizeFareItineraries } from '../dist/fares/summary.js'

const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')))
const database = new URL(env.DATABASE_URL)
if (env.NODE_ENV !== 'development' || database.pathname !== '/flightor_demo'
  || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
  throw new Error('This verification requires the dedicated local flightor_demo database')
}
if (!args.artifact && !Object.hasOwn(args, 'live')) throw new Error('Use --artifact=<saved-id> for replay or --live --origin=... --destination=... --date=... for one real fare search')
const started = Date.now()
try {
  const providers = createProviders(env)
  let result
  if (args.artifact) {
    const record = await db.selectFrom('artifacts').select('payload_json').where('public_id', '=', args.artifact).where('type', '=', 'flight_search').executeTakeFirstOrThrow()
    const { id, type, ...payload } = record.payload_json
    result = fareSearchResultSchema.parse(payload)
  } else {
    result = fareSearchResultSchema.parse(await providers.fares.searchFlights({
      origin: args.origin, destination: args.destination, departureDate: args.date,
      currency: 'CNY', travelClass: 1
    }, { signal: AbortSignal.timeout(35_000) }))
  }
  const aviation = new CompositeAviationProvider(providers.aviation, new PostgresLocationResolver(db))
  const signal = AbortSignal.timeout(90_000)
  const [origin, destination] = await Promise.all([aviation.getAirport({ iata: result.query.origin }, { signal }), aviation.getAirport({ iata: result.query.destination }, { signal })])
  assert.ok(origin && destination, 'Canonical endpoints must resolve')
  const trip = emptyTripContext('connecting-fare-verification')
  const artifacts = new InMemoryArtifactRepository('verification', new Set([trip.id]))
  const trips = new InMemoryTripContextRepository([trip])
  // Replay exactly this quote through production route services. No extra fare calls.
  const fares = { name: result.provider, searchFlights: async query => {
    assert.deepEqual(query, result.query)
    return structuredClone(result)
  } }
  const topology = { search: async () => ({ edges: [], serviceVersion: 'verification-empty-topology', warnings: [], truncated: false, exhausted: true, verification: result.verification }) }
  const window = { from: result.query.departureDate, to: result.query.departureDate }
  const connections = await new LiveFareConnectionSearch({ artifacts, trips, fares, aviation, topology }).search({
    origin, destination, window, preferredLocations: [], excludedLocations: [],
    acceptsSelfTransfer: false, acceptsLongStopover: true, maxCandidates: 100
  }, { tripId: trip.id, signal })
  const connecting = connections.edges.filter(edge => edge.transferType === 'airline')
  assert.ok(result.offers.some(offer => offer.transferType === 'airline'), 'Provider must return a connecting fare for this acceptance sample')
  assert.ok(connecting.length, 'Connecting quotes must enter route comparison')
  for (const edge of connections.edges) {
    const offer = result.offers.find(offer => offer.id === edge.fareOfferId)
    assert.ok(offer)
    assert.equal(edge.fare.amount, offer.totalAmount)
    assert.equal(edge.segments.length, offer.segments.length)
    assert.equal(edge.protectedConnection, offer.protectedConnection)
    const saved = await artifacts.get(edge.fareArtifactId)
    assert.ok(saved.payload.offers.some(item => item.id === offer.id && item.segments.length === offer.segments.length))
  }
  const planned = await new DeterministicFlightRoutePlanner().plan({
    nodes: [{ location: origin, role: 'origin' }, { location: destination, role: 'destination' }],
    edges: connections.edges, window, constraints: { requiredLocations: [], excludedLocations: [], maxTransfers: 30,
      allowSelfTransfer: false, allowAirportChange: false, allowLongStopover: true, minTransferMinutes: 45 }, maxPaths: 100
  }, { signal })
  assert.ok(planned.paths.some(path => path.edges.some(edge => edge.transferType === 'airline')), 'A connecting quote must survive physical path validation')
  for (const path of planned.paths) {
    assert.equal(path.edges.length, 1, 'Complete quote must not be split into fictitious priced edges')
    assert.equal(path.totalFare.amount, path.edges[0].fare.amount)
    assert.equal(path.transferCount, path.edges[0].segments.length - 1)
  }
  const optimized = await new ParetoRouteOptimizer().optimize({ paths: planned.paths, weights: {}, preferredLocations: [], interestLocations: [], maxRepresentatives: 10 })
  assert.ok(optimized.representatives.some(value => value.path.edges.some(edge => edge.transferType === 'airline')), 'Connecting fares must participate in final comparisons')
  const evidence = {
    mode: args.artifact ? 'persisted-provider-snapshot-replay' : 'one-live-fare-search-then-production-service-replay',
    checkedAt: result.checkedAt, query: result.query, provider: result.provider,
    elapsedMs: Date.now() - started, sourceArtifactId: args.artifact,
    providerCounts: summarizeFareItineraries(result.offers).counts,
    routeEdges: connections.edges.length, connectingEdges: connecting.length,
    paths: planned.paths.length, representatives: optimized.representatives.map(value => ({
      transferType: value.path.edges[0].transferType, totalFare: value.path.totalFare,
      transferCount: value.path.transferCount, feasibility: value.path.feasibility,
      route: value.path.edges[0].segments.map(segment => segment.from.iata).concat(value.path.edges[0].to.iata)
    })), warnings: connections.warnings,
    boundaries: ['Topology stub is empty; provider quote integration is tested independently.', 'Route artifacts are stored in memory for this replay.', 'This does not run the worker, LLM, ticketing or WeChat UI.']
  }
  await fs.mkdir('.demo', { recursive: true })
  const evidenceFile = `.demo/connecting-fares-${args.artifact ? 'replay' : 'live'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  await fs.writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n')
  await fs.writeFile('.demo/connecting-fares-verification.json', JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally { await db.destroy() }
