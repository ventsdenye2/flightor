import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaceLookup } from '../src/place-lookup.mjs'
import { PlaceResolver } from '../src/place-resolver.mjs'
import { chooseCommonsPhoto } from '../src/commons-media.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataRoot } from '../src/paths.mjs'

const identity = { name: '卢浮宫', query: 'Louvre', city: 'Paris' }
const page = { title: 'File:Paris skyline.jpg', imageinfo: [{ width: 3000, height: 2000, mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Paris.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Paris_skyline.jpg', extmetadata: { Artist: { value: 'Photographer' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }] }
test('MVP accepts the first legal local coordinate without online city resolution or strict entity agreement', async () => {
  const resolver = new PlaceResolver({ offline: true, enrichment: null, index: { byName: name => name === 'Louvre' ? [{ qid: 'Q1', latitude: 48.86, longitude: 2.34 }, { qid: 'Q2', latitude: 49, longitude: 3 }] : [], byQid: () => null } })
  const result = await new PlaceLookup({ resolver }).lookup(identity, { fields: ['location'], cache: false })
  assert.equal(result.location.status, 'found'); assert.equal(result.location.value.latitude, 48.86)
})
test('image coverage is independent of missing coordinates and search-result QID/filename matching', async () => {
  const calls = []
  const resolver = new PlaceResolver({ index: null, enrichment: null, enterpriseToken: () => undefined, http: { json: async url => {
    calls.push(String(url))
    return new URL(url).hostname === 'commons.wikimedia.org' ? { query: { pages: [page] } } : { search: [] }
  } } })
  const result = await new PlaceLookup({ resolver }).lookup(identity, { cache: false })
  assert.equal(result.location.status, 'not-found'); assert.equal(result.image.status, 'found')
  assert.equal(result.image.value.author, 'Photographer')
  assert.equal(calls.filter(url => url.includes('wbsearchentities')).length, 1)
  assert.equal(calls.some(url => url.includes('wbgetentities')), false)
  assert.equal(chooseCommonsPhoto([page], identity), null)
  assert.ok(chooseCommonsPhoto([page], identity, { acceptSearchResult: true }))
  const restricted = structuredClone(page); restricted.imageinfo[0].extmetadata.LicenseShortName.value = 'All rights reserved'
  assert.equal(chooseCommonsPhoto([restricted], identity, { acceptSearchResult: true }), null)
})
test('image still succeeds after entity transport failure; coordinates remain unavailable, not semantic failure', async () => {
  const resolver = new PlaceResolver({ index: null, enrichment: null, enterpriseToken: () => undefined, http: { json: async url => {
    if (new URL(url).hostname === 'commons.wikimedia.org') return { query: { pages: [page] } }
    throw Error('429 cooldown')
  } } })
  const result = await new PlaceLookup({ resolver }).lookup(identity, { cache: false })
  assert.equal(result.location.status, 'unavailable'); assert.equal(result.image.status, 'found')
})

test('online path tries Enterprise for article and QID before public APIs; warm fields do not query again', async t => {
  const calls = []
  const root = await fs.mkdtemp(path.join(dataRoot, 'place-priority-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const resolver = new PlaceResolver({ index: null, enrichment: null, enterpriseToken: () => 'test-token', http: { json: async value => {
    const url = new URL(value); calls.push(url.hostname + url.pathname)
    if (url.pathname.includes('/articles/')) return [{ name: 'Louvre', is_part_of: { identifier: 'enwiki' }, main_entity: { identifier: 'Q19675' } }]
    if (url.pathname.includes('/wikidata/items/')) return { entity: { identifier: 'Q19675', type: 'item', labels: { en: 'Louvre' }, statements: {
      P625: [{ value: { type: 'globe-coordinate', content_data: { latitude: '48.86', longitude: '2.34', globe: 'http://www.wikidata.org/entity/Q2' } } }],
      P18: [{ value: { type: 'commonsMedia', content: 'Paris skyline.jpg' } }]
    } } }
    assert.equal(url.hostname, 'commons.wikimedia.org')
    return { query: { pages: [page] } }
  } } })
  const lookup = new PlaceLookup({ resolver, cacheRoot: root })
  const first = await lookup.lookup(identity)
  assert.equal(first.location.via, 'enterprise')
  assert.match(first.image.via, /^enterprise\+P18/)
  assert.deepEqual(calls, ['api.enterprise.wikimedia.com/v2/articles/Louvre', 'api.enterprise.wikimedia.com/v2/wikidata/items/Q19675', 'commons.wikimedia.org/w/api.php'])
  const count = calls.length, second = await lookup.lookup(identity)
  assert.equal(second.location.via, 'field-cache'); assert.equal(second.image.via, 'field-cache'); assert.equal(calls.length, count)
})
test('public fallback is used only after Enterprise miss, without extra semantic rounds', async () => {
  const calls = []
  const resolver = new PlaceResolver({ index: null, enrichment: null, enterpriseToken: () => 'test-token', http: { json: async value => {
    const url = new URL(value); calls.push(url.hostname + (url.searchParams.get('action') || url.pathname))
    if (url.hostname === 'api.enterprise.wikimedia.com') throw Error('404')
    if (url.searchParams.get('action') === 'wbsearchentities') return { search: [{ id: 'Q19675' }] }
    if (url.searchParams.get('action') === 'wbgetentities') return { entities: { Q19675: { id: 'Q19675', claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 48.86, longitude: 2.34 } } } }] } } } }
    return { query: { pages: [page] } }
  } } })
  const result = await new PlaceLookup({ resolver }).lookup(identity, { fields: ['location'], cache: false })
  assert.equal(result.location.status, 'found'); assert.equal(result.location.via, 'public-api')
  assert.deepEqual(calls, ['api.enterprise.wikimedia.com/v2/articles/Louvre', 'www.wikidata.orgwbsearchentities', 'api.enterprise.wikimedia.com/v2/wikidata/items/Q19675', 'www.wikidata.orgwbgetentities'])
})
