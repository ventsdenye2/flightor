import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from '../src/paths.mjs'
import { attachFlightOptions, updateFlightChoice } from '../src/conversation-timeline.mjs'
import { loadConversation, runConversation } from '../src/conversation.mjs'

test('new searches retain old message cards and locked choices', () => {
  const conversation = { messages: [{ id: 'a1', role: 'assistant' }, { id: 'a2', role: 'assistant' }] }
  const first = { searchId: 'first', options: [{ id: 'one' }] }
  const second = { searchId: 'second', options: [{ id: 'two' }] }
  attachFlightOptions(conversation, first, 'a1')
  updateFlightChoice(conversation, { searchId: 'first', candidateId: 'one' }, true)
  attachFlightOptions(conversation, first, 'a2')
  assert.equal(conversation.messages[1].flightOptions, undefined)
  attachFlightOptions(conversation, second, 'a2')
  assert.equal(conversation.messages[0].flightOptions, first)
  assert.equal(conversation.messages[0].selectedFlight.candidateId, 'one')
  assert.equal(conversation.messages[0].flightSelectionLocked, true)
  assert.equal(conversation.flightOptions, second)
  assert.equal(conversation.selectedFlight, undefined)
  assert.equal(conversation.flightSelectionLocked, undefined)
})
test('legacy runs restore cards at their original replies and recover the saved itinerary', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'timeline-test-'))
  const id = crypto.randomUUID()
  const options = { searchId: crypto.randomUUID(), options: [{ id: 'one' }] }
  const selection = { searchId: options.searchId, candidateId: 'one' }
  const messages = [{ id: 'u1', role: 'user', content: '查机票' }, { id: 'a1', role: 'assistant', content: '找到航班' }, { id: 'u2', role: 'user', content: '开始规划' }, { id: 'a2', role: 'assistant', content: '开始安排' }, { id: 'u3', role: 'user', content: '继续聊' }, { id: 'a3', role: 'assistant', content: '可以' }]
  const trip = { id: 'saved-trip', title: '已生成行程', provenance: 'dsh' }
  try {
    await fs.mkdir(path.join(root, 'conversations'))
    await fs.mkdir(path.join(root, 'runs'))
    await fs.writeFile(path.join(root, 'conversations', id + '.json'), JSON.stringify({ id, messages, flightOptions: options, selectedFlight: selection }))
    const runs = [
      { createdAt: '2026-10-19T01:00:00Z', stage: 'completed', conversation: { id, messages: messages.slice(0, 2), flightOptions: options } },
      { createdAt: '2026-10-19T02:00:00Z', stage: 'completed', trip, conversation: { id, messages: messages.slice(0, 4), flightOptions: options, selectedFlight: selection } },
      { createdAt: '2026-10-19T03:00:00Z', stage: 'completed', conversation: { id, messages, flightOptions: options, selectedFlight: selection } }
    ]
    for (let i = 0; i < runs.length; i++) await fs.writeFile(path.join(root, 'runs', i + '.json'), JSON.stringify(runs[i]))
    const recovered = await loadConversation(id, root)
    assert.equal(recovered.messages[1].flightOptions.searchId, options.searchId)
    assert.equal(recovered.messages[3].trip.id, trip.id)
    assert.equal(recovered.messages[5].trip, undefined)
    assert.equal(recovered.flightSelectionLocked, true)
    assert.deepEqual(await loadConversation(id, root), recovered)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('a planned itinerary is saved in its reply before completion and survives later chat', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'timeline-test-'))
  const trip = { id: 'trip', title: '巴黎七天', provenance: 'dsh' }
  let savedBeforeCompletion = false
  const plan = async (run, { beforeComplete }) => {
    run.trip = trip
    await beforeComplete(run)
    savedBeforeCompletion = (await loadConversation(run.conversation.id, root)).messages.at(-1).trip.id === 'trip'
    run.stage = 'completed'
  }
  class Agent { async start() {} async close() {} async run() { return { text: '{"reply":"继续聊。","intent":"chat"}' } } }
  try {
    const first = { id: crypto.randomUUID(), message: '开始规划', action: 'plan' }
    await runConversation(first, { root, Agent, plan })
    assert.equal(savedBeforeCompletion, true)
    const second = { id: crypto.randomUUID(), conversationId: first.conversation.id, message: '我还有个问题' }
    await runConversation(second, { root, Agent, plan })
    const restored = await loadConversation(first.conversation.id, root)
    assert.equal(restored.messages[1].trip.id, trip.id)
    assert.equal(restored.messages.at(-1).trip, undefined)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
