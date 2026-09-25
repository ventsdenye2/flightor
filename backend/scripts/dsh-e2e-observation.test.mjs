import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { installDshE2eObservation } from './dsh-e2e-observation.mjs'
import { DshSessionManager } from '../dist/agent/dsh/session-manager.js'

test('observes an official fixture worker incrementally without raw model/tool secrets or behavior changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-observer-'))
  const dataDirectory = path.join(root, 'sessions'), directory = path.join(root, 'audit')
  const observer = await installDshE2eObservation({ directory, dataDirectory })
  assert.equal(await installDshE2eObservation({ directory, dataDirectory }), observer)
  const guideId = randomUUID(), evidenceRef = randomUUID()
  const args = { baseGuideId: guideId, expectedContentHash: 'a'.repeat(64), replaceSlots: [{ day: 2, slot: 'afternoon' }],
    privateThought: 'SENSITIVE_ARGUMENT' }
  const manager = new DshSessionManager({ root: dataDirectory, metered: true, route: { provider: 'fixture', model: 'fixture' },
    web: { provider: 'serpapi-raw' }, fixture: [
      { tool: 'web_search', args: { queries: ['SENSITIVE_QUERY'] } }, { tool: 'commit_travel_guide', args },
      { text: 'SENSITIVE_RAW_REPLY' },
    ] })
  const calls = [], activities = []
  const read = () => fs.readdirSync(observer.directory).flatMap(file => fs.readFileSync(path.join(observer.directory, file), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
  try {
    const input = { ownerId: randomUUID(), tripId: randomUUID(), conversationId: randomUUID(), generationId: randomUUID(), memoryEpoch: 'test',
      message: 'SENSITIVE_USER_MESSAGE', snapshot: 'SENSITIVE_SNAPSHOT', persona: 'SENSITIVE_PERSONA',
      tools: [{ name: 'web_search', description: 'Source', rawSchema: { type: 'object' } },
        { name: 'web_fetch', description: 'Page', rawSchema: { type: 'object' } },
        { name: 'commit_travel_guide', description: 'Commit', rawSchema: { type: 'object' } }],
      onActivity: event => activities.push(event),
      async execute(name, value, callId) {
        calls.push({ name, value, callId })
        // This record is visible before the underlying callback returns, not just on exit.
        assert.ok(read().some(row => row.type === 'tool_start' && row.toolName === name && row.toolCallId === callId))
        if (name.endsWith('_admit')) return { ok: true, id: callId }
        if (name.endsWith('_receipt')) return { ok: true }
        if (name === '__web_search') return { sources: [{ url: 'https://example.com/museum?token=SENSITIVE_URL', title: 'Museum', snippet: 'SENSITIVE_SOURCE_BODY' }], truncated: false }
        if (name === '__record_web') return { evidenceRefs: [evidenceRef], urls: ['https://example.com/museum?token=SENSITIVE_URL'] }
        if (name === 'commit_travel_guide') return { ok: false, error: { code: 'DSH_GUIDE_NEEDS_REVISION',
          details: { issues: ['guide_day_count:SENSITIVE_DETAIL', { code: 'format', detail: 'SENSITIVE_DETAIL' }],
            repair: { issues: [{ code: 'source_missing', detail: 'SENSITIVE_DETAIL' }] } } } }
        throw Error('Unexpected fixture call')
      },
    }
    const result = await manager.run(input)
    assert.equal(result.reply, 'SENSITIVE_RAW_REPLY')
    assert.equal(result.reason, 'completed')
    assert.ok(activities.some(event => event.type === 'tool_start' && event.toolName === 'web_search'))
    assert.deepEqual(calls.find(call => call.name === 'commit_travel_guide').value, args)
    const records = read(), raw = JSON.stringify(records)
    assert.equal(raw.includes('SENSITIVE_'), false)
    assert.deepEqual(records.find(row => row.type === 'tool_start' && row.toolName === 'commit_travel_guide').commit,
      { baseGuideId: guideId, expectedContentHash: 'a'.repeat(64), replaceSlots: [{ day: 2, slot: 'afternoon' }] })
    assert.deepEqual(records.find(row => row.type === 'tool_end' && row.toolName === 'commit_travel_guide').revisionReasons,
      ['guide_day_count', 'format', 'source_missing'])
    const receipt = records.find(row => row.type === 'tool_end' && row.toolName === '__record_web')
    assert.deepEqual(receipt.evidenceRefs, [evidenceRef]); assert.deepEqual(receipt.urls, ['https://example.com/museum'])
    assert.ok(records.some(row => row.type === 'tool_start' && row.toolName === '__model_receipt' && typeof row.meter.usage.inputTokens === 'number'))
    assert.ok(records.some(row => row.type === 'activity' && row.toolName === 'web_search' && row.activity === 'tool_end'))
    assert.match(records.find(row => row.type === 'session_mapping').profile, /^[a-f0-9]{64}$/)
    assert.match(records.find(row => row.type === 'session_mapping').sessionId, /^[a-f0-9-]{36}$/)
    assert.equal(records.at(-1).type, 'execution_closed')
    assert.equal(observer.writeFailures, 0)
  } finally { await manager.close(); observer.uninstall(); fs.rmSync(root, { recursive: true, force: true }) }
})
