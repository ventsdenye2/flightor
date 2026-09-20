import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'
const SERP = 'https://serpapi.com/search.json'

function fail(code, message = code) {
  const e = new Error(message)
  e.code = code
  return e
}

function rate(pricing, names) {
  for (const name of names) {
    const value = pricing?.[name]
    const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric >= 0) return numeric
  }
  return undefined
}

function pricingRates(pricing, model) {
  const catalogEntry = pricing?.[model] ?? pricing?.catalog?.[model]
  const prompt = rate(pricing, ['prompt', 'promptPerToken', 'input', 'inputPerToken']) ??
    rate(catalogEntry, ['prompt', 'promptPerToken', 'input', 'inputPerToken']) ??
    rate(pricing?.catalog, ['prompt', 'promptPerToken', 'input', 'inputPerToken'])
  const completion = rate(pricing, ['completion', 'completionPerToken', 'output', 'outputPerToken']) ??
    rate(catalogEntry, ['completion', 'completionPerToken', 'output', 'outputPerToken']) ??
    rate(pricing?.catalog, ['completion', 'completionPerToken', 'output', 'outputPerToken'])
  return { prompt, completion }
}

function readLedger(directory, limitUsd) {
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'ledger.json')
  const initial = { version: 1, limitUsd, blocked: false, calls: [] }
  try {
    const fd = fs.openSync(file, 'wx')
    try { fs.writeFileSync(fd, JSON.stringify(initial, null, 2) + '\n', 'utf8') } finally { fs.closeSync(fd) }
    return { file, value: initial }
  } catch (error) {
    if (error?.code === 'EEXIST') throw fail('G1_LEDGER_EXISTS')
    throw error
  }
}

function persist(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8')
  fs.renameSync(temporary, file)
}

function micros(value) { return Math.ceil(Number(value) * 1_000_000) }
function spend(ledger) {
  return ledger.calls.reduce((sum, call) => sum + micros(typeof call.costUsd === 'number' ? call.costUsd : call.reservedUsd), 0)
}

export function installG1Budget({ directory, model, pricing, limitUsd = 2, fetchImpl = globalThis.fetch }) {
  if (!directory || typeof model !== 'string' || !model) throw fail('INVALID_INSTALL')
  if (!Number.isFinite(limitUsd) || limitUsd <= 0 || limitUsd > 2) throw fail('INVALID_LIMIT')
  if (typeof fetchImpl !== 'function') throw fail('INVALID_FETCH')
  const { file, value: ledger } = readLedger(directory, limitUsd)
  const rates = pricingRates(pricing, model)
  const state = { next: ledger.calls.length + 1, blocked: ledger.blocked === true }
  const snapshot = () => {
    const calls = ledger.calls.map(call => ({ ...call }))
    const knownCostUsd = calls.reduce((s, c) => s + (typeof c.costUsd === 'number' ? micros(c.costUsd) : 0), 0) / 1_000_000
    const heldUsd = calls.reduce((s, c) => s + (typeof c.costUsd === 'number' ? 0 : micros(c.reservedUsd)), 0) / 1_000_000
    return { knownCostUsd, heldUsd, totalCostUsd: knownCostUsd + heldUsd, calls }
  }

  const wrappedFetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url
    let parsed
    try { parsed = new URL(url) } catch { throw fail('G1_URL_FORBIDDEN') }
    const method = String(init.method ?? (typeof input !== 'string' ? input.method : 'GET') ?? 'GET').toUpperCase()
    let kind
    let reservedUsd
    let requestModel = model
    let requestBody
    if (parsed.href === OPENROUTER) {
      kind = 'model'; reservedUsd = 0.10
      if (method !== 'POST' || parsed.protocol !== 'https:') throw fail('G1_REQUEST_FORBIDDEN')
      if (init.redirect && init.redirect !== 'error') throw fail('G1_REDIRECT_FORBIDDEN')
      requestBody = init.body
      if (typeof requestBody !== 'string') throw fail('G1_BODY_REQUIRED')
      if (Buffer.byteLength(requestBody, 'utf8') > 200000) throw fail('G1_BODY_TOO_LARGE')
      let body
      try { body = JSON.parse(requestBody) } catch { throw fail('G1_BODY_JSON') }
      if (body.model !== model || body.plugins !== undefined || body.web_search_options !== undefined || body.responses !== undefined) throw fail('G1_MODEL_OR_TOOLS')
      if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => !tool || tool.type !== 'function'))) throw fail('G1_MODEL_OR_TOOLS')
      if (body.n !== undefined && body.n !== 1) throw fail('G1_OUTPUT_LIMIT')
      if (body.stream === true || body.max_completion_tokens !== undefined) throw fail('G1_OUTPUT_LIMIT')
      if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 8000) throw fail('G1_MAX_TOKENS')
      if (rates.prompt === undefined || rates.completion === undefined) throw fail('G1_PRICING_REQUIRED')
      const worst = (Buffer.byteLength(requestBody, 'utf8') + 4096) * rates.prompt + body.max_tokens * rates.completion
      if (!(worst < reservedUsd)) throw fail('G1_RESERVE_EXCEEDED')
    } else if (parsed.href.startsWith(SERP) && parsed.origin === 'https://serpapi.com' && parsed.pathname === '/search.json') {
      kind = 'serp'; reservedUsd = 0.05
      if (method !== 'GET' || parsed.protocol !== 'https:' || (parsed.searchParams.get('engine') !== 'google' && parsed.searchParams.get('engine') !== 'google_flights')) throw fail('G1_SERP_FORBIDDEN')
      requestBody = undefined
    } else throw fail('G1_URL_FORBIDDEN')
    if (state.blocked || spend(ledger) + micros(reservedUsd) > micros(limitUsd)) throw fail('G1_BUDGET_EXCEEDED')
    const count = ledger.calls.filter(c => c.kind === kind).length
    if (count >= (kind === 'model' ? 24 : 12)) throw fail('G1_CALL_LIMIT')
    const call = { index: state.next++, kind, requestModel: kind === 'model' ? requestModel : undefined, reservedUsd, status: 'running', startedAt: Date.now() }
    if (call.requestModel === undefined) delete call.requestModel
    ledger.calls.push(call)
    persist(file, ledger)
    const started = call.startedAt
    try {
      const response = await fetchImpl(input, { ...init, redirect: 'error' })
      call.status = response?.ok === false ? 'unknown' : 'success'
      call.statusCode = Number.isInteger(response?.status) ? response.status : undefined
      call.durationMs = Date.now() - started
      if (call.statusCode === undefined) delete call.statusCode
      try {
        const copy = response.clone()
        const data = await copy.json()
        const actual = data?.usage?.cost
        const httpError = response?.ok === false || (Number.isInteger(response?.status) && response.status >= 400)
        if (kind === 'model' && !httpError && typeof actual === 'number' && Number.isFinite(actual) && actual >= 0) {
          call.costUsd = actual
          call.status = 'success'
          if (actual > reservedUsd) state.blocked = ledger.blocked = true
        }
        if (typeof data?.model === 'string') call.responseModel = data.model
        if (typeof data?.choices?.[0]?.finish_reason === 'string') call.finishReason = data.choices[0].finish_reason
      } catch { call.status = 'unknown' }
      try { persist(file, ledger) } catch { /* a logging failure cannot change a successful provider response */ }
      return response
    } catch (error) {
      call.status = 'unknown'; call.durationMs = Date.now() - started
      try { persist(file, ledger) } catch { /* billing persistence errors must not turn a provider result into a failure */ }
      throw error
    }
  }
  return { fetch: wrappedFetch, ledger, snapshot }
}

export default { installG1Budget }
