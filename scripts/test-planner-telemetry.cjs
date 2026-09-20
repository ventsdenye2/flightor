const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/plannerTelemetry.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText, { module: loaded, exports: loaded.exports })
const { PlannerTelemetry } = loaded.exports
const scope = { ownerId: 'owner', authRevision: 1, requestId: 1, sessionId: 'session', tripId: 'trip', conversationId: 'conversation' }
let passed = 0
function test(name, run) { run(); passed++; console.log(`PASS ${name}`) }
test('one monotonic client clock separates receipt, actual commit and final commit', () => {
  let now = 15
  const sink = new PlannerTelemetry(() => now), id = sink.begin(scope, 10)
  now = 30; sink.accepted(id, scope, 'turn', 'generation')
  now = 50; sink.published(id, scope, 'turn', 'generation', [{ id: 'flight', type: 'flight_search' }, { id: 'guide', type: 'travel_guide' }])
  assert.equal(sink.snapshot()[0].firstFlight, null)
  now = 70; sink.commit(id, scope, { kind: 'flight', artifactId: 'flight', verificationStatus: 'partial' })
  now = 100; sink.commit(id, scope, { kind: 'guide', artifactId: 'guide', verificationStatus: 'verified' })
  now = 120; sink.terminal(id, scope, 'completed', { deliveryStatus: 'satisfied' })
  assert.equal(sink.snapshot()[0].finalUiCommitMs, null)
  now = 150; sink.commit(id, scope, { kind: 'final' })
  const value = sink.snapshot()[0]
  assert.equal(value.clickToAckMs, 20); assert.equal(value.firstFlightCommitMs, 60)
  assert.equal(value.firstGuideCommitMs, 90); assert.equal(value.finalUiCommitMs, 140)
  assert.equal(value.firstFlight.verificationStatus, 'partial'); assert.equal(value.firstGuide.verificationStatus, 'verified')
  assert.equal(value.timeToFailureMs, null); assert.equal(value.renderEvidence, 'react_effect_commit_not_paint')
})
test('historical, removed, wrong type and wrong generation refs cannot become first results', () => {
  const sink = new PlannerTelemetry(() => 50), id = sink.begin(scope, 1)
  sink.accepted(id, scope, 'turn', 'generation')
  sink.published(id, scope, 'turn', 'wrong', [{ id: 'history', type: 'travel_guide' }])
  sink.commit(id, scope, { kind: 'guide', artifactId: 'history' })
  sink.published(id, scope, 'turn', 'generation', [{ id: 'flight', type: 'flight_search' }])
  sink.commit(id, scope, { kind: 'guide', artifactId: 'flight' })
  sink.published(id, scope, 'turn', 'generation', [])
  sink.commit(id, scope, { kind: 'flight', artifactId: 'flight' })
  assert.equal(sink.snapshot()[0].firstFlight, null); assert.equal(sink.snapshot()[0].firstGuide, null)
})
test('scope mismatches cannot mutate acceptance or result timing', () => {
  const sink = new PlannerTelemetry(() => 100), id = sink.begin(scope, 1)
  for (const key of Object.keys(scope)) {
    const foreign = { ...scope, [key]: typeof scope[key] === 'number' ? 2 : 'other' }
    sink.accepted(id, foreign, 'foreign-turn', 'foreign-generation')
    sink.terminal(id, foreign, 'failed')
  }
  assert.equal(sink.snapshot()[0].turnId, null); assert.equal(sink.snapshot()[0].status, 'running')
})
test('failures and cancellations keep time-to-failure without fabricated final UI', () => {
  for (const status of ['failed', 'cancelled', 'abandoned']) {
    let now = 10
    const sink = new PlannerTelemetry(() => now), id = sink.begin(scope, 0)
    sink.accepted(id, scope, 'turn', 'generation'); now = 80
    sink.terminal(id, scope, status, { code: 'AGENT_TURN_TIMEOUT' })
    sink.commit(id, scope, { kind: 'final' }); sink.terminal(id, scope, 'completed')
    assert.equal(sink.snapshot()[0].status, status); assert.equal(sink.snapshot()[0].timeToFailureMs, 70)
    assert.equal(sink.snapshot()[0].finalUiCommitMs, null)
  }
})
test('clock unavailable, regression and missing click remain unknown instead of zero', () => {
  const unavailable = new PlannerTelemetry(() => null), id = unavailable.begin(scope, 1)
  unavailable.accepted(id, scope, 'turn'); unavailable.terminal(id, scope, 'failed')
  assert.equal(unavailable.snapshot()[0].clock, 'unavailable'); assert.equal(unavailable.snapshot()[0].timeToFailureMs, null)
  let now = 10
  const sink = new PlannerTelemetry(() => now), missingClick = sink.begin(scope)
  sink.accepted(missingClick, scope, 'turn'); assert.equal(sink.snapshot()[0].clickToAckMs, null)
  now = 5; sink.terminal(missingClick, scope, 'failed'); assert.equal(sink.snapshot()[0].terminalAtMs, null)
})
test('multiple turns coexist with bounded memory and defensive snapshots', () => {
  const sink = new PlannerTelemetry(() => 10, 2)
  sink.begin(scope, 1); const b = sink.begin({ ...scope, requestId: 2 }, 2); const c = sink.begin({ ...scope, requestId: 3 }, 3)
  assert.equal(sink.snapshot().length, 2); assert.equal(sink.snapshot()[0].id, b); assert.equal(sink.snapshot()[1].id, c)
  const exported = sink.snapshot(); exported[0].scope.tripId = 'tampered'
  assert.equal(sink.snapshot()[0].scope.tripId, 'trip'); assert.equal(sink.snapshot()[0].scope.ownerId, undefined)
})
test('first commit is stable and unknown verification is not promoted', () => {
  let now = 20
  const sink = new PlannerTelemetry(() => now), id = sink.begin(scope, 10)
  sink.accepted(id, scope, 'turn', 'gen'); sink.published(id, scope, 'turn', 'gen', [{ id: 'guide', type: 'travel_guide' }])
  sink.commit(id, scope, { kind: 'guide', artifactId: 'guide', verificationStatus: 'invented' })
  now = 99; sink.commit(id, scope, { kind: 'guide', artifactId: 'guide', verificationStatus: 'verified' })
  assert.equal(sink.snapshot()[0].firstGuideCommitMs, 10); assert.equal(sink.snapshot()[0].firstGuide.verificationStatus, null)
})
test('a missing first commit timestamp stays missing even if the clock recovers later', () => {
  let now = 20
  const sink = new PlannerTelemetry(() => now), id = sink.begin(scope, 10)
  sink.accepted(id, scope, 'turn', 'gen'); sink.terminal(id, scope, 'completed')
  now = null; sink.commit(id, scope, { kind: 'final' })
  now = 100; sink.commit(id, scope, { kind: 'final' })
  assert.equal(sink.snapshot()[0].finalUiCommitObserved, true)
  assert.equal(sink.snapshot()[0].finalUiCommitMs, null)
})
console.log(`${passed} Planner telemetry checks passed (injected monotonic clock; no live timing claim).`)
