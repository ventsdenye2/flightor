import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from '../src/paths.mjs'
import { presentFlightOptions, flightOptionsFromEvidence } from '../src/flight-options.mjs'
import { runConversation, loadConversation, selectConversationFlight } from '../src/conversation.mjs'

const fixture = () => ({
  searchId: crypto.randomUUID(), source: 'Trip.com', sourceUrl: 'https://www.trip.com/flights/', observedAt: '2026-10-19T05:00:00Z', status: 'partial', query: { origin: 'BJS', destination: 'PRG', departureDate: '2026-10-28', adults: 1, currency: 'CNY' },
  evidence: { resultPath: 'private/local/result.json' }, candidates: [{ id: 'abc123', airlines: ['测试航空'], price: { amount: 2150, currency: 'CNY' }, departureAirport: 'PEK', arrivalAirport: 'PRG', departureLocal: '2026-10-28T10:00:00', arrivalLocal: '2026-10-28T19:20:00', durationMinutes: 920, stopCount: 1, details: { rawTextPath: 'private/local/text', screenshotPath: 'private/local/image', segments: [], connections: [], baggage: { carryOn: null, checked: null } } }]
})

test('technical stop facts survive public presentation without private parser fields', () => {
  const result = fixture()
  result.candidates[0].details.segments = [{ flightNumber: 'CX530', origin: 'HKG', destination: 'NGO', stops: [{ city: 'Taipei', durationMinutes: 70, rawTextPath: 'private/stop' }] }]
  result.candidates[0].journeys = [{ ...result.candidates[0], direction: 'outbound' }]
  const option = presentFlightOptions(result).options[0]
  assert.deepEqual(option.segments[0].stops, [{ city: 'Taipei', durationMinutes: 70 }])
  assert.deepEqual(option.journeys[0].segments[0].stops, option.segments[0].stops)
  assert.doesNotMatch(JSON.stringify(option), /rawTextPath|private/)
})
test('CLI evidence exposes exact flight facts without raw messages and filesystem paths', async () => {
  const result = fixture()
  const options = await flightOptionsFromEvidence([{ message: { content: [{ type: 'text', text: JSON.stringify(result) }] } }], dataRoot)
  assert.equal(options.searchId, result.searchId)
  assert.equal(options.options[0].amount, 2150)
  assert.equal(options.options[0].departureAirport, 'PEK')
  assert.equal(options.options[0].arrivalLocal, result.candidates[0].arrivalLocal)
  assert.doesNotMatch(JSON.stringify(options), /private|rawTextPath|screenshotPath|resultPath/)
  assert.equal(presentFlightOptions({ status: 'error' }), null)
})
test('choice stays on its original reply; next chat locks it and explicit planning still consults the conversation agent', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'flight-options-test-'))
  const result = fixture(), plans = [], prompts = []
  let modelCalls = 0
  class Agent {
    async start() {}
    async run(input) {
      modelCalls++; prompts.push(input)
      this.onEvent('conversation', { type: 'tool/result', data: { message: { content: [{ type: 'text', text: JSON.stringify(result) }] } } })
      return { text: JSON.stringify({ reply: '已找到这些航班，可以先比较。', intent: 'chat' }) }
    }
    async close() {}
  }
  const plan = async run => { plans.push(run); run.stage = 'completed' }
  try {
    const run = { id: crypto.randomUUID(), message: '只查北京到布拉格机票，先不规划' }
    await runConversation(run, { root, Agent, plan })
    assert.equal(run.conversation.flightOptions.options.length, 1)
    const selection = { searchId: result.searchId, candidateId: 'abc123' }
    await selectConversationFlight(run.conversation.id, selection, root)
    assert.equal(modelCalls, 1); assert.equal(plans.length, 0)
    assert.deepEqual((await loadConversation(run.conversation.id, root)).selectedFlight, selection)
    await assert.rejects(selectConversationFlight(run.conversation.id, { ...selection, candidateId: 'made-up' }, root), /重新选择/)
    await selectConversationFlight(run.conversation.id, null, root)
    await selectConversationFlight(run.conversation.id, selection, root)
    const anchorId = run.conversation.messages.at(-1).id
    const chat = { id: crypto.randomUUID(), conversationId: run.conversation.id, message: '这班托运行李怎么安排？', action: 'chat' }
    await runConversation(chat, { root, Agent, plan })
    const restored = await loadConversation(run.conversation.id, root)
    assert.equal(restored.messages.find(message => message.flightOptions).id, anchorId)
    assert.equal(restored.messages.at(-1).flightOptions, undefined)
    assert.equal(restored.flightSelectionLocked, true)
    assert.equal(restored.messages.find(message => message.id === anchorId).flightSelectionLocked, true)
    await assert.rejects(selectConversationFlight(run.conversation.id, null, root), /不能更改/)
    assert.equal(plans.length, 0); assert.match(prompts.at(-1), /2150/); assert.match(prompts.at(-1), /选择本身不是开始规划/)
    const planning = { id: crypto.randomUUID(), conversationId: run.conversation.id, message: '现在开始规划', action: 'plan' }
    await runConversation(planning, { root, Agent, plan })
    assert.equal(plans.length, 0); assert.deepEqual(planning.flightSelection, selection)
    assert.equal(planning.constraints.selectedFlight.amount, 2150)
    assert.match(prompts.at(-1), /托运行李怎么安排/)
    assert.match(prompts.at(-1), /用户已点击生成行程/)
    assert.deepEqual((await loadConversation(run.conversation.id, root)).selectedFlight, selection)
    assert.equal(modelCalls, 3); assert.equal(plans.length, 0)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('round-trip facts survive selection, refresh and planning with both dates and no private paths', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'flight-options-test-'))
  const result = fixture(), plans = [], prompts = []
  result.query.tripType = 'round_trip'; result.query.returnDate = '2026-11-03'
  const outbound = { ...result.candidates[0], direction: 'outbound' }
  const inbound = { ...outbound, direction: 'return', departureAirport: 'PRG', arrivalAirport: 'PEK', departureLocal: '2026-11-03T12:00:00', arrivalLocal: '2026-11-04T07:00:00' }
  result.candidates[0].journeys = [outbound, inbound]
  class Agent {
    async start() {} async close() {}
    async run(input) {
      prompts.push(input)
      if (prompts.length === 1) this.onEvent('conversation', { type: 'tool/result', data: result })
      return { text: JSON.stringify({ reply: prompts.length === 1 ? '请选择往返组合。' : '按已确认的去返程规划。', intent: prompts.length === 1 ? 'chat' : 'plan' }) }
    }
  }
  try {
    const first = { id: crypto.randomUUID(), message: '查北京布拉格往返，10月28日去，11月3日回' }
    await runConversation(first, { root, Agent })
    const options = first.conversation.flightOptions
    assert.equal(options.tripType, 'round_trip'); assert.equal(options.returnDate, '2026-11-03')
    assert.equal(options.options[0].journeys[1].departureLocal, inbound.departureLocal)
    assert.doesNotMatch(JSON.stringify(options), /private|rawTextPath|screenshotPath/)
    const selection = { searchId: result.searchId, candidateId: 'abc123' }
    await selectConversationFlight(first.conversation.id, selection, root)
    const restored = await loadConversation(first.conversation.id, root)
    assert.deepEqual(restored.selectedFlight, selection)
    const next = { id: crypto.randomUUID(), conversationId: first.conversation.id, action: 'plan', message: '按这组往返规划' }
    await runConversation(next, { root, Agent, plan: async run => { plans.push(run); run.stage = 'completed' } })
    assert.equal(plans.length, 1)
    assert.equal(next.constraints.selectedFlight.journeys.length, 2)
    assert.equal(next.constraints.confirmedFlights[0].journeys[1].departureLocal, inbound.departureLocal)
    assert.match(prompts[1], /2026-11-03T12:00:00/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('two selected one-way searches retain both confirmations when the latest options replace the first query', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'flight-options-test-'))
  const firstResult = fixture(), returnResult = fixture()
  returnResult.query = { ...returnResult.query, origin: 'PRG', destination: 'BJS', departureDate: '2026-11-03' }
  Object.assign(returnResult.candidates[0], { departureAirport: 'PRG', arrivalAirport: 'PEK', departureLocal: '2026-11-03T12:00:00', arrivalLocal: '2026-11-04T07:00:00' })
  returnResult.observedAt = '2026-10-19T06:00:00Z'
  let calls = 0
  class Agent {
    async start() {} async close() {}
    async run(input) {
      calls++
      if (calls < 3) this.onEvent('conversation', { type: 'tool/result', data: calls === 1 ? firstResult : returnResult })
      else { assert.match(input, /2026-10-28T19:20:00/); assert.match(input, /2026-11-03T12:00:00/) }
      return { text: JSON.stringify({ reply: calls < 3 ? '请选择。' : '已确认去返程。', intent: 'chat' }) }
    }
  }
  try {
    const first = { id: crypto.randomUUID(), message: '查去程' }
    await runConversation(first, { root, Agent })
    await selectConversationFlight(first.conversation.id, { searchId: firstResult.searchId, candidateId: 'abc123' }, root)
    const second = { id: crypto.randomUUID(), conversationId: first.conversation.id, message: '再查返程' }
    await runConversation(second, { root, Agent })
    await selectConversationFlight(first.conversation.id, { searchId: returnResult.searchId, candidateId: 'abc123' }, root)
    const third = { id: crypto.randomUUID(), conversationId: first.conversation.id, message: '两边都选好了' }
    await runConversation(third, { root, Agent })
    assert.equal(third.constraints.confirmedFlights.length, 2)
    assert.equal(third.planningRequested, false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
