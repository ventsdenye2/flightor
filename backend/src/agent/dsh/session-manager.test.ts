import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
    await writeFile(workerPath, `let turn; process.on('message', m => {
      if(m.op==='open') process.send({kind:'result',id:m.id,ok:true,data:{profile:'flightor-dsh-v1',plugins:[],tools:m.data.tools.map(t=>t.name),sessionId:m.data.sessionId,resumed:m.data.resume}});
      if(m.op==='turn'){turn=m; process.send({kind:'tool',id:'old',generation:'old-generation',name:'read_trip',args:{}}); const tool={kind:'tool',id:'call-1',generation:m.data.generation,name:'read_trip',args:{}}; process.send(tool);process.send(tool);}
      if(m.op==='tool_result')process.send({kind:'result',id:turn.id,ok:true,data:{reply:'ok',reason:'stop',calls:1,cancelled:false}});
      if(m.op==='close'){process.send({kind:'result',id:m.id,ok:true,data:{closed:true}});process.disconnect();}
    }); process.on('disconnect',()=>process.exit(0));`)
    const separate = new DshSessionManager({ root, workerPath, route: { provider: 'fixture', model: 'fixture' }, fixture: [] }); managers.push(separate)
    const execute = vi.fn(async () => ({ city: 'Tokyo' }))
    expect(await separate.run(input({ execute, tools: [{ name: 'read_trip', description: 'Read', rawSchema: { type: 'object', properties: {} } }] }))).toMatchObject({ reply: 'ok' })
    expect(execute).toHaveBeenCalledTimes(1)
  }, 30000)
})
