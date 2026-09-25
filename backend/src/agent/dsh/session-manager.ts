import { fork, type ChildProcess, type ForkOptions } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'

const MAX_BYTES = 1_000_000
const id = z.string().min(1).max(160)
const toolSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), description: z.string().max(10000), rawSchema: z.record(z.string(), z.unknown()) }).strict()
const routeSchema = z.object({ provider: z.enum(['openrouter', 'deepseek', 'fixture']), model: z.string().min(1), baseURL: z.url().optional(), maxTokens: z.number().int().min(256).max(16384).optional() }).strict()
const webSchema = z.object({ provider: z.enum(['serpapi-raw', 'deepseek-official']), baseURL: z.url().optional(), model: z.string().min(1).optional() }).strict()
const internalWebTools = ['__web_search', '__web_fetch', '__record_web'] as const
const internalMeterTools = ['__model_admit', '__model_receipt', '__search_admit', '__search_receipt'] as const
const billingId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/)
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const usageSchema = z.object({ inputTokens: tokenCount, outputTokens: tokenCount, totalTokens: tokenCount.optional(),
  cacheReadTokens: tokenCount.optional(), cacheWriteTokens: tokenCount.optional(), reasoningTokens: tokenCount.optional() }).strict()
const receiptBase = { id: billingId, durationMs: z.number().finite().nonnegative().max(3600000), failed: z.boolean() }
const modelReceipt = { finishReason: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  model: z.string().min(1).max(200).optional(), maxTokens: z.number().int().min(256).max(16384).optional(),
  thinking: z.literal('disabled').optional() }
const resultSchema = z.object({ reply: z.string().max(500000), reason: z.string().max(100), calls: z.number().int().min(0).max(13), cancelled: z.boolean() }).strict()
const activitySchema = z.union([
  z.object({ kind: z.literal('activity'), generation: id.optional(), type: z.enum(['model_start', 'model_end']), durationMs: z.number().nonnegative().optional() }).strict(),
  z.object({ kind: z.literal('activity'), generation: id.optional(), type: z.enum(['tool_start', 'tool_end']), toolName: toolSchema.shape.name, toolCallId: id }).strict()
])
const messageSchema = z.union([
  z.object({ kind: z.literal('tool'), id, generation: id, name: z.union([toolSchema.shape.name, z.enum(internalWebTools)]), args: z.unknown() }).strict(),
  z.object({ kind: z.literal('tool'), id, generation: id, name: z.literal('__model_admit'), args: z.object({ id: billingId }).strict() }).strict(),
  z.object({ kind: z.literal('tool'), id, generation: id, name: z.literal('__model_receipt'), args: z.object({ ...receiptBase, ...modelReceipt, usage: usageSchema.nullable() }).strict() }).strict(),
  z.object({ kind: z.literal('tool'), id, generation: id, name: z.literal('__search_admit'), args: z.object({}).strict() }).strict(),
  z.object({ kind: z.literal('tool'), id, generation: id, name: z.literal('__search_receipt'), args: z.object(receiptBase).strict() }).strict(),
  z.object({ kind: z.literal('result'), id, ok: z.boolean(), data: z.unknown().optional(), error: z.string().max(500).optional() }).strict(),
  activitySchema
])
const mapSchema = z.object({ version: z.literal(1), sessionId: z.string().uuid(), epochHash: z.string().length(64), profile: z.string().length(64) }).strict()
const lockSchema = z.object({ pid: z.number().int().positive(), token: z.string().uuid() }).strict()

