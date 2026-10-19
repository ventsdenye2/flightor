import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { chooseCommonsPhoto, loadPlaceMedia, mediaIdentity, queryCommons } from '../src/place-media.mjs'

const identity = { name: '查理大桥', query: 'Charles Bridge', city: 'Prague' }
const page = (title = 'File:Charles Bridge Prague.jpg') => ({ title, imageinfo: [{ width: 3000, height: 2000, mime: 'image/jpeg', thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Charles_Bridge.jpg/960px-Charles_Bridge.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Charles_Bridge_Prague.jpg', extmetadata: { Artist: { value: '<a>Photographer</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }] })

test('Commons selection uses landmark identity and retains plain author, source and license', () => {
  const chosen = chooseCommonsPhoto([page('File:Prague skyline.jpg'), page()], identity)
  assert.equal(chosen.description, '查理大桥'); assert.equal(chosen.author, 'Photographer')
  assert.equal(chosen.license, 'CC BY-SA 4.0'); assert.match(chosen.source.url, /^https:\/\/commons.wikimedia.org\//)
  assert.match(chosen.src, /^https:\/\/thumb.wikimedia.org\//)
  assert.equal(chooseCommonsPhoto([page('File:Prague skyline.jpg')], identity), null)
})
test('unknown license, tiny images and foreign image hosts are omitted', () => {
  for (const change of [i => { delete i.extmetadata.LicenseShortName }, i => { i.width = 100 }, i => { i.thumburl = 'https://evil.example/photo.jpg' }, i => { i.extmetadata.Restrictions = { value: 'restricted' } }, i => { i.mime = 'image/svg+xml' }]) {
    const value = page(); change(value.imageinfo[0]); assert.equal(chooseCommonsPhoto([value], identity), null)
  }
})
test('only fixed Commons API is queried; no model URL or conversation is sent', async () => {
  const media = await queryCommons(identity, { request: async (url, options) => {
    assert.equal(url.origin, 'https://commons.wikimedia.org'); assert.equal(url.pathname, '/w/api.php')
    assert.match(url.searchParams.get('gsrsearch'), /Charles Bridge.*Prague/)
    assert.equal(url.searchParams.get('gsrnamespace'), '6'); assert.match(options.headers['User-Agent'], /^FlightOR/)
    return { ok: true, json: async () => ({ query: { pages: [page()] } }) }
  } })
  assert.equal(media.author, 'Photographer')
  assert.throws(() => mediaIdentity({ name: '' }))
  assert.throws(() => mediaIdentity({ name: 'Museum', query: {} }))
})
test('same-place requests coalesce and survive restart through metadata cache; failures stay retryable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flightor-media-'))
  let calls = 0
  const lookup = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return chooseCommonsPhoto([page()], identity) }
  try {
    const [a, b] = await Promise.all([loadPlaceMedia(identity, { root, lookup }), loadPlaceMedia(identity, { root, lookup })])
    assert.equal(calls, 1); assert.equal(a.status, 'ready'); assert.deepEqual(a, b)
    const cached = await loadPlaceMedia(identity, { root, lookup: () => assert.fail('must use disk cache') })
    assert.deepEqual(cached, a)
    const other = { ...identity, city: 'Another city' }
    assert.equal((await loadPlaceMedia(other, { root, lookup: async () => { throw Error('offline') } })).status, 'unavailable')
    assert.equal((await loadPlaceMedia(other, { root, lookup: async () => null })).status, 'not-found')
    assert.equal((await loadPlaceMedia(identity, { root, now: () => Date.now() + 8 * 86400000, lookup: async () => null })).status, 'not-found')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
