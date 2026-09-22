const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const moduleValue = { exports: {} }
const calls = []
let resolveEnglish
let postMode = 'pending'
let getStatus = 'accepted'
let delayedGet
const envelope = locale => ({ id: 'guide', tripId: 'trip', type: 'travel_guide', schemaVersion: 1,
  createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z',
  payload: { publication: { locale, status: 'accepted' }, days: [] } })
const transport = async options => {
  calls.push(options)
  const locale = options.data?.locale ?? (options.url.includes('locale=en') ? 'en' : 'zh')
  if (options.method === 'POST') {
    if (postMode === 'blocked') return { artifact: { ...envelope(locale), payload: { publication: { locale, status: 'blocked', canRetry: true, revision: 1 } } } }
    return new Promise(resolve => { resolveEnglish = () => resolve({ artifact: envelope(locale) }) })
  }
  if (getStatus === 'delayed') return new Promise(resolve => { delayedGet = () => resolve({ artifact: { ...envelope(locale), payload: { publication: { locale, status: 'blocked' } } } }) })
  return { artifact: { ...envelope(locale), payload: { publication: { locale, status: getStatus } } } }
}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/artifactService.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, { exports: moduleValue.exports, module: moduleValue, require: name => {
  if (name === '../utils/request') return { request: transport }
  if (name === './airportTime') return { readAirportTimePresentation: () => undefined }
  throw new Error(name)
}, Date, Map, Error })
;(async () => {
  const service = new moduleValue.exports.ArtifactService(transport)
  service.setSession('owner', 'session')
  const zh = await service.fetchArtifact('guide', { locale: 'zh' })
  const en = await service.fetchArtifact('guide', { locale: 'en' })
  assert.equal(zh.payload.publication.locale, 'zh'); assert.equal(en.payload.publication.locale, 'en')
  await service.fetchArtifact('guide', { locale: 'zh' }); await service.fetchArtifact('guide', { locale: 'en' })
  assert.equal(calls.length, 2)
  const pending = service.localizeArtifact('guide', { locale: 'en' })
  assert.equal((await service.fetchArtifact('guide', { locale: 'zh' })).payload.publication.locale, 'zh')
  resolveEnglish(); await pending
  assert.equal((await service.fetchArtifact('guide', { locale: 'zh' })).payload.publication.locale, 'zh')
  const old = service.localizeArtifact('guide', { locale: 'en' })
  service.setSession('other', 'new'); resolveEnglish()
  await assert.rejects(old, /previous owner or session/)
  postMode = 'blocked'; await service.localizeArtifact('guide', { locale: 'en' })
  const beforeRefresh = calls.length
  await service.fetchArtifact('guide', { locale: 'en' })
  assert.equal(calls.length, beforeRefresh + 1, 'blocked POST must not occupy cache')
  service.clearCache(); getStatus = 'blocked'
  await service.fetchArtifact('guide', { locale: 'en' }); await service.fetchArtifact('guide', { locale: 'en' })
  assert.equal(calls.length, beforeRefresh + 3, 'blocked GET must not occupy cache')
  getStatus = 'delayed'
  const late = service.fetchArtifact('guide', { locale: 'en', force: true })
  const lateCheck = assert.rejects(late, /superseded/)
  postMode = 'pending'
  const beforeRetry = calls.length
  const retries = [service.localizeArtifact('guide', { locale: 'en', retryRevision: 1 }), service.localizeArtifact('guide', { locale: 'en', retryRevision: 1 })]
  assert.equal(calls.length, beforeRetry + 1, 'concurrent explicit retry coalesces')
  assert.equal(calls.at(-1).data.retryRevision, 1); assert.equal(calls.at(-1).retry, 0)
  resolveEnglish(); await Promise.all(retries)
  delayedGet(); await lateCheck
  assert.equal((await service.fetchArtifact('guide', { locale: 'en' })).payload.publication.status, 'accepted')
  console.log('PASS locale cache/reuse/isolation, failure cache eviction, explicit retry coalescing, late GET protection (8 checks)')
})().catch(error => { console.error(error); process.exitCode = 1 })
