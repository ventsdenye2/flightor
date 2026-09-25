import test from 'node:test'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime, CORE_PLUGINS } from '../runtime.mjs'
import { FixtureAdapter } from './fixture-adapter.mjs'

test('official search schema enforces one query and rejects invalid queries before budget admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-search-contract-'))
  const invalid = [{ queries: ['one', 'two'] }, { queries: [] }, { queries: ['  '] }, { queries: [42] }]
  const adapter = new FixtureAdapter([...invalid.map(args => ({ tool: 'web_search', args })),
    { tool: 'web_search', args: { queries: ['museum'] } }, { text: 'Done.' }])
  const operations = []
  const ctx = await createRuntime({ root, adapter, metered: true, web: { provider: 'serpapi-raw' },
    tools: [{ name: 'web_search', description: 'Search', rawSchema: {} }], execute: async (name, args) => {
      operations.push({ name, args })
      if (name === '__search_admit') return { ok: true, id: 'only-valid-search' }
      if (name === '__web_search') return { sources: [{ url: 'https://example.com/museum', title: 'Museum', snippet: 'Cultural exhibits.' }], truncated: false }
      if (name === '__record_web') return { evidenceRefs: ['fixture-ref'], urls: ['https://example.com/museum'] }
      return { ok: true }
    } })
  try {
    const handle = await ctx.agents.create({ sessionId: 'search-contract', agentOptions: { provider: 'fixture', model: 'fixture' } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Search' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    assert.equal(adapter.calls.length, 6)
    const queries = adapter.calls[0].tools.find(tool => tool.name === 'web_search').parameters.properties.queries
    assert.equal(queries.minItems, 1); assert.equal(queries.maxItems, 1)
    assert.deepEqual(operations.map(item => item.name), ['__search_admit', '__web_search', '__search_receipt', '__record_web'])
    assert.equal(operations[1].args.query, 'museum')
    assert.equal(operations[2].args.id, 'only-valid-search')
    assert.equal(operations[2].args.failed, false)
    assert.ok(JSON.stringify(adapter.calls[4].messages).includes('did not start search or reserve search budget'))
    await handle.dispose()
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('real AgentLoop executes one tool, follows up, resumes and cancels without coding plugins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-'))
  let count = 0
  const adapter = new FixtureAdapter([{ tool: 'read_trip' }, { text: 'Tokyo' }, { text: 'Because it matches culture.' }])
  const config = { root, adapter, tools: [{ name: 'read_trip', description: 'Read current trip', parameters: {} }], execute: async () => { count++; return { city: 'Tokyo' } } }
  let ctx = await createRuntime(config)
  try {
    assert.deepEqual(ctx.tools.schemas().map(t => t.name), ['read_trip'])
    assert.equal(CORE_PLUGINS.some(p => /shell|bash|subagent|inventory|session-log/.test(p)), false)
    let handle = await ctx.agents.create({ sessionId: 'smoke-session', agentOptions: { provider: 'fixture', model: 'fixture', maxTokens: 4096 } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read trip' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    assert.equal(count, 1)
    assert.equal(adapter.calls.length, 2)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Why?' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    assert.equal(adapter.calls.length, 3)
    await handle.dispose()
    await ctx.fiber.dispose()
    const resumed = new FixtureAdapter([{ text: 'Restored' }, { hang: true }])
    ctx = await createRuntime({ ...config, adapter: resumed })
    handle = await ctx.agents.resume({ resumeSessionId: 'smoke-session', agentOptions: { provider: 'fixture', model: 'fixture' } })
    assert.equal(resumed.calls.length, 0)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    assert.ok(JSON.stringify(resumed.calls[0].messages).includes('Why?'))
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Wait' }], source: { kind: 'user' } }))
    await new Promise(resolve => setTimeout(resolve, 30))
    await handle.agent.cancel({ kind: 'user' })
    await handle.agent.whenIdle()
    assert.equal(handle.agent.status, 'idle')
    await handle.dispose()
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
