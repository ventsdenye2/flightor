const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Pure UI data only: unexpected provider, framework or network imports fail here.
const cache = new Map()
function load(name) {
  const file = path.resolve(__dirname, '../src/features/ui-experience', `${name}.ts`)
  if (cache.has(file)) return cache.get(file)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: dependency => {
    assert.ok(dependency.startsWith('./'), `Unexpected display dependency: ${dependency}`)
    return load(dependency.slice(2))
  } }, { filename: file })
  cache.set(file, module.exports)
  return module.exports
}
const model = load('presentation')
const samples = load('sampleTrips')
let passed = 0
function check(label, fn) { fn(); passed++; console.log(`PASS ${label}`) }
const { lisbonTrip, kyotoTrip, partialTrip, emptyTrip, complexTrip } = samples
check('selected day uses identity, never numeric ranges or array offsets', () => {
  assert.equal(model.selectTripDay(kyotoTrip.days, '2026-11-04').label, '慢游')
  assert.equal(model.selectTripDay(kyotoTrip.days, 'missing').id, 'arrival-kyoto')
  assert.equal(model.selectTripDay(lisbonTrip.days, '2').id, 1)
  assert.equal(model.selectTripDay(lisbonTrip.days, 2).id, 2)
})
check('pending and empty schedules do not borrow ready-day activities', () => {
  assert.equal(model.selectTripDay(partialTrip.days, 3).id, 1)
  assert.equal(partialTrip.days[2].activities.length, 0)
  assert.equal(model.selectTripDay([{ ...kyotoTrip.days[0], status: 'pending' }]), undefined)
  assert.equal(model.selectTripDay(emptyTrip.days), undefined)
})
check('updated schedule retains a valid selected id and drops removed or pending selection', () => {
  const selected = '2026-11-04'
  const newSnapshot = kyotoTrip.days.map(day => ({ ...day, title: `${day.title} · 已更新` }))
  assert.equal(model.selectTripDay(newSnapshot, selected), newSnapshot[1])
  assert.equal(model.selectTripDay(newSnapshot.filter(day => day.id !== selected), selected), newSnapshot[0])
  const waitingSnapshot = newSnapshot.map(day => day.id === selected ? { ...day, status: 'pending' } : day)
  assert.equal(model.selectTripDay(waitingSnapshot, selected), waitingSnapshot[0])
})
check('missing or invalid coordinates are not converted to zero', () => {
  for (const value of [{}, { latitude: null, longitude: null }, { latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 1 }, { latitude: 1, longitude: Infinity }, { latitude: 1, longitude: -181 }]) assert.equal(model.hasCoordinates(value), false)
  assert.equal(model.hasCoordinates({ latitude: 0, longitude: 0 }), true)
  assert.equal(model.hasCoordinates(lisbonTrip.days[1].activities[0]), true)
})
check('unknown prices stay unknown even if a numeric placeholder is present', () => {
  const price = { ...lisbonTrip.flights[0].price, status: 'unknown', amount: 0 }
  assert.equal(model.formatPrice(price), '价格待确认')
  assert.equal(model.priceStatusLabel(price), '尚无报价')
  assert.equal(model.formatPrice(kyotoTrip.flights[0].price), '价格待确认')
  assert.equal(model.formatPrice(undefined), '价格待确认')
})
check('map viewport leaves room for edge pins without changing route coordinates', () => {
  const points = lisbonTrip.days[1].activities.map(({ latitude, longitude }) => ({ latitude, longitude }))
  const before = JSON.stringify(points)
  const bounds = model.mapViewportPoints(points)
  const south = Math.min(...points.map(point => point.latitude))
  const north = Math.max(...points.map(point => point.latitude))
  assert.ok(bounds[0].latitude < south && bounds[1].latitude > north)
  assert.ok(north - south <= (bounds[1].latitude - bounds[0].latitude) * 0.6)
  for (const point of points) {
    assert.ok(point.longitude > bounds[0].longitude && point.longitude < bounds[1].longitude)
  }
  assert.equal(JSON.stringify(points), before)
})
check('map framing keeps empty and single locations and clamps geographic edges', () => {
  assert.equal(model.mapViewportPoints([]).length, 0)
  const one = [{ latitude: 0, longitude: 0 }]
  assert.equal(model.mapViewportPoints(one), one)
  const edges = model.mapViewportPoints([{ latitude: -89, longitude: -179 }, { latitude: 89, longitude: 179 }])
  assert.equal(edges.every(model.hasCoordinates), true)
})
check('known zero is distinct from invalid prices and currency is preserved', () => {
  const price = lisbonTrip.flights[0].price
  assert.equal(model.formatPrice({ ...price, amount: 0 }), '¥0')
  assert.equal(model.formatPrice({ ...price, amount: -1 }), '价格待确认')
  assert.equal(model.formatPrice({ ...price, amount: NaN }), '价格待确认')
  assert.equal(model.formatPrice({ ...price, amount: 125, currency: 'EUR' }), '€125')
  assert.equal(model.formatPrice({ ...price, amount: 125, currency: 'AUD' }), '125 AUD')
})
check('partial dates and unknown counts retain their actual known scope', () => {
  assert.equal(model.formatTripDates(emptyTrip), '日期待确认')
  assert.equal(model.formatTripDates({ dates: { start: '2031-04-20', end: null, label: '' } }), '2031-04-20 起 · 结束日期待确认')
  assert.equal(model.tripDurationLabel(emptyTrip), '天数待确认')
  assert.equal(model.travelerLabel(emptyTrip), '同行人数待确认')
  assert.equal(model.tripDurationLabel(kyotoTrip), '3 天')
  assert.equal(model.travelerLabel(kyotoTrip), '1 人同行')
})
check('replacement candidates are local, distinct and do not mutate input', () => {
  const day = kyotoTrip.days[0]
  const before = JSON.stringify(day)
  assert.equal(model.findAlternative(day, kyotoTrip.alternatives, day.activities[0].id).id, 'kyoto-rest')
  assert.equal(model.findAlternative({ ...day, activities: kyotoTrip.alternatives }, kyotoTrip.alternatives), undefined)
  assert.equal(model.findAlternative(day, []), undefined)
  assert.equal(JSON.stringify(day), before)
})
check('second destination has no borrowed Lisbon media or made-up flight values', () => {
  assert.equal(kyotoTrip.cover.src, null)
  assert.equal(kyotoTrip.days.flatMap(day => day.activities).every(activity => activity.media === null), true)
  assert.equal(kyotoTrip.flights[0].legs[0].depart, null)
  assert.equal(kyotoTrip.flights[0].price.amount, null)
  assert.equal(emptyTrip.flights.length, 0)
  assert.equal(complexTrip.flights[0].legs.length, 3)
})
check('unknown trip ids do not silently resolve to Lisbon', () => {
  assert.equal(samples.getSampleTrip('missing-trip'), undefined)
  assert.equal(samples.getSampleTrip(kyotoTrip.id), kyotoTrip)
  assert.equal(new Set(samples.sampleTrips.map(trip => trip.id)).size, samples.sampleTrips.length)
})
console.log(`${passed} presentation boundary checks passed`)
