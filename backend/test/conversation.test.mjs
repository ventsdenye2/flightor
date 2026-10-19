import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from '../src/paths.mjs'
import { runConversation, loadConversation, parseConversationReply } from '../src/conversation.mjs'
import { conversationPersona } from '../src/prompts.mjs'

test('chat preserves context and only an explicit planning intent invokes the planner', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'conversation-test-'))
  const inputs = [], plans = []
  const answers = [{ reply: '想逛博物馆还是街区？', intent: 'chat' }, { reply: '记住了，预算改成两万。', intent: 'chat' }, { reply: '现在按聊过的内容规划。', intent: 'plan' }]
  class Agent {
    async start(persona) { assert.equal(persona, conversationPersona) }
    async run(input) { inputs.push(input); return { text: JSON.stringify(answers.shift()) } }
    async close() {}
  }
  const plan = async run => { plans.push(run.prompt); run.trip = { id: 'generated' }; run.stage = 'completed' }
  const make = (message, conversationId, action = 'chat') => ({ id: crypto.randomUUID(), message, conversationId, action })
  try {
    const first = make('北京去巴黎七天，先聊聊，预算一万八')
    await runConversation(first, { root, Agent, plan })
    assert.equal(first.stage, 'completed'); assert.equal(plans.length, 0); assert.equal(first.conversation.messages.length, 2)
    const second = make('预算改两万，喜欢建筑，不去迪士尼', first.conversation.id)
    await runConversation(second, { root, Agent, plan })
    assert.equal(plans.length, 0); assert.match(inputs[1], /预算一万八/); assert.match(inputs[1], /预算改两万/)
    const third = make('现在帮我规划', first.conversation.id)
    await runConversation(third, { root, Agent, plan })
    assert.equal(plans.length, 1); assert.match(plans[0], /不去迪士尼/); assert.match(plans[0], /北京去巴黎七天/); assert.match(plans[0], /预算改两万/)
    assert.equal((await loadConversation(first.conversation.id, root)).messages.length, 6)
    assert.equal(third.trip.id, 'generated')
    const fourth = make('按前面的内容生成', first.conversation.id, 'plan')
    await runConversation(fourth, { root, Agent, plan })
    assert.equal(plans.length, 2); assert.equal(inputs.length, 3)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('unstructured or invalid intent replies remain chat, never trigger planning', () => {
  assert.equal(parseConversationReply('先聊聊你的想法').intent, 'chat')
  assert.equal(parseConversationReply('{"reply":"开始","intent":"maybe"}').intent, 'chat')
})
test('actual lifecycle progress updates and the saved reply publish before agent cleanup', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'conversation-test-'))
  let closed = false, publishedBeforeClose = false, live
  class Agent {
    async start() {}
    async run() {
      this.onEvent('conversation', { type: 'tool/call', data: { arguments: 'private' } })
      live = run.progress.text
      return { text: '{"reply":"可以继续聊。","intent":"chat"}' }
    }
    async close() { closed = true }
  }
  const run = { id: crypto.randomUUID(), message: '你好' }
  try {
    await runConversation(run, { root, Agent, onChange: async value => { if (value.conversation && !closed) publishedBeforeClose = true } })
    assert.match(live, /正在调用工具/)
    assert.equal(publishedBeforeClose, true)
    assert.equal(run.conversation.messages.at(-1).content, '可以继续聊。')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('cancelled chat cannot publish a late answer or initiate planning', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'conversation-test-'))
  const controller = new AbortController()
  class Agent { async start() {} async run() { controller.abort(); return { text: '{"reply":"开始","intent":"plan"}' } } async close() {} }
  const run = { id: crypto.randomUUID(), message: '现在规划' }
  try { await assert.rejects(runConversation(run, { root, Agent, signal: controller.signal, plan: async () => assert.fail('must not plan') })); assert.equal(run.stage, 'cancelled'); assert.equal(run.conversation, undefined) }
  finally { await fs.rm(root, { recursive: true, force: true }) }
})
