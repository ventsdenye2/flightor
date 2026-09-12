import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (dependencies[name]) return dependencies[name]
    if (name.endsWith('.scss')) return {}
    throw new Error(`Unexpected dependency ${name}`)
  } })
  return module.exports
}
const airportTime = load('src/services/airportTime.ts')
const flightConnections = load('src/services/flightConnections.ts')
const artifacts = load('src/services/artifactService.ts', { './airportTime': airportTime, '../utils/request': { request: () => { throw new Error('Unexpected network') } } })
const routes = load('src/services/routeArtifact.ts', { './airportTime': airportTime })
const payload = load('src/components/artifacts/payload.ts', { '../../services/airportTime': airportTime, '../../services/flightConnections': flightConnections })
const flights = load('src/services/flightService.ts', {
  './flightConnections': flightConnections,
  './airportTime': airportTime, '../mocks/airports': {}, '../utils/request': {}, '../utils/format': {},
  '../utils/flightRecommendation': {}, './artifactService': {}, '../../cloud/searchProxy/connectivity': {}
})
const components = { View: 'View', Text: 'Text', Canvas: 'Canvas', Button: 'Button' }
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
const ui = {
  '@tarojs/components': components, 'react/jsx-runtime': jsx,
  'react': { useMemo: fn => fn(), useState: value => [value, () => undefined] },
  'mobx-react-lite': { observer: fn => fn }, '@tarojs/taro': {},
  '../../i18n': { t: key => key, fd: minutes => `${minutes} min` },
  '../../services/airportTime': airportTime,
  '../../services/flightConnections': flightConnections
}
const RouteWorkspace = load('src/components/route/RouteWorkspace.tsx', {
  ...ui, '../map/WorldMap': () => null, '../../services/routeArtifact': routes
}).RouteWorkspace
const FlightCompareCard = load('src/components/flight/FlightCompareCard.tsx', {
  ...ui, '../../utils/format': { formatPrice: amount => String(amount) }
}).default
const FlightDetail = load('src/components/route/FlightDetail.tsx', { ...ui, '../artifacts/payload': payload }).FlightDetail
const FlightSearchCard = load('src/components/artifacts/FlightSearchCard.tsx', {
  ...ui, './ArtifactCard': { ArtifactCard: props => props.children }, './payload': payload
}).FlightSearchCard
const BoardingPassItinerary = load('src/components/itinerary/BoardingPassItinerary.tsx', ui).default
function renderedText(node) {
  if (node === undefined || node === null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderedText).join(' ')
  return renderedText(typeof node.type === 'function' ? node.type(node.props) : node.props?.children)
}
let passed = 0
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }

const departure = '2026-10-10T16:30:00Z', arrival = '2026-10-10T19:10:00Z'
const departureView = { basis: 'airport_local', instant: departure, localDateTime: '2026-10-11T00:30:00', timezone: 'Asia/Shanghai', offset: '+08:00', airportIata: 'PVG', display: '2026-10-11 00:30 (Asia/Shanghai, UTC+08:00)' }
const arrivalView = { basis: 'airport_local', instant: arrival, localDateTime: '2026-10-11T04:10:00', timezone: 'Asia/Tokyo', offset: '+09:00', airportIata: 'HND', display: '2026-10-11 04:10 (Asia/Tokyo, UTC+09:00)' }
const from = { id: 'pvg', name: 'Shanghai Pudong', iata: 'PVG' }, to = { id: 'hnd', name: 'Tokyo Haneda', iata: 'HND' }
const edge = { id: 'edge', from, to, transferType: 'direct', departureAt: departure, arrivalAt: arrival, durationMinutes: 160, warnings: [],
  segments: [{ from, to, departureAt: departure, arrivalAt: arrival, flightNumber: 'QA1' }] }
