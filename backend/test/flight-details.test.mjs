import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from '../src/paths.mjs'
import { executeFlightDetails } from '../src/flight-query.mjs'
import { runManualFlightSearch } from '../src/manual-flight-search.mjs'
import { runFlightDetails } from '../src/flight-details.mjs'
import { loadConversation, selectConversationFlight } from '../src/conversation.mjs'

async function setup() {
  const root = await fs.mkdtemp(path.join(dataRoot, 'flight-details-test-'))
  const raw = { searchId: crypto.randomUUID(), source: 'Trip.com', status: 'complete', observedAt: new Date().toISOString(), query: { origin: 'BJS', destination: 'LIS', departureDate: '2099-11-04', currency: 'CNY' },
    candidates: [{ id: '0123456789abcdef', detailsState: 'deferred', price: { amount: 1234, currency: 'CNY' }, details: null, airlines: ['Test'] }] }
  const search = { id: crypto.randomUUID(), query: raw.query }
  await runManualFlightSearch(search, { root, search: async () => raw })
  await fs.mkdir(path.join(root, 'flight-results'), { recursive: true })
  await fs.writeFile(path.join(root, 'flight-results', raw.searchId + '.json'), JSON.stringify(raw))
  const selection = { searchId: raw.searchId, candidateId: raw.candidates[0].id }
  const response = { ...raw, candidate: { ...raw.candidates[0], detailsState: 'ready', details: { observedAt: new Date().toISOString(), segments: [], connections: [], baggage: { checked: '23kg', carryOn: null } } } }
  return { root, raw, selection, response, run: { conversationId: search.conversation.id, selection, select: false } }
}

test('details CLI uses cancellable search budget and explicit selection refresh', async () => {
  const response = { status: 'complete' }, signal = new AbortController().signal
  assert.deepEqual(await executeFlightDetails({ searchId: crypto.randomUUID(), candidateId: '0123456789abcdef' }, { signal, refresh: true, execute: async (_bin, argv, options) => {
    assert.ok(argv.includes('--refresh')); assert.ok(argv.includes('details')); assert.equal(options.signal, signal); assert.equal(options.timeout, 205000)
    return { stdout: JSON.stringify(response) }
  } }), response)
})

test('worker adapters avoid CLI processes and preserve evidence, three-result limit, refresh and cancellation', async () => {
  const { root, raw, selection } = await setup()
  const signal = new AbortController().signal
  try {
    const { executeFlightSearch } = await import('../src/flight-query.mjs')
    const calls = []
    const worker = async (command, input, options) => { calls.push({ command, input, options }); return raw }
    await executeFlightSearch(raw.query, { root, signal, worker })
    await executeFlightDetails(selection, { signal, refresh: true, worker })
    assert.equal(calls[0].command, 'search'); assert.equal(calls[0].input.maxResults, 3)
    assert.equal(calls[1].command, 'details'); assert.equal(calls[1].options.refresh, true)
    assert.equal(calls[0].options.signal, signal); assert.equal(calls[1].options.signal, signal)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('details load enriches its message and evidence without selection; selection refreshes before saving', async () => {
  const { root, run, selection, response } = await setup()
  try {
    await assert.rejects(selectConversationFlight(run.conversationId, selection, root), /核对价格/)
    let calls = 0
    const details = async (input, options) => { calls++; assert.deepEqual(input, selection); assert.equal(options.refresh, calls === 2); return response }
    await runFlightDetails(run, { root, details })
    const restored = await loadConversation(run.conversationId, root)
    assert.equal(restored.messages[1].flightOptions.options[0].baggage.checked, '23kg')
    assert.ok(!restored.selectedFlight); assert.equal(run.trip, undefined)
    await runFlightDetails({ ...run, select: true }, { root, details })
    assert.deepEqual((await loadConversation(run.conversationId, root)).selectedFlight, selection)
    const evidence = JSON.parse(await fs.readFile(path.join(root, 'conversation-evidence', run.conversationId + '.json'), 'utf8'))
    assert.equal(evidence.length, 3)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('changed price, wrong candidate, restrictions and late cancellation do not select or enrich', async () => {
  const { root, run, response } = await setup()
  try {
    for (const bad of [{ status: 'error', code: 'PRICE_CHANGED' }, { status: 'needs_user_action', code: 'ACCESS_RESTRICTED' }, { ...response, candidate: { ...response.candidate, id: 'ffffffffffffffff' } }, { ...response, candidate: { ...response.candidate, price: { amount: 999, currency: 'CNY' } } }]) {
      await assert.rejects(runFlightDetails({ ...run, select: true }, { root, details: async () => bad }))
      const saved = await loadConversation(run.conversationId, root)
      assert.ok(!saved.selectedFlight); assert.equal(saved.flightOptions.options[0].detailsState, 'deferred')
    }
    const controller = new AbortController()
    await assert.rejects(runFlightDetails(run, { root, signal: controller.signal, details: async () => { controller.abort(); return response } }))
    assert.equal(run.stage, 'cancelled')
    assert.equal((await loadConversation(run.conversationId, root)).flightOptions.options[0].detailsState, 'deferred')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
