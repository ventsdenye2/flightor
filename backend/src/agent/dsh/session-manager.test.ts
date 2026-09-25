import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshSessionManager, type DshSessionRun } from './session-manager.js'

const roots: string[] = [], managers: DshSessionManager[] = []
async function setup(fixture: unknown[], extra: Partial<ConstructorParameters<typeof DshSessionManager>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-manager-')); roots.push(root)
  const manager = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture, ...extra }); managers.push(manager)
  return { root, manager }
}
function input(overrides: Partial<DshSessionRun> = {}): DshSessionRun {
  return { ownerId: 'owner-a', tripId: 'trip-a', conversationId: 'conversation-a', memoryEpoch: 'enabled:1', generationId: 'generation-1',
    message: 'Explain this trip', snapshot: 'Current trip is Tokyo', persona: 'Travel planner', tools: [], execute: vi.fn(), ...overrides }
}
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map(manager => manager.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH session manager with actual official worker', () => {
  it('counts only admitted model dispatches when a turn or budget limit stops the real loop', async () => {
    const { manager } = await setup(Array.from({ length: 13 }, () => ({ tool: 'read_trip' })), { metered: true })
    const execute = vi.fn(async (name: string) => name === '__model_admit' || name === '__model_receipt' ? { ok: true } : { city: 'Tokyo' })
    const tools = [{ name: 'read_trip', description: 'Read trip', rawSchema: { type: 'object', properties: {}, additionalProperties: false } }]
    expect(await manager.run(input({ execute, tools }))).toMatchObject({ calls: 12, reason: 'error' })
    expect(execute.mock.calls.filter(([name]) => name === '__model_admit')).toHaveLength(12)
    expect(execute.mock.calls.filter(([name]) => name === '__model_receipt')).toHaveLength(12)
    expect(execute.mock.calls.filter(([name]) => name === 'read_trip')).toHaveLength(12)
    const denied = await setup([{ text: 'Must never dispatch' }], { metered: true })
    const rejectAdmission = vi.fn(async () => ({ ok: false }))
    expect(await denied.manager.run(input({ execute: rejectAdmission }))).toMatchObject({ calls: 0, reason: 'error', reply: '' })
    expect(rejectAdmission).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('passes metered model/search admission and receipts through the actual worker without exposing internal tools', async () => {
    const { manager } = await setup([{ tool: 'web_search', args: { queries: ['Tokyo museum'] } }, { text: 'Source result' }],
      { metered: true, web: { provider: 'serpapi-raw' } })
    const execute = vi.fn(async (name: string, _args: unknown, callId: string) => {
      if (name.endsWith('_admit')) return { ok: true, id: callId }
      if (name.endsWith('_receipt')) return { ok: true }
      if (name === '__web_search') return { sources: [{ url: 'https://example.com/museum', title: 'Museum', snippet: 'Cultural exhibits.' }], truncated: false }
      if (name === '__record_web') return { evidenceRefs: ['evidence-1'], urls: [] }
      throw Error('Unexpected tool')
    })
    const activity = vi.fn()
    const tools = ['web_search', 'web_fetch'].map(name => ({ name, description: 'Read source', rawSchema: { type: 'object', properties: {} } }))
    expect(await manager.run(input({ execute, tools, onActivity: activity }))).toMatchObject({ reply: 'Source result', cancelled: false, calls: 2 })
    const names = execute.mock.calls.map(call => call[0])
    expect(names.filter(name => name === '__model_admit')).toHaveLength(2)
    expect(names.filter(name => name === '__model_receipt')).toHaveLength(2)
    expect(names.filter(name => name === '__search_admit')).toHaveLength(1)
    expect(names.filter(name => name === '__search_receipt')).toHaveLength(1)
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_start', toolName: 'web_search' }))
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_end', toolName: 'web_search' }))
  }, 30000)

  it('retires a persistent session when metering policy changes', async () => {
    const { root, manager } = await setup([{ text: 'Unmetered fixture' }])
    await manager.run(input()); await manager.close()
    const mapping = (await readdir(root)).find(file => /^[0-9a-f]{64}\.json$/.test(file))!
    const previous = JSON.parse(await readFile(join(root, mapping), 'utf8'))
    const next = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [{ text: 'Metered fixture' }], metered: true }); managers.push(next)
    expect(await next.run(input({ execute: async () => ({ ok: true }) }))).toMatchObject({ reply: 'Metered fixture', resumed: false })
    const current = JSON.parse(await readFile(join(root, mapping), 'utf8'))
    expect(current.sessionId).not.toBe(previous.sessionId)
    expect(current.profile).not.toBe(previous.profile)
  }, 30000)

  it('serializes stale-lock reclamation so concurrent starters cannot remove the winning lock', async () => {
    const { root, manager } = await setup([{ text: 'Winner' }])
    const departed = spawnSync(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' })
    expect(departed.status).toBe(0)
    const old = { pid: departed.pid, token: randomUUID() }
    await writeFile(join(root, 'manager.lock'), JSON.stringify(old))
    const other = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [{ text: 'Other winner' }] }); managers.push(other)
    const results = await Promise.allSettled([manager.run(input()), other.run(input())])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const held = JSON.parse(await readFile(join(root, 'manager.lock'), 'utf8'))
    expect(held.pid).toBe(process.pid); expect(held.token).not.toBe(old.token)
    const loser = results[0]!.status === 'rejected' ? manager : other
    await loser.close()
    expect(JSON.parse(await readFile(join(root, 'manager.lock'), 'utf8'))).toEqual(held)
  }, 30000)

  it('fails closed on an orphaned acquisition guard without deleting either file', async () => {
    const { root, manager } = await setup([{ text: 'Must not run' }])
    const guard = JSON.stringify({ pid: 2147483647, token: randomUUID() })
    await writeFile(join(root, 'manager.lock.guard'), guard)
    await expect(manager.run(input())).rejects.toMatchObject({ code: 'DSH_DIRECTORY_LOCKED' })
    expect(await readFile(join(root, 'manager.lock.guard'), 'utf8')).toBe(guard)
  })

  it.each([
    ['__model_admit', { id: 'model-1', extra: true }],
    ['__model_receipt', { id: 'model-1', durationMs: 2, failed: false, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: -1 } }],
    ['__search_admit', { url: 'https://example.com' }],
    ['__search_receipt', { id: 'search-1', durationMs: -1, failed: false }]
  ])('rejects malformed %s IPC before calling the meter', async (name, args) => {
    const { root, manager } = await setup([]); await manager.close()
    const workerPath = join(root, 'invalid-meter-worker.mjs')
    await writeFile(workerPath, `process.on('message',m=>{
      if(m.op==='open')process.send({kind:'result',id:m.id,ok:true,data:{profile:'flightor-dsh-v1',plugins:[],tools:[],sessionId:m.data.sessionId,resumed:m.data.resume}});
      if(m.op==='turn')process.send({kind:'tool',id:'bad-meter',generation:m.data.generation,name:${JSON.stringify(name)},args:${JSON.stringify(args)}});
    });process.on('disconnect',()=>process.exit(0));`)
    const malformed = new DshSessionManager({ root, workerPath, route: { provider: 'fixture', model: 'fixture' }, fixture: [], metered: true }); managers.push(malformed)
    const execute = vi.fn()
    await expect(malformed.run(input({ execute }))).rejects.toMatchObject({ code: 'DSH_IPC_INVALID' })
    expect(execute).not.toHaveBeenCalled()
  }, 30000)
  it('runs a followup in one worker, then cold resumes the durable session', async () => {
    const { root, manager } = await setup([{ text: 'First answer' }, { text: 'Followup answer' }])
    const admitted = vi.fn().mockResolvedValue(undefined)
    expect(await manager.run(input({ onAdmitted: admitted }))).toMatchObject({ reply: 'First answer', calls: 1, cancelled: false, resumed: false })
    expect(await manager.run(input({ generationId: 'generation-2', message: 'Explain further', onAdmitted: admitted }))).toMatchObject({ reply: 'Followup answer', calls: 1 })
    expect(admitted).toHaveBeenCalledTimes(2)
    const mapping = (await readdir(root)).find(file => /^[0-9a-f]{64}\.json$/.test(file))!
    const before = JSON.parse(await readFile(join(root, mapping), 'utf8'))
    await manager.close()
    const restored = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [{ text: 'Restored answer' }] }); managers.push(restored)
    expect(await restored.run(input({ generationId: 'generation-3' }))).toMatchObject({ reply: 'Restored answer', resumed: true })
    expect(JSON.parse(await readFile(join(root, mapping), 'utf8')).sessionId).toBe(before.sessionId)
  }, 30000)

  it('retires history when the Memory epoch changes and isolates owner scopes', async () => {
    const { root, manager } = await setup([{ text: 'Fresh context' }, { text: 'Old context' }])
    await manager.run(input())
    const mapping = (await readdir(root)).find(file => file.endsWith('.json'))!
    const before = JSON.parse(await readFile(join(root, mapping), 'utf8')).sessionId
    expect(await manager.run(input({ memoryEpoch: 'disabled:2', generationId: 'generation-2' }))).toMatchObject({ reply: 'Fresh context', resumed: false })
    expect(JSON.parse(await readFile(join(root, mapping), 'utf8')).sessionId).not.toBe(before)
    expect(await manager.run(input({ ownerId: 'owner-b' }))).toMatchObject({ reply: 'Fresh context', resumed: false })
    expect((await readdir(root)).filter(file => file.endsWith('.json'))).toHaveLength(2)
  }, 30000)

  it('rejects concurrent same-scope turns and drains an actual in-flight domain promise before acknowledging cancellation', async () => {
    const { manager } = await setup([{ tool: 'save_note' }, { text: 'Saved' }])
    let begun!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { begun = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const controller = new AbortController(), admitted = vi.fn().mockResolvedValue(undefined)
    let domainSignal: AbortSignal | undefined, settled = false
    const execute = vi.fn(async (_name, _args, _callId, signal: AbortSignal) => { domainSignal = signal; begun(); await gate; return { saved: false } })
    const running = manager.run(input({ signal: controller.signal, onAdmitted: admitted, execute,
      tools: [{ name: 'save_note', description: 'Save explicit note', rawSchema: { type: 'object', properties: {} } }] })).then(result => { settled = true; return result })
    await started
    await expect(manager.run(input({ generationId: 'competing', onAdmitted: admitted }))).rejects.toMatchObject({ code: 'DSH_SESSION_BUSY' })
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(domainSignal?.aborted).toBe(true)
    expect(settled).toBe(false)
    release()
    expect(await running).toMatchObject({ cancelled: true, reply: '' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(admitted).toHaveBeenCalledTimes(1)
  }, 30000)

  it('holds the persistence directory exclusively and does not run a second instance', async () => {
    const { root, manager } = await setup([{ text: 'First instance' }])
    await manager.run(input())
    const other = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, fixture: [{ text: 'Other instance' }] }); managers.push(other)
    await expect(other.run(input())).rejects.toMatchObject({ code: 'DSH_DIRECTORY_LOCKED' })
    await other.close()
    expect(JSON.parse(await readFile(join(root, 'manager.lock'), 'utf8')).pid).toBe(process.pid)
  }, 30000)

  it('enforces worker capacity while another scope is opening or active', async () => {
    const { manager } = await setup([{ hang: true }], { maxActive: 1 })
    let begun!: () => void
    const started = new Promise<void>(resolve => { begun = resolve }), controller = new AbortController()
    const first = manager.run(input({ signal: controller.signal, onActivity: value => { if (value.type === 'model_start') begun() } }))
    await started
    await expect(manager.run(input({ ownerId: 'other-owner' }))).rejects.toMatchObject({ code: 'DSH_CAPACITY' })
    controller.abort(); expect(await first).toMatchObject({ cancelled: true })
  }, 30000)

  it('ignores old-generation IPC and deduplicates repeated tool call IDs', async () => {
    const { root, manager } = await setup([{ text: 'unused' }])
    await manager.close()
    const workerPath = join(root, 'duplicate-worker.mjs')
    await writeFile(workerPath, `let turn, tool, receipts=[]; process.on('message', m => {
      if(m.op==='open') process.send({kind:'result',id:m.id,ok:true,data:{profile:'flightor-dsh-v1',plugins:[],tools:m.data.tools.map(t=>t.name),sessionId:m.data.sessionId,resumed:m.data.resume}});
      if(m.op==='turn'){turn=m; process.send({kind:'tool',id:'old',generation:'old-generation',name:'read_trip',args:{}}); tool={kind:'tool',id:'call-1',generation:m.data.generation,name:'read_trip',args:{}}; process.send(tool);process.send(tool);}
      if(m.op==='tool_result'){receipts.push(m.data); if(receipts.length===2)process.send(tool); if(receipts.length===3)process.send({kind:'result',id:turn.id,ok:true,data:{reply:JSON.stringify(receipts),reason:'stop',calls:1,cancelled:false}});}
      if(m.op==='close'){process.send({kind:'result',id:m.id,ok:true,data:{closed:true}});process.disconnect();}
    }); process.on('disconnect',()=>process.exit(0));`)
    const separate = new DshSessionManager({ root, workerPath, route: { provider: 'fixture', model: 'fixture' }, fixture: [] }); managers.push(separate)
    const execute = vi.fn(async () => ({ city: 'Tokyo' }))
    const result = await separate.run(input({ execute, tools: [{ name: 'read_trip', description: 'Read', rawSchema: { type: 'object', properties: {} } }] }))
    expect(JSON.parse(result.reply)).toEqual([{ city: 'Tokyo' }, { city: 'Tokyo' }, { city: 'Tokyo' }])
    expect(execute).toHaveBeenCalledTimes(1)
  }, 30000)

  it('kills only an unresponsive cancelled worker and still waits for the parent tool to drain', async () => {
    const { root, manager } = await setup([{ text: 'unused' }])
    await manager.close()
    const workerPath = join(root, 'unresponsive-worker.mjs')
    await writeFile(workerPath, `process.on('message',m=>{
      if(m.op==='open')process.send({kind:'result',id:m.id,ok:true,data:{profile:'flightor-dsh-v1',plugins:[],tools:m.data.tools.map(t=>t.name),sessionId:m.data.sessionId,resumed:m.data.resume}});
      if(m.op==='turn')process.send({kind:'tool',id:'in-flight',generation:m.data.generation,name:'save_note',args:{keys:Object.keys(process.env)}});
    });process.on('disconnect',()=>process.exit(0));`)
    const separate = new DshSessionManager({ root, workerPath, route: { provider: 'fixture', model: 'fixture' }, fixture: [],
      modelKey: 'private-fixture-key' }); managers.push(separate)
    let begun!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { begun = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    const controller = new AbortController()
    let settled = false, keys: string[] = []
    const execute = vi.fn(async (_name, args: { keys: string[] }) => { keys = args.keys; begun(); await gate; return {} })
    const running = separate.run(input({ execute, signal: controller.signal,
      tools: [{ name: 'save_note', description: 'Save', rawSchema: { type: 'object', properties: {} } }] })).then(result => { settled = true; return result })
    await started
    expect(keys).toContain('FLIGHTOR_DSH_MODEL_KEY')
    expect(keys).not.toContain('OPENROUTER_API_KEY')
    expect(keys).not.toContain('HOME')
    expect(keys).not.toContain('CODEX_HOME')
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 2200))
    expect(settled).toBe(false)
    release()
    expect(await running).toMatchObject({ cancelled: true })
    expect(execute).toHaveBeenCalledTimes(1)
  }, 30000)
})
