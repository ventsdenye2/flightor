import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fork } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const terminal of ['stop', 'length']) test(`official HTTP body, evidence and metering (${terminal})`, { timeout: 20000 }, async () => {
  const maxTokens = terminal === 'stop' ? 4096 : 8192
  const root = await mkdtemp(join(tmpdir(), 'dsh-provider-'))
  const meters = [], requests = [], evidence = [], modelReceipts = []
  let modelCalls = 0
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    const body = JSON.parse(raw)
    requests.push({ path: req.url, body })
    if (req.url === '/anthropic/v1/messages') {
      assert.ok(meters.includes('__search_admit'))
      assert.equal(req.headers['x-api-key'], 'local-search-fixture')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/museum', title: 'Museum' }] },
        { type: 'text', text: 'Museum', citations: [{ url: 'https://example.com/museum', cited_text: 'Cultural exhibits.' }] },
      ] }))
      return
    }
    assert.equal(req.url, '/v1/chat/completions')
    assert.deepEqual(body.thinking, { type: 'disabled' })
    assert.equal(body.model, 'deepseek-v4-flash')
    assert.equal(body.max_tokens, maxTokens)
    assert.equal(body.reasoning, undefined)
    const searchQueries = body.tools.find(tool => tool.function.name === 'web_search').function.parameters.properties.queries
    assert.equal(searchQueries.minItems, 1)
    assert.equal(searchQueries.maxItems, 1)
    assert.equal(req.headers.authorization, 'Bearer local-model-fixture')
    assert.equal(meters.filter(value => value === '__model_admit').length, ++modelCalls)
    res.setHeader('content-type', 'text/event-stream')
    const chunk = delta => res.write(`data: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    chunk({ role: 'assistant' })
    if (modelCalls === 1) chunk({ tool_calls: [{ index: 0, id: 'search-one', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ queries: ['museum'], maxResults: 1 }) } }] })
    else chunk({ content: 'Official adapter route exercised locally.' })
    res.write(`data: ${JSON.stringify({ id: 'local', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: modelCalls === 1 ? 'tool_calls' : terminal }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const child = fork(new URL('../worker.mjs', import.meta.url), [], { env: { SystemRoot: process.env.SystemRoot,
    FLIGHTOR_DSH_MODEL_KEY: 'local-model-fixture', FLIGHTOR_DSH_SEARCH_KEY: 'local-search-fixture' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = '', serial = 0
  child.stderr.on('data', value => { stderr += value })
  const pending = new Map()
  child.on('message', message => {
    if (message.kind === 'tool') {
      let data = { ok: true, id: message.args.id ?? message.id }
      if (message.name === '__model_receipt') modelReceipts.push(message.args)
      if (message.name.startsWith('__model_') || message.name.startsWith('__search_')) meters.push(message.name)
      else if (message.name === '__record_web') { evidence.push(message.args); data = { evidenceRefs: ['fixture-source'] } }
      else data = { error: 'unexpected tool' }
      child.send({ id: message.id, op: 'tool_result', data })
    }
    if (message.kind === 'result') { const p = pending.get(message.id); pending.delete(message.id); message.ok ? p?.resolve(message.data) : p?.reject(Error(message.error)) }
  })
  const call = (op, data) => new Promise((resolve, reject) => { const id = String(++serial); pending.set(id, { resolve, reject }); child.send({ id, op, data }) })
  try {
    await call('open', { root, sessionId: 'provider-test', resume: false, persona: 'Research with web_search.', metered: true,
      route: { provider: 'deepseek', model: 'deepseek-v4-flash', baseURL: `${base}/v1`, maxTokens },
      web: { provider: 'deepseek-official', model: 'deepseek-v4-flash', baseURL: `${base}/anthropic/v1` },
      tools: [{ name: 'web_search', description: 'Search', rawSchema: {} }, { name: 'web_fetch', description: 'Fetch', rawSchema: {} }] })
    const result = await call('turn', { generation: 'local-provider', message: 'Find museum', snapshot: '{}' })
    assert.equal(result.reason, terminal === 'stop' ? 'completed' : 'max-tokens', JSON.stringify(result) + stderr)
    assert.equal(result.reply, 'Official adapter route exercised locally.')
    assert.equal(modelCalls, 2)
    assert.deepEqual(requests.map(req => req.path), ['/v1/chat/completions', '/anthropic/v1/messages', '/v1/chat/completions'])
    assert.equal(evidence[0].value.sources[0].snippet, 'Cultural exhibits.')
    assert.deepEqual(evidence[0].args, { queries: ['museum'], maxResults: 1 })
    assert.equal(meters.filter(value => value === '__model_receipt').length, 2)
    assert.deepEqual(modelReceipts.map(value => value.finishReason), ['tool-calls', terminal === 'stop' ? 'stop' : 'max-tokens'])
    for (const value of modelReceipts) {
      assert.equal(value.failed, false)
      assert.equal(value.maxTokens, maxTokens)
      assert.equal(value.thinking, 'disabled')
      assert.equal(value.usage.outputTokens, 20)
    }
    assert.equal(meters.filter(value => value === '__search_receipt').length, 1)
    await call('close', {})
  } finally {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
