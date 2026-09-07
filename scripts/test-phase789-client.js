import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.resolve(file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (dependencies[name]) return dependencies[name]; throw new Error(`Unexpected dependency ${name}`) } })
  return module.exports
}
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }
const { readRouteArtifact, fareLabel } = load('src/services/routeArtifact.ts')
const a = { id: 'A', name: 'Origin', iata: 'AAA', latitude: 40, longitude: 120 }, b = { id: 'B', name: 'Destination', iata: 'BBB', latitude: 50, longitude: 10 }
const edge = { id: 'edge', from: a, to: b, transferType: 'direct', warnings: [], segments: [{ from: a, to: b, departureAt: '2026-10-01T10:00:00Z', arrivalAt: '2026-10-01T12:00:00Z', flightNumber: 'QA100' }] }
const route = { id: 'route', nodes: [{ location: a, role: 'origin' }, { location: b, role: 'destination' }], edges: [edge], transferCount: 0, warnings: [] }
const artifact = (paths) => ({ type: 'route_set', schemaVersion: 1, payload: { schemaVersion: 1, kind: 'flight_paths', paths } })
await test('unknown fares stay unknown while supplied coordinates and flight details survive', () => {
  const [value] = readRouteArtifact(artifact([route]))
  assert.equal(value.totalFare, undefined); assert.equal(fareLabel(value.totalFare), '价格待确认')
  assert.equal(value.nodes[0].location.latitude, 40); assert.equal(value.edges[0].segments[0].flightNumber, 'QA100')
})
await test('missing and oversized route collections reject instead of becoming empty success', () => {
  assert.throws(() => readRouteArtifact(artifact(undefined)))
  assert.throws(() => readRouteArtifact(artifact(Array(201).fill(route))))
  assert.equal(readRouteArtifact(artifact([])).length, 0)
})
await test('mismatched endpoints, duplicate route IDs and missing transfer counts reject', () => {
  assert.throws(() => readRouteArtifact(artifact([{ ...route, edges: [{ ...edge, to: a }] }])))
  assert.throws(() => readRouteArtifact(artifact([route, route])))
  assert.throws(() => readRouteArtifact(artifact([{ ...route, transferCount: undefined }])))
})
await test('invalid embedded segments never render a false direct route', () => {
  for (const segments of [[], Array(5).fill(edge.segments[0]), [{ ...edge.segments[0], to: a }], [{ ...edge.segments[0], arrivalAt: '2026-09-30T12:00:00Z' }]]) {
    assert.throws(() => readRouteArtifact(artifact([{ ...route, edges: [{ ...edge, segments }] }])))
  }
})
await test('recommendations show supplied positive reasons and tradeoffs', () => {
  const result = readRouteArtifact({ type: 'route_set', schemaVersion: 1, payload: { schemaVersion: 1, kind: 'optimized_routes', representatives: [{ path: route, badges: ['balanced'], explanation: { scoreBreakdown: [{ direction: 'positive', contribution: 0.3, reason: 'Matches the requested city' }, { direction: 'negative', contribution: -0.1, reason: 'More transfers' }], tradeoffs: ['Costs more than the cheapest option'] } }] } })
  assert.equal(result[0].reasons.length, 1); assert.equal(result[0].reasons[0], 'Matches the requested city')
  assert.equal(result[0].tradeoffs[0], 'Costs more than the cheapest option')
})
const calls = []
const request = async input => { calls.push(input); return { trip: { id: 'trip' }, memory: { markdown: 'saved' }, templates: [] } }
const workspace = load('src/services/workspaceService.ts', { '../utils/request': { request, USE_MOCK: false } })
await test('saving a route carries the expected workspace version and never retries a mutation', async () => {
  await workspace.updateCloudTrip('trip', { expectedVersion: 3, savedRoute: { artifactId: 'artifact', routeId: 'route' } })
  const call = calls.at(-1); assert.equal(call.method, 'PATCH'); assert.equal(call.data.expectedVersion, 3); assert.equal(call.retry, 0)
  assert.equal(call.data.userId, undefined)
})
await test('Memory edits and toggles use the cloud version contract', async () => {
  await workspace.saveCloudMemory('# Preferences', 9)
  assert.equal(calls.at(-1).data.expected_version, 9)
  await workspace.setCloudMemoryEnabled(false, 10)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).data)), { enabled: false, expected_version: 10 })
})
await test('mock mode cannot claim to save cloud preferences', async () => {
  const mock = load('src/services/workspaceService.ts', { '../utils/request': { request, USE_MOCK: true } })
  await assert.rejects(() => mock.saveCloudMemory('draft', 0))
})
const explore = load('src/services/exploreService.ts', { '../utils/request': { request, USE_MOCK: false } })
await test('Explore retries carry the same template version and idempotency key', async () => {
  const item = { id: 'template', version: 2 }
  await explore.startExplore(item, 'same-request-key'); await explore.startExplore(item, 'same-request-key')
  const [a, b] = calls.slice(-2); assert.deepEqual(a.data, b.data); assert.equal(a.data.version, 2); assert.equal(a.retry, 0)
})
console.log(`Phase 7–9 client: ${passed}/${passed} passed`)
