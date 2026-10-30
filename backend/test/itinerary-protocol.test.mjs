import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataRoot } from '../src/paths.mjs'
import { DshAgent } from '../src/dsh.mjs'
import { ItinerarySubmission, itinerarySubmissionTool, submittedItinerary } from '../src/itinerary-protocol.mjs'

const itinerary = {
  title: '东京两日', destination: '东京', overview: '历史与街区慢游', highlights: [], issues: [],
  days: [{ activities: [{ id: 'd1-a1', name: '浅草寺', description: '上午慢慢游览' }] }]
}

async function harness(scripts, options = {}) {
  const dir = await fs.mkdtemp(path.join(dataRoot, 'itinerary-protocol-test-'))
  const agent = new DshAgent({ role: 'reviewer', workspace: dir, sessionId: 'test-reviewer' })
  agent.itinerarySubmission = new ItinerarySubmission(path.join(dir, 'state.json'))
  agent.itinerarySubmission.reset()
  const prompts = [], calls = []
  const emit = event => { agent.events.push(event); agent.protocolObserver?.(event) }
  let id = 0
  const submit = (args, { resultId, noCall = false } = {}) => {
    const callId = 'call-' + ++id
    if (!noCall) emit({ type: 'tool/call', data: { name: itinerarySubmissionTool, callId, arguments: args } })
    const exec = { name: itinerarySubmissionTool, callId, arguments: args, signal: AbortSignal.timeout(10000) }
    const denial = agent.itinerarySubmission.guard(exec)
    const value = denial ? denial : agent.itinerarySubmission.submit(args, exec)
    emit({ type: 'tool/result', data: { message: { toolCallId: resultId || callId, isError: !!denial, content: [{ type: 'text', text: denial || JSON.stringify(value) }] } } })
    calls.push({ exec, denial })
  }
  const end = () => emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  agent.rpc = { async request(method, params, signal) {
    signal.throwIfAborted()
    if (method === 'session/prompt') { prompts.push(params.contentBlocks[0].text); return }
    if (method === 'session/wait') { const script = scripts.shift(); assert.ok(script, 'unexpected extra reviewer turn'); await script({ agent, submit, emit, end, signal }); signal.throwIfAborted() }
  } }
  return { agent, prompts, calls, cleanup: () => fs.rm(dir, { recursive: true, force: true }), signal: options.signal || AbortSignal.timeout(10000) }
}

test('reviewer delivers tool-only itinerary after turn completion without an added repair turn', async () => {
  let finished = false
  const h = await harness([async ({ submit, end }) => { submit({ itinerary }); await new Promise(resolve => setTimeout(resolve, 15)); finished = true; end() }])
  try {
    const result = await h.agent.run('review', h.signal)
    assert.equal(finished, true)
    assert.deepEqual(result.itinerary, itinerary)
    assert.equal(result.protocol.firstSubmissionSucceeded, true)
    assert.equal(result.protocol.repairCount, 0)
    assert.equal(h.prompts.length, 1)
  } finally { await h.cleanup() }
})

test('missing tool submission gets one same-session repair and ignores assistant JSON text', async () => {
  const h = await harness([
    ({ emit, end }) => { emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(itinerary) }] } } }); end() },
    ({ submit, end }) => { submit({ itinerary }); end() }
  ])
  try {
    const result = await h.agent.run('review', h.signal)
    assert.deepEqual(result.itinerary, itinerary)
    assert.equal(result.protocol.repairCount, 1)
    assert.equal(h.prompts.length, 2)
    assert.match(h.prompts[1], /缺少 submit_itinerary/)
  } finally { await h.cleanup() }
})

test('field errors consume the single repair and only submission remains available', async () => {
  const h = await harness([({ agent, submit, end }) => {
    submit({ itinerary: { title: '缺少必填结构' } })
    assert.match(agent.itinerarySubmission.guard({ name: 'lookup_places_batch' }), /仅允许/)
    submit({ itinerary }); end()
  }])
  try {
    const result = await h.agent.run('review', h.signal)
    assert.deepEqual(result.itinerary, itinerary)
    assert.equal(result.protocol.attempts, 2)
    assert.equal(result.protocol.repairCount, 1)
    assert.equal(h.prompts.length, 1)
  } finally { await h.cleanup() }
})

