import test from 'node:test'
import assert from 'node:assert/strict'
import { progressFromEvent, updateProgress } from '../src/progress.mjs'

test('progress replaces the latest lifecycle summary without exposing model or tool content', () => {
  const run = { stage: 'chatting' }
  updateProgress(run, 'conversation', { type: 'tool/call', data: { arguments: 'private command' } })
  assert.match(run.progress.text, /正在调用工具/)
  updateProgress(run, 'conversation', { type: 'tool/result', data: { text: 'private result' } })
  assert.match(run.progress.text, /已收到工具结果/)
  assert.doesNotMatch(JSON.stringify(run.progress), /private/)
  assert.equal(progressFromEvent('conversation', { type: 'reasoning', data: 'private reasoning' }), null)
  const last = run.progress
  run.stage = 'cancelled'
  updateProgress(run, 'conversation', { type: 'assistant/message' })
  assert.equal(run.progress, last)
})
