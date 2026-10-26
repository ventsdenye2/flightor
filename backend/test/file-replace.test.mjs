import test from 'node:test'
import assert from 'node:assert/strict'
import { replaceFile, replaceFileSync } from '../src/file-replace.mjs'

test('Windows transient sharing failures retry atomic replacement without repeating the write', async () => {
  let calls = 0
  const waits = [], rename = () => { calls++; if (calls < 3) throw Object.assign(Error('sharing'), { code: 'EPERM' }) }
  await replaceFile('private.tmp', 'private.json', { rename, wait: async ms => { waits.push(ms) }, platform: 'win32' })
  assert.equal(calls, 3); assert.deepEqual(waits, [10, 20])
  calls = 0; waits.length = 0
  replaceFileSync('private.tmp', 'private.json', { rename, wait: ms => { waits.push(ms) }, platform: 'win32' })
  assert.equal(calls, 3); assert.deepEqual(waits, [10, 20])
})

test('permanent errors and non-Windows errors retain the original failure; lock retry budget is finite', async () => {
  const failure = Object.assign(Error('locked'), { code: 'EPERM' })
  let calls = 0
  const rename = () => { calls++; throw failure }
  await assert.rejects(replaceFile('a', 'b', { rename, wait: async () => {}, platform: 'win32' }), error => error === failure)
  assert.equal(calls, 5)
  calls = 0
  assert.throws(() => replaceFileSync('a', 'b', { rename, wait: () => assert.fail('no retry'), platform: 'linux' }), error => error === failure)
  assert.equal(calls, 1)
  calls = 0; failure.code = 'ENOSPC'
  await assert.rejects(replaceFile('a', 'b', { rename, wait: async () => assert.fail('no retry'), platform: 'win32' }), error => error === failure)
  assert.equal(calls, 1)
})
