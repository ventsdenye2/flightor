import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { GeoIndex } from '../src/geo-index.mjs'
import { PlaceResolver } from '../src/place-resolver.mjs'
import { PlaceLookup } from '../src/place-lookup.mjs'
import { PlaceBatch } from '../src/place-batch.mjs'
import { PlaceEnrichment } from '../src/place-enrichment.mjs'
import { WikimediaHttp } from '../src/wikimedia-http.mjs'
import { dataRoot } from '../src/paths.mjs'
const fixtures = JSON.parse(await fs.readFile(new URL('../test/fixtures/place-benchmark.json', import.meta.url), 'utf8'))
const tag = process.argv[2]
if (!/^[a-z0-9-]+$/.test(tag || '')) throw Error('Provide a new benchmark directory tag')
const root = path.join(dataRoot, 'place-batch-benchmark', tag)
await fs.mkdir(path.dirname(root), { recursive: true })
await fs.mkdir(root) // Refuse to overwrite evidence or accidentally call a warm run cold.
const index = new GeoIndex(), enrichment = new PlaceEnrichment(path.join(root, 'enrichment.sqlite'))
const rows = []
try {
  for (const mode of ['cold', 'warm', 'offline']) {
    const http = new WikimediaHttp({ root: path.join(root, 'http'), offline: mode === 'offline' })
    const resolver = new PlaceResolver({ index, enrichment, http, offline: mode === 'offline' })
    const lookup = new PlaceLookup({ resolver, cacheRoot: path.join(root, 'fields') })
    const batches = []
    // Six independent six-place itineraries. Every itinerary is one tool call with a shared 20s budget.
    for (let start = 0; start < fixtures.length; start += 6) {
      const cooldown = Math.max(0, ...[...http.hosts.values()].map(host => host.next - Date.now()))
      if (cooldown > 5000 && mode !== 'offline') {
        console.log(JSON.stringify({ mode, nextBatch: batches.length + 1, respectingCooldownMs: cooldown }))
        await delay(cooldown + 100)
      }
      const entries = fixtures.slice(start, start + 6).map((row, i) => ({ id: 'a' + (start + i + 1), name: row.name, city: row.city,
        query: row.referenceTitle.replace(/_/g, ' ') }))
      const batch = new PlaceBatch({ file: path.join(root, `${mode}-${start}.json`), lookup })
      const begin = performance.now(), result = await batch.run({ places: entries })
      const elapsedMs = performance.now() - begin
      const state = await batch.read()
      batches.push({ elapsedMs, ...result, records: state.rows })
      console.log(JSON.stringify({ mode, batch: batches.length, elapsedMs, images: result.results.filter(row => row.image === 'found').length, coordinates: result.results.filter(row => row.location === 'found').length }))
    }
    const results = batches.flatMap(batch => batch.results)
    rows.push({ mode, places: results.length, images: results.filter(row => row.image === 'found').length,
      coordinates: results.filter(row => row.location === 'found').length, meanBatchMs: batches.reduce((sum, row) => sum + row.elapsedMs, 0) / batches.length,
      maxBatchMs: Math.max(...batches.map(row => row.elapsedMs)), http: http.metrics, batches })
    await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify(rows, null, 2))
    await http.dispatcher?.close()
  }
} finally { index.close(); enrichment.close() }
console.log(JSON.stringify(rows.map(({ batches, http, ...row }) => ({ ...row, http: { network: http.network, cache: http.cache, retries: http.retries, failures: http.failures } })), null, 2))
