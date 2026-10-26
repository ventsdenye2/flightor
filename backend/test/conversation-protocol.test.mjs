import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataRoot } from '../src/paths.mjs'
import { DshAgent } from '../src/dsh.mjs'
import { ConversationSubmission, submissionTool, submittedReply, validateConversationReply, roleEfforts, reasoningEffortFor } from '../src/conversation-protocol.mjs'
import { runConversation } from '../src/conversation.mjs'

const fixtures = JSON.parse(await fs.readFile(new URL('./fixtures/conversation-20261025.json', import.meta.url), 'utf8'))
const valid = { reply: '按已确认的交通开始规划。', intent: 'plan' }

async function harness(scripts, options = {}) {
  const dir = await fs.mkdtemp(path.join(dataRoot, 'protocol-test-'))
  const agent = new DshAgent({ role: 'conversation', workspace: dir, sessionId: 'test-current' })
  agent.submission = new ConversationSubmission(path.join(dir, 'state.json'))
  agent.submission.reset()
  const prompts = [], calls = []
  const emit = event => { agent.events.push(event); agent.protocolObserver?.(event) }
  let id = 0
  const submit = (args, { payload, resultId, noCall = false } = {}) => {
    const callId = 'call-' + ++id
    if (!noCall) emit({ type: 'tool/call', data: { name: submissionTool, callId, arguments: args } })
    const exec = { name: submissionTool, callId, arguments: args, signal: AbortSignal.timeout(10000) }
    const denial = agent.submission.guard(exec)
    const value = denial ? denial : payload || agent.submission.submit(args, exec)
    emit({ type: 'tool/result', data: { message: { toolCallId: resultId || callId, isError: !!denial, content: [{ type: 'text', text: denial || JSON.stringify(value) }] } } })
    calls.push({ exec, denial })
  }
  const end = () => emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  agent.rpc = { async request(method, params, signal) {
    signal.throwIfAborted()
    if (method === 'session/prompt') { prompts.push(params.contentBlocks[0].text); return }
    if (method === 'session/wait') { const script = scripts.shift(); assert.ok(script, 'unexpected extra repair turn'); await script({ agent, submit, emit, end, signal }); signal.throwIfAborted() }
  } }
  return { agent, prompts, calls, cleanup: () => fs.rm(dir, { recursive: true, force: true }), signal: options.signal || AbortSignal.timeout(10000) }
}

for (const fixture of fixtures) test(`replay ${fixture.caseId}: old model JSON is never published; same-session repair submits`, async () => {
  const h = await harness([
    ({ emit, end }) => { emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: fixture.originalAssistantText }] } } }); end() },
    ({ submit, end }) => { submit(fixture.correctedSubmission); end() }
  ])
  try {
    const result = await h.agent.run('replay', h.signal)
    assert.deepEqual(result.submission, fixture.correctedSubmission)
    assert.equal(result.protocol.repairCount, 1)
    assert.equal(result.protocol.attempts, 2)
    assert.equal(h.prompts.length, 2)
    assert.match(h.prompts[1], /缺少 submit_conversation_reply/)
    assert.throws(() => validateConversationReply(fixture.originalAssistantText), { code: 'OUTPUT_PROTOCOL_ERROR' })
  } finally { await h.cleanup() }
})

test('successful tool-only reply waits for completed turn and needs no assistant body', async () => {
  let finished = false
  const h = await harness([async ({ submit, end }) => { submit(valid); await new Promise(resolve => setTimeout(resolve, 15)); finished = true; end() }])
  try {
    const result = await h.agent.run('start', h.signal)
    assert.equal(finished, true)
    assert.deepEqual(result.submission, valid)
    assert.equal(result.protocol.firstSubmissionSucceeded, true)
    assert.equal(h.prompts.length, 1)
  } finally { await h.cleanup() }
})

test('strict required fields, types, enum and whitespace; correction guard denies every other tool', async () => {
  for (const bad of [{ reply: '开始' }, { reply: 1, intent: 'chat' }, { reply: ' ', intent: 'plan' }, { reply: '开始', intent: 'maybe' }, { reply: '开始', intent: 1 }, { ...valid, extra: true }]) {
    const h = await harness([({ submit, agent, end }) => {
      submit(bad)
      for (const name of ['search_flights', 'get_flight_details', 'web_search', 'agent', 'run_code']) assert.match(agent.submission.guard({ name }), /仅允许/)
      submit(valid); end()
    }])
    try { const r = await h.agent.run('bad args', h.signal); assert.equal(r.protocol.repairCount, 1); assert.equal(h.prompts.length, 1); assert.deepEqual(r.submission, valid) }
    finally { await h.cleanup() }
  }
})

