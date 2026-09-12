const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Load only pure presentation modules. Any provider/network dependency fails.
const cache = new Map()
function load(name) {
  const file = path.resolve(__dirname, '../src/features/ui-experience', `${name}.ts`)
  if (cache.has(file)) return cache.get(file)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: dependency => {
    assert.ok(dependency.startsWith('./'), `Unexpected presentation dependency: ${dependency}`)
    return load(dependency.slice(2))
  } }, { filename: file })
  cache.set(file, module.exports)
  return module.exports
}
const flight = load('flightSamples')
const explore = load('exploreSamples')
const { kyotoTrip } = load('sampleTrips')
const ids = values => Array.from(values, value => value.id)
let passed = 0
const check = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`) }
const { defaultFlightDataset: lisbon, kyotoFlightDataset: kyoto, emptyFlightDataset: empty, DEFAULT_FLIGHT_FILTERS: filters } = flight
const lisbonSearch = flight.initialFlightSearch(lisbon)
const kyotoSearch = flight.initialFlightSearch(kyoto)
check('default sample compatibility and all legs preserved', () => {
  const results = flight.selectFlightResults(lisbon, lisbonSearch)
  assert.equal(results.length, 3)
  assert.equal(results.find(item => item.id === 'mixed').legs.length, 3)
})
check('arbitrary route and date use the injected dataset', () => {
  const injected = { ...kyoto, origin: 'HND', originName: '东京羽田', destination: 'ICN', destinationName: '首尔仁川', date: '2031-03-25' }
  assert.equal(flight.selectFlightResults(injected, flight.initialFlightSearch(injected)).length, 2)
  assert.equal(flight.selectFlightResults(injected, lisbonSearch).length, 0)
})
check('aliases normalize only within injected airports', () => {
  assert.equal(flight.canonicalAirport(' 大阪 ', kyoto), 'KIX')
  assert.equal(flight.canonicalAirport('kix', kyoto), 'KIX')
  assert.equal(flight.matchesFlightDataset({ ...kyotoSearch, from: '上海', to: '关西' }, kyoto), true)
  assert.equal(flight.matchesFlightDataset({ ...kyotoSearch, from: 'KIX', to: 'PVG' }, kyoto), false)
  assert.equal(flight.matchesFlightDataset({ ...kyotoSearch, date: '2026-11-07' }, kyoto), false)
})
check('unknown prices sort after known prices without mutating data', () => {
  const source = { ...kyoto, flights: [...kyoto.flights].reverse() }
  const before = JSON.stringify(source)
  assert.deepEqual(ids(flight.selectFlightResults(source, kyotoSearch, filters, 'price')), ['kyoto-known', 'kyoto-unknown'])
  assert.equal(JSON.stringify(source), before)
})
check('price cap excludes unknown rather than treating it as zero', () => {
  assert.deepEqual(ids(flight.selectFlightResults(kyoto, kyotoSearch, { ...filters, price: 2000 })), ['kyoto-known'])
  assert.equal(flight.selectFlightResults(kyoto, kyotoSearch, { ...filters, price: 1000 }).length, 0)
  assert.equal(flight.formatFlightAmount(null), '待核验')
})
check('zero amount stays distinct from unknown and invalid values', () => {
  const source = { ...kyoto, flights: [
    { ...kyoto.flights[0], id: 'zero', price: 0 },
    { ...kyoto.flights[0], id: 'negative', price: -1 },
    { ...kyoto.flights[0], id: 'nan', price: NaN },
    kyoto.flights[1]
  ] }
  assert.deepEqual(ids(flight.selectFlightResults(source, kyotoSearch, { ...filters, price: 100 })), ['zero'])
  assert.equal(flight.formatFlightAmount(0), '0')
  assert.equal(flight.formatFlightAmount(-1), '待核验')
  assert.equal(flight.formatFlightAmount(NaN), '待核验')
})
check('duration ordering does not rank unknown as quickest', () => {
  assert.deepEqual(ids(flight.selectFlightResults({ ...kyoto, flights: [...kyoto.flights].reverse() }, kyotoSearch, filters, 'duration')), ['kyoto-known', 'kyoto-unknown'])
  assert.equal(flight.formatFlightDuration(null), '用时待核验')
})
check('self-transfer filter does not invent protection for unknown values', () => {
  const source = { ...kyoto, flights: [kyoto.flights[0], { ...kyoto.flights[1], selfTransfer: null }] }
  assert.deepEqual(ids(flight.selectFlightResults(source, kyotoSearch, { ...filters, protectedOnly: true })), ['kyoto-known'])
})
check('stop filter excludes unknown count and retains direct services', () => {
  const source = { ...kyoto, flights: [kyoto.flights[0], { ...kyoto.flights[1], stops: null }] }
  assert.deepEqual(ids(flight.selectFlightResults(source, kyotoSearch, { ...filters, oneStop: true })), ['kyoto-known'])
  assert.equal(flight.formatFlightStops(0), '直飞')
  assert.equal(flight.formatFlightStops(null), '中转待核验')
})
check('empty flight dataset never falls back to Lisbon', () => {
  assert.equal(flight.selectFlightResults(empty, flight.initialFlightSearch(empty)).length, 0)
  assert.equal(flight.selectFlightResults(empty, lisbonSearch).length, 0)
})
check('calendar validation rejects nonexistent dates', () => {
  assert.equal(flight.validFlightDate('2028-02-29'), true)
  assert.equal(flight.validFlightDate('2026-02-29'), false)
  assert.equal(flight.validFlightDate('2026-04-31'), false)
  assert.equal(flight.validFlightDate('2026-13-01'), false)
})
check('injected explore items search their destination and category', () => {
  const injected = [{ ...explore.kyotoExploreItems[0], id: 'tokyo', title: '庭园一天', destination: '东京', category: '庭园' }]
  assert.deepEqual(ids(explore.filterExploreItems(injected, '东京', '全部')), ['tokyo'])
  assert.deepEqual(ids(explore.filterExploreItems(injected, '', '庭园')), ['tokyo'])
  assert.equal(explore.filterExploreItems(injected, '里斯本', '全部').length, 0)
})
check('featured exclusion hides only the shown item, not all destinations', () => {
  const first = explore.kyotoExploreItems[0]
  const second = { ...first, id: 'second-destination' }
  assert.deepEqual(ids(explore.filterExploreItems([first, second], '', '全部', first.id)), ['second-destination'])
  assert.equal(explore.filterExploreItems([first], '京都', '全部', first.id).length, 1)
})
check('empty explore dataset remains empty and Kyoto arrival has no Lisbon route', () => {
  assert.equal(explore.filterExploreItems([], '', '全部').length, 0)
  assert.equal(kyoto.date, kyotoTrip.dates.start)
  assert.equal(kyoto.travelers, kyotoTrip.travelers)
  assert.equal(kyotoSearch.travelers, 1)
  assert.ok(explore.kyotoExploreItems[0].prompt.includes('1人出行'))
  const arrival = explore.kyotoExploreItems[0].arrival
  assert.ok(arrival.prompt.includes('1人出行'))
  assert.ok(arrival.prompt.includes('2026年11月3日至5日'))
  assert.deepEqual(Array.from(arrival.route, point => point.code), ['PVG', 'KIX'])
  assert.ok(!arrival.prompt.includes('里斯本'))
  assert.equal(explore.kyotoExploreItems[0].photo, '')
})
console.log(`UI flight/explore presentation checks: ${passed} passed.`)
