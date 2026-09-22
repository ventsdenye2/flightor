const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const moduleValue = { exports: {} }
const calls = []
let resolveEnglish
const envelope = locale => ({ id: 'guide', tripId: 'trip', type: 'travel_guide', schemaVersion: 1,
  createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z',
  payload: { publication: { locale, status: 'accepted' }, days: [] } })
const transport = async options => {
  calls.push(options)
  const locale = options.data?.locale ?? (options.url.includes('locale=en') ? 'en' : 'zh')
  if (options.method === 'POST') return new Promise(resolve => { resolveEnglish = () => resolve({ artifact: envelope(locale) }) })
  return { artifact: envelope(locale) }
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
  console.log('PASS locale-separated cache, refresh reuse, late language result, and owner isolation (4 checks)')
})().catch(error => { console.error(error); process.exitCode = 1 })
