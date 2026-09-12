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
  const state = { now: 1_000, revision: 1, current: true, calls: [], progress: [], sleeps: [], active: 0, maxActive: 0 }
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
    ...options
  })
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

console.log(`\n${passed} conversation progress checks passed (offline; no live Provider or WeChat device).`)
