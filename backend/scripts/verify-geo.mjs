import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { GeoIndex } from '../src/geo-index.mjs'
import { dataRoot } from '../src/paths.mjs'

const index = new GeoIndex()
const cases = [
  { name: 'Charles Bridge', city: 'Prague', qid: 'Q204871' },
  { name: 'Eiffel Tower', city: 'Paris, France', qid: 'Q243' },
  { name: 'Taj Mahal', city: 'Agra', qid: 'Q9141' },
  { name: 'Colosseum', city: 'Rome', qid: 'Q10285' }
]
try {
  const rows = cases.map(({ qid, ...input }) => {
    const start = performance.now(), result = index.resolve(input)
    assert.equal(result.place?.qid, qid, JSON.stringify({ input, result }))
    assert.equal(index.byQid(qid).qid, qid)
    return { input, qid: result.place.qid, elapsedMs: performance.now() - start }
  })
  const near = index.nearby({ latitude: 50.0865, longitude: 14.4118 }, .2)
  assert.ok(near.some(place => place.qid === 'Q204871'))
  assert.equal(index.resolve({ name: 'Eiffel Tower', city: 'Paris' }).status, 'ambiguous')
  const report = { places: index.manifest.places, rows, nearbyCharlesBridge: true, duplicateParisRejected: true }
  await fs.writeFile(path.join(dataRoot, 'wikimedia-geo', 'offline-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { index.close() }