test('native malformed tool arguments share the same repair budget', async () => {
  const h = await harness([({ agent, emit, submit, end }) => {
    emit({ type: 'tool/call', data: { name: itinerarySubmissionTool, callId: 'native-bad', arguments: '{"itinerary":' } })
    emit({ type: 'tool/result', data: { message: { toolCallId: 'native-bad', isError: true, content: [{ type: 'text', text: 'Invalid JSON arguments' }] } } })
    assert.match(agent.itinerarySubmission.guard({ name: 'lookup_places_batch' }), /仅允许/)
    submit({ itinerary }); end()
  }])
  try {
    const result = await h.agent.run('review', h.signal)
    assert.deepEqual(result.itinerary, itinerary)
    assert.equal(result.protocol.attempts, 2)
    assert.equal(result.protocol.repairCount, 1)
  } finally { await h.cleanup() }
})

test('duplicate submission is idempotent and a different object conflicts', async () => {
  const h = await harness([({ submit, end }) => {
    submit({ itinerary }); submit({ itinerary })
    submit({ itinerary: { ...itinerary, title: '另一份行程' } }); end()
  }])
  try {
    await assert.rejects(h.agent.run('review', h.signal), error => { assert.equal(error.code, 'OUTPUT_PROTOCOL_ERROR'); assert.equal(error.protocolMetrics.firstSubmissionSucceeded, false); return true })
  } finally { await h.cleanup() }
})

test('missing submission in both initial and repair turns fails explicitly', async () => {
  const h = await harness([({ end }) => end(), ({ end }) => end()])
  try {
    await assert.rejects(h.agent.run('review', h.signal), { code: 'OUTPUT_PROTOCOL_ERROR' })
    assert.equal(h.prompts.length, 2)
  } finally { await h.cleanup() }
})

test('submitted itinerary is paired to the current request and toolCallId', () => {
  const call = { type: 'tool/call', data: { name: itinerarySubmissionTool, callId: 'current', arguments: { itinerary } } }
  const result = (toolCallId, requestId, isError = false) => ({ type: 'tool/result', data: { message: { toolCallId, isError, content: [{ type: 'text', text: JSON.stringify({ requestId, accepted: true }) }] } } })
  assert.equal(submittedItinerary([call, result('old', 'now'), result('current', 'old'), result('current', 'now', true)], 'now'), undefined)
  assert.deepEqual(submittedItinerary([call, result('current', 'now')], 'now'), itinerary)
})

test('submit_itinerary is registered only for reviewer and rejects incomplete schemas', async () => {
  const { apply } = await import('../dsh/tools.mjs')
  const dir = await fs.mkdtemp(path.join(dataRoot, 'itinerary-tool-test-'))
  const keys = ['FLIGHTOR_DSH_ROLE', 'FLIGHTOR_DSH_ITINERARY_SUBMISSION', 'FLIGHTOR_DSH_PLACE_LEDGER', 'FLIGHTOR_DSH_AUDIT']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    process.env.FLIGHTOR_DSH_ITINERARY_SUBMISSION = path.join(dir, 'state.json')
    process.env.FLIGHTOR_DSH_AUDIT = path.join(dir, 'audit.json')
    delete process.env.FLIGHTOR_DSH_PLACE_LEDGER
    new ItinerarySubmission(process.env.FLIGHTOR_DSH_ITINERARY_SUBMISSION).reset()
    for (const role of ['conversation', 'planner', 'reviewer']) {
      process.env.FLIGHTOR_DSH_ROLE = role
      const tools = [], guards = []
      await apply({ tools: { register: tool => tools.push(tool), guard: value => guards.push(value), schemas: () => tools } })
      const submit = tools.find(tool => tool.name === itinerarySubmissionTool)
      assert.equal(!!submit, role === 'reviewer')
      assert.equal(guards.length, Number(role === 'reviewer'))
      if (submit) await assert.rejects(submit.execute({ itinerary: { title: 'invalid' } }, { signal: AbortSignal.timeout(1000) }), /destination|overview|highlights|days|issues/)
    }
  } finally {
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] }
    await fs.rm(dir, { recursive: true, force: true })
  }
})
