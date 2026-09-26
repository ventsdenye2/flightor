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
  finishReason: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(), model: z.string().min(1).max(200).optional(),
  maxTokens: z.number().int().min(256).max(16384).optional(), thinking: z.literal('disabled').optional(),
  actualCostUsdMicros: micros.optional(), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional() }).strict()
const authorizationSchema = z.object({ authorizedUsdMicros: micros, maxModelCalls: micros, maxSearchCalls: micros,
  modelReserveUsdMicros: micros.positive(), searchReserveUsdMicros: micros.positive(), unlimited: z.literal(true).optional() }).strict()
const entrySchema = z.object({ id: identifier, kind: z.enum(['model', 'search']), provider: providerSchema,
  admittedAt: z.iso.datetime(), reservedUsdMicros: micros.positive(), receipt: receiptSchema.optional(), settledAt: z.iso.datetime().optional() }).strict()
const grantSchema = z.object({ id: identifier, grantedAt: z.iso.datetime(), reference: z.string().min(1).max(300),
  before: authorizationSchema, after: authorizationSchema }).strict()
const ledgerSchema = z.object({ version: z.literal(1), batchId: z.string().uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  authorization: authorizationSchema, authorizationGrants: z.array(grantSchema).max(100).optional(), entries: z.array(entrySchema).max(100_000) }).strict()
const lockSchema = z.object({ version: z.literal(1), token: z.string().uuid(), pid: z.number().int().positive(),
  host: z.string().min(1).max(253), createdAt: z.iso.datetime() }).strict()
type Ledger = z.infer<typeof ledgerSchema>
export type DshBudgetEntry = z.infer<typeof entrySchema>
export interface DshBudgetOptions {
  path: string; authorizedUsd: number; maxModelCalls: number; maxSearchCalls: number
  modelReserveUsd?: number; searchReserveUsd?: number; unlimited?: boolean
}
export interface DshBudgetReceipt {
  durationMs: number
  finishReason?: string
  model?: string
  maxTokens?: number
  thinking?: 'disabled'
  usage?: { promptTokens?: number | undefined; completionTokens?: number | undefined; totalTokens?: number | undefined }
  /** Only a real monetary receipt; token usage or rate estimates must not populate this. */
  actualCostUsd?: number
  errorCode?: string
}
export interface DshBudgetSnapshot {
  version: 1; batchId: string; createdAt: string; updatedAt: string
  authorization: Ledger['authorization']; entries: DshBudgetEntry[]
  modelCalls: number; searchCalls: number; knownCostUsdMicros: number; unknownReservedUsdMicros: number
  consumedUsdMicros: number; remainingUsdMicros: number | null; unknownCostCalls: number; pendingCalls: number; overBudget: boolean
}

function error(code: string, message: string): never { throw new AppError(code, message, 409) }
function usdMicros(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) error('DSH_BUDGET_INVALID_CONFIGURATION', 'Budget amount must be finite nonnegative USD within the supported range')
  // Round upward so fractional microdollar estimates never reduce reservations.
  return Math.ceil(Number((value * 1_000_000).toPrecision(15)))
}
function isMissing(value: unknown): boolean { return (value as NodeJS.ErrnoException)?.code === 'ENOENT' }
/** Retry only the atomic replacement, never a transaction or an admission.
 * Windows readers may transiently deny rename; the same temp file and lock remain held. */
