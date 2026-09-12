const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const file = path.join(root, 'src/features/ui-experience/productionPresentation.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
const loadedModule = { exports: {} }
const displayPayload = {
  record: value => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined,
  records: (value, max) => Array.isArray(value) ? value.slice(0, max).filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [],
  text: value => typeof value === 'string' && value.trim() ? value : undefined,
  numberValue: value => typeof value === 'number' && Number.isFinite(value) ? value : undefined,
  firstText: (...values) => values.find(value => typeof value === 'string' && value.trim())
}
vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, URL, require: dependency => {
  if (dependency.endsWith('/components/artifacts/payload')) return displayPayload
  throw new Error(`Unexpected runtime dependency: ${dependency}`)
} }, { filename: file })
const { artifactToTripPresentation, safeSourceUrl } = loadedModule.exports
const location = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', latitude: 35.6, longitude: 139.7 }
const route = { kind: 'trip_route_plan', schemaVersion: 1, tripContextVersion: 4, cities: [{ location, stayDays: 2, role: 'visit', reasons: ['culture'] }], days: [{ day: 1, city: location, activityRefs: [] }, { day: 2, city: location, activityRefs: [] }], warnings: [], landTransfers: [] }
const routeArtifact = { id: 'route-1', tripId: 'trip-1', type: 'route', schemaVersion: 1, payload: route }
const guideItem = { id: 'activity-1', title: '浅草', description: '寺院与街区', city: location, category: 'activity', verification: { status: 'partially_verified', sources: [{ provider: 'provider-x', reference: 'https://example.com/a' }, { provider: 'bad', reference: 'https://user:pass@example.com/private' }, { provider: 'ftp', reference: 'ftp://example.com/a' }] }, timeOfDay: 'morning' }
const guide = { kind: 'trip_travel_guide', schemaVersion: 1, routeArtifactId: 'route-1', days: [{ day: 1, city: location, theme: '慢慢走', items: [guideItem] }], warnings: [] }
const guideArtifact = { id: 'guide-1', tripId: 'trip-1', type: 'travel_guide', schemaVersion: 1, payload: guide }
const workspace = { trip: { id: 'trip-1', title: '东京周末', contextVersion: 4 }, tripContextSummary: { departureWindow: { from: '2026-10-01', to: '2026-10-09', precision: 'exact' }, returnWindow: { from: '2026-10-03', to: '2026-10-03', precision: 'exact' }, travelDays: 3 }, messages: [{ delivery: { status: 'satisfied', artifactIds: ['guide-1'] } }] }
let passed = 0
function check(label, fn) { fn(); passed += 1; console.log(`PASS ${label}`) }

check('rejects non-route and wrong route payloads', () => { assert.throws(() => artifactToTripPresentation({ ...routeArtifact, type: 'research' }), /不支持/); assert.throws(() => artifactToTripPresentation({ ...routeArtifact, payload: { ...route, kind: 'wrong' } }), /不支持/) })
check('rejects guide trip and route identity mismatches', () => { assert.throws(() => artifactToTripPresentation(routeArtifact, { ...guideArtifact, tripId: 'trip-2' }), /不匹配/); assert.throws(() => artifactToTripPresentation(routeArtifact, { ...guideArtifact, payload: { ...guide, routeArtifactId: 'route-2' } }), /不匹配/) })
check('accepts only safe source URLs and preserves provider/status', () => { assert.equal(safeSourceUrl('ftp://example.com/a'), undefined); assert.equal(safeSourceUrl('https://user:pass@example.com/a'), undefined); assert.equal(safeSourceUrl('https://example.com/a'), 'https://example.com/a'); const sources = artifactToTripPresentation(routeArtifact, guideArtifact, workspace).sources; assert.equal(sources[0].label, 'provider-x'); assert.equal(sources[0].url, 'https://example.com/a'); assert.equal(sources[0].status, 'partial'); assert.equal(sources.some(source => source.url === 'ftp://example.com/a' || source.url?.includes('@')), false) })
check('does not treat city center as activity coordinates or invent media', () => { const activity = artifactToTripPresentation(routeArtifact, guideArtifact, workspace).days[0].activities[0]; assert.equal(activity.latitude, null); assert.equal(activity.longitude, null); assert.equal(activity.media, null) })
check('uses exact departure and return windows from matching context', () => { const trip = artifactToTripPresentation(routeArtifact, guideArtifact, workspace); assert.equal(trip.dates.start, '2026-10-01'); assert.equal(trip.dates.end, '2026-10-03'); assert.equal(trip.durationDays, 3); const old = artifactToTripPresentation({ ...routeArtifact, payload: { ...route, tripContextVersion: 3 } }, guideArtifact, workspace); assert.equal(old.dates.start, null); assert.equal(old.dates.end, null) })
check('delivery satisfaction controls ready status', () => { assert.equal(artifactToTripPresentation(routeArtifact, guideArtifact, workspace).status, 'ready'); assert.equal(artifactToTripPresentation(routeArtifact, guideArtifact, { ...workspace, messages: [{ delivery: { status: 'partial', artifactIds: ['guide-1'] } }] }).status, 'partial') })
check('route-only snapshots stay partial with unknown travelers and prices', () => { const trip = artifactToTripPresentation(routeArtifact, undefined, workspace); assert.equal(trip.status, 'partial'); assert.equal(trip.days[0].status, 'pending'); assert.equal(trip.travelers, null); assert.equal(trip.flights.length, 0) })
check('guide activities preserve identity and unknown time fields', () => { const activity = artifactToTripPresentation(routeArtifact, guideArtifact, workspace).days[0].activities[0]; assert.equal(activity.id, 'activity-1'); assert.equal(activity.time, '上午'); assert.equal(activity.until, null) })
console.log(`Production presentation behavior checks: ${passed} passed.`)
