// Offline contract and rendered-text checks for real provider connecting offers.
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
const connections = load('src/services/flightConnections.ts')
const airportTime = load('src/services/airportTime.ts')
const artifactService = load('src/services/artifactService.ts', { './airportTime': airportTime, '../utils/request': {} })
const payload = load('src/components/artifacts/payload.ts', {
  '../../services/airportTime': airportTime, '../../services/flightConnections': connections
})
const flights = load('src/services/flightService.ts', {
  './airportTime': airportTime, './flightConnections': connections,
  '../mocks/airports': {}, '../utils/request': { request: () => { throw new Error('Unexpected network') } },
  '../utils/format': {}, '../utils/flightRecommendation': {}, './artifactService': {}, '../../cloud/searchProxy/connectivity': {}
})
const recommendation = load('src/utils/flightRecommendation.ts', {
  '../services/flightConnections': connections,
  '../mocks/countries': { countryOfAirport: () => undefined, findCountry: () => undefined }
})
const { FlightStore } = load('src/stores/flightStore.ts', {
  mobx: { makeAutoObservable: () => {}, runInAction: fn => fn() },
  '../services/flightService': flights, '../services/artifactService': {}, '../components/artifacts/registry': {},
  '../utils/request': { USE_MOCK: false }, '../utils/flightRecommendation': recommendation,
  './chatStore': { chatStore: { currentSessionId: 'session' }, registerChatSessionChangeHandler: () => {} },
  './userStore': { userStore: { profile: { uid: 'owner' } }, registerUserSessionClearHandler: () => {} },
  '../i18n': { localeStore: { locale: 'zh' } }
})
const components = { View: 'View', Text: 'Text' }
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
const ui = {
  '@tarojs/components': components, 'react/jsx-runtime': jsx,
  'react': { useState: value => [value, () => undefined] },
  'mobx-react-lite': { observer: fn => fn },
  '../../i18n': { t: key => ({ 'fcc.airline': '航司联程', 'fcc.direct': '直飞', 'fcc.self': '自行中转' })[key] ?? key, fd: minutes => `${minutes} min`, localeStore: { locale: 'zh' } },
  '../../services/airportTime': airportTime, '../../services/flightConnections': connections
}
const FlightCompareCard = load('src/components/flight/FlightCompareCard.tsx', { ...ui, '../../utils/format': { formatPrice: String } }).default
const FlightDetail = load('src/components/route/FlightDetail.tsx', { ...ui, '../artifacts/payload': payload }).FlightDetail
const FlightSearchCard = load('src/components/artifacts/FlightSearchCard.tsx', { ...ui, './ArtifactCard': { ArtifactCard: props => props.children }, './payload': payload }).FlightSearchCard
const TransferModeCompare = load('src/components/flight/TransferModeCompare.tsx', { ...ui, '../../utils/format': { formatPrice: String } }).default
function renderedText(node) {
  if (node === undefined || node === null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderedText).join(' ')
  return renderedText(typeof node.type === 'function' ? node.type(node.props) : node.props?.children)
}
function findNodes(node, predicate) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(value => findNodes(value, predicate))
  return [...(predicate(node) ? [node] : []), ...findNodes(node.props?.children, predicate)]
}
const offer = {
  id: 'connecting-offer', totalAmount: 1800, currency: 'CNY', totalDurationMinutes: 540, airlines: ['QA'], transferType: 'airline',
  segments: [
    { flightNumber: 'QA100', airline: 'QA', origin: 'PVG', destination: 'KUL', departsAt: '2026-10-01T01:00:00Z', arrivesAt: '2026-10-01T05:00:00Z', durationMinutes: 240 },
    { flightNumber: 'QA200', airline: 'QA', origin: 'KUL', destination: 'SIN', departsAt: '2026-10-01T06:00:00Z', arrivesAt: '2026-10-01T07:00:00Z', durationMinutes: 60 },
    { flightNumber: 'QA300', airline: 'QA', origin: 'SIN', destination: 'DPS', departsAt: '2026-10-01T08:30:00Z', arrivesAt: '2026-10-01T10:00:00Z', durationMinutes: 90 }
  ],
  layovers: [
    { afterSegmentIndex: 0, airport: 'KUL', durationMinutes: 60 },
    { afterSegmentIndex: 1, airport: 'SIN', durationMinutes: 90 }
  ]
}
const flightPayload = { id: 'artifact', type: 'flight_search', provider: 'serpapi', query: { origin: 'PVG', destination: 'DPS', departureDate: '2026-10-01' }, offers: [offer] }
const artifact = { id: 'artifact', type: 'flight_search', schemaVersion: 1, payload: flightPayload, createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z' }
const ref = { id: artifact.id, type: artifact.type, schemaVersion: 1 }
function adapt(value = flightPayload) { return flights.responseFromFlightSearchArtifact(value, ref, artifact.updatedAt) }
let passed = 0
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }

