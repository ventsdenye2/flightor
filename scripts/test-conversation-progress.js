// Offline contract tests for the real transport loop; fake clocks avoid long waits.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const file = path.resolve('src/services/conversationService.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS }
}).outputText
class ApiRequestError extends Error {
  constructor(status, code = `HTTP_${status}`) { super(code); this.status = status; this.code = code }
}
const input = { tripId: 'trip-1', conversationId: 'conversation-1', message: 'Plan my trip' }
const response = {
  tripId: input.tripId, conversationId: input.conversationId, reply: 'A saved response',
  tripContextSummary: { version: 1, destinations: { mode: 'open', required: [], preferred: [], excluded: [] }, interests: [], readyForRouteGeneration: false },
  artifactRefs: [], suggestedActions: [], warnings: [], stopReason: 'completed'
}
const accepted = { turnId: 'turn-1', status: 'running', startedAt: '2026-09-08T00:00:00.000Z' }
const view = (status = 'running', stage = 'thinking', extra = {}) => ({
  ...accepted, status, stage, updatedAt: '2026-09-08T00:00:02.000Z',
  ...(status === 'completed' ? { response } : {}), ...extra
})

function harness(steps) {
  const state = { now: 1_000, revision: 1, current: true, calls: [], progress: [], artifacts: [], sleeps: [], active: 0, maxActive: 0 }
  class Clock extends Date { static now() { return state.now } }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date: Clock,
    setTimeout(callback, duration) {
      state.sleeps.push(duration)
      state.now += duration
      state.onSleep?.()
      queueMicrotask(callback)
      return 1
    },
    require(specifier) {
      if (specifier === './budgetParser') return { parseBudget: () => null }
      if (specifier === '../utils/authSession') return {
        authSnapshot: () => ({ revision: state.revision }),
        assertAuthSession: expected => { if (expected !== state.revision) throw new Error('AUTH_SESSION_CHANGED') }
      }
      if (specifier === '../utils/request') return { USE_MOCK: false, ApiRequestError, request: async options => {
        state.calls.push(options)
        state.active++
        state.maxActive = Math.max(state.maxActive, state.active)
        try {
          const next = Array.isArray(steps) ? steps.shift() : steps
          if (next instanceof Error) throw next
          return typeof next === 'function' ? await next(options, state) : next
        } finally { state.active-- }
      } }
      throw new Error(`Unexpected dependency ${specifier}`)
    }
  }, { filename: file })
  state.run = options => module.exports.converse(input, {
    startedAt: 500,
    isCurrent: () => state.current,
    onProgress: value => { state.progress.push(value); state.onProgress?.(value) },
    onArtifacts: value => { state.artifacts.push(value); state.onArtifacts?.(value) },
    ...options
  })
  state.cancel = (scope = publicationScope) => module.exports.cancelConversationTurn(accepted.turnId, scope)
  return state
}

let passed = 0
async function test(name, run) {
  await run()
  passed++
  console.log(`PASS ${name}`)
}

await test('one submission, serial short polls and stage changes follow successful GETs', async () => {
  const h = harness([accepted, view(), view('running', 'researching'), view('completed', 'finalizing')])
  assert.equal(await h.run(), response)
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].data)), input)
  assert.equal(h.calls[1].url, '/v1/agent/turns/turn-1')
  assert.equal(h.maxActive, 1)
  assert.ok(h.calls.every(call => call.timeout <= 10_000 && call.retry === 0 && call.showError === false))
  assert.deepEqual(h.sleeps, [2_000, 2_000])
  assert.deepEqual(h.progress.map(p => p.connection), ['connecting', 'connecting', 'running', 'running', 'completed'])
  assert.deepEqual(h.progress.map(p => p.stage), [undefined, undefined, 'thinking', 'researching', 'finalizing'])
  assert.ok(h.progress.every(p => p.startedAt === 500))
})

await test('network failure preserves the last confirmed stage and heartbeat then recovers', async () => {
  const h = harness([accepted, view('running', 'searching_flights'), new Error('network timeout'), view('completed', 'finalizing')])
  await h.run()
  const confirmed = h.progress.find(p => p.connection === 'running')
  const reconnecting = h.progress.find(p => p.connection === 'reconnecting')
  assert.equal(reconnecting.stage, 'searching_flights')
  assert.equal(reconnecting.lastConfirmedAt, confirmed.lastConfirmedAt)
  assert.equal(h.progress.at(-1).connection, 'completed')
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1)
})