test('normal phase keeps existing tools available; native retry consumes the single repair', async () => {
  const h = await harness([({ agent, submit, end }) => {
    assert.equal(agent.submission.guard({ name: 'web_search' }), undefined)
    submit({ reply: '缺intent' })
    end()
  }])
  try { await assert.rejects(h.agent.run('start', h.signal), { code: 'OUTPUT_PROTOCOL_ERROR' }); assert.equal(h.prompts.length, 1) }
  finally { await h.cleanup() }
})

test('native malformed JSON arguments share the same correction budget before guard dispatch', async () => {
  const h = await harness([({ emit, agent, submit, end }) => {
    emit({ type: 'tool/call', data: { name: submissionTool, callId: 'native-bad-json', arguments: '{"reply":"开始"，"intent":"plan"}' } })
    emit({ type: 'tool/result', data: { message: { toolCallId: 'native-bad-json', isError: true, content: [{ type: 'text', text: 'Invalid JSON arguments: unexpected Chinese comma' }] } } })
    assert.match(agent.submission.guard({ name: 'search_flights' }), /仅允许/)
    submit(valid); end()
  }])
  try {
    const delivered = await h.agent.run('native parse failure', h.signal)
    assert.deepEqual(delivered.submission, valid)
    assert.equal(delivered.protocol.attempts, 2); assert.equal(delivered.protocol.repairCount, 1)
    assert.equal(h.prompts.length, 1)
  } finally { await h.cleanup() }
})

test('two invalid submissions fail without an added reminder or further retry', async () => {
  const h = await harness([({ submit, end }) => { submit({ reply: '缺intent' }); submit({ reply: '仍缺intent' }); end() }])
  try { await assert.rejects(h.agent.run('start', h.signal), { code: 'OUTPUT_PROTOCOL_ERROR' }); assert.equal(h.prompts.length, 1) }
  finally { await h.cleanup() }
})

test('identical submissions are idempotent, differing submissions conflict', async () => {
  for (const conflict of [false, true]) {
    const h = await harness([({ submit, end }) => { submit(valid); submit(conflict ? { ...valid, intent: 'chat' } : valid); end() }])
    try {
      if (conflict) await assert.rejects(h.agent.run('start', h.signal), error => { assert.equal(error.code, 'OUTPUT_PROTOCOL_ERROR'); assert.equal(error.protocolMetrics.firstSubmissionSucceeded, false); return true })
      else { const r = await h.agent.run('start', h.signal); assert.equal(r.protocol.attempts, 1); assert.deepEqual(r.submission, valid) }
    } finally { await h.cleanup() }
  }
})

test('missing submission plus bad repair cannot acquire another native retry', async () => {
  const h = await harness([({ end }) => end(), ({ submit, end }) => { submit({ reply: 'still missing intent' }); end() }])
  try { await assert.rejects(h.agent.run('start', h.signal), { code: 'OUTPUT_PROTOCOL_ERROR' }); assert.equal(h.prompts.length, 2) }
  finally { await h.cleanup() }
})

test('repair deadline aborts wait with protocol error, within the original task signal', async () => {
  const h = await harness([({ agent, emit }) => {
    const state = agent.submission.read()
    state.phase = 'repair'; state.repairStartedAt = Date.now() - 30001; agent.submission.write(state)
    emit({ type: 'step/start' })
    return new Promise(() => {})
  }])
  // Fake transport follows the same AbortSignal contract as the real RPC client.
  const request = h.agent.rpc.request
  h.agent.rpc.request = (method, params, signal) => Promise.race([request(method, params, signal), new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))])
  try { await assert.rejects(h.agent.run('start', h.signal), { code: 'OUTPUT_PROTOCOL_ERROR' }) }
  finally { await h.cleanup() }
})

test('current execution and toolCallId are required; stale, orphaned and failed results are ignored', () => {
  const call = { type: 'tool/call', data: { name: submissionTool, callId: 'current' } }
  const result = (toolCallId, requestId, isError = false) => ({ type: 'tool/result', data: { message: { toolCallId, isError, content: [{ type: 'text', text: JSON.stringify({ requestId, ...valid }) }] } } })
  assert.equal(submittedReply([call, result('old', 'now'), result('current', 'old'), result('current', 'now', true)], 'now'), undefined)
  assert.deepEqual(submittedReply([call, result('current', 'now')], 'now'), valid)
})

test('native session failure during repair remains an explicit protocol error', async () => {
  const h = await harness([({ end }) => end(), () => { throw Error('native session failed') }])
  try { await assert.rejects(h.agent.run('start', h.signal), { code: 'OUTPUT_PROTOCOL_ERROR' }); assert.equal(h.prompts.length, 2) }
  finally { await h.cleanup() }
})

