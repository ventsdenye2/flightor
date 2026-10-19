import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { entityLocation, loadPlaceLocation, matchPlaceEntities, queryPlaceLocation } from '../src/place-locations.mjs'
const identity = { name: '查理大桥', query: 'Charles Bridge', city: 'Prague' }
const match = { id: 'Q204871', label: 'Charles Bridge', description: 'bridge in Prague, Czech Republic' }
const entity = () => ({ id: 'Q204871', claims: { P625: [{ rank: 'normal', mainsnak: { datavalue: { value: { latitude: 50.0864, longitude: 14.4119, globe: 'http://www.wikidata.org/entity/Q2' } } } }] } })

test('location matching requires exact landmark and city, excluding artworks and wrong cities', () => {
  const matches = matchPlaceEntities([match, { ...match, id: 'Q2', description: 'bridge in another city' }, { ...match, id: 'Q3', label: 'Charles Bridge Gallery' }, { ...match, id: 'Q4', description: 'painting of Prague' }], identity)
  assert.deepEqual(matches.map(item => item.id), ['Q204871'])
  assert.equal(matchPlaceEntities([{ id: 'Q10', label: 'Nerudova', description: 'street in Prague' }], { ...identity, query: 'Nerudova Street' }).length, 1)
})
test('only valid unambiguous Earth coordinates publish with entity source', () => {
  assert.equal(entityLocation(entity()).source.url, 'https://www.wikidata.org/wiki/Q204871')
  for (const mutate of [v => { v.latitude = 95 }, v => { v.longitude = NaN }, v => { v.globe = 'http://www.wikidata.org/entity/Q405' }]) {
    const value = entity(); mutate(value.claims.P625[0].mainsnak.datavalue.value); assert.equal(entityLocation(value), null)
  }
  const conflict = entity(); conflict.claims.P625.push({ ...conflict.claims.P625[0], mainsnak: { datavalue: { value: { ...conflict.claims.P625[0].mainsnak.datavalue.value, latitude: 52 } } } })
  assert.equal(entityLocation(conflict), null)
  conflict.claims.P625[0].rank = 'preferred'; assert.equal(entityLocation(conflict).latitude, 50.0864)
  assert.equal(entityLocation({}), null)
})
test('Wikidata requests only place identity and do not choose ambiguous entities', async () => {
  const actions = []
  const request = async url => {
    assert.equal(url.origin, 'https://www.wikidata.org'); const action = url.searchParams.get('action'); actions.push(action)
    return { ok: true, json: async () => action === 'wbsearchentities' ? { search: [match] } : { entities: { Q204871: entity() } } }
  }
  assert.equal((await queryPlaceLocation(identity, { request })).latitude, 50.0864)
  assert.deepEqual(actions, ['wbsearchentities', 'wbgetentities'])
  assert.equal(await queryPlaceLocation(identity, { request: async () => ({ ok: true, json: async () => ({ search: [match, { ...match, id: 'Q9' }] }) }) }), null)
})
test('location cache coalesces requests, survives reload and leaves network failures retryable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flightor-location-'))
  let calls = 0
  const lookup = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return entityLocation(entity()) }
  try {
    const [a, b] = await Promise.all([loadPlaceLocation(identity, { root, lookup }), loadPlaceLocation(identity, { root, lookup })])
    assert.equal(calls, 1); assert.equal(a.status, 'resolved'); assert.deepEqual(a, b)
    assert.deepEqual(await loadPlaceLocation(identity, { root, lookup: () => assert.fail('must use cache') }), a)
    const other = { ...identity, query: 'Other landmark' }
    assert.equal((await loadPlaceLocation(other, { root, lookup: async () => { throw Error('offline') } })).status, 'unavailable')
    assert.equal((await loadPlaceLocation(other, { root, lookup: async () => null })).status, 'not-found')
    await assert.rejects(loadPlaceLocation({ ...identity, city: '' }, { root }), /城市/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