await test('failure before the first successful GET cannot invent a server stage', async () => {
  const h = harness([accepted, new Error('offline'), view('completed', 'finalizing')])
  await h.run()
  const reconnecting = h.progress.find(p => p.connection === 'reconnecting')
  assert.equal(reconnecting.stage, undefined)
  assert.equal(reconnecting.lastConfirmedAt, undefined)
})

await test('ambiguous submission failure is not resubmitted', async () => {
  const h = harness([new Error('request timeout')])
  await assert.rejects(h.run(), /request timeout/)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.progress.map(p => p.connection), ['connecting'])
})

await test('missing turn after a server restart stops with a specific error', async () => {
  const h = harness([accepted, new ApiRequestError(404)])
  await assert.rejects(h.run(), /CONVERSATION_TURN_NOT_FOUND/)
  assert.equal(h.calls.length, 2)
  assert.equal(h.sleeps.length, 0)
})

await test('final unauthorized response stops without network resubmission', async () => {
  const h = harness([accepted, new ApiRequestError(401)])
  await assert.rejects(h.run(), /HTTP_401/)
  assert.equal(h.calls.length, 2)
  assert.equal(h.sleeps.length, 0)
})

await test('the whole poll uses the same auth revision, including a same-owner login', async () => {
  const h = harness([accepted, view()])
  h.onSleep = () => { h.revision++ }
  await assert.rejects(h.run(), /AUTH_SESSION_CHANGED/)
  assert.equal(h.calls.length, 2)
})

await test('an identity change while a GET is in flight discards its final response', async () => {
  const h = harness([accepted, (_options, state) => { state.revision++; return view('completed') }])
  await assert.rejects(h.run(), /AUTH_SESSION_CHANGED/)
  assert.ok(h.progress.every(p => p.connection !== 'completed'))
})

await test('workspace switch during a request prevents late callbacks and further polling', async () => {
  const h = harness([accepted, (_options, state) => { state.current = false; return view('completed') }])
  await assert.rejects(h.run(), /STALE_CONVERSATION_TURN/)
  assert.equal(h.calls.length, 2)
  assert.ok(h.progress.every(p => p.connection === 'connecting'))
})

await test('workspace switch during the poll interval prevents the next request', async () => {
  const h = harness([accepted, view()])
  h.onSleep = () => { h.current = false }
  await assert.rejects(h.run(), /STALE_CONVERSATION_TURN/)
  assert.equal(h.calls.length, 2)
})

await test('server failures remain failures, including the real agent timeout', async () => {
  const h = harness([accepted, view('failed', 'researching', { error: { code: 'AGENT_TURN_TIMEOUT', message: 'Timed out' } })])
  await assert.rejects(h.run(), /AGENT_TURN_TIMEOUT/)
  assert.ok(h.progress.every(p => p.connection !== 'completed'))
  assert.equal(h.calls.length, 2)
})

await test('transport deadline is bounded and never creates a second server turn', async () => {
  const h = harness(options => options.method === 'POST' ? accepted : Promise.reject(new Error('offline')))
  await assert.rejects(h.run(), /CONVERSATION_TURN_TIMEOUT/)
  assert.equal(h.now, 331_000)
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1)
  assert.equal(h.progress.filter(p => p.connection === 'running').length, 0)
})

await test('a response from another conversation cannot complete the turn', async () => {
  const h = harness([accepted, view('completed', 'finalizing', { response: { ...response, conversationId: 'another-session' } })])
  await assert.rejects(h.run(), /INVALID_CONVERSATION_TURN_RESPONSE/)
  assert.ok(h.progress.every(p => p.connection !== 'completed'))
})

await test('malformed successful GET and unknown stage terminate instead of inventing progress', async () => {
  for (const value of [undefined, view('running', 'invented_stage'), view('running', 'thinking', { turnId: 'other-turn' })]) {
    const h = harness([accepted, value])
    await assert.rejects(h.run(), /INVALID_CONVERSATION_TURN_RESPONSE/)
    assert.equal(h.calls.length, 2)
  }
})

const publicationScope = { tripId: input.tripId, conversationId: input.conversationId, generationId: 'generation-1' }
const scopedAccepted = { ...accepted, ...publicationScope }
const savedRef = { id: '00000000-0000-4000-8000-000000000001', type: 'travel_guide', schemaVersion: 1, tripContextVersion: 4, presentationHint: 'travel_guide' }
const published = (revision, refs = [savedRef], extra = {}) => view('running', 'finalizing', {
  ...publicationScope, artifactRevision: revision, artifactRefs: refs, ...extra
})