const route = { id: 'route', nodes: [{ location: from, role: 'origin' }, { location: to, role: 'destination' }], edges: [edge], transferCount: 0, warnings: [] }
const routePayloads = [
  { payload: { schemaVersion: 1, kind: 'optimized_routes', representatives: [{ path: route }] }, pointer: '/representatives/0/path/edges/0' },
  { payload: { schemaVersion: 1, kind: 'flight_paths', paths: [route] }, pointer: '/paths/0/edges/0' },
  { payload: { schemaVersion: 1, kind: 'connection_edges', edges: [edge] }, pointer: '/edges/0' }
]
const projection = entries => ({ schemaVersion: 1, truncated: false, airportTimes: entries })
const envelope = (payload, type, presentation) => ({ id: 'artifact', tripId: 'trip', schemaVersion: 1, type, payload, presentation, createdAt: departure, updatedAt: departure })
const routeArtifacts = routePayloads.map(({ payload, pointer }) => envelope(payload, 'route_set', projection({
  [`${pointer}/departureAt`]: departureView, [`${pointer}/arrivalAt`]: arrivalView,
  [`${pointer}/segments/0/departureAt`]: departureView, [`${pointer}/segments/0/arrivalAt`]: arrivalView
})))
const offer = { id: 'offer', totalAmount: 1600, currency: 'CNY', totalDurationMinutes: 160, airlines: ['QA'], transferType: 'direct',
  segments: [{ origin: 'PVG', destination: 'HND', flightNumber: 'QA1', airline: 'QA', departsAt: departure, arrivesAt: arrival, durationMinutes: 160 }] }
const flightArtifact = envelope({ id: 'artifact', type: 'flight_search', offers: [offer] }, 'flight_search', projection({
  '/offers/0/segments/0/departsAt': departureView, '/offers/0/segments/0/arrivesAt': arrivalView
}))
const ref = { id: 'artifact', type: 'flight_search', schemaVersion: 1 }