test('provider connecting offer remains one priced airline option with every segment', () => {
  const result = adapt()
  assert.equal(result.direct.length, 0)
  assert.equal(result.selfTransfer.length, 0)
  assert.equal(result.airlineTransfer.length, 1)
  const flight = result.airlineTransfer[0]
  assert.equal(flight.totalPrice, 1800)
  assert.equal(flight.segments.map(segment => segment.flightNo).join(','), 'QA100,QA200,QA300')
  assert.equal(flight.layovers.map(connection => `${connection.airport}:${connection.durationMinutes}`).join(','), 'KUL:60,SIN:90')
  assert.equal(flight.baggageRecheck, undefined)
  assert.equal(flight.hub.baggageRecheck, undefined)
})
test('preview shows the full route, connection count and each separate connection', () => {
  const text = renderedText(FlightSearchCard({ artifact }))
  assert.match(text, /PVG → KUL → SIN → DPS/)
  assert.match(text, /航司联程 · 2 次中转/)
  assert.match(text, /KUL · 衔接 60 分钟/)
  assert.match(text, /SIN · 衔接 90 分钟/)
  assert.match(text, /行李直挂\/重托运待确认/)
})
test('search card never repeats the first hub at the second connection', () => {
  const text = renderedText(FlightCompareCard({ flight: adapt().airlineTransfer[0], savingsAmount: 0, savingsPercent: 0 }))
  assert.equal(text.match(/KUL · 衔接 60 分钟/g)?.length, 1)
  assert.equal(text.match(/SIN · 衔接 90 分钟/g)?.length, 1)
  for (const flightNo of ['QA100', 'QA200', 'QA300']) assert.match(text, new RegExp(flightNo))
  assert.match(text, /2 次中转/)
})
test('detail preserves segments, total duration, source classification and unknown baggage', () => {
  const text = renderedText(FlightDetail({ artifact, offerId: offer.id }))
  assert.match(text, /航司联程 · 2 次中转\s+· 全程 540 分钟/)
  assert.match(text, /KUL · 衔接 60 分钟/)
  assert.match(text, /SIN · 衔接 90 分钟/)
  for (const flightNo of ['QA100', 'QA200', 'QA300']) assert.match(text, new RegExp(flightNo))
  assert.match(text, /出票及衔接保障以购票规则为准/)
  assert.match(text, /行李直挂\/重托运待确认/)
})
test('legacy multi-segment offers derive every connection from raw timestamps', () => {
  const legacy = { ...offer, layovers: undefined }
  const flight = adapt({ ...flightPayload, offers: [legacy] }).airlineTransfer[0]
  assert.equal(flight.layovers.map(connection => `${connection.airport}:${connection.durationMinutes}`).join(','), 'KUL:60,SIN:90')
  const shown = payload.displayOffers({ ...flightPayload, offers: [legacy] })[0]
  assert.equal(shown.layovers.length, 2)
})
test('airport changes and overnight metadata are attached to the right segment boundary', () => {
  const changed = { ...offer, segments: [offer.segments[0], { ...offer.segments[1], origin: 'SZB' }],
    layovers: [{ afterSegmentIndex: 0, airport: 'KUL', departureAirport: 'SZB', durationMinutes: 180, airportChange: true, overnight: true }] }
  const display = payload.displayOffers({ offers: [changed] })[0]
  assert.equal(connections.flightPath(display.segments), 'PVG → KUL → SZB → SIN')
  assert.equal(connections.connectionLabel(display.layovers[0]), 'KUL → SZB · 衔接 180 分钟 · 需换机场 · 过夜中转')
})
test('missing or reversed timestamps remain unconfirmed, never a zero-minute connection', () => {
  for (const segments of [
    [{ destination: 'KUL' }, { origin: 'KUL' }],
    [{ destination: 'KUL', arrivalAt: '2026-10-01T05:00:00' }, { origin: 'KUL', departureAt: '2026-10-01T06:00:00' }],
    [{ destination: 'KUL', arrivalAt: '2026-10-01T05:00:00Z' }, { origin: 'KUL', departureAt: '2026-10-01T04:00:00Z' }]
  ]) {
    const connection = connections.flightConnections(segments)[0]
    assert.equal(connection.durationMinutes, undefined)
    assert.match(connections.connectionLabel(connection), /衔接时间待确认/)
  }
})
test('misaligned connection metadata cannot overwrite a different airport boundary', () => {
  const shown = payload.displayOffers({ offers: [{ ...offer, layovers: [{ afterSegmentIndex: 0, airport: 'SIN', durationMinutes: 999, overnight: true }] }] })[0]
  assert.equal(shown.layovers[0].airport, 'KUL')
  assert.equal(shown.layovers[0].durationMinutes, 60)
  assert.equal(shown.layovers[0].overnight, undefined)
})
test('direct offers have no fabricated connection and explicit baggage states stay distinct', () => {
  const direct = { ...offer, transferType: 'direct', segments: [offer.segments[0]], layovers: undefined }
  assert.equal(adapt({ ...flightPayload, offers: [direct] }).direct[0].layovers.length, 0)
  assert.equal(connections.flightTypeLabel('direct', 1), '直飞')
  assert.match(connections.baggageLabel(false), /供应商标记无需重新托运行李/)
  assert.match(connections.baggageLabel(true), /供应商标记需提取行李并重新托运/)
})
test('an offer with unknown total duration remains available and clearly labelled', () => {
  const unknownOffer = { ...offer, totalDurationMinutes: undefined }
  const data = { ...flightPayload, offers: [unknownOffer] }
  const flight = adapt(data).airlineTransfer[0]
  assert.equal(flight.totalPrice, 1800)
  assert.equal(flight.totalDuration, undefined)
  assert.equal(flight.segments.length, 3)
  for (const node of [
    FlightCompareCard({ flight, savingsAmount: 0, savingsPercent: 0 }),
    FlightSearchCard({ artifact: { ...artifact, payload: data } }),
    FlightDetail({ artifact: { ...artifact, payload: data }, offerId: offer.id })
  ]) {
    assert.match(renderedText(node), /全程时长待确认/)
    assert.doesNotMatch(renderedText(node), /NaN|全程 0 分钟/)
  }
})
test('unknown durations sort after known durations without hiding cheap offers in price sort', () => {
  const known = adapt().airlineTransfer[0]
  const unknown = { ...known, id: 'unknown', totalDuration: undefined, totalPrice: 100 }
  const store = new FlightStore()
  store.result = { direct: [], selfTransfer: [], airlineTransfer: [unknown, known], metadata: {} }
  for (const sort of ['duration', 'recommended']) {
    store.sortBy = sort
    assert.equal(store.visibleOptions[0].id, known.id)
    assert.equal(store.visibleOptions[1].id, 'unknown')
  }
  store.sortBy = 'price'
  assert.equal(store.visibleOptions[0].id, 'unknown')
})
test('unknown connection durations do not become zero-wait recommendation evidence', () => {
  const known = adapt().airlineTransfer[0]
  assert.equal(recommendation.totalLayoverMinutes(known), 150)
  const unknown = { ...known, layovers: undefined, segments: known.segments.map(segment => ({ ...segment, departTime: '', arriveTime: '' })) }
  assert.equal(recommendation.totalLayoverMinutes(unknown), undefined)
})
test('comparison marks neither option faster when either total duration is unknown', () => {
  const base = { price: 1800, baggagePolicy: '待确认', missedConnectionRisk: 'low', visaRequired: false, stopoverPlayable: false,
    minConnectionTime: 90, protectionLevel: '待确认', flexibility: '待确认', totalDuration: 540 }
  for (const [selfTransfer, airlineTransfer] of [[{ ...base, totalDuration: undefined }, base], [base, { ...base, totalDuration: undefined }]]) {
    const tree = TransferModeCompare({ selfTransfer, airlineTransfer, onSelect: () => {} })
    const row = findNodes(tree, node => node.props?.className === 'tmc__dim').find(node => renderedText(node).includes('tmc.duration'))
    assert.ok(row)
    assert.equal(findNodes(row, node => typeof node.props?.className === 'string' && node.props.className.includes('is-winner')).length, 0)
  }
})
test('server uncertainty marks legacy baggage false unknown without changing the immutable payload', () => {
  const legacy = { ...offer, baggageRecheck: false }
  for (const [data, pointer] of [
    [{ ...flightPayload, offers: [legacy, { ...legacy, id: 'confirmed-false' }] }, '/offers/0/baggageRecheck'],
    [{ ...flightPayload, offers: undefined, results: [{ offers: [] }, { offers: [legacy, { ...legacy, id: 'confirmed-false' }] }] }, '/results/1/offers/0/baggageRecheck']
  ]) {
    const presentation = airportTime.readAirportTimePresentation({ schemaVersion: 1, airportTimes: {}, truncated: false, unconfirmedFields: [pointer] })
    const shown = payload.displayOffers(data, presentation)
    const options = flights.responseFromFlightSearchArtifact(data, ref, artifact.updatedAt, presentation).airlineTransfer
    assert.equal(shown[0].baggageRecheck, undefined)
    assert.equal(options[0].baggageRecheck, undefined)
    assert.equal(options[0].hub.baggageRecheck, undefined)
    assert.equal(shown[1].baggageRecheck, false)
    assert.equal(options[1].baggageRecheck, false)
    assert.equal(legacy.baggageRecheck, false)
    const text = renderedText(FlightDetail({ artifact: { ...artifact, payload: data, presentation }, offerId: legacy.id }))
    assert.match(text, /行李直挂\/重托运待确认/)
    assert.doesNotMatch(text, /供应商标记无需重新托运行李/)
  }
})
test('uncertainty sidecar has bounded JSON pointer fields and remains optional for existing projections', () => {
  const projection = { schemaVersion: 1, airportTimes: {}, truncated: false }
  for (const unconfirmedFields of ['not-an-array', [1], ['baggageRecheck'], ['/' + 'x'.repeat(512)], Array(8193).fill('/baggageRecheck')]) {
    assert.equal(airportTime.readAirportTimePresentation({ ...projection, unconfirmedFields }), undefined)
  }
  assert.ok(airportTime.readAirportTimePresentation(projection))
  assert.equal(airportTime.readAirportTimePresentation({ ...projection, unconfirmedFields: ['/offers/0/baggageRecheck'] }).unconfirmedFields[0], '/offers/0/baggageRecheck')
})
const legacyPayload = { ...flightPayload, offers: [{ ...offer, baggageRecheck: false }] }
const remoteEnvelope = { ...artifact, tripId: 'trip', payload: legacyPayload,
  presentation: { schemaVersion: 1, airportTimes: {}, truncated: false, unconfirmedFields: ['/offers/0/baggageRecheck'] } }
const cache = new artifactService.BoundedArtifactCache()
cache.setSession('owner', 'session')
cache.set(artifact.id, { ...remoteEnvelope, presentation: undefined })
let fetches = 0
const service = new artifactService.ArtifactService(async () => { fetches++; return { artifact: remoteEnvelope } }, cache)
const refreshed = await service.fetchArtifact(artifact.id, { ownerId: 'owner', sessionId: 'session', force: true })
test('refreshing a cached Artifact retrieves current uncertainty without rewriting saved values', () => {
  assert.equal(fetches, 1)
  assert.equal(refreshed.payload.offers[0].baggageRecheck, false)
  assert.equal(payload.displayOffers(refreshed.payload, refreshed.presentation)[0].baggageRecheck, undefined)
  assert.equal(cache.get(artifact.id).presentation.unconfirmedFields[0], '/offers/0/baggageRecheck')
})
console.log(`\nFlight connections: ${passed}/${passed} passed (offline; no supplier calls)`)
