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
test('choice stays on its original reply; the next chat locks selection and explicit planning retains it', async () => {
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
    assert.equal(plans.length, 1); assert.deepEqual(planning.flightSelection, selection)
    assert.equal(planning.constraints.selectedFlight.amount, 2150)
    assert.match(planning.prompt, /托运行李怎么安排/)
    assert.deepEqual((await loadConversation(run.conversation.id, root)).selectedFlight, selection)
    assert.equal(modelCalls, 2); assert.equal(plans.length, 1)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
