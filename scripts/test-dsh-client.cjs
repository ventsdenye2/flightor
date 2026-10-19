const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/features/ui-experience/backendClient.ts'), 'utf8')
const moduleValue = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: moduleValue.exports, module: moduleValue, Set, Error, Promise, setTimeout })
const { createConversationClient, createGenerator, PlanCancellation, restoreTrip } = moduleValue.exports
async function main() {
  const methods = []
  let finish
  let published = false
  const cancellation = new PlanCancellation()
  const generate = createGenerator(async method => {
    methods.push(method)
    if (method === 'POST') return { id: 'cancelled-run' }
    if (method === 'GET') return new Promise(resolve => { finish = resolve })
    return { stage: 'cancelled' }
  }, () => { published = true })
  const pending = generate('test', () => {}, cancellation.signal)
  await new Promise(resolve => setTimeout(resolve, 0))
  cancellation.abort()
  finish({ stage: 'completed', trip: { id: 'late-result' } })
  await assert.rejects(pending, /已取消/)
  assert.ok(methods.includes('DELETE'))
  assert.equal(published, false)
  const restored = await restoreTrip(async () => ({ stage: 'completed', trip: { id: 'saved', provenance: 'dsh' } }), 'saved-id')
  assert.equal(restored.id, 'saved')
  assert.equal(await restoreTrip(async () => ({ stage: 'completed', trip: { id: 'sample' } }), 'sample-id'), null)
  let saved = null, completed = null
  const sent = []
  const chat = createConversationClient(async (method, route, body) => {
    if (method === 'POST') { sent.push(body); return { id: 'chat-turn' } }
    if (route.includes('/conversations/')) return { id: saved, messages: [] }
    return { stage: 'completed', conversation: { id: 'context-1', messages: [] }, ...(sent.at(-1).action === 'plan' ? { trip: { id: 'trip' } } : {}) }
  }, { get: () => saved, set: id => { saved = id }, clear: () => { saved = null } }, id => { completed = id })
  await chat.send('先聊聊', () => {}, new PlanCancellation().signal)
  assert.equal(sent[0].action, 'chat'); assert.equal(completed, null)
  await chat.send('现在生成', () => {}, new PlanCancellation().signal, 'plan')
  assert.equal(sent[1].conversationId, 'context-1'); assert.equal(completed, 'chat-turn')
  assert.equal((await chat.load()).id, 'context-1'); chat.reset(); assert.equal(await chat.load(), null)
  const cancelledChat = new PlanCancellation()
  let resolveTurn, posted
  const lateChat = createConversationClient(async (method) => {
    if (method === 'POST') return { id: 'late-chat' }
    if (method === 'GET') { posted = true; return new Promise(resolve => { resolveTurn = resolve }) }
    return {}
  }, { get: () => null, set: () => assert.fail('late history must not persist'), clear: () => {} })
  const late = lateChat.send('消息', () => assert.fail('late progress must not publish'), cancelledChat.signal)
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(posted, true); cancelledChat.abort()
  await assert.rejects(late, /已取消/)
  resolveTurn({ stage: 'completed', conversation: { id: 'late', messages: [] } })
  let submit, deleted = false
  const earlyCancellation = new PlanCancellation()
  const earlyChat = createConversationClient(async method => {
    if (method === 'POST') return new Promise(resolve => { submit = resolve })
    if (method === 'DELETE') { deleted = true; return {} }
    assert.fail('cancelled submission must not poll')
  }, { get: () => null, set: () => assert.fail('cancelled submission must not save'), clear: () => {} })
  const early = earlyChat.send('消息', () => assert.fail('cancelled progress'), earlyCancellation.signal)
  earlyCancellation.abort()
  await assert.rejects(early, /已取消/)
  submit({ id: 'late-post' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(deleted, true)
  const updates = []
  let poll = 0
  const progressChat = createConversationClient(async method => {
    if (method === 'POST') return { id: 'progress' }
    poll++
    return { stage: poll === 1 ? 'chatting' : 'completed', progress: { text: poll === 1 ? '正在调用工具查询资料' : '回复已保存' }, ...(poll === 2 ? { conversation: { id: 'done', messages: [] } } : {}) }
  }, { get: () => null, set: () => {}, clear: () => {} })
  await progressChat.send('消息', text => updates.push(text), new PlanCancellation().signal)
  assert.deepEqual(updates, ['正在调用工具查询资料', '回复已保存'])
  console.log('PASS cancellation signals backend and ignores late result; saved real result restores; sample result is not restored as live')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
