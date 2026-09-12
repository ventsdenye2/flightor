// Run from the repository root after `npm --prefix backend run build`:
// node backend/scripts/verify-agent-cancellation.mjs
// This harness re-executes under strict rejection handling and uses only fake
// tools plus an ephemeral localhost Fastify server. No DB or provider is used.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { z } from 'zod'
import { ToolRegistry } from '../dist/agent/runtime/registry.js'
import { AgentRuntime } from '../dist/agent/runtime/runtime.js'

const strictRejections = '--unhandled-rejections=strict'
if (!process.execArgv.includes(strictRejections)) {
  const child = spawnSync(process.execPath, [strictRejections, fileURLToPath(import.meta.url)], { stdio: 'inherit' })
  if (child.error) throw child.error
  process.exit(child.status ?? 1)
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const call = name => ({ id: `call_${name}`, type: 'function', function: { name, arguments: '{}' } })
const context = {
  requestId: 'cancellation-regression', conversationId: 'local-conversation',
  tripId: 'local-trip', generationId: 'local-generation'
}
const fakeTool = (name, execute, overrides = {}) => ({
  name, description: 'Local cancellation regression tool',
  inputSchema: z.object({}).strict(), outputSchema: z.object({ ok: z.boolean() }).strict(),
  costClass: 'free', costUnits: 1, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 5_000, execute, ...overrides
})

// A rejected or hung regression must fail instead of leaving a test server up.
const watchdog = setTimeout(() => { throw new Error('Cancellation regression exceeded its 6 second deadline') }, 6_000)
watchdog.unref()
const checks = []
const server = Fastify({ logger: false })

try {
  let preCancelledStarts = 0
  const preCancelledRegistry = new ToolRegistry().register(fakeTool('pre_cancelled', async (_input, _context, signal) => {
    preCancelledStarts += 1
    signal.throwIfAborted()
    return { ok: true }
  }))
  const cancelled = new AbortController()
  cancelled.abort(new Error('Agent turn timeout'))
  const cancelledResult = await preCancelledRegistry.execute(call('pre_cancelled'), context, cancelled.signal)
  assert.equal(cancelledResult.errorCode, 'TOOL_CANCELLED')
  assert.equal(cancelledResult.costUnits, 0)
  assert.equal(preCancelledStarts, 0, 'A pre-cancelled tool must not start')
  await delay(0)
  checks.push('pre_cancelled_tool_never_starts')

  // Exercise cancellation after the wrapper subscribes, before its queued start.
  const sameTick = new AbortController()
  const sameTickPending = preCancelledRegistry.execute(call('pre_cancelled'), context, sameTick.signal)
  sameTick.abort(new Error('Cancelled before the tool start microtask'))
  assert.equal((await sameTickPending).errorCode, 'TOOL_CANCELLED')
  assert.equal(preCancelledStarts, 0)
  await delay(0)
  checks.push('same_tick_cancellation_never_starts_tool')

  let timedOutToolRejected = false
  const lateRegistry = new ToolRegistry().register(fakeTool('late_reject', async (_input, _context, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => setTimeout(() => {
      timedOutToolRejected = true
      reject(new Error('Provider settled after tool cancellation'))
    }, 25), { once: true })
  }), { timeoutMs: 20 }))
  const timedOutToolResult = await lateRegistry.execute(call('late_reject'), context, new AbortController().signal)
  assert.equal(timedOutToolResult.errorCode, 'TOOL_TIMEOUT')
  await delay(60)
  assert.equal(timedOutToolRejected, true, 'The late rejection must actually execute')
  checks.push('tool_timeout_late_rejection_remains_observed')

  let firstStarts = 0
  let secondStarts = 0
  let modelCalls = 0
  let turnToolRejected = false
  const turnRegistry = new ToolRegistry()
    .register(fakeTool('first_in_batch', async (_input, _context, signal) => {
      firstStarts += 1
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => setTimeout(() => {
          turnToolRejected = true
          reject(signal.reason)
        }, 30), { once: true })
      })
    }))
    .register(fakeTool('second_in_batch', async (_input, _context, signal) => {
      secondStarts += 1
      signal.throwIfAborted()
      return { ok: true }
    }))
  const runtime = new AgentRuntime({
    async complete() {
      modelCalls += 1
      return { message: { role: 'assistant', content: null, tool_calls: [call('first_in_batch'), call('second_in_batch')] } }
    }
  }, turnRegistry, { turnTimeoutMs: 1_000 })

  server.get('/health', async () => ({ status: 'ok', pid: process.pid }))
  server.post('/turn', async () => runtime.run({ messages: [{ role: 'user', content: 'Run local cancellation regression' }], context }))
  const address = await server.listen({ host: '127.0.0.1', port: 0 })
  const initialHealth = await fetch(`${address}/health`, { signal: AbortSignal.timeout(2_000) })
  assert.equal(initialHealth.status, 200)
  assert.equal((await initialHealth.json()).pid, process.pid)

  const startedAt = Date.now()
  const response = await fetch(`${address}/turn`, { method: 'POST', signal: AbortSignal.timeout(3_500) })
  assert.equal(response.status, 200)
  const result = await response.json()
  const turnDurationMs = Date.now() - startedAt
  assert.equal(result.stopReason, 'turn_timeout')
  assert.equal(result.fallback, true)
  assert.ok(result.reply.trim().length > 0, 'The cancelled HTTP turn must return a reply')
  assert.equal(result.delivery.status, 'not_requested')
  assert.equal(result.costUnits, 1, 'Unstarted work must not consume tool cost')
  assert.equal(firstStarts, 1)
  assert.equal(secondStarts, 0, 'The next sequential tool must not start after turn cancellation')
  assert.equal(modelCalls, 1, 'Cancellation must not start another model completion')
  assert.ok(turnDurationMs < 3_000, `Turn fallback exceeded the expected bound: ${turnDurationMs} ms`)
  checks.push('turn_timeout_returns_http_fallback_without_starting_next_tool')

  // Remain alive past the underlying tool's real, uncaught-by-the-harness reject.
  await delay(80)
  assert.equal(turnToolRejected, true)
  const finalHealth = await fetch(`${address}/health`, { signal: AbortSignal.timeout(2_000) })
  assert.equal(finalHealth.status, 200)
  assert.deepEqual(await finalHealth.json(), { status: 'ok', pid: process.pid })
  checks.push('same_process_health_200_after_late_rejection')
  console.log(JSON.stringify({ status: 'passed', strictUnhandledRejections: true, realProviders: false, database: false, turnDurationMs, checks }, null, 2))
} finally {
  await server.close()
  clearTimeout(watchdog)
}
