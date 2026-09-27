import test from 'node:test'
import assert from 'node:assert/strict'
import { mayRetryProvider, retryPause } from '../provider-recovery.mjs'

const failure = code => ({ type: 'finish', reason: { kind: 'error', failure: { code } } })

test('only transient pre-output provider failures receive at most two retries', () => {
  for (const code of ['TRANSPORT', 'TIMEOUT', 'RATE_LIMIT', 'SERVER']) {
    assert.equal(mayRetryProvider({ chunk: failure(code), emitted: false, retries: 0 }), true)
    assert.equal(mayRetryProvider({ chunk: failure(code), emitted: false, retries: 1 }), true)
    assert.equal(mayRetryProvider({ chunk: failure(code), emitted: false, retries: 2 }), false)
    assert.equal(mayRetryProvider({ chunk: failure(code), emitted: true, retries: 0 }), false)
  }
  for (const code of ['AUTH', 'INVALID_REQUEST', 'QUOTA_EXCEEDED', 'ABORTED', 'CONTEXT_WINDOW_EXCEEDED'])
    assert.equal(mayRetryProvider({ chunk: failure(code), emitted: false, retries: 0 }), false)
  assert.equal(mayRetryProvider({ chunk: { type: 'finish', reason: { kind: 'aborted', failure: { code: 'TIMEOUT' } } }, emitted: false, retries: 0 }), false)
  assert.equal(mayRetryProvider({ chunk: failure('SERVER'), emitted: false, retries: 0, signal: AbortSignal.abort() }), false)
})

test('abort interrupts recovery delay', async () => {
  const controller = new AbortController()
  const started = performance.now()
  const wait = retryPause(1, controller.signal)
  controller.abort()
  assert.equal(await wait, false)
  assert.ok(performance.now() - started < 100)
})