export interface DshSessionManagerConfig {
  metered?: boolean
  root: string
  workerPath?: string
  route: z.infer<typeof routeSchema>
  modelKey?: string
  web?: z.infer<typeof webSchema>
  searchKey?: string
  maxActive?: number
  idleMs?: number
  fixture?: unknown[]
}
export interface DshSessionRun {
  ownerId: string
  tripId: string
  conversationId: string
  memoryEpoch: string
  generationId: string
  message: string
  snapshot: string
  persona: string
  tools: z.infer<typeof toolSchema>[]
  signal?: AbortSignal
  onAdmitted?: () => Promise<void>
  onActivity?: (activity: z.infer<typeof activitySchema>) => void
  execute: (name: string, args: unknown, callId: string, signal: AbortSignal) => Promise<unknown>
}
export type DshSessionResult = z.infer<typeof resultSchema> & { resumed: boolean; rehydrated?: boolean }
interface Pending { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface Active {
  input: DshSessionRun
  controller: AbortController
  tools: Map<string, { execution: Promise<unknown>; fingerprint: string }>
  retired: boolean
  cancel?: Promise<void>
}
interface Worker {
  child: ChildProcess
  exited: Promise<void>
  pending: Map<string, Pending>
  profile: string
  epochHash: string
  resumed: boolean
  active?: Active
  idleTimer?: ReturnType<typeof setTimeout>
  dead: boolean
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const failure = (code: string, message: string, status = 503) => new AppError(code, message, status)
const scopeKey = (input: DshSessionRun) => hash([input.ownerId, input.tripId, input.conversationId])

/** One host/one API instance owns this private persistence directory. */
export class DshSessionManager {
  private readonly root: string
  private readonly workers = new Map<string, Worker>()
  private readonly busy = new Set<string>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly lockToken = randomUUID()
  private ready?: Promise<void>
  private closed = false
  private serial = 0
  private opening = 0

  constructor(private readonly config: DshSessionManagerConfig) {
    this.root = resolve(config.root)
    routeSchema.parse(config.route)
    if (config.web) webSchema.parse(config.web)
    if (config.route.provider === 'fixture' && !config.fixture) throw failure('DSH_FIXTURE_DISABLED', 'Fixture script is required')
  }

  run(input: DshSessionRun): Promise<DshSessionResult> {
    const scope = scopeKey(input)
    if (this.closed) return Promise.reject(failure('DSH_MANAGER_CLOSED', 'DSH is shutting down'))
    if (this.busy.has(scope)) return Promise.reject(failure('DSH_SESSION_BUSY', 'This conversation already has an active turn', 409))
    // Held across opening, execution, cancellation and the drain of actual tool promises.
    this.busy.add(scope)
    const operation = this.execute(scope, input).finally(() => { this.busy.delete(scope); this.operations.delete(operation) })
    this.operations.add(operation)
    return operation
  }

  private async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await this.withDirectoryGuard(async () => {
      const lockPath = join(this.root, 'manager.lock')
      const acquire = async () => {
        const file = await open(lockPath, 'wx', 0o600)
        try { await file.writeFile(JSON.stringify({ pid: process.pid, token: this.lockToken })) } finally { await file.close() }
      }
      try { await acquire() } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        let old: z.infer<typeof lockSchema>
        try { old = lockSchema.parse(JSON.parse(await readFile(lockPath, 'utf8'))) }
        catch { throw failure('DSH_DIRECTORY_LOCKED', 'DSH directory has an unreadable lock; inspect it before reuse') }
        try { process.kill(old.pid, 0) }
        catch (probe) {
          if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw failure('DSH_DIRECTORY_LOCKED', 'DSH directory owner cannot be verified')
          // All cooperating acquisition/release paths hold the same exclusive guard.
          // The read/check/unlink sequence cannot delete a concurrent replacement.
          const current = lockSchema.parse(JSON.parse(await readFile(lockPath, 'utf8')))
          if (current.token !== old.token) throw failure('DSH_DIRECTORY_LOCKED', 'DSH directory owner changed')
          await unlink(lockPath)
          await acquire()
          return
        }
        throw failure('DSH_DIRECTORY_LOCKED', 'DSH directory is already owned by a live API process')
      }
    })
  }

