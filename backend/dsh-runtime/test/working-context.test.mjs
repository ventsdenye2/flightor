import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createRuntime } from '../runtime.mjs'
import { replaceWorkingContext } from '../working-context.mjs'
import { FixtureAdapter } from './fixture-adapter.mjs'

test('idle projection removes obsolete raw tools but preserves audit, current tools and cold resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-working-'))
  let writes = 0
  let adapter = new FixtureAdapter([{ tool: 'read_trip' }, { text: 'Previous answer' }, { tool: 'read_trip' }, { text: 'Current answer' }])
  const config = () => ({ root, adapter, persona: 'FlightOR', tools: [{ name: 'read_trip', description: 'Read', parameters: {} }],
    execute: async () => ({ value: ++writes, evidenceRef: writes === 1 ? 'obsolete-evidence' : 'current-evidence' }) })
  let ctx = await createRuntime(config())
  const followup = async (agent, text) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  try {
    let handle = await ctx.agents.create({ sessionId: 'working-context', agentOptions: { provider: 'fixture', model: 'fixture' } })
    replaceWorkingContext(handle.agent, 'old snapshot')
    await followup(handle.agent, 'Old question')
    const before = handle.agent.session.snapshotEvents()
    const stats = replaceWorkingContext(handle.agent, 'current Trip and publicHistory: Previous answer')
    assert.ok(stats.shadowedMessages >= 4)
    await followup(handle.agent, 'Current question')
    assert.ok(!JSON.stringify(adapter.calls[2].messages).includes('obsolete-evidence'))
    assert.ok(JSON.stringify(adapter.calls[2].messages).includes('Previous answer'))
    assert.ok(JSON.stringify(adapter.calls[3].messages).includes('current-evidence'))
    assert.deepEqual(handle.agent.session.snapshotEvents().slice(0, before.length), before)
    assert.ok(JSON.stringify(handle.agent.session.snapshotEvents()).includes('obsolete-evidence'))
    await handle.dispose(); await ctx.fiber.dispose()
    adapter = new FixtureAdapter([{ text: 'Restored answer' }])
    ctx = await createRuntime(config())
    handle = await ctx.agents.resume({ resumeSessionId: 'working-context', agentOptions: { provider: 'fixture', model: 'fixture' } })
    await handle.agent.cancel({ kind: 'user' })
    replaceWorkingContext(handle.agent, 'restored Trip with current guide and recent dialogue')
    await followup(handle.agent, 'Explain')
    const request = JSON.stringify(adapter.calls[0].messages)
    assert.ok(!request.includes('obsolete-evidence') && !request.includes('current-evidence'))
    assert.ok(request.includes('restored Trip'))
    assert.equal(writes, 2)
    assert.ok(JSON.stringify(handle.agent.session.snapshotEvents()).includes('obsolete-evidence'))
    await handle.dispose()
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
