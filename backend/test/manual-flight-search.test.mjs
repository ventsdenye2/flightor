import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from '../src/paths.mjs'
import { executeFlightSearch } from '../src/flight-query.mjs'
import { manualFlightQuery, runManualFlightSearch } from '../src/manual-flight-search.mjs'
import { loadConversation, selectConversationFlight } from '../src/conversation.mjs'

const query = { origin: 'BJS', destination: 'LIS', departureDate: '2099-10-31', tripType: 'round_trip', returnDate: '2099-11-03', adults: 1, cabin: 'economy', currency: 'CNY' }
const fixture = () => ({ searchId: crypto.randomUUID(), source: 'Trip.com', status: 'partial', observedAt: new Date().toISOString(), query,
  candidates: [{ id: '0123456789abcdef', price: { amount: 8593, currency: 'CNY' }, departureAirport: 'PEK', arrivalAirport: 'LIS', departureLocal: '2099-10-31T00:40:00', arrivalLocal: '2099-10-31T19:00:00', airlines: ['测试航司'], details: null }] })

test('manual input rejects missing/invalid return dates, past dates and unsupported passenger counts before querying', () => {
  assert.equal(manualFlightQuery(query).tripType, 'round_trip')
  assert.equal(manualFlightQuery({ ...query, adults: 9 }).adults, 9)
  for (const change of [{ returnDate: undefined }, { returnDate: '2099-10-30' }, { returnDate: '2099-02-30' }, { adults: 10 }, { adults: 0 }, { adults: 1.5 }, { tripType: 'one_way' }, { departureDate: '2020-01-01' }]) {
    assert.throws(() => manualFlightQuery({ ...query, ...change }))
  }
})

test('shared CLI adapter passes both dates and preserves partial stdout snapshots on nonzero exit', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'manual-search-test-')), raw = fixture()
  try {
    const result = await executeFlightSearch(query, { root, execute: async (_bin, argv, options) => {
      assert.equal(argv[argv.indexOf('--trip-type') + 1], 'round_trip')
      assert.equal(argv[argv.indexOf('--return-date') + 1], query.returnDate)
      assert.equal(argv[argv.indexOf('--adults') + 1], '1')
      assert.equal(options.windowsHide, true)
      throw { stdout: JSON.stringify(raw) }
    } })
    assert.equal(result.candidates[0].price.amount, 8593)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'flight-results', raw.searchId + '.json'), 'utf8')), raw)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('failed CLI queries retain their inputs and private diagnostics without a searchId', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'manual-search-test-'))
  const raw = { status: 'error', code: 'PAGE_CHANGED', message: 'private browser diagnostic', attempts: 1 }
  try {
    assert.deepEqual(await executeFlightSearch(query, { root, execute: async () => { throw { stdout: JSON.stringify(raw) } } }), raw)
    const files = await fs.readdir(path.join(root, 'flight-results'))
    assert.equal(files.length, 1)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'flight-results', files[0]), 'utf8')), { ...raw, query })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('manual search reports actionable public errors without exposing browser stacks', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'manual-search-test-'))
  try {
    for (const [code, expected] of [['PAGE_CHANGED', /页面发生变化/], ['LOCATION_SELECTION_FAILED', /城市或机场/], ['TIMEOUT', /超时/]]) {
      const run = { id: crypto.randomUUID(), query }
      await assert.rejects(runManualFlightSearch(run, { root, search: async () => ({ status: 'error', code, message: 'locator.click private stack' }) }), expected)
      assert.equal(run.errorCode, code)
      assert.doesNotMatch(run.error, /locator|private/)
      assert.equal(run.conversation, undefined)
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('manual search saves tool facts to the current conversation; selection and refresh never request planning', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'manual-search-test-'))
  try {
    const first = { id: crypto.randomUUID(), query }, raw = fixture()
    await runManualFlightSearch(first, { root, search: async value => { assert.deepEqual(value, query); return raw } })
    assert.equal(first.stage, 'completed'); assert.equal(first.planningRequested, false); assert.equal(first.trip, undefined)
    const id = first.conversation.id
    const selected = { searchId: raw.searchId, candidateId: raw.candidates[0].id }
    await selectConversationFlight(id, selected, root)
    assert.deepEqual((await loadConversation(id, root)).selectedFlight, selected)
    const next = { id: crypto.randomUUID(), query, conversationId: id }, second = fixture()
    await runManualFlightSearch(next, { root, search: async () => second })
    const restored = await loadConversation(id, root)
    assert.equal(restored.messages.length, 4)
    assert.equal(restored.messages[1].flightSelectionLocked, true)
    assert.deepEqual(restored.messages[1].selectedFlight, selected)
    assert.equal(restored.flightOptions.searchId, second.searchId)
    assert.equal(restored.selectedFlight, undefined)
    const evidence = JSON.parse(await fs.readFile(path.join(root, 'conversation-evidence', id + '.json'), 'utf8'))
    assert.deepEqual(evidence.map(result => result.searchId), [raw.searchId, second.searchId])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('restricted and cancelled searches publish no fake candidates or late conversation', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'manual-search-test-'))
  try {
    const restricted = { id: crypto.randomUUID(), query }
    await assert.rejects(runManualFlightSearch(restricted, { root, search: async () => ({ status: 'needs_user_action', code: 'ACCESS_RESTRICTED' }) }), /限制访问/)
    assert.equal(restricted.stage, 'failed'); assert.equal(restricted.conversation, undefined)
    const controller = new AbortController(), cancelled = { id: crypto.randomUUID(), query }
    await assert.rejects(runManualFlightSearch(cancelled, { root, signal: controller.signal, search: async () => { controller.abort(); return fixture() } }))
    assert.equal(cancelled.stage, 'cancelled'); assert.equal(cancelled.conversation, undefined)
    assert.equal((await fs.readdir(root)).length, 0)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
