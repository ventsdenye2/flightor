import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hostname } from 'node:os'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'

export const DSH_OFFICIAL_SEARCH_PROVIDER = 'deepseek-official'
const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/)
const providerSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const usageSchema = z.object({ promptTokens: micros.optional(), completionTokens: micros.optional(), totalTokens: micros.optional() }).strict()
const receiptSchema = z.object({ durationMs: z.number().finite().nonnegative(), usage: usageSchema.optional(),
  actualCostUsdMicros: micros.optional(), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional() }).strict()
const authorizationSchema = z.object({ authorizedUsdMicros: micros, maxModelCalls: micros, maxSearchCalls: micros,
  modelReserveUsdMicros: micros.positive(), searchReserveUsdMicros: micros.positive() }).strict()
const entrySchema = z.object({ id: identifier, kind: z.enum(['model', 'search']), provider: providerSchema,
  admittedAt: z.iso.datetime(), reservedUsdMicros: micros.positive(), receipt: receiptSchema.optional(), settledAt: z.iso.datetime().optional() }).strict()
const ledgerSchema = z.object({ version: z.literal(1), batchId: z.string().uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  authorization: authorizationSchema, entries: z.array(entrySchema).max(100_000) }).strict()
const lockSchema = z.object({ version: z.literal(1), token: z.string().uuid(), pid: z.number().int().positive(),
  host: z.string().min(1).max(253), createdAt: z.iso.datetime() }).strict()
type Ledger = z.infer<typeof ledgerSchema>
export type DshBudgetEntry = z.infer<typeof entrySchema>
export interface DshBudgetOptions {
  path: string; authorizedUsd: number; maxModelCalls: number; maxSearchCalls: number
  modelReserveUsd?: number; searchReserveUsd?: number
}
export interface DshBudgetReceipt {
  durationMs: number
  usage?: { promptTokens?: number | undefined; completionTokens?: number | undefined; totalTokens?: number | undefined }
  /** Only a real monetary receipt; token usage or rate estimates must not populate this. */
  actualCostUsd?: number
  errorCode?: string
}
export interface DshBudgetSnapshot {
  version: 1; batchId: string; createdAt: string; updatedAt: string
  authorization: Ledger['authorization']; entries: DshBudgetEntry[]
  modelCalls: number; searchCalls: number; knownCostUsdMicros: number; unknownReservedUsdMicros: number
  consumedUsdMicros: number; remainingUsdMicros: number; unknownCostCalls: number; pendingCalls: number; overBudget: boolean
}

function error(code: string, message: string): never { throw new AppError(code, message, 409) }
function usdMicros(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) error('DSH_BUDGET_INVALID_CONFIGURATION', 'Budget amount must be finite nonnegative USD within the supported range')
  // Round upward so fractional microdollar estimates never reduce reservations.
  return Math.ceil(Number((value * 1_000_000).toPrecision(15)))
}
function isMissing(value: unknown): boolean { return (value as NodeJS.ErrnoException)?.code === 'ENOENT' }
function callCounts(kind: DshBudgetEntry['kind'], provider: string) {
  return { model: Number(kind === 'model' || provider === DSH_OFFICIAL_SEARCH_PROVIDER), search: Number(kind === 'search') }
}
function reservation(authorization: Ledger['authorization'], kind: DshBudgetEntry['kind'], provider: string) {
  const counts = callCounts(kind, provider)
  return counts.model * authorization.modelReserveUsdMicros + counts.search * authorization.searchReserveUsdMicros
}
function snapshot(ledger: Ledger): DshBudgetSnapshot {
  let modelCalls = 0, searchCalls = 0, knownCostUsdMicros = 0, unknownReservedUsdMicros = 0, unknownCostCalls = 0, pendingCalls = 0
  for (const entry of ledger.entries) {
    const counts = callCounts(entry.kind, entry.provider)
    modelCalls += counts.model; searchCalls += counts.search
    if (entry.receipt?.actualCostUsdMicros !== undefined) knownCostUsdMicros += entry.receipt.actualCostUsdMicros
    else { unknownReservedUsdMicros += entry.reservedUsdMicros; unknownCostCalls++ }
    if (!entry.receipt) pendingCalls++
  }
  const consumedUsdMicros = knownCostUsdMicros + unknownReservedUsdMicros
  if (!Number.isSafeInteger(consumedUsdMicros)) error('DSH_BUDGET_CORRUPT', 'Budget totals exceed the supported integer range')
  return { ...structuredClone(ledger), modelCalls, searchCalls, knownCostUsdMicros, unknownReservedUsdMicros, consumedUsdMicros,
    remainingUsdMicros: Math.max(0, ledger.authorization.authorizedUsdMicros - consumedUsdMicros), unknownCostCalls, pendingCalls,
    overBudget: consumedUsdMicros > ledger.authorization.authorizedUsdMicros }
}

