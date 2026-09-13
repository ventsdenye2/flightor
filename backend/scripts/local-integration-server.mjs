import fs from 'node:fs'
import path from 'node:path'

// Explicit, local-only validation launcher. Its USD ledger meters both Planner
// and Research; Runtime cost units and the Research DB ledger are separate.
const db = new URL(process.env.DATABASE_URL || '')
if (process.env.HOST !== '127.0.0.1' || process.env.PORT !== '3011' || db.hostname !== '127.0.0.1' || db.port !== '15432' || db.pathname !== '/flightor_integration_20260913') throw new Error('INTEGRATION_SCOPE_REQUIRED')
if (process.env.OPENROUTER_BASE_URL !== 'https://openrouter.ai/api/v1') throw new Error('OFFICIAL_PROVIDER_ENDPOINT_REQUIRED')
// A new user-authorized round never erases earlier receipts or held charges.
const secondRound = process.env.LOCAL_INTEGRATION_BUDGET_ROUND === '2'
const ledgerPath = path.resolve(secondRound ? '.demo/live-integration-ledger-round2.json' : '.demo/live-integration-ledger.json')
const initial = { limitUsd: secondRound ? 5 : 1.50, previousExperimentAdmittedUsd: secondRound ? 3.949322018 : 3.447637138, calls: [] }
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : initial
if (ledger.limitUsd !== initial.limitUsd || ledger.previousExperimentAdmittedUsd !== initial.previousExperimentAdmittedUsd || !Array.isArray(ledger.calls)) throw new Error('INVALID_INTEGRATION_LEDGER')
const write = () => { fs.mkdirSync(path.dirname(ledgerPath), { recursive: true }); fs.writeFileSync(`${ledgerPath}.tmp`, JSON.stringify(ledger, null, 2)); fs.renameSync(`${ledgerPath}.tmp`, ledgerPath) }
const spend = () => ledger.calls.reduce((sum, call) => sum + (call.costUsd ?? call.reservedUsd), 0)
const rawFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.href !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('EXTERNAL_PROVIDER_NOT_ADMITTED_FOR_LOCAL_VALIDATION')
  const body = JSON.parse(String(init?.body || '{}'))
  const native = ['qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash'].includes(body.model)
  if (!native && body.model !== 'deepseek/deepseek-v4-flash-0731') throw new Error('MODEL_NOT_ADMITTED')
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 8000 || Buffer.byteLength(JSON.stringify(body)) > 120000) throw new Error('REQUEST_EXCEEDS_VALIDATION_ENVELOPE')
  const reservedUsd = native ? 0.50 : 0.10
  // Calls accumulate across sessions; the authorized dollar limit, not a lifetime
  // request count, governs admission. Runtime still bounds each Planner turn.
  if (ledger.calls.some(call => call.costUsd > call.reservedUsd) || spend() + reservedUsd > ledger.limitUsd) throw new Error('INTEGRATION_BUDGET_ADMISSION_STOP')
  const call = { index: ledger.calls.length + 1, model: body.model, reservedUsd, status: 'running', startedAt: new Date().toISOString() }
  ledger.calls.push(call); write()
  try {
    const response = await rawFetch(input, init)
    const receipt = await response.clone().json()
    const cost = receipt.usage?.cost
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) call.costUsd = cost
    Object.assign(call, { status: response.ok ? 'received' : 'rejected', httpStatus: response.status, generationId: receipt.id, usage: receipt.usage, finishReason: receipt.choices?.[0]?.finish_reason })
    fs.writeFileSync(path.resolve(`.demo/live-${secondRound ? 'round2-' : ''}receipt-${call.index}.json`), JSON.stringify(receipt, null, 2))
    return response
  } catch (error) { call.status = 'unknown'; throw error }
  finally { call.finishedAt = new Date().toISOString(); write() }
}
// Reservations left running after a previous process exit are ambiguous and
// must not be automatically released on restart.
if (ledger.calls.some(call => call.status === 'running')) throw new Error('INTEGRATION_UNFINISHED_BILLING_REQUIRES_REVIEW')
write()
await import('../src/server.ts')
