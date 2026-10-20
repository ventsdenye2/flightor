import test from 'node:test'
import assert from 'node:assert/strict'
import { searchFlightLocations } from '../src/flight-locations.mjs'
import { resolveLocation } from '../../trip-flight-tool/dist/core/locations.js'

test('offline suggestions accept Chinese, English, IATA and ICAO', () => {
  for (const [query, code] of [['北京', 'BJS'], ['Beijing', 'BJS'], ['里斯本', 'LIS'], ['Lisbon', 'LIS'], ['pvg', 'PVG'], ['ZBAA', 'PEK']]) {
    assert.equal(searchFlightLocations(query)[0].code, code, query)
  }
  assert.ok(searchFlightLocations('Heathrow').some(entry => entry.code === 'LHR'))
  assert.ok(searchFlightLocations('北').some(entry => entry.code === 'BJS'))
})
test('city and specific airport suggestions preserve the selected scope', () => {
  const city = searchFlightLocations('上海')[0]
  const airport = searchFlightLocations('上海虹桥')[0]
  assert.equal(city.kind, 'city')
  assert.ok(city.airports.includes('PVG'))
  assert.equal(airport.kind, 'airport')
  assert.deepEqual(resolveLocation(airport.value).airports, ['SHA'])
  for (const entry of searchFlightLocations('Chengdu')) assert.deepEqual(resolveLocation(entry.value).airports, entry.airports)
})
test('suggestions are bounded and unknown input has no fallback', () => {
  assert.equal(searchFlightLocations().length, 6)
  assert.ok(searchFlightLocations('a').length <= 12)
  assert.deepEqual(searchFlightLocations('不存在的机场zzzz'), [])
  assert.throws(() => searchFlightLocations('x'.repeat(101)), /100/)
})
test('search covers airports across continents and islands, beyond the common-city list', () => {
  for (const code of ['PRG', 'LHR', 'HND', 'JFK', 'GRU', 'JNB', 'SYD', 'AKL', 'PPT', 'SXM', 'KEF', 'SCL']) {
    const entry = searchFlightLocations(code)[0]
    assert.equal(entry.code, code)
    assert.deepEqual(resolveLocation(entry.value).airports, entry.airports)
  }
  assert.ok(searchFlightLocations('Reykjavik').some(entry => entry.code === 'KEF' || entry.code === 'RKV'))
  assert.ok(searchFlightLocations('São Paulo').length > 0)
})