test('Artifact validation retains the bounded server projection without changing UTC payload', () => {
  const artifact = artifacts.validateArtifactEnvelope(routeArtifacts[0])
  assert.equal(artifact.presentation.airportTimes['/representatives/0/path/edges/0/departureAt'].display, departureView.display)
  assert.equal(artifact.payload, routeArtifacts[0].payload)
  assert.equal(airportTime.readAirportTimePresentation({ ...artifact.presentation, schemaVersion: 2 }), undefined)
  assert.equal(airportTime.readAirportTimePresentation(projection({ '/bad': { ...departureView, display: 'x'.repeat(201) } })), undefined)
})
test('Every route shape resolves edge and nested segment clocks by its payload pointer', () => {
  for (const artifact of routeArtifacts) {
    const result = routes.readRouteArtifact(artifact)[0].edges[0]
    assert.equal(result.departureDisplay, departureView.display)
    assert.equal(result.arrivalDisplay, arrivalView.display)
    assert.equal(result.segments[0].departureDisplay, departureView.display)
    assert.equal(result.segments[0].arrivalDisplay, arrivalView.display)
    assert.equal(result.departureAt, departure)
    assert.equal(result.arrivalAt, arrival)
  }
})
test('Missing or truncated airport projection labels UTC instead of guessing an airport clock', () => {
  const truncated = { ...projection({}), truncated: true }
  assert.equal(airportTime.airportTimeDisplay(departure, truncated, '/missing'), '2026-10-10 16:30 (UTC; airport timezone unavailable)')
  assert.equal(airportTime.airportTimeDisplay('2026-10-11T00:30:00+08:00'), '2026-10-10 16:30 (UTC; airport timezone unavailable)')
  assert.equal(airportTime.airportTimeDisplay('invalid'), '时间未提供')
})
test('Provider-local clocks remain explicitly unknown-zone and are never converted using the device', () => {
  const raw = '2026-10-11T00:30:00'
  const display = '2026-10-11 00:30 (provider local; timezone unavailable)'
  assert.equal(airportTime.airportTimeDisplay(raw), display)
  assert.equal(airportTime.airportTimeDisplay(raw, projection({ '/t': { basis: 'provider_local', localDateTime: raw, display } }), '/t'), display)
})
test('Flexible date results preserve original indexes for both strict adapters and display cards', () => {
  const data = { id: 'artifact', type: 'flight_search', results: [{ offers: [] }, { offers: [offer] }] }
  const presentation = projection({ '/results/1/offers/0/segments/0/departsAt': departureView, '/results/1/offers/0/segments/0/arrivesAt': arrivalView })
  const result = flights.responseFromFlightSearchArtifact(data, ref, departure, presentation).direct[0]
  assert.equal(result.segments[0].departTimeDisplay, departureView.display)
  assert.equal(result.segments[0].arriveTimeDisplay, arrivalView.display)
  assert.equal(payload.displayOffers(data, presentation)[0].segments[0].arrival, arrivalView.display)
  const skipped = { offers: [null, offer] }
  assert.equal(payload.displayOffers(skipped, projection({ '/offers/1/segments/0/departsAt': departureView }))[0].segments[0].departure, departureView.display)
  const laterDate = { ...data, results: [{ offers: Array.from({ length: 100 }, (_, index) => ({ ...offer, id: `earlier-${index}` })) }, { offers: [offer] }] }
  assert.equal(payload.displayOfferById(laterDate, offer.id, presentation).segments[0].departure, departureView.display)
})
test('Airport display projection leaves raw timestamps and transfer duration calculations unchanged', () => {
  const next = { ...offer.segments[0], origin: 'HND', destination: 'KIX', departsAt: '2026-10-10T20:10:00Z', arrivesAt: '2026-10-10T21:30:00Z', durationMinutes: 80 }
  const data = { ...flightArtifact.payload, offers: [{ ...offer, segments: [...offer.segments, next], transferType: 'self', totalDurationMinutes: 300 }] }
  const result = flights.responseFromFlightSearchArtifact(data, ref, departure, flightArtifact.presentation).selfTransfer[0]
  assert.equal(result.segments[0].departTime, departure)
  assert.equal(result.segments[0].arriveTime, arrival)
  assert.equal(result.hub.layoverMinutes, 60)
  assert.equal(result.totalDuration, 300)
})
test('Rendered route, flight cards, detail and itinerary keep the same cross-day airport clocks across device timezones', () => {
  const previous = process.env.TZ
  const deviceHours = new Set(), results = []
  try {
    for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = timezone
      deviceHours.add(new Date(departure).getHours())
      const routeViews = routes.readRouteArtifact(routeArtifacts[0])
      const flight = flights.responseFromFlightSearchArtifact(flightArtifact.payload, ref, departure, flightArtifact.presentation).direct[0]
      const views = [
        RouteWorkspace({ routes: routeViews }), FlightCompareCard({ flight, savingsAmount: 0, savingsPercent: 0 }),
        FlightDetail({ artifact: flightArtifact, offerId: 'offer' }), FlightSearchCard({ artifact: flightArtifact }),
        BoardingPassItinerary({ itinerary: [{ ...flight.segments[0], type: 'flight' }] })
      ].map(renderedText)
      for (const view of views) {
        assert.ok(view.includes(departureView.display), `Departure projection missing under ${timezone}`)
        assert.ok(view.includes(arrivalView.display), `Arrival projection missing under ${timezone}`)
        assert.ok(!view.includes('(+1)'), 'Device-derived cross-day badge must not replace explicit local dates')
      }
      results.push(JSON.stringify({ views, fallback: airportTime.airportTimeDisplay(departure), providerLocal: airportTime.airportTimeDisplay('2026-10-11T00:30:00') }))
    }
    assert.ok(deviceHours.size > 1, 'The test must actually change the device clock')
    assert.equal(new Set(results).size, 1)
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
console.log(`\nAirport time presentation: ${passed} passed`)