await test('committed refs arrive before final response, are compact and deduplicated', async () => {
  const h = harness([scopedAccepted, published(1, [{ ...savedRef, payload: 'must not enter history' }, savedRef]), view('completed')])
  h.onArtifacts = value => {
    assert.equal(h.progress.some(progress => progress.connection === 'completed'), false)
    assert.equal(value.artifactRefs.length, 1)
    assert.equal(value.artifactRefs[0].payload, undefined)
  }
  await h.run()
  assert.equal(h.artifacts.length, 1)
})

await test('repeat and older revisions cannot re-add invalidated refs', async () => {
  const h = harness([scopedAccepted, published(2), published(2), published(1), published(3, []), view('completed')])
  await h.run()
  assert.deepEqual(h.artifacts.map(value => value.artifactRevision), [2, 3])
  assert.equal(h.artifacts.at(-1).artifactRefs.length, 0)
})

await test('failed model tail publishes committed refs without inventing completion', async () => {
  const h = harness([scopedAccepted, published(1, [savedRef], { status: 'failed', error: { code: 'AGENT_TURN_TIMEOUT' } })])
  await assert.rejects(h.run(), /AGENT_TURN_TIMEOUT/)
  assert.equal(h.artifacts[0].artifactRefs[0].id, savedRef.id)
  assert.equal(h.progress.some(value => value.connection === 'completed'), false)
})

await test('publication requires accepted generation and exact Trip/conversation/generation scope', async () => {
  for (const bad of [{ tripId: 'other' }, { conversationId: 'other' }, { generationId: 'other' }]) {
    const h = harness([scopedAccepted, published(1, [savedRef], bad)])
    await assert.rejects(h.run(), /INVALID_CONVERSATION_TURN_RESPONSE/)
    assert.equal(h.artifacts.length, 0)
  }
  const legacy = harness([accepted, published(1)])
  await assert.rejects(legacy.run(), /INVALID_CONVERSATION_TURN_RESPONSE/)
})

await test('malformed publication bounds, type, version and presentation are rejected', async () => {
  for (const extra of [
    { artifactRevision: -1 }, { artifactRefs: undefined }, { artifactRefs: Array(25).fill(savedRef) },
    { artifactRefs: [{ ...savedRef, id: 'invalid' }] }, { artifactRefs: [{ ...savedRef, tripContextVersion: -1 }] },
    { artifactRefs: [{ ...savedRef, type: 'research' }] }, { artifactRefs: [{ ...savedRef, presentationHint: 'flight_cards' }] }
  ]) {
    const h = harness([scopedAccepted, published(1, [savedRef], extra)])
    await assert.rejects(h.run(), /INVALID_CONVERSATION_TURN_RESPONSE/)
    assert.equal(h.artifacts.length, 0)
  }
})

await test('account switch during publication fetch suppresses all artifacts', async () => {
  const h = harness([scopedAccepted, (_options, state) => { state.revision++; return published(1) }])
  await assert.rejects(h.run(), /AUTH_SESSION_CHANGED/)
  assert.equal(h.artifacts.length, 0)
})

await test('cancel uses one authenticated POST and returns committed refs on acknowledgement', async () => {
  const h = harness([published(1, [savedRef], { status: 'failed', error: { code: 'AGENT_TURN_CANCELLED' } })])
  const cancelled = await h.cancel()
  assert.equal(cancelled.error.code, 'AGENT_TURN_CANCELLED')
  assert.equal(cancelled.artifactRefs[0].id, savedRef.id)
  assert.equal(h.calls[0].method, 'POST')
  assert.equal(h.calls[0].url, '/v1/agent/turns/turn-1/cancel')
  assert.equal(h.calls[0].retry, 0)
})

await test('cancel rejects running or foreign-scope acknowledgements and auth changes', async () => {
  for (const bad of [published(1), published(1, [], { status: 'failed', generationId: 'other' })]) {
    await assert.rejects(harness([bad]).cancel(), /INVALID_CONVERSATION_TURN_RESPONSE/)
  }
  const h = harness([(_options, state) => { state.revision++; return published(1, [], { status: 'failed' }) }])
  await assert.rejects(h.cancel(), /AUTH_SESSION_CHANGED/)
})

await test('acceptance callback fires once only after a valid scope-bound acknowledgement', async () => {
  const values = []
  const h = harness([scopedAccepted, view('completed')])
  await h.run({ onAccepted: value => values.push(value) })
  assert.equal(values.length, 1)
  assert.equal(values[0].generationId, publicationScope.generationId)
  const bad = harness([{ ...scopedAccepted, conversationId: 'other' }])
  await assert.rejects(bad.run({ onAccepted: value => values.push(value) }), /INVALID_CONVERSATION_TURN_RESPONSE/)
  assert.equal(values.length, 1)
})

console.log(`\n${passed} conversation progress checks passed (offline; no live Provider or WeChat device).`)
