import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataRoot } from '../src/paths.mjs'
import { WikimediaHttp, actionUrl } from '../src/wikimedia-http.mjs'
const response = value => ({ ok: true, json: async () => value })

test('transport serializes each host, coalesces identical calls, persists public responses', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'http-test-'))
  let active = 0, calls = 0, peak = 0
  const http = new WikimediaHttp({ root, intervalMs: 0, request: async () => {
    active++; peak = Math.max(peak, active); calls++
    await new Promise(resolve => setTimeout(resolve, 10)); active--
    return response({ public: calls })
  } })
  const a = actionUrl('www.wikidata.org', { action: 'a' }), b = actionUrl('www.wikidata.org', { action: 'b' })
  try {
    const [one, two] = await Promise.all([http.json(a), http.json(a), http.json(b)])
    assert.deepEqual(one, two); assert.equal(calls, 2); assert.equal(peak, 1)
    assert.deepEqual(await new WikimediaHttp({ root, request: () => assert.fail('disk cache required') }).json(a), one)
    await assert.rejects(http.json('https://evil.example/w/api.php'), /Unsupported/)
  } finally { await fs.rm(root, { recursive: true }) }
})

test('429 cooldown is host-specific and unavailable responses are not cached as absence', async () => {
  let calls = 0
  const http = new WikimediaHttp({ root: null, intervalMs: 0, request: async url => {
    calls++
    return url.hostname === 'www.wikidata.org' ? { ok: false, status: 429, headers: new Headers({ 'retry-after': '60' }) } : response({ ok: true })
  } })
  await assert.rejects(http.json('https://www.wikidata.org/w/api.php'), /cooldown/)
  assert.deepEqual(await http.json('https://commons.wikimedia.org/w/api.php'), { ok: true })
  await assert.rejects(http.json('https://www.wikidata.org/w/api.php'), /cooldown/)
  assert.equal(calls, 2)
})

test('transient transfer failure retries, maxlag respects backoff, cancellation bounds queue wait', async () => {
  let calls = 0
  const http = new WikimediaHttp({ root: null, intervalMs: 0, request: async () => {
    calls++; if (calls === 1) throw TypeError('connection reset')
    return response({ ok: true })
  } })
  assert.deepEqual(await http.json('https://www.wikidata.org/w/api.php'), { ok: true })
  assert.equal(http.metrics.retries, 1)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(http.json('https://commons.wikimedia.org/w/api.php', { signal: controller.signal }))
  const lag = new WikimediaHttp({ root: null, intervalMs: 0, request: async () => response({ error: { code: 'maxlag', lag: 60 } }) })
  await assert.rejects(lag.json('https://www.wikidata.org/w/api.php'), /cooldown/)
})

test('offline transport serves cached public metadata and never attempts a network cache miss', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'offline-http-test-'))
  const url = actionUrl('commons.wikimedia.org', { action: 'query', titles: 'File:Known.jpg' })
  try {
    await new WikimediaHttp({ root, intervalMs: 0, request: async () => response({ known: true }) }).json(url)
    const http = new WikimediaHttp({ root, offline: true, request: () => assert.fail('offline network must be disabled') })
    assert.deepEqual(await http.json(url), { known: true })
    await assert.rejects(http.json(actionUrl('commons.wikimedia.org', { action: 'query', titles: 'File:Unknown.jpg' })), /Offline/)
    assert.equal(http.metrics.network, 0)
  } finally { await fs.rm(root, { recursive: true }) }
})
