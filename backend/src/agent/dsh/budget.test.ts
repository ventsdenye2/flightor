import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileDshBudget, type DshBudgetOptions } from './budget.js'

const directories: string[] = []
async function fixture(overrides: Partial<Omit<DshBudgetOptions, 'path'>> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'flightor-dsh-budget-'))
  directories.push(directory)
  const options = { path: join(directory, 'ledger.json'), authorizedUsd: 1, maxModelCalls: 5, maxSearchCalls: 3, ...overrides }
  return { options, budget: new FileDshBudget(options), directory }
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('file DSH authorization budget', () => {
  it('persists admission before the request and accumulates reloads without deriving money from usage', async () => {
    const f = await fixture()
    const first = await f.budget.admit('model', 'model-1', 'openrouter')
    expect(first.reservedUsdMicros).toBe(40_000)
    expect(JSON.parse(await readFile(f.options.path, 'utf8')).entries[0].id).toBe('model-1')
    await f.budget.settle('model-1', { durationMs: 124, usage: { promptTokens: 1000, completionTokens: 300, totalTokens: 1300 } })
    const reloaded = new FileDshBudget(f.options)
    const snapshot = await reloaded.readSnapshot()
    expect(snapshot).toMatchObject({ modelCalls: 1, searchCalls: 0, knownCostUsdMicros: 0, unknownReservedUsdMicros: 40_000,
      unknownCostCalls: 1, pendingCalls: 0, consumedUsdMicros: 40_000 })
    await reloaded.admit('search', 'search-1', 'serpapi')
    expect(await f.budget.readSnapshot()).toMatchObject({ modelCalls: 1, searchCalls: 1, consumedUsdMicros: 120_000 })
  })
  it('reserves official search as both one model and one search including both reservations', async () => {
    const f = await fixture({ maxModelCalls: 1, maxSearchCalls: 2 })
    expect(await f.budget.admit('search', 'official-1', 'deepseek-official')).toMatchObject({ reservedUsdMicros: 120_000 })
    expect(await f.budget.readSnapshot()).toMatchObject({ modelCalls: 1, searchCalls: 1, consumedUsdMicros: 120_000 })
    await expect(f.budget.admit('search', 'official-2', 'deepseek-official')).rejects.toMatchObject({ code: 'DSH_BUDGET_CALL_LIMIT' })
    expect((await f.budget.readSnapshot()).entries).toHaveLength(1)
  })
  it('enforces the search cap for official search even when model calls remain', async () => {
    const f = await fixture({ maxSearchCalls: 0 })
    await expect(f.budget.admit('search', 'official-1', 'deepseek-official')).rejects.toMatchObject({ code: 'DSH_BUDGET_CALL_LIMIT' })
    expect(await f.budget.readSnapshot()).toMatchObject({ modelCalls: 0, searchCalls: 0 })
  })
  it('stops both paid routes once either positive call ceiling is reached', async () => {
    const f = await fixture({ maxSearchCalls: 1 })
    await f.budget.admit('search', 'last-search', 'deepseek-official')
    await expect(f.budget.admit('model', 'another-model', 'deepseek')).rejects.toMatchObject({ code: 'DSH_BUDGET_CALL_LIMIT' })
    expect((await f.budget.readSnapshot()).entries).toHaveLength(1)
    const modelOnly = await fixture({ maxSearchCalls: 0 })
    await expect(modelOnly.budget.admit('model', 'model-only', 'deepseek')).resolves.toMatchObject({ kind: 'model' })
  })
  it('does not free failed request counts or unknown charges', async () => {
    const f = await fixture({ maxModelCalls: 1, maxSearchCalls: 1 })
    await f.budget.admit('model', 'model-1', 'openrouter')
    await f.budget.settle('model-1', { durationMs: 100, errorCode: 'PROVIDER_TIMEOUT' })
    await expect(f.budget.admit('model', 'model-2', 'openrouter')).rejects.toMatchObject({ code: 'DSH_BUDGET_CALL_LIMIT' })
    expect(await f.budget.readSnapshot()).toMatchObject({ modelCalls: 1, consumedUsdMicros: 40_000, knownCostUsdMicros: 0, unknownCostCalls: 1 })
  })
  it('retains output-limit diagnostics and unknown reservation across reopening', async () => {
    const f = await fixture()
    await f.budget.admit('model', 'length-1', 'deepseek')
    await f.budget.settle('length-1', { durationMs: 80, finishReason: 'max-tokens', model: 'deepseek-v4-flash',
      maxTokens: 4096, thinking: 'disabled', errorCode: 'MODEL_OUTPUT_LIMIT',
      usage: { promptTokens: 700, completionTokens: 4096, totalTokens: 4796 } })
    const reopened = await new FileDshBudget(f.options).readSnapshot()
    expect(reopened).toMatchObject({ modelCalls: 1, pendingCalls: 0, unknownReservedUsdMicros: 40_000 })
    expect(reopened.entries[0]?.receipt).toMatchObject({ finishReason: 'max-tokens', thinking: 'disabled', maxTokens: 4096,
      errorCode: 'MODEL_OUTPUT_LIMIT', usage: { completionTokens: 4096 } })
  })
  it('appends an explicit grant without resetting failed entries, cost or batch identity', async () => {
    const f = await fixture()
    await f.budget.admit('model', 'old-failure', 'deepseek')
    await f.budget.settle('old-failure', { durationMs: 1, errorCode: 'PROVIDER_FAILURE' })
    const before = await f.budget.readSnapshot()
    const granted = await f.budget.extendAuthorization({ id: 'user-grant-1', reference: 'Explicit isolated test grant',
      additionalUsd: 3, additionalModelCalls: 48, additionalSearchCalls: 12 })
    expect(granted.batchId).toBe(before.batchId)
    expect(granted.entries).toEqual(before.entries)
    expect(granted.unknownReservedUsdMicros).toBe(before.unknownReservedUsdMicros)
    expect(granted.authorization.authorizedUsdMicros).toBe(before.authorization.authorizedUsdMicros + 3_000_000)
    const reopened = new FileDshBudget({ ...f.options, authorizedUsd: f.options.authorizedUsd + 3,
      maxModelCalls: f.options.maxModelCalls + 48, maxSearchCalls: f.options.maxSearchCalls + 12 })
    expect((await reopened.readSnapshot()).entries).toEqual(before.entries)
    await expect(f.budget.admit('model', 'stale-config', 'deepseek')).rejects.toThrow()
    await expect(reopened.extendAuthorization({ id: 'user-grant-1', reference: 'Replay', additionalUsd: 3,
      additionalModelCalls: 48, additionalSearchCalls: 12 })).rejects.toMatchObject({ code: 'DSH_BUDGET_GRANT_REPLAY' })
  })
  it('can add explicitly authorized money/search capacity without increasing an unused model cap', async () => {
    const f = await fixture()
    await f.budget.admit('model', 'preserved-failure', 'deepseek')
    await f.budget.settle('preserved-failure', { durationMs: 1, errorCode: 'PROVIDER_FAILURE' })
    const before = await f.budget.readSnapshot()
    const after = await f.budget.extendAuthorization({ id: 'search-grant', reference: 'Explicit fixture grant without added model calls',
      additionalUsd: 1, additionalModelCalls: 0, additionalSearchCalls: 6 })
    expect(after.entries).toEqual(before.entries)
    expect(after.authorization.maxModelCalls).toBe(before.authorization.maxModelCalls)
    expect(after.authorization.maxSearchCalls).toBe(before.authorization.maxSearchCalls + 6)
    expect(after.remainingUsdMicros).toBe(before.remainingUsdMicros + 1_000_000)
  })
  it('refuses amounts beyond the cap and keeps an actual charge above the cap truthfully', async () => {
    const f = await fixture({ authorizedUsd: 0.1 })
    await f.budget.admit('model', 'model-1', 'openrouter')
    await expect(f.budget.admit('search', 'search-1', 'serpapi')).rejects.toMatchObject({ code: 'DSH_BUDGET_AMOUNT_LIMIT' })
    await f.budget.settle('model-1', { durationMs: 50, actualCostUsd: 0.11 })
    expect(await f.budget.readSnapshot()).toMatchObject({ knownCostUsdMicros: 110_000, consumedUsdMicros: 110_000, remainingUsdMicros: 0, overBudget: true })
    await expect(f.budget.admit('model', 'model-2', 'openrouter')).rejects.toMatchObject({ code: 'DSH_BUDGET_AMOUNT_LIMIT' })
    expect((await new FileDshBudget(f.options).readSnapshot()).overBudget).toBe(true)
  })
  it('settles a real monetary receipt and serializes concurrent calls within one instance', async () => {
    const f = await fixture({ authorizedUsd: 0.04 })
    const [first, replay] = await Promise.all([f.budget.admit('model', 'same-id', 'openrouter'), f.budget.admit('model', 'same-id', 'openrouter')])
    expect(replay).toEqual(first)
    const receipt = { durationMs: 25, actualCostUsd: 0.01, usage: { promptTokens: 12 } }
    await Promise.all([f.budget.settle('same-id', receipt), f.budget.settle('same-id', receipt)])
    expect(await f.budget.readSnapshot()).toMatchObject({ modelCalls: 1, knownCostUsdMicros: 10_000, unknownReservedUsdMicros: 0, remainingUsdMicros: 30_000 })
    await expect(f.budget.admit('search', 'same-id', 'serpapi')).rejects.toMatchObject({ code: 'DSH_BUDGET_ID_CONFLICT' })
    await expect(f.budget.settle('same-id', { ...receipt, actualCostUsd: 0 })).rejects.toMatchObject({ code: 'DSH_BUDGET_RECEIPT_CONFLICT' })
  })
  it.each([{ authorizedUsd: 2 }, { maxModelCalls: 8 }, { maxSearchCalls: 6 }, { modelReserveUsd: 0.001 }, { searchReserveUsd: 0.001 }])(
    'cannot overwrite existing authorization with %o', async override => {
      const f = await fixture()
      await f.budget.admit('search', 'search-1', 'serpapi')
      const original = await readFile(f.options.path, 'utf8')
      await expect(new FileDshBudget({ ...f.options, ...override }).admit('model', 'new-model', 'openrouter')).rejects.toMatchObject({ code: 'DSH_BUDGET_AUTHORIZATION_MISMATCH' })
      expect(await readFile(f.options.path, 'utf8')).toBe(original)
    })
  it.each(['{broken', JSON.stringify({ version: 1, token: 'bad', pid: process.pid }), JSON.stringify({
    version: 1, token: randomUUID(), pid: process.pid, host: hostname(), createdAt: new Date().toISOString()
  })])('refuses existing or corrupted locks without deleting them', async lock => {
    const f = await fixture()
    await f.budget.readSnapshot()
    const original = await readFile(f.options.path, 'utf8')
    await writeFile(`${f.options.path}.lock`, lock)
    await expect(f.budget.admit('model', 'model-1', 'openrouter')).rejects.toMatchObject({ code: lock.includes(hostname()) ? 'DSH_BUDGET_LOCKED' : 'DSH_BUDGET_LOCK_CORRUPT' })
    expect(await readFile(`${f.options.path}.lock`, 'utf8')).toBe(lock)
    expect(await readFile(f.options.path, 'utf8')).toBe(original)
  })
  it('concurrent writers with different authorizations cannot both initialize or replace the batch', async () => {
    const f = await fixture()
    const other = new FileDshBudget({ ...f.options, authorizedUsd: 2 })
    const results = await Promise.allSettled([f.budget.admit('model', 'first', 'openrouter'), other.admit('model', 'second', 'openrouter')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const saved = JSON.parse(await readFile(f.options.path, 'utf8'))
    expect(saved.entries).toHaveLength(1)
    const loser = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(['DSH_BUDGET_LOCKED', 'DSH_BUDGET_LOCK_CORRUPT', 'DSH_BUDGET_AUTHORIZATION_MISMATCH']).toContain(loser.reason.code)
    // A writer may observe the winning process between exclusive open and lock payload fsync;
    // an incomplete lock is deliberately treated as corrupt and still fails closed.
  })
  it('never resets a corrupt ledger and refuses prompt/credential-like receipt payload fields', async () => {
    const f = await fixture()
    await f.budget.admit('model', 'model-1', 'openrouter')
    await expect(f.budget.settle('model-1', { durationMs: 1, prompt: 'raw user prompt', apiKey: 'secret' } as any)).rejects.toMatchObject({ code: 'DSH_BUDGET_INVALID_RECEIPT' })
    expect(await readFile(f.options.path, 'utf8')).not.toContain('raw user prompt')
    expect(await readFile(f.options.path, 'utf8')).not.toContain('secret')
    await writeFile(f.options.path, '{invalid-ledger')
    await expect(f.budget.readSnapshot()).rejects.toMatchObject({ code: 'DSH_BUDGET_CORRUPT' })
    expect(await readFile(f.options.path, 'utf8')).toBe('{invalid-ledger')
  })
  it('refuses unknown settlements, contradictory history and invalid reservations', async () => {
    const f = await fixture()
    await expect(f.budget.settle('unknown', { durationMs: 1 })).rejects.toMatchObject({ code: 'DSH_BUDGET_NOT_ADMITTED' })
    await f.budget.admit('model', 'model-1', 'openrouter')
    const invalid = JSON.parse(await readFile(f.options.path, 'utf8'))
    invalid.entries[0].reservedUsdMicros = 1
    await writeFile(f.options.path, JSON.stringify(invalid))
    await expect(f.budget.readSnapshot()).rejects.toMatchObject({ code: 'DSH_BUDGET_CORRUPT' })
    expect(() => new FileDshBudget({ ...f.options, modelReserveUsd: 0 })).toThrow()
    expect(() => new FileDshBudget({ ...f.options, authorizedUsd: Number.NaN })).toThrow()
  })
})