async function budgetFileOperation<T>(operation: string, action: () => Promise<T>, retryRename = false): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await action() } catch (failure) {
      const systemCode = (failure as NodeJS.ErrnoException)?.code
      // These are existing create/read control-flow cases, not recoverable lock failures.
      if (systemCode === 'ENOENT' || systemCode === 'EEXIST') throw failure
      if (retryRename && (systemCode === 'EPERM' || systemCode === 'EBUSY') && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 25 : 75))
        continue
      }
      const code = typeof systemCode === 'string' && /^[A-Z0-9_]{1,16}$/.test(systemCode) ? systemCode : 'UNKNOWN'
      throw new AppError(`DSH_BUDGET_FS_${operation}_${code}`, `Budget file operation ${operation} failed after ${attempt} attempt(s)`, 503,
        { operation, systemCode: code, attempts: attempt })
    }
  }
}
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
    remainingUsdMicros: ledger.authorization.unlimited ? null : Math.max(0, ledger.authorization.authorizedUsdMicros - consumedUsdMicros), unknownCostCalls, pendingCalls,
    overBudget: !ledger.authorization.unlimited && consumedUsdMicros > ledger.authorization.authorizedUsdMicros }
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
      modelReserveUsdMicros: usdMicros(options.modelReserveUsd ?? 0.04), searchReserveUsdMicros: usdMicros(options.searchReserveUsd ?? 0.08),
      ...(options.unlimited === true ? { unlimited: true } : {}) })
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
      if (!ledger.authorization.unlimited && (current.modelCalls >= ledger.authorization.maxModelCalls
        || ledger.authorization.maxSearchCalls > 0 && current.searchCalls >= ledger.authorization.maxSearchCalls
        || current.modelCalls + counts.model > ledger.authorization.maxModelCalls || current.searchCalls + counts.search > ledger.authorization.maxSearchCalls)) {
        error('DSH_BUDGET_CALL_LIMIT', 'The authorized model or search call limit would be exceeded')
      }
      if (!ledger.authorization.unlimited && current.consumedUsdMicros + reservedUsdMicros > ledger.authorization.authorizedUsdMicros) {
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

  /** Explicit user authorization only: keep all prior caps, grants, failures and reservations as audit history. */
  authorizeUnlimited(grant: { id: string; reference: string }): Promise<DshBudgetSnapshot> {
    return this.transaction(async ledger => {
      if (ledger.authorizationGrants?.some(item => item.id === grant.id)) error('DSH_BUDGET_GRANT_REPLAY', 'This authorization grant is already recorded')
      if (snapshot(ledger).pendingCalls) error('DSH_BUDGET_PENDING_CALLS', 'Settle active requests before recording a new grant')
      if (ledger.authorization.unlimited) error('DSH_BUDGET_ALREADY_UNLIMITED', 'This batch already has an uncapped authorization')
      const before = structuredClone(ledger.authorization)
      const after = { ...before, unlimited: true as const }
      const parsed = grantSchema.safeParse({ id: grant.id, reference: grant.reference, grantedAt: new Date().toISOString(), before, after })
      if (!parsed.success) error('DSH_BUDGET_INVALID_GRANT', 'An uncapped authorization requires a bounded unique identity and explicit reference')
      ledger.authorizationGrants = [...(ledger.authorizationGrants ?? []), parsed.data]
      ledger.authorization = after
      return { value: snapshot(ledger), changed: true }
    })
  }

  /** Administrative operation only after a new explicit user grant. Never used by Agent/HTTP admission. */
  extendAuthorization(grant: { id: string; reference: string; additionalUsd: number; additionalModelCalls: number; additionalSearchCalls: number }): Promise<DshBudgetSnapshot> {
    return this.transaction(async ledger => {
      if (ledger.authorizationGrants?.some(item => item.id === grant.id)) error('DSH_BUDGET_GRANT_REPLAY', 'This authorization grant is already recorded')
      if (snapshot(ledger).pendingCalls) error('DSH_BUDGET_PENDING_CALLS', 'Settle active requests before recording a new grant')
      if (!(grant.additionalUsd > 0) || !Number.isSafeInteger(grant.additionalModelCalls) || grant.additionalModelCalls < 0
        || !Number.isSafeInteger(grant.additionalSearchCalls) || grant.additionalSearchCalls < 0)
        error('DSH_BUDGET_INVALID_GRANT', 'A grant must explicitly add positive money and nonnegative model/search capacity')
      const before = structuredClone(ledger.authorization)
      const after = { ...before, authorizedUsdMicros: before.authorizedUsdMicros + usdMicros(grant.additionalUsd),
        maxModelCalls: before.maxModelCalls + grant.additionalModelCalls, maxSearchCalls: before.maxSearchCalls + grant.additionalSearchCalls }
      const parsed = grantSchema.safeParse({ id: grant.id, reference: grant.reference, grantedAt: new Date().toISOString(), before, after })
      if (!parsed.success || after.maxModelCalls + after.maxSearchCalls > 100_000) error('DSH_BUDGET_INVALID_GRANT', 'Invalid authorization grant')
      ledger.authorizationGrants = [...(ledger.authorizationGrants ?? []), parsed.data]
      ledger.authorization = after
      return { value: snapshot(ledger), changed: true }
    })
  }

  private transaction<T>(operation: (ledger: Ledger) => Promise<{ value: T; changed: boolean }>): Promise<T> {
    const task = this.queue.then(async () => {
      await budgetFileOperation('DIRECTORY_CREATE', () => mkdir(dirname(this.path), { recursive: true }))
      const lockPath = `${this.path}.lock`
      const lock = { version: 1 as const, token: randomUUID(), pid: process.pid, host: hostname(), createdAt: new Date().toISOString() }
      let handle
      try { handle = await budgetFileOperation('LOCK_OPEN', () => open(lockPath, 'wx', 0o600)) } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure
        let valid = false
        try { valid = lockSchema.safeParse(JSON.parse(await budgetFileOperation('LOCK_READ', () => readFile(lockPath, 'utf8')))).success } catch (failure) {
          if (failure instanceof AppError) throw failure
          /* No stale-lock deletion or recovery guess. */
        }
        error(valid ? 'DSH_BUDGET_LOCKED' : 'DSH_BUDGET_LOCK_CORRUPT', 'The budget lock must be inspected before another process can write')
      }
      try {
        await budgetFileOperation('LOCK_WRITE', () => handle.writeFile(JSON.stringify(lock)))
        await budgetFileOperation('LOCK_SYNC', () => handle.sync())
        let ledger: Ledger, fresh = false
        try {
          const parsed = ledgerSchema.safeParse(JSON.parse(await budgetFileOperation('LEDGER_READ', () => readFile(this.path, 'utf8'))))
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
        if (!ledger.authorization.unlimited && (before.modelCalls > ledger.authorization.maxModelCalls || before.searchCalls > ledger.authorization.maxSearchCalls)) error('DSH_BUDGET_CORRUPT', 'The existing budget history exceeds its authorized call counts')
        const result = await operation(ledger)
        if (fresh || result.changed) {
          if (result.changed) ledger.updatedAt = new Date().toISOString()
          await this.persist(ledger)
        }
        return result.value
      } finally {
        await budgetFileOperation('LOCK_CLOSE', () => handle.close())
        // Never unlink a replacement/corrupted lock owned by someone else.
        let held
        try { held = lockSchema.safeParse(JSON.parse(await budgetFileOperation('LOCK_READ', () => readFile(lockPath, 'utf8')))) } catch (failure) {
          if (failure instanceof AppError) throw failure
          error('DSH_BUDGET_LOCK_CORRUPT', 'Budget lock changed while held')
        }
        if (!held.success || held.data.token !== lock.token) error('DSH_BUDGET_LOCK_CORRUPT', 'Budget lock ownership changed while held')
        await budgetFileOperation('LOCK_RELEASE', () => unlink(lockPath))
      }
    })
    this.queue = task.catch(() => {})
    return task
  }

  private async persist(ledger: Ledger): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`
    const handle = await budgetFileOperation('TEMP_OPEN', () => open(temporary, 'wx', 0o600))
    let moved = false
    try {
      await budgetFileOperation('TEMP_WRITE', () => handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`))
      await budgetFileOperation('TEMP_SYNC', () => handle.sync())
      await budgetFileOperation('TEMP_CLOSE', () => handle.close())
      await budgetFileOperation('LEDGER_RENAME', () => rename(temporary, this.path), true); moved = true
    } finally {
      await handle.close().catch(() => {})
      if (!moved) await unlink(temporary).catch(() => {})
    }
  }
}