  private async withDirectoryGuard<T>(operation: () => Promise<T>): Promise<T> {
    const path = join(this.root, 'manager.lock.guard')
    let guard
    try { guard = await open(path, 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      throw failure('DSH_DIRECTORY_LOCKED', 'DSH directory lock is being changed; an orphaned guard requires inspection')
    }
    try {
      await guard.writeFile(JSON.stringify({ pid: process.pid, token: this.lockToken }))
      await guard.sync()
      return await operation()
    } finally {
      await guard.close()
      // Guards are never automatically reclaimed: a crash fails closed rather
      // than creating another recursive stale-lock deletion race.
      const current = lockSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (current.token === this.lockToken) await unlink(path)
    }
  }

  private async execute(scope: string, input: DshSessionRun): Promise<DshSessionResult> {
    id.parse(input.generationId)
    z.string().min(1).max(2000).parse(input.message)
    z.string().max(100000).parse(input.snapshot)
    z.string().max(50000).parse(input.persona)
    z.array(toolSchema).max(32).parse(input.tools)
    if (new Set(input.tools.map(tool => tool.name)).size !== input.tools.length) throw failure('DSH_DUPLICATE_TOOL', 'DSH tools must be unique', 500)
    input.signal?.throwIfAborted()
    await (this.ready ??= this.initialize())
    if (this.closed) throw failure('DSH_MANAGER_CLOSED', 'DSH is shutting down')
    const profile = hash(['flightor-dsh-v2-thinking-off', this.config.route, this.config.web, this.config.metered === true, input.persona, input.tools])
    const epochHash = hash(input.memoryEpoch)
    let worker = this.workers.get(scope)
    if (worker && (worker.dead || worker.profile !== profile || worker.epochHash !== epochHash)) {
      await this.dispose(worker)
      this.workers.delete(scope)
      worker = undefined
    }
    if (!worker) {
      const limit = Math.max(1, this.config.maxActive ?? 8)
      let evicted: Worker | undefined
      if (this.workers.size + this.opening >= limit) {
        const idle = [...this.workers].find(([key, candidate]) => !this.busy.has(key) && !candidate.active)
        if (!idle) throw failure('DSH_CAPACITY', 'DSH workers are busy; retry later')
        this.workers.delete(idle[0]); evicted = idle[1]
      }
      this.opening += 1
      try {
        if (evicted) await this.dispose(evicted)
        worker = await this.start(scope, input, profile, epochHash)
      } finally { this.opening -= 1 }
      this.workers.set(scope, worker)
    }
    if (this.closed) { await this.dispose(worker); throw failure('DSH_MANAGER_CLOSED', 'DSH is shutting down') }
    if (worker.idleTimer) clearTimeout(worker.idleTimer)
    input.signal?.throwIfAborted()
    const active: Active = { input, controller: new AbortController(), tools: new Map(), retired: false }
    worker.active = active
    const current = worker
    const abort = () => { void this.cancel(current, active) }
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) abort()
    try {
      if (active.retired) return { reply: '', reason: 'cancelled', calls: 0, cancelled: true, resumed: worker.resumed }
      await input.onAdmitted?.()
      if (active.retired) return { reply: '', reason: 'cancelled', calls: 0, cancelled: true, resumed: worker.resumed }
      const result = resultSchema.parse(await this.request(worker, 'turn', { generation: input.generationId, message: input.message, snapshot: input.snapshot }, 305000))
      if (active.retired) return { ...result, reply: '', reason: 'cancelled', cancelled: true, resumed: worker.resumed }
      return { ...result, resumed: worker.resumed }
    } catch (error) {
      if (active.retired) return { reply: '', reason: 'cancelled', calls: 0, cancelled: true, resumed: worker.resumed }
      throw error
    } finally {
      active.retired = true
      active.controller.abort()
      if (active.cancel) await active.cancel
      // No timeout races this drain. Cancellation acknowledgement must not outlive writes.
      await Promise.allSettled([...active.tools.values()].map(tool => tool.execution))
      input.signal?.removeEventListener('abort', abort)
      delete worker.active
      if (!worker.dead && !this.closed) {
        worker.idleTimer = setTimeout(() => {
          if (!this.busy.has(scope) && this.workers.get(scope) === worker) {
            this.workers.delete(scope)
            void this.dispose(worker!)
          }
        }, Math.max(1, this.config.idleMs ?? 60000))
        worker.idleTimer.unref()
      }
    }
  }