test('cancelled or closed request denies late submission and publishes no answer', async () => {
  const controller = new AbortController()
  const h = await harness([({ agent, submit, end }) => { controller.abort(); assert.match(agent.submission.guard({ name: submissionTool, arguments: valid }), /取消|结束/); end() }], { signal: controller.signal })
  try { await assert.rejects(h.agent.run('start', h.signal), { name: 'AbortError' }) }
  finally { await h.cleanup() }
})

test('all role initialization parameters retain model/provider and set the agreed reasoning efforts', () => {
  for (const role of ['conversation', 'planner', 'reviewer']) {
    const agent = new DshAgent({ role, workspace: 'test', sessionId: role })
    assert.deepEqual(agent.initializationParameters(), { cwd: 'test', model: 'deepseek-flash', provider: 'deepseek-account', reasoningEffort: roleEfforts[role] })
    assert.equal(Object.hasOwn(agent.initializationParameters(), 'maxTokens'), false)
  }
})

test('planner effort trials allow low/high/max while chat and reviewer stay fixed', () => {
  for (const value of ['low', 'high', 'max']) {
    const env = { FLIGHTOR_DSH_PLANNER_REASONING_EFFORT: value }
    assert.equal(reasoningEffortFor('planner', env), value)
    assert.equal(reasoningEffortFor('conversation', env), 'low')
    assert.equal(reasoningEffortFor('reviewer', env), 'high')
  }
  assert.equal(reasoningEffortFor('planner', {}), 'max')
  assert.throws(() => reasoningEffortFor('planner', { FLIGHTOR_DSH_PLANNER_REASONING_EFFORT: 'invalid' }), /必须为/)
})

test('bad delivery fails run with OUTPUT_PROTOCOL_ERROR, without saving a fake reply or empty trip', async () => {
  const dir = await fs.mkdtemp(path.join(dataRoot, 'protocol-test-'))
  class Agent { async start() {} async run() { return { submission: { reply: 'no intent' } } } async close() {} }
  const run = { id: 'protocol-invalid', message: '生成' }
  try {
    await assert.rejects(runConversation(run, { root: dir, Agent, plan: () => assert.fail('must not plan') }), { code: 'OUTPUT_PROTOCOL_ERROR' })
    assert.equal(run.stage, 'failed'); assert.equal(run.errorCode, 'OUTPUT_PROTOCOL_ERROR'); assert.match(run.error, /请重试/)
    assert.equal(run.trip, undefined); assert.equal(run.conversation, undefined)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('native registration exposes submit only to conversation and enforces the required schema', async () => {
  const { apply } = await import('../dsh/tools.mjs')
  const dir = await fs.mkdtemp(path.join(dataRoot, 'protocol-tool-test-'))
  const keys = ['FLIGHTOR_DSH_ROLE', 'FLIGHTOR_DSH_SUBMISSION', 'FLIGHTOR_DSH_AUDIT', 'FLIGHTOR_DSH_PLACE_LEDGER']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    process.env.FLIGHTOR_DSH_SUBMISSION = path.join(dir, 'state.json')
    process.env.FLIGHTOR_DSH_AUDIT = path.join(dir, 'audit.json')
    delete process.env.FLIGHTOR_DSH_PLACE_LEDGER
    new ConversationSubmission(process.env.FLIGHTOR_DSH_SUBMISSION).reset()
    for (const role of ['conversation', 'planner', 'reviewer']) {
      process.env.FLIGHTOR_DSH_ROLE = role
      const tools = [], guards = []
      await apply({ tools: { register: tool => tools.push(tool), guard: value => guards.push(value), schemas: () => tools } })
      const submit = tools.find(tool => tool.name === submissionTool)
      assert.equal(!!submit, role === 'conversation')
      assert.equal(guards.length, Number(role === 'conversation'))
      if (submit) {
        await assert.rejects(submit.execute({ reply: 'missing intent' }, {}), /intent/)
        assert.match(guards[0]({ name: submissionTool, callId: 'invalid', arguments: { reply: 'missing intent' } }), /intent/)
      }
    }
  } finally {
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] }
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('generate action with missing transport consumes a valid chat reply without starting planning', async () => {
  const dir = await fs.mkdtemp(path.join(dataRoot, 'protocol-test-'))
  class Agent {
    async start() {}
    async run(prompt) { assert.match(prompt, /缺任一项返回intent=chat/); return { submission: fixtures[2].correctedSubmission } }
    async close() {}
  }
  const run = { id: 'transport-guard', message: '开罗三天，现在生成', action: 'plan' }
  try {
    await runConversation(run, { root: dir, Agent, plan: () => assert.fail('transport missing: must ask') })
    assert.equal(run.stage, 'completed'); assert.equal(run.planningRequested, false); assert.equal(run.trip, undefined)
    assert.match(run.conversation.messages.at(-1).content, /抵达和离开/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