/** Local-host file ledger. No network calls, credentials, prompts or provider response bodies are accepted. */
export class FileDshBudget {
  readonly path: string
  private readonly authorization: Ledger['authorization']
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: DshBudgetOptions) {
    this.path = resolve(options.path)
    const parsed = authorizationSchema.safeParse({ authorizedUsdMicros: usdMicros(options.authorizedUsd),
      maxModelCalls: options.maxModelCalls, maxSearchCalls: options.maxSearchCalls,
      modelReserveUsdMicros: usdMicros(options.modelReserveUsd ?? 0.04), searchReserveUsdMicros: usdMicros(options.searchReserveUsd ?? 0.08) })
    if (!parsed.success || options.maxModelCalls + options.maxSearchCalls > 100_000) error('DSH_BUDGET_INVALID_CONFIGURATION', 'Budget call limits and reservations are invalid')
    this.authorization = parsed.data
  }

  /** Must resolve before making an external request. Replays return the already-durable admission. */
  admit(kind: 'model' | 'search', id: string, provider: string): Promise<DshBudgetEntry> {
    return this.transaction(async ledger => {
      if (!z.enum(['model', 'search']).safeParse(kind).success || !identifier.safeParse(id).success || !providerSchema.safeParse(provider).success) {
        error('DSH_BUDGET_INVALID_ADMISSION', 'Admission requires bounded opaque identifiers and a declared route')
      }
      const previous = ledger.entries.find(entry => entry.id === id)
      if (previous) {
        if (previous.kind !== kind || previous.provider !== provider) error('DSH_BUDGET_ID_CONFLICT', 'Admission identity was reused for a different request route')
        return { value: structuredClone(previous), changed: false }
      }
      const current = snapshot(ledger), counts = callCounts(kind, provider)
      const reservedUsdMicros = reservation(ledger.authorization, kind, provider)
      if (current.modelCalls >= ledger.authorization.maxModelCalls
        || ledger.authorization.maxSearchCalls > 0 && current.searchCalls >= ledger.authorization.maxSearchCalls
        || current.modelCalls + counts.model > ledger.authorization.maxModelCalls || current.searchCalls + counts.search > ledger.authorization.maxSearchCalls) {
        error('DSH_BUDGET_CALL_LIMIT', 'The authorized model or search call limit would be exceeded')
      }
      if (current.consumedUsdMicros + reservedUsdMicros > ledger.authorization.authorizedUsdMicros) {
        error('DSH_BUDGET_AMOUNT_LIMIT', 'The authorized monetary budget cannot cover this request reservation')
      }
      const entry: DshBudgetEntry = { id, kind, provider, reservedUsdMicros, admittedAt: new Date().toISOString() }
      ledger.entries.push(entry)
      return { value: structuredClone(entry), changed: true }
    })
  }

  /** Failed/unknown charges retain their reservation and call counts. Conflicting receipts cannot rewrite history. */
  settle(id: string, value: DshBudgetReceipt): Promise<DshBudgetEntry> {
    return this.transaction(async ledger => {
      const { actualCostUsd, ...rest } = value
      const parsed = receiptSchema.safeParse({ ...rest, ...(actualCostUsd === undefined ? {} : { actualCostUsdMicros: usdMicros(actualCostUsd) }) })
      if (!identifier.safeParse(id).success || !parsed.success) error('DSH_BUDGET_INVALID_RECEIPT', 'Only bounded duration, token counts, monetary receipts and error codes may be recorded')
      const entry = ledger.entries.find(item => item.id === id)
      if (!entry) error('DSH_BUDGET_NOT_ADMITTED', 'The request has no durable admission')
      if (entry.receipt) {
        if (JSON.stringify(entry.receipt) !== JSON.stringify(parsed.data)) error('DSH_BUDGET_RECEIPT_CONFLICT', 'A settled receipt cannot be replaced')
        return { value: structuredClone(entry), changed: false }
      }
      entry.receipt = parsed.data; entry.settledAt = new Date().toISOString()
      // Even a charge above the cap is retained truthfully; future admissions fail closed.
      snapshot(ledger)
      return { value: structuredClone(entry), changed: true }
    })
  }

  readSnapshot(): Promise<DshBudgetSnapshot> {
    return this.transaction(async ledger => ({ value: snapshot(ledger), changed: false }))
  }

  private transaction<T>(operation: (ledger: Ledger) => Promise<{ value: T; changed: boolean }>): Promise<T> {
    const task = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const lockPath = `${this.path}.lock`
      const lock = { version: 1 as const, token: randomUUID(), pid: process.pid, host: hostname(), createdAt: new Date().toISOString() }
      let handle
      try { handle = await open(lockPath, 'wx', 0o600) } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure
        let valid = false
        try { valid = lockSchema.safeParse(JSON.parse(await readFile(lockPath, 'utf8'))).success } catch { /* No stale-lock deletion or recovery guess. */ }
        error(valid ? 'DSH_BUDGET_LOCKED' : 'DSH_BUDGET_LOCK_CORRUPT', 'The budget lock must be inspected before another process can write')
      }
      try {
        await handle.writeFile(JSON.stringify(lock)); await handle.sync()
        let ledger: Ledger, fresh = false
        try {
          const parsed = ledgerSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')))
          if (!parsed.success) error('DSH_BUDGET_CORRUPT', 'The existing budget ledger is invalid; it will not be reset')
          ledger = parsed.data
        } catch (failure) {
          if (!isMissing(failure)) {
            if (failure instanceof AppError) throw failure
            error('DSH_BUDGET_CORRUPT', 'The existing budget ledger cannot be read; it will not be reset')
          }
          const now = new Date().toISOString()
          ledger = { version: 1, batchId: randomUUID(), createdAt: now, updatedAt: now, authorization: this.authorization, entries: [] }
          fresh = true
        }
        if (JSON.stringify(ledger.authorization) !== JSON.stringify(this.authorization)) error('DSH_BUDGET_AUTHORIZATION_MISMATCH', 'Configured authorization differs from the existing batch; totals and limits will not be overwritten')
        if (new Set(ledger.entries.map(entry => entry.id)).size !== ledger.entries.length || ledger.entries.some(entry =>
          entry.reservedUsdMicros !== reservation(ledger.authorization, entry.kind, entry.provider) || Boolean(entry.receipt) !== Boolean(entry.settledAt))) {
          error('DSH_BUDGET_CORRUPT', 'The existing budget history is inconsistent; it will not be reset')
        }
        const before = snapshot(ledger)
        if (before.modelCalls > ledger.authorization.maxModelCalls || before.searchCalls > ledger.authorization.maxSearchCalls) error('DSH_BUDGET_CORRUPT', 'The existing budget history exceeds its authorized call counts')
        const result = await operation(ledger)
        if (fresh || result.changed) {
          if (result.changed) ledger.updatedAt = new Date().toISOString()
          await this.persist(ledger)
        }
        return result.value
      } finally {
        await handle.close()
        // Never unlink a replacement/corrupted lock owned by someone else.
        let held
        try { held = lockSchema.safeParse(JSON.parse(await readFile(lockPath, 'utf8'))) } catch { error('DSH_BUDGET_LOCK_CORRUPT', 'Budget lock changed while held') }
        if (!held.success || held.data.token !== lock.token) error('DSH_BUDGET_LOCK_CORRUPT', 'Budget lock ownership changed while held')
        await unlink(lockPath)
      }
    })
    this.queue = task.catch(() => {})
    return task
  }

  private async persist(ledger: Ledger): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    let moved = false
    try {
      await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`); await handle.sync(); await handle.close()
      await rename(temporary, this.path); moved = true
    } finally {
      await handle.close().catch(() => {})
      if (!moved) await unlink(temporary).catch(() => {})
    }
  }
}
