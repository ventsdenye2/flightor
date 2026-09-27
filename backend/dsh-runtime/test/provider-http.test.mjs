import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function scenario(statuses, { cancelAfterFirstReceipt = false } = {}) {
  const bodies = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    bodies.push(JSON.parse(body))
    const status = statuses.shift() ?? 200
    if (status !== 200) {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: status === 401 ? 'unauthorized' : 'temporary server failure', type: 'provider_error' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"id":"local","object":"chat.completion.chunk","created":1,"model":"mock-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Recovered"},"finish_reason":null}]}\n\n')
    response.write('data: {"id":"local","object":"chat.completion.chunk","created":1,"model":"mock-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n')
    response.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await mkdtemp(join(tmpdir(), 'flightor-provider-http-'))
  const child = fork(new URL('../worker.mjs', import.meta.url), [], {
    env: { ...process.env, FLIGHTOR_DSH_MODEL_KEY: 'local-test-key' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const pending = new Map(), meter = { admitted: [], receipted: [] }
  let serial = 0, stderr = '', cancelPromise
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('message', message => {
    if (message.kind === 'tool') {
      if (message.name === '__model_admit') meter.admitted.push(message.args.id)
      if (message.name === '__model_receipt') {
        meter.receipted.push(message.args)
        if (cancelAfterFirstReceipt && meter.receipted.length === 1)
          cancelPromise = call('cancel', { generation: 'g1' })
      }
      child.send({ id: message.id, op: 'tool_result', data: { ok: true } })
    }
    if (message.kind === 'result') {
      const call = pending.get(message.id); pending.delete(message.id)
      message.ok ? call?.resolve(message.data) : call?.reject(new Error(message.error))
    }
  })
  const call = (op, data) => new Promise((resolve, reject) => {
    const id = String(++serial); pending.set(id, { resolve, reject }); child.send({ id, op, data })
  })
  try {
    await call('open', { root, sessionId: 'http-test', resume: false, persona: 'Reply briefly.', tools: [], metered: true,
      route: { provider: 'deepseek', model: 'mock-model', baseURL: `http://127.0.0.1:${server.address().port}/v1`, maxTokens: 256 } })
    const result = await call('turn', { generation: 'g1', message: 'Hello', snapshot: 'Trip context' })
    if (cancelPromise) await cancelPromise
    return { result, meter, bodies, stderr }
  } finally {
    child.kill()
    await new Promise(resolve => child.once('exit', resolve))
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}

test('HTTP 503 retries one actual request and accounts both attempts', async () => {
  const { result, meter, bodies, stderr } = await scenario([503, 200])
  assert.equal(stderr, '')
  assert.equal(result.reply, 'Recovered', JSON.stringify({ result, meter, bodies, stderr }))
  assert.equal(result.calls, 2)
  assert.equal(result.providerRetries, 1)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].messages.at(-1).content, bodies[1].messages.at(-1).content)
  assert.equal(meter.admitted.length, 2)
  assert.deepEqual(meter.receipted.map(item => item.id), meter.admitted)
  assert.deepEqual(meter.receipted.map(item => item.failed), [true, false])
})

test('HTTP 401 does not retry and settles its request', async () => {
  const { result, meter, bodies } = await scenario([401])
  assert.equal(result.calls, 1)
  assert.equal(result.providerRetries, 0)
  assert.equal(bodies.length, 1)
  assert.equal(meter.admitted.length, 1)
  assert.equal(meter.receipted.length, 1)
})

test('repeated HTTP 503 stops after two extra attempts and settles all', async () => {
  const { result, meter, bodies } = await scenario([503, 503, 503, 200])
  assert.equal(result.calls, 3)
  assert.equal(result.providerRetries, 2)
  assert.equal(result.errorCode, 'SERVER')
  assert.equal(bodies.length, 3)
  assert.deepEqual(meter.receipted.map(item => item.id), meter.admitted)
  assert.deepEqual(meter.receipted.map(item => item.failed), [true, true, true])
})

test('HTTP 429 retries once under same model request body', async () => {
  const { result, meter, bodies } = await scenario([429, 200])
  assert.equal(result.calls, 2)
  assert.equal(result.providerRetries, 1)
  assert.equal(bodies.length, 2)
  assert.deepEqual(meter.receipted.map(item => item.id), meter.admitted)
})

test('cancellation during retry pause prevents a second HTTP request', async () => {
  const { result, meter, bodies } = await scenario([503, 200], { cancelAfterFirstReceipt: true })
  assert.equal(result.calls, 1)
  assert.equal(result.providerRetries, 0)
  assert.equal(bodies.length, 1)
  assert.deepEqual(meter.receipted.map(item => item.id), meter.admitted)
})
