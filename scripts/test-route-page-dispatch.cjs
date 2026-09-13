const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function loadTypeScript(relativePath, dependencies = {}) {
  const file = path.join(root, relativePath)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: file
  }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(specifier) {
      if (Object.prototype.hasOwnProperty.call(dependencies, specifier)) return dependencies[specifier]
      throw new Error(`Unexpected runtime dependency: ${specifier}`)
    }
  }, { filename: file })
  return loadedModule.exports
}

const registry = loadTypeScript('src/components/artifacts/registry.ts', {
  '../../services/artifactService': {}
})
const dispatch = loadTypeScript('src/pages/route/dispatch.ts', {
  '../../components/artifacts/registry': registry
})

const artifact = (type, schemaVersion, payload) => ({
  id: `${type}-1`,
  tripId: 'trip-1',
  type,
  schemaVersion,
  payload,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z'
})
const flight = artifact('flight_search', 1, { id: 'flight-1', type: 'flight_search', offers: [] })
const research = artifact('research', 2, { id: 'research-1', type: 'research', findings: [] })
const destination = artifact('destination_set', 1, { kind: 'destination_candidates', schemaVersion: 1, candidates: [] })
const routeSet = artifact('route_set', 1, { kind: 'optimized_routes', schemaVersion: 1, representatives: [] })
const route = artifact('route', 1, { kind: 'trip_route_plan', schemaVersion: 1, days: [] })
const guide = artifact('travel_guide', 1, { kind: 'trip_travel_guide', schemaVersion: 1, days: [] })
const presentation = { id: 'trip-1', days: [], flights: [], alternatives: [], sources: [] }

const cases = [
  ['guest takes precedence', { artifactId: 'route-1', artifact: route }, 'guest'],
  ['missing artifact id', { ownerId: 'owner-1', artifactId: '' }, 'missing'],
  ['load error', { ownerId: 'owner-1', artifactId: 'route-1', error: 'offline' }, 'error'],
  ['pending artifact', { ownerId: 'owner-1', artifactId: 'route-1' }, 'loading'],
  ['combined route presentation', { ownerId: 'owner-1', artifactId: 'route-1', artifact: route, presentation }, 'trip'],
  ['route set keeps route semantics', { ownerId: 'owner-1', artifactId: 'route_set-1', artifact: routeSet, routes: [] }, 'route-set'],
  ['flight search summary', { ownerId: 'owner-1', artifactId: 'flight-1', artifact: flight }, 'flight-list'],
  ['flight offer detail', { ownerId: 'owner-1', artifactId: 'flight-1', artifact: flight, offerId: 'offer-1' }, 'flight-detail'],
  ['research result', { ownerId: 'owner-1', artifactId: 'research-1', artifact: research }, 'research'],
  ['destination result', { ownerId: 'owner-1', artifactId: 'destination-1', artifact: destination }, 'destination'],
  ['unsupported schema', { ownerId: 'owner-1', artifactId: 'flight-1', artifact: { ...flight, schemaVersion: 99 } }, 'unavailable'],
  ['unknown artifact type', { ownerId: 'owner-1', artifactId: 'other-1', artifact: artifact('other', 1, {}) }, 'unavailable'],
  ['route waits for a production presentation', { ownerId: 'owner-1', artifactId: 'route-1', artifact: route }, 'unavailable'],
  ['guide waits for a production presentation', { ownerId: 'owner-1', artifactId: 'guide-1', artifact: guide }, 'unavailable']
]

for (const [label, input, expected] of cases) {
  assert.equal(dispatch.resolveRouteDetailView(input).kind, expected, label)
  console.log(`PASS ${label} -> ${expected}`)
}

assert.equal(dispatch.resolveRouteDetailView({ ownerId: 'owner-1', artifactId: 'route-1', artifact: route }).reason, 'presentation_unavailable')
assert.equal(dispatch.ROUTE_DETAIL_SHELL_CLASS, 'ux-app production-detail-page route-production')
const pageSource = fs.readFileSync(path.join(root, 'src/pages/route/index.tsx'), 'utf8')
assert.equal((pageSource.match(/className=\{ROUTE_DETAIL_SHELL_CLASS\}/g) || []).length, 2, 'trip and non-trip roots use the shared production shell')
assert.doesNotMatch(pageSource, /route-detail-page/, 'legacy dark route shell is not rendered')

console.log(`Route page dispatch regression: ${cases.length + 3} assertions passed`)
