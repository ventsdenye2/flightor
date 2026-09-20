import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { installG1Budget } from './g1-budget.mjs'

const model = 'fixture/model'
const pricing = { prompt: '0.00000004', completion: '0.00000008' }
const body = JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
const response = (payload = { model, usage: { cost: 0.01 }, choices: [{ finish_reason: 'stop' }] }) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
async function fixture(fetchImpl = async () => response()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flightor-g1-'))
  return { directory, meter: installG1Budget({ directory, model, pricing, fetchImpl }) }
}

test('concurrent admission never exceeds the USD budget', async () => {
  const { meter } = await fixture(async () => { await new Promise(r => setTimeout(r, 5)); return response({ model, usage: { cost: 0.10 } }) })
  const results = await Promise.allSettled(Array.from({ length: 21 }, () => meter.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 20)
  assert.equal(meter.snapshot().totalCostUsd, 2)
})

test('provider and parse failures retain the reservation as unknown', async () => {
  const { meter } = await fixture(async () => { throw new Error('offline') })
  await assert.rejects(meter.fetch('https://serpapi.com/search.json?engine=google'), /offline/)
  assert.equal(meter.snapshot().calls[0].status, 'unknown')
  const parse = await fixture(async () => new Response('not-json'))
  const result = await parse.meter.fetch('https://serpapi.com/search.json?engine=google')
  assert.equal(result.status, 200)
  assert.equal(parse.meter.snapshot().calls[0].status, 'unknown')
})

test('forbids other URLs and native tools but allows function tools', async () => {
  const { meter } = await fixture()
  await assert.rejects(meter.fetch('http://openrouter.ai/api/v1/chat/completions', { method: 'POST', body }), e => e.code === 'G1_URL_FORBIDDEN')
  await assert.rejects(meter.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'other', max_tokens: 1 }) }), e => e.code === 'G1_MODEL_OR_TOOLS')
  await meter.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model, max_tokens: 1, tools: [{ type: 'function', function: { name: 'lookup' } }] }) })
  await assert.rejects(meter.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model, max_tokens: 1, tools: [{ type: 'web_search' }] }) }), e => e.code === 'G1_MODEL_OR_TOOLS')
  await assert.rejects(meter.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model, max_tokens: 1, stream: true }) }), e => e.code === 'G1_OUTPUT_LIMIT')
})

test('actual cost above reservation blocks subsequent calls', async () => {
  const { meter } = await fixture(async () => response({ model, usage: { cost: 0.11 } }))
  await meter.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body })
  await assert.rejects(meter.fetch('https://serpapi.com/search.json?engine=google'), e => e.code === 'G1_BUDGET_EXCEEDED')
  assert.equal(meter.snapshot().calls[0].costUsd, 0.11)
})

test('ledger excludes credentials and refuses overwrite on restart', async () => {
  const { directory, meter } = await fixture()
  await meter.fetch('https://serpapi.com/search.json?engine=google&api_key=secret-token')
  const before = await fs.readFile(path.join(directory, 'ledger.json'), 'utf8')
  assert.throws(() => installG1Budget({ directory, model, pricing, fetchImpl: async () => response() }), e => e.code === 'G1_LEDGER_EXISTS')
  assert.equal((await fs.readFile(path.join(directory, 'ledger.json'), 'utf8')), before)
  assert.equal(before.includes('secret-token'), false)
  assert.equal(meter.snapshot().knownCostUsd, 0)
  assert.equal(meter.snapshot().heldUsd, 0.05)
})

test('HTTP errors retain reservation even when their body reports a cost', async () => {
  const { meter } = await fixture(async () => new Response(JSON.stringify({ usage: { cost: 0.001 } }), { status: 429 }))
  await meter.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body })
  assert.equal(meter.snapshot().heldUsd, 0.1)
  assert.equal(meter.snapshot().knownCostUsd, 0)
})
