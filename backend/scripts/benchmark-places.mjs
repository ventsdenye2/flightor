import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { GeoIndex, distanceKm } from '../src/geo-index.mjs'
import { PlaceResolver } from '../src/place-resolver.mjs'
import { PlaceEnrichment } from '../src/place-enrichment.mjs'
import { WikimediaHttp, actionUrl } from '../src/wikimedia-http.mjs'
import { dataRoot } from '../src/paths.mjs'

const fixtures = JSON.parse(await fs.readFile(new URL('../test/fixtures/place-benchmark.json', import.meta.url), 'utf8'))
const directory = path.join(dataRoot, 'wikimedia-geo', 'benchmark')
await fs.mkdir(directory, { recursive: true })
const referenceFile = path.join(directory, 'references.json')
const mode = process.argv[2] || 'references'
const summary = rows => {
  const values = rows.map(row => row.elapsedMs).sort((a, b) => a - b)
  const resolved = rows.filter(row => row.qid), correct = resolved.filter(row => row.coordinateCorrect)
  const images = rows.filter(row => row.media), linked = images.filter(row => row.imageCorrect)
  return { total: rows.length, coordinates: resolved.length, coordinateCorrect: correct.length,
    coordinatePositionCorrect: resolved.filter(row => row.offsetM <= 500).length,
    coordinatePrecision: resolved.length ? correct.length / resolved.length : null, coordinateCoverage: resolved.length / rows.length,
    images: images.length, imageEntityAgreement: images.length ? linked.length / images.length : null, imageCoverage: images.length / rows.length,
    meanMs: values.reduce((a, b) => a + b, 0) / values.length, p50Ms: values[Math.floor(values.length * .5)], p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * .95))] }
}
if (mode === 'references') {
  try { await fs.copyFile(referenceFile, path.join(directory, 'references-initial.json'), fs.constants.COPYFILE_EXCL) } catch {}
  const http = new WikimediaHttp({ root: path.join(directory, 'reference-http') })
  const value = await http.json(actionUrl('en.wikipedia.org', { action: 'query', titles: fixtures.map(row => row.referenceTitle).join('|'),
    redirects: '1', prop: 'pageprops|coordinates', coprimary: 'primary', colimit: 'max' }))
  const redirects = new Map([...(value.query?.normalized || []), ...(value.query?.redirects || [])].map(row => [row.from, row.to]))
  const references = fixtures.map(row => {
    let title = row.referenceTitle
    for (let i = 0; i < 5 && redirects.has(title); i++) title = redirects.get(title)
    const page = value.query?.pages?.find(page => page.title === title)
    if (!page?.pageprops?.wikibase_item) throw Error('Missing reference identity: ' + row.referenceTitle)
    if (page.pageprops.disambiguation != null) throw Error('Reference must identify a physical place, not a disambiguation page: ' + row.referenceTitle)
    const coordinate = page.coordinates?.[0]
    if (coordinate && distanceKm(row, { latitude: coordinate.lat, longitude: coordinate.lon }) > 2) throw Error('Reference coordinate differs by >2km: ' + row.referenceTitle)
    return { title: row.referenceTitle, qid: page.pageprops.wikibase_item, source: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      latitude: coordinate?.lat ?? row.latitude, longitude: coordinate?.lon ?? row.longitude, coordinateSource: coordinate ? 'Wikipedia primary coordinates' : 'fixed approximate fixture coordinate' }
  })
  await fs.writeFile(referenceFile, JSON.stringify({ createdAt: new Date().toISOString(), references }, null, 2))
  console.log('Frozen independent Wikipedia references:', references.length)
  process.exit(0)
}
const references = JSON.parse(await fs.readFile(referenceFile, 'utf8')).references
const index = new GeoIndex()
const offline = mode.startsWith('offline')
const coldOffline = mode.startsWith('offline-cold')
const finalRun = mode.endsWith('-final')
const runTag = process.env.FLIGHTOR_BENCHMARK_RUN || 'acceptance'
if (!/^[a-z0-9-]+$/.test(runTag)) throw Error('Invalid benchmark run directory name')
const runDirectory = finalRun ? path.join(directory, runTag) : directory
if (mode === 'online-cold-final') {
  try { await fs.access(path.join(runDirectory, 'enrichment.sqlite')); throw Error('Cold acceptance directory already contains enrichment; use a new run directory') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await fs.copyFile(path.join(directory, mode + '.json'), path.join(directory, mode + '-' + Date.now() + '.json')) } catch {}
}
const enrichment = coldOffline ? null : new PlaceEnrichment(path.join(runDirectory, 'enrichment.sqlite'))
const http = new WikimediaHttp({ root: path.join(runDirectory, 'http'), offline })
const resolver = new PlaceResolver({ index, enrichment, offline, http })
const rows = []
for (const [i, fixture] of fixtures.entries()) {
  if (!offline) {
    const cooldown = Math.max(0, ...[...http.hosts.values()].map(host => host.next - Date.now()))
    if (cooldown > 5000) {
      console.log(`Respecting upstream cooldown before next landmark: ${Math.ceil(cooldown / 1000)}s`)
      await delay(Math.min(cooldown + 100, 60000))
    }
  }
  const input = { name: fixture.name, city: fixture.city }
  const reference = references[i], start = performance.now()
  let resolved, media = null, evidence, error, mediaError
  try { resolved = await resolver.resolve(input) } catch (caught) { error = caught.message }
  const coordinateMs = performance.now() - start
  if (!coldOffline && resolved?.place) {
    try { media = await resolver.media(input, { onEvidence: value => { evidence = value } }) } catch (caught) { mediaError = caught.message }
  }
  const place = resolved?.place, offsetM = place ? distanceKm(reference, place) * 1000 : null
  const row = { input, group: fixture.group, reference, status: resolved?.status || 'unavailable', method: resolved?.method,
    qid: place?.qid || null, location: place ? { latitude: place.latitude, longitude: place.longitude } : null,
    offsetM, coordinateCorrect: Boolean(place?.qid === reference.qid && offsetM <= 500), coordinateMs, media, evidence,
    imageCorrect: Boolean(media && evidence?.qid === reference.qid), elapsedMs: performance.now() - start, error, mediaError }
  rows.push(row)
  await fs.writeFile(path.join(directory, mode + '.json'), JSON.stringify({ mode, rows, summary: summary(rows), http: http.metrics }, null, 2))
  console.log(`${i + 1}/${fixtures.length} ${fixture.name}: ${row.status} ${row.qid || '-'} coordinate=${row.coordinateCorrect} image=${Boolean(media)} ${Math.round(row.elapsedMs)}ms`, error || mediaError || '')
}
const groups = Object.fromEntries([...new Set(fixtures.map(row => row.group))].map(group => [group, summary(rows.filter(row => row.group === group))]))
await fs.writeFile(path.join(directory, mode + '.json'), JSON.stringify({ mode, rows, summary: summary(rows), groups, http: http.metrics }, null, 2))
console.log(JSON.stringify({ mode, summary: summary(rows), groups, http: http.metrics }, null, 2))
index.close(); enrichment?.close()