  private async start(scope: string, input: DshSessionRun, profile: string, epochHash: string): Promise<Worker> {
    const path = join(this.root, `${scope}.json`)
    let previous: z.infer<typeof mapSchema> | undefined
    try { previous = mapSchema.parse(JSON.parse(await readFile(path, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw failure('DSH_SESSION_MAPPING_INVALID', 'DSH session mapping is unreadable') }
    const resumed = previous?.profile === profile && previous.epochHash === epochHash
    const sessionId = resumed ? previous!.sessionId : randomUUID()
    const env: NodeJS.ProcessEnv = {}
    // Node is launched by absolute execPath; no inherited PATH, HOME, profile or credential bag.
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
    if (this.config.modelKey) env.FLIGHTOR_DSH_MODEL_KEY = this.config.modelKey
    if (this.config.searchKey) env.FLIGHTOR_DSH_SEARCH_KEY = this.config.searchKey
    if (this.config.route.provider === 'fixture') env.FLIGHTOR_DSH_TEST = '1'
    const workerPath = this.config.workerPath ?? fileURLToPath(new URL('../../../dsh-runtime/worker.mjs', import.meta.url))
    const options: ForkOptions & { windowsHide: boolean } = { cwd: dirname(workerPath), env, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
    const child = fork(workerPath, [], options)
    const exited = new Promise<void>(resolveExit => child.once('close', () => resolveExit()))
    const worker: Worker = { child, exited, pending: new Map(), profile, epochHash, resumed, dead: false }
    child.on('message', raw => { this.message(worker, raw) })
    child.on('error', () => { this.retire(worker, failure('DSH_WORKER_FAILURE', 'DSH worker failed')) })
    child.on('exit', () => { this.retire(worker, failure('DSH_WORKER_EXITED', 'DSH worker exited')) })
    try {
      const opened = await this.request(worker, 'open', { root: join(this.root, 'sessions'), sessionId, resume: resumed,
        persona: input.persona, tools: input.tools, route: this.config.route,
        ...(this.config.web ? { web: this.config.web } : {}),
        ...(this.config.metered ? { metered: true } : {}),
        ...(this.config.fixture ? { fixture: this.config.fixture } : {}) }, 30000)
      const receipt = z.object({ profile: z.literal('flightor-dsh-v1'), plugins: z.array(z.string()), tools: z.array(z.string()), sessionId: id, resumed: z.boolean() }).strict().parse(opened)
      if (receipt.sessionId !== sessionId || receipt.resumed !== resumed || JSON.stringify([...receipt.tools].sort()) !== JSON.stringify(input.tools.map(tool => tool.name).sort())) {
        throw failure('DSH_PROFILE_MISMATCH', 'DSH worker did not load the configured tool profile')
      }
      const temporary = `${path}.${randomUUID()}.tmp`
      await open(temporary, 'wx', 0o600).then(async file => { try { await file.writeFile(JSON.stringify({ version: 1, sessionId, epochHash, profile })) } finally { await file.close() } })
      await rename(temporary, path)
      return worker
    } catch (error) { this.retire(worker, failure('DSH_WORKER_OPEN_FAILED', 'DSH session could not be opened')); await worker.exited; throw error }
  }

  private message(worker: Worker, raw: unknown) {
    if (worker.dead) return
    let message: z.infer<typeof messageSchema>
    try {
      if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BYTES) throw Error('size')
      message = messageSchema.parse(raw)
    } catch { this.retire(worker, failure('DSH_IPC_INVALID', 'DSH worker sent an invalid message')); return }
    if (message.kind === 'result') {
      const pending = worker.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer); worker.pending.delete(message.id)
      message.ok ? pending.resolve(message.data) : pending.reject(failure('DSH_WORKER_REQUEST_FAILED', 'DSH worker request failed'))
      return
    }
    const active = worker.active
    if (!active || active.retired || message.generation !== active.input.generationId) return
    if (message.kind === 'activity') { try { active.input.onActivity?.(message) } catch { /* observation is best effort */ }; return }
    const tool = message
    const fingerprint = hash([tool.name, tool.args])
    const cached = active.tools.get(tool.id)
    const reply = (data: unknown) => {
      if (!active.retired && worker.active === active && !worker.dead) this.send(worker, { id: tool.id, op: 'tool_result', data })
    }
    if (cached) {
      if (cached.fingerprint !== fingerprint) { this.retire(worker, failure('DSH_IPC_ID_CONFLICT', 'DSH tool ID was reused with different arguments')); return }
      void cached.execution.then(reply) // Retry receives the same result, including while the first execution is pending.
      return
    }
    const execution = Promise.resolve().then(async () => {
      if (active.retired || worker.dead) return { error: 'DSH_GENERATION_RETIRED' }
      const internalWeb = this.config.web && (internalWebTools as readonly string[]).includes(tool.name)
      const internalMeter = this.config.metered && (internalMeterTools as readonly string[]).includes(tool.name)
      if (!internalWeb && !internalMeter && !active.input.tools.some(candidate => candidate.name === tool.name)) return { error: 'DSH_TOOL_NOT_ALLOWED' }
      return structuredClone(await active.input.execute(tool.name, tool.args, tool.id, active.controller.signal))
    }).catch(() => ({ error: 'DSH_TOOL_EXECUTION_FAILED' }))
    active.tools.set(message.id, { execution, fingerprint })
    void execution.then(reply)
  }

  private send(worker: Worker, message: unknown) {
    try {
      if (Buffer.byteLength(JSON.stringify(message)) > MAX_BYTES) throw Error('size')
      if (!worker.child.connected) throw Error('closed')
      worker.child.send(message as object, error => { if (error) this.retire(worker, failure('DSH_IPC_SEND_FAILED', 'DSH worker connection failed')) })
    } catch { this.retire(worker, failure('DSH_IPC_SEND_FAILED', 'DSH worker connection failed')) }
  }

  private request(worker: Worker, op: string, data: unknown, timeoutMs: number): Promise<unknown> {
    if (worker.dead) return Promise.reject(failure('DSH_WORKER_EXITED', 'DSH worker exited'))
    const requestId = `${process.pid}:${++this.serial}`
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { this.retire(worker, failure('DSH_WORKER_TIMEOUT', 'DSH worker timed out')) }, timeoutMs)
      worker.pending.set(requestId, { resolve: resolveRequest, reject, timer })
      this.send(worker, { id: requestId, op, data })
    })
  }

  private cancel(worker: Worker, active: Active): Promise<void> {
    if (active.cancel) return active.cancel
    active.retired = true // Fence all late IPC before asking the worker to stop.
    active.controller.abort()
    active.cancel = this.request(worker, 'cancel', { generation: active.input.generationId }, 2000).then(() => {}, () => {})
    return active.cancel
  }

  private retire(worker: Worker, error: Error) {
    if (worker.dead) return
    worker.dead = true
    worker.active?.controller.abort()
    if (worker.idleTimer) clearTimeout(worker.idleTimer)
    for (const pending of worker.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    worker.pending.clear()
    worker.child.kill()
  }

  private async dispose(worker: Worker) {
    if (worker.idleTimer) clearTimeout(worker.idleTimer)
    if (worker.active) await this.cancel(worker, worker.active)
    try { if (!worker.dead) await this.request(worker, 'close', {}, 2000) } catch { /* bounded disposal */ }
    this.retire(worker, failure('DSH_WORKER_CLOSED', 'DSH worker closed'))
    // Do not release session-directory ownership while the child can still hold/write files.
    await worker.exited
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.workers.values()].map(worker => this.dispose(worker)))
    await Promise.allSettled([...this.operations])
    this.workers.clear()
    if (this.ready) {
      try {
        await this.ready
        await this.withDirectoryGuard(async () => {
          const path = join(this.root, 'manager.lock')
          const value = lockSchema.parse(JSON.parse(await readFile(path, 'utf8')))
          if (value.token === this.lockToken) await unlink(path)
        })
      } catch { /* A failed acquisition must never remove another owner's lock. */ }
    }
  }
}
