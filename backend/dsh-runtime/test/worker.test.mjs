import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('private worker runs actual loop and correlates tool and turn receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flightor-worker-'))
  const child = fork(new URL('../worker.mjs', import.meta.url), [], { env: { SystemRoot: process.env.SystemRoot, FLIGHTOR_DSH_TEST: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''; child.stderr.on('data', value => { stderr += value })
  const pending = new Map(); let serial = 0; let tools = 0
  child.on('message', value => {
    if (value.kind === 'tool') { tools++; child.send({ id: value.id, op: 'tool_result', data: { city: 'Tokyo' } }) }
    if (value.kind === 'result') { const p = pending.get(value.id); pending.delete(value.id); value.ok ? p?.resolve(value.data) : p?.reject(new Error(value.error)) }
  })
  const call = (op, data) => new Promise((resolve, reject) => { const id = String(++serial); pending.set(id, { resolve, reject }); child.send({ id, op, data }) })
  try {
    const opened = await call('open', { root, sessionId: 'worker-test', resume: false, persona: 'Read trip',
      route: { provider: 'fixture', model: 'fixture' }, tools: [{ name: 'read_trip', description: 'Read', rawSchema: { type: 'object', properties: {}, additionalProperties: false } }],
      fixture: [{ tool: 'read_trip' }, { text: 'Tokyo' }] })
    assert.deepEqual(opened.tools, ['read_trip'])
    const result = await call('turn', { generation: 'g1', snapshot: 'Trusted current trip', message: 'Where?' })
    assert.equal(result.reply, 'Tokyo'); assert.equal(result.calls, 2); assert.equal(tools, 1)
    await call('close', {})
    assert.equal(stderr, '')
  } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); await rm(root, { recursive: true, force: true }) }
})
