import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { repo } from '../src/paths.mjs'

test('real HTTP routes retain frontend contracts, input errors, source and attribution without calling an Agent', async () => {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, ['backend/src/server.mjs'], { cwd: repo, windowsHide: true,
    env: { ...process.env, PORT: String(port), FLIGHTOR_PLACES_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const done = once(child, 'exit')
  let error = ''
  child.stderr.on('data', chunk => { error += chunk })
  try {
    await Promise.race([once(child.stdout, 'data'), done.then(() => { throw Error('API startup failed: ' + error) }), new Promise((_, reject) => setTimeout(() => reject(Error('API startup timed out')), 10000).unref())])
    const post = (route, body) => fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4178' }, body: JSON.stringify(body) })
    const response = await post('/api/place-locations', { name: '查理大桥', query: 'Charles Bridge', city: 'Prague' })
    assert.equal(response.status, 200)
    const location = await response.json()
    // This route integration runs even on a fresh machine without the large local dataset.
    assert.ok(['resolved', 'not-found'].includes(location.status))
    assert.deepEqual(Object.keys(location).sort(), ['location', 'status'])
    if (location.location) {
      assert.ok(Math.abs(location.location.latitude - 50.0864) < .002)
      assert.match(location.location.source.url, /wikidata.org\/wiki\/Q204871$/)
    }
    const mediaResponse = await post('/api/place-media', { name: '查理大桥', query: 'Charles Bridge', city: 'Prague' })
    assert.equal(mediaResponse.status, 200)
    const media = await mediaResponse.json()
    assert.deepEqual(Object.keys(media).sort(), ['media', 'status'])
    assert.ok(['ready', 'not-found', 'unavailable'].includes(media.status))
    if (media.media) for (const key of ['src', 'author', 'license', 'licenseUrl', 'source']) assert.ok(media.media[key])
    assert.equal((await post('/api/place-locations', { name: 'Invalid', city: '' })).status, 400)
    assert.equal((await post('/api/place-media', { name: 'Invalid', qid: 'Q1|Q2' })).status, 400)
    assert.equal((await post('/api/place-locations', { name: 'x'.repeat(2200), city: 'Prague' })).status, 413)
  } finally { child.kill(); await done }
})
