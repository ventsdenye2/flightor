import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaceResolver, placeIdentity } from '../src/place-resolver.mjs'
import { commonsFile, chooseCommonsPhoto } from '../src/commons-media.mjs'
import { fromEnterpriseEntity, entityLocation } from '../src/wikidata-entity.mjs'

const point = { latitude: 50.0864, longitude: 14.4119 }
const landmark = { ...point, qid: 'Q204871', label: 'Charles Bridge', description: 'bridge in Prague', source: { url: 'https://www.wikidata.org/wiki/Q204871' } }
const city = { latitude: 50.08, longitude: 14.42, qid: 'Q1085', label: 'Prague', description: 'capital city of Czechia' }
const index = { byName: name => name === 'Charles Bridge' ? [landmark] : name === 'Prague' ? [city] : [], byQid: qid => qid === landmark.qid ? landmark : null }
const identity = { name: '查理大桥', query: 'Charles Bridge', city: 'Prague' }
const entity = { id: landmark.qid, labels: { en: { value: 'Charles Bridge' }, zh: { value: '查理大桥' } }, descriptions: { en: { value: 'bridge in Prague' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'A precise entity photograph.jpg' } } }] }, sitelinks: { enwiki: { title: 'Charles Bridge' } } }
const imagePage = { title: 'File:A precise entity photograph.jpg', imageinfo: [{ width: 3000, height: 2000, mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/p.jpg/960px-p.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:A_precise_entity_photograph.jpg', extmetadata: { Artist: { value: 'Photographer' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }] }

test('location uses offline identity without HTTP, ambiguous identities never become first-result matches', async () => {
  const resolver = new PlaceResolver({ index, enrichment: null, http: { json: () => assert.fail('must stay offline') }, offline: true })
  assert.deepEqual(await resolver.location(identity), { ...point, source: landmark.source })
  assert.equal((await resolver.resolve({ name: '查理大桥', city: 'Prague' })).status, 'not-found')
  assert.equal((await resolver.resolve({ ...identity, city: 'London' })).status, 'not-found')
  const ambiguous = new PlaceResolver({ index: { ...index, byName: name => name === 'Charles Bridge' ? [landmark, { ...landmark, qid: 'Q123' }] : name === 'Prague' ? [city] : [] }, enrichment: null, offline: true })
  assert.equal((await ambiguous.resolve(identity)).status, 'ambiguous')
})

test('P18 file binding permits arbitrary filenames but requires full Commons license and author', async () => {
  const requests = []
  const resolver = new PlaceResolver({ index, enrichment: null, http: { json: async url => {
    requests.push(url)
    return url.hostname === 'www.wikidata.org' ? { entities: { [entity.id]: entity } } : { query: { pages: [imagePage] } }
  } } })
  const media = await resolver.media(identity)
  assert.equal(media.author, 'Photographer'); assert.equal(requests.length, 2)
  assert.equal(requests[1].searchParams.get('titles'), 'File:A precise entity photograph.jpg')
  assert.equal(chooseCommonsPhoto([{ ...imagePage, title: 'File:Charles Bridge Prague.jpg' }], { ...identity, qid: landmark.qid }, { requireDepicts: true }), null)
  assert.equal(await commonsFile('Some other file.jpg', identity, { http: { json: async () => ({ query: { pages: [imagePage] } }) } }), null)
  const panorama = { ...imagePage, title: 'File:City panorama.jpg', depicts: [landmark.qid], imageinfo: [{ ...imagePage.imageinfo[0], extmetadata: { ...imagePage.imageinfo[0].extmetadata, ImageDescription: { value: 'Charles Bridge and the city skyline' } } }] }
  assert.ok(chooseCommonsPhoto([panorama], { ...identity, qid: landmark.qid }, { requireDepicts: true }))
})

test('Wikipedia and Enterprise main images must carry the resolved QID; bearer token never enters URL or body', async () => {
  const resolver = new PlaceResolver({ index, enrichment: null, enterpriseToken: () => 'test-secret', http: { json: async (url, options) => {
    if (typeof url === 'string') {
      assert.match(url, /^https:\/\/api.enterprise.wikimedia.com\/v2\/structured-contents\//)
      assert.equal(options.headers.authorization, 'Bearer test-secret'); assert.equal(options.body.includes('test-secret'), false)
      return [{ main_entity: { identifier: 'Q999' }, is_part_of: { identifier: 'enwiki' }, image: { content_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/wrong.jpg' } }]
    }
    return { query: { pages: [{ pageprops: { wikibase_item: entity.id }, pageimage: 'Correct.jpg' }] } }
  } } })
  assert.equal(await resolver.wikipediaImage(entity), 'Correct.jpg')
  resolver.http.json = async () => [{ main_entity: { identifier: entity.id }, is_part_of: { identifier: 'enwiki' }, image: { content_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Correct.jpg' } }]
  assert.equal(await resolver.wikipediaImage(entity), 'Correct.jpg')
  resolver.enterpriseToken = () => undefined
  resolver.http.json = async () => ({ query: { pages: [{ pageprops: { wikibase_item: 'Q999' }, pageimage: 'Wrong.jpg' }] } })
  assert.equal(await resolver.wikipediaImage(entity), null)
})

test('public input rejects malformed QID and partial coordinates', () => {
  assert.throws(() => placeIdentity({ ...identity, qid: 'Q1|Q2' }))
  assert.throws(() => placeIdentity({ ...identity, latitude: 50 }))
})

test('qualified same-name cities cannot be overridden by a generic city word in a place description', async () => {
  const paris = { qid: 'Q90', label: 'Paris', description: 'capital city of France', latitude: 48.85, longitude: 2.35 }
  const texas = { qid: 'Q830149', label: 'Paris', description: 'city in Texas, United States', latitude: 33.66, longitude: -95.55 }
  const tower = { ...paris, qid: 'Q243', label: 'Eiffel Tower', description: 'tower in Paris, France' }
  const replica = { ...texas, qid: 'Q25223034', label: 'Eiffel Tower', description: 'tower in Paris, Texas' }
  const resolver = new PlaceResolver({ enrichment: null, offline: true, index: { byName: name => name === 'Paris' || name === 'paris' ? [paris, texas] : name === 'Eiffel Tower' ? [tower, replica] : [], byQid: () => null } })
  assert.equal((await resolver.resolve({ name: 'Eiffel Tower', city: 'Paris, Texas' })).place.qid, replica.qid)
  assert.equal((await resolver.resolve({ name: 'Eiffel Tower', city: 'Paris' })).status, 'ambiguous')
})

test('Enterprise entity format converts numeric coordinates and preserves QID and P18', () => {
  const value = fromEnterpriseEntity({ entity: { identifier: 'Q243', type: 'item', labels: { en: 'Eiffel Tower' }, aliases: { zh: ['埃菲尔铁塔'] }, sitelinks: { enwiki: { title: 'Eiffel Tower' } }, statements: {
    P625: [{ rank: 'normal', value: { type: 'globe-coordinate', content_data: { latitude: '48.8583', longitude: '2.2945', precision: '0.0001', globe: 'http://www.wikidata.org/entity/Q2' } } }],
    P18: [{ rank: 'normal', value: { type: 'commonsMedia', content: 'Tower.jpg' } }]
  } } })
  assert.equal(entityLocation(value).latitude, 48.8583)
  assert.equal(value.claims.P18[0].mainsnak.datavalue.value, 'Tower.jpg')
  assert.equal(value.aliases.zh[0].value, '埃菲尔铁塔')
  assert.equal(fromEnterpriseEntity({}), null)
})

test('configured Enterprise metadata is tried before public Wikidata and auth failures fall back', async () => {
  const calls = []
  const resolver = new PlaceResolver({ index: null, enrichment: null, enterpriseToken: () => 'test-token', http: { json: async url => {
    calls.push(String(url))
    if (String(url).includes('api.enterprise.wikimedia.com')) throw Error('simulated unavailable')
    return { entities: { [entity.id]: entity } }
  } } })
  assert.equal((await resolver.entities([entity.id]))[entity.id].id, entity.id)
  assert.match(calls[0], /api.enterprise.wikimedia.com/)
  assert.match(calls[1], /www.wikidata.org/)
})

test('cached qualified article identity remains usable offline when the common name has over 200 candidates', async () => {
  const known = { ...entity, labels: { en: { value: 'Old Bridge' } }, sitelinks: { enwiki: { title: 'Old Bridge, Prague' } } }
  const resolver = new PlaceResolver({ offline: true, index: { ...index, byName: name => name === 'Old Bridge' ? Array.from({ length: 201 }, (_, i) => ({ ...landmark, qid: 'Q' + (i + 1000) })) : name === 'Prague' ? [city] : [] },
    enrichment: { byName: name => name === 'Old Bridge, Prague' ? [known] : [], get: () => null } })
  assert.equal((await resolver.resolve({ name: 'Old Bridge', city: 'Prague' })).place.qid, landmark.qid)
})
