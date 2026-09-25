// Bounded DSH browser E2E preparation and explicitly gated sequential probes.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import dotenv from 'dotenv'
import pg from 'pg'
import { Kysely, PostgresDialect, Migrator, sql } from 'kysely'

const root = path.resolve(import.meta.dirname, '..')
const directory = path.join(root, '.demo', 'dsh-e2e-20260924')
const schema = 'dsh_e2e_20260924'
const basePath = process.env.FLIGHTOR_BASE_ENV_PATH
const overlayPath = process.env.FLIGHTOR_DSH_ENV_PATH ?? path.join(root, '.env.dsh.local')
const base = basePath && fs.existsSync(basePath) ? dotenv.parse(fs.readFileSync(basePath)) : {}
const overlay = fs.existsSync(overlayPath) ? dotenv.parse(fs.readFileSync(overlayPath)) : {}
const settings = { ...base, ...overlay }
const budgetPath = path.resolve(root, '.dsh-data/budget.json')
const statePath = path.join(directory, 'state.private.json')
const lockPath = path.join(directory, 'runner.lock')
const priorState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null
if (priorState && (priorState.version !== 1 || priorState.schema !== schema || priorState.budgetPath !== budgetPath)) throw Error('DSH_E2E_STATE_MISMATCH')
const budgetSnapshot = readBudget(budgetPath)
const executeModel = process.argv.includes('--model')
const executeSearch = process.argv.includes('--search')
const executeCommit = process.argv.includes('--commit')
const prepare = process.argv.includes('--prepare')
const serve = process.argv.includes('--serve')
const browserExecute = process.argv.includes('--execute') && serve
const execute = executeModel || executeSearch || executeCommit
const probeCount = Number(executeModel) + Number(executeSearch) + Number(executeCommit)
if (execute && (!process.argv.includes('--execute') || probeCount !== 1)) throw Error('DSH_E2E_EXPLICIT_SINGLE_PROBE_REQUIRED')
if ((executeModel || executeSearch) && prepare) throw Error('DSH_E2E_MODEL_SEARCH_PROBES_ARE_NON_BROWSER')
if (process.argv.includes('--dry-run') && (prepare || serve || execute)) throw Error('DSH_E2E_DRY_RUN_MODE_CONFLICT')
if (execute && serve) throw Error('DSH_E2E_PROBE_AND_BROWSER_MUST_BE_SEQUENTIAL')

function readBudget(file) {
  if (!fs.existsSync(file)) return null
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (value.version !== 1 || !Array.isArray(value.entries) || !value.authorization) throw Error('DSH_E2E_BUDGET_INVALID')
  const calls = value.entries.reduce((counts, entry) => {
    if (entry.kind === 'model' || entry.provider === 'deepseek-official') counts.model++
    if (entry.kind === 'search') counts.search++
    counts.usdMicros += entry.receipt?.actualCostUsdMicros ?? entry.reservedUsdMicros
    if (!entry.receipt) counts.pending++
    return counts
  }, { model: 0, search: 0, usdMicros: 0, pending: 0 })
  return { batchId: value.batchId, authorization: value.authorization, ...calls,
    remainingUsdMicros: value.authorization.unlimited === true ? null : value.authorization.authorizedUsdMicros - calls.usdMicros }
}
function capacity(kind) {
  const current = readBudget(budgetPath)
  if (!current) throw Error('DSH_E2E_EXISTING_BUDGET_REQUIRED')
  if (priorState?.budgetBatchId && priorState.budgetBatchId !== current.batchId) throw Error('DSH_E2E_BUDGET_BATCH_CHANGED')
  if (current.pending) throw Error('DSH_E2E_BUDGET_PENDING_ENTRY')
  const a = current.authorization
  if ((a.unlimited === true) !== (settings.DSH_BUDGET_UNLIMITED === 'true')) throw Error('DSH_E2E_BUDGET_AUTHORIZATION_MISMATCH')
  if (a.unlimited === true) return
  const officialSearch = kind !== 'model' && settings.DSH_SEARCH_PROVIDER === 'deepseek-official'
  const neededUsd = kind === 'commit' ? a.modelReserveUsdMicros + (officialSearch ? a.searchReserveUsdMicros : 0)
    : kind === 'search' ? a.searchReserveUsdMicros + (officialSearch ? a.modelReserveUsdMicros : 0) : a.modelReserveUsdMicros
  if (current.remainingUsdMicros < neededUsd) throw Error('DSH_E2E_BUDGET_AMOUNT_CAPACITY_REQUIRED')
  if (kind !== 'search' && current.model >= a.maxModelCalls) throw Error('DSH_E2E_MODEL_CAPACITY_REQUIRED')
  if (kind !== 'model' && current.search >= a.maxSearchCalls) throw Error('DSH_E2E_SEARCH_CAPACITY_REQUIRED')
  if (officialSearch && current.model >= a.maxModelCalls) throw Error('DSH_E2E_OFFICIAL_SEARCH_MODEL_CAPACITY_REQUIRED')
}

if (!prepare && !serve && !execute) {
  console.log(JSON.stringify({ mode: 'dry-run', budgetPath, budgetSnapshot, envPaths: { baseSupplied: Boolean(basePath), overlayPresent: fs.existsSync(overlayPath) },
    probes: { model: 'requires --execute --model', search: 'requires --execute --search', commit: 'requires --execute --commit' },
    policy: ['dry-run is read-only and never initializes the ledger', 'probe capacity is checked immediately before each call', 'one paid probe per invocation', 'browser requests use ordinary bearer authentication; no harness nonce', 'legacy Planner, Runtime, and Research paths are forbidden'] }))
  process.exit(0)
}
if (!basePath) throw Error('FLIGHTOR_BASE_ENV_PATH_REQUIRED')
if (!budgetSnapshot || budgetSnapshot.batchId !== 'd1a2aef6-d04d-4c44-9d22-6b1892226f95') throw Error('DSH_E2E_ORIGINAL_BUDGET_REQUIRED')
if (settings.DSH_MODEL_PROVIDER !== 'deepseek' || settings.DSH_SEARCH_PROVIDER !== 'deepseek-official'
  || settings.DEEPSEEK_BASE_URL !== 'https://api.deepseek.com/v1' || settings.DEEPSEEK_SEARCH_BASE_URL !== 'https://api.deepseek.com/anthropic/v1') throw Error('DSH_E2E_OFFICIAL_ROUTES_REQUIRED')
const probeKind = executeModel ? 'model' : executeSearch ? 'search' : executeCommit ? 'commit' : null
if (executeSearch && priorState?.probes?.model?.status !== 'passed' || executeCommit && priorState?.probes?.search?.status !== 'passed') throw Error('DSH_E2E_PREVIOUS_PROBE_REQUIRED')
if (probeKind && priorState?.probes?.[probeKind] && !process.argv.includes('--retry-failed')) throw Error('DSH_E2E_EXPLICIT_RETRY_REQUIRED')
if (!fs.existsSync(path.join(root, 'dist/app.js'))) throw Error('DSH_BACKEND_BUILD_REQUIRED')
if (execute) capacity(executeSearch ? 'search' : executeCommit ? 'commit' : 'model')
const dbFile = process.env.DSH_DB_ENV_PATH ?? path.join(root, '.demo', 'dsh-db-env.json')
const dbConfig = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
const connectionUrl = dbConfig.TEST_DATABASE_URL
const databaseUrl = new URL(connectionUrl)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname) || !databaseUrl.port || databaseUrl.searchParams.has('options')) throw Error('DSH_E2E_LOOPBACK_DATABASE_REQUIRED')
const secretValues = Object.entries(settings).filter(([key]) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key)).map(([, value]) => value).filter(v => typeof v === 'string' && v.length > 8)
function writePrivate(file, value) {
  fs.mkdirSync(directory, { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  fs.renameSync(temp, file)
}
function acquireLock() {
  fs.mkdirSync(directory, { recursive: true })
  const descriptor = fs.openSync(lockPath, 'wx', 0o600)
  const token = randomUUID()
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }))
  fs.fsyncSync(descriptor)
  return { descriptor, token }
}
Object.assign(process.env, settings, { NODE_ENV: 'development', HOST: '127.0.0.1', DATABASE_URL: connectionUrl,
  REDIS_ENABLED: 'false', FLIGHTOR_AGENT_ENGINE: 'dsh', DSH_BUDGET_PATH: budgetPath,
  DSH_DATA_DIRECTORY: path.join(root, '.dsh-data'), LOG_LEVEL: 'error' })
const { parseEnv } = await import('../dist/config/env.js')
const env = parseEnv(process.env)
const { installDshE2eObservation } = await import('./dsh-e2e-observation.mjs')
const observation = await installDshE2eObservation({ directory, dataDirectory: env.DSH_DATA_DIRECTORY })
const { buildApp } = await import('../dist/app.js')
const { createProviders } = await import('../dist/providers/index.js')
const { PostgresUserIdentityRepository } = await import('../dist/identity/postgres.js')
const { issueAccessToken } = await import('../dist/auth/tokens.js')
const admin = new pg.Pool({ connectionString: connectionUrl, max: 1 })
const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: connectionUrl, options: `-c search_path=${schema}`, max: 8 }) }) })
let app
const events = []
const serverAuditPath = path.join(directory, `server-${randomUUID()}.jsonl`)
function recordEvent(event) {
  events.push(event)
  fs.appendFileSync(serverAuditPath, `${JSON.stringify(event)}\n`, { mode: 0o600 })
}
const localizationRequest = new AsyncLocalStorage()
let setupWritesAllowed = true
let probeCommitAllowed = executeCommit
function forbidden(name) { recordEvent({ type: 'forbidden', name, at: new Date().toISOString() }); throw Error(`DSH_E2E_FORBIDDEN_${name}`) }
async function installGuards() {
  for (const [file, cls, method] of [['agent/cloud/service', 'CloudPlannerService', 'runTurn'], ['agent/runtime/runtime', 'AgentRuntime', 'run'],
    ['research-agent/production', 'ProductionResearchAgent', 'research'], ['research-agent/native', 'NativeResearchAgent', 'research'],
    ['providers/openrouter/research', 'OpenRouterResearchSynthesisModel', 'synthesize']]) {
    const prototype = (await import(`../dist/${file}.js`))[cls]?.prototype
    if (!prototype || typeof prototype[method] !== 'function') throw Error('DSH_E2E_GUARD_TARGET_MISSING')
    prototype[method] = async () => forbidden(`${cls}_${method}`)
  }
  const { GuideFinalizer } = await import('../dist/travel-guides/finalization.js')
  const original = GuideFinalizer.prototype.generate
  GuideFinalizer.prototype.generate = function (...args) {
    if (!localizationRequest.getStore()) return forbidden('initial_finalizer')
    return original.apply(this, args)
  }
  recordEvent({ type: 'guards_installed', engine: 'dsh', at: new Date().toISOString(),
    guarded: ['CloudPlannerService.runTurn', 'AgentRuntime.run', 'ProductionResearchAgent.research', 'NativeResearchAgent.research',
      'OpenRouterResearchSynthesisModel.synthesize', 'GuideFinalizer.generate outside explicit localization', 'fare requests'] })
}
async function http(method, url, token, body) {
  const response = await fetch(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw Error(`DSH_E2E_HTTP_${response.status}_${result.error?.code ?? 'UNKNOWN'}`)
  return result
}
function saveProbeResult(state, kind, status, details) {
  if (status === 'passed' && observation.writeFailures) throw Error('DSH_E2E_OBSERVATION_WRITE_FAILED')
  state.probes[kind] = { status, recordedAt: new Date().toISOString(), ...details }
  state.probeAttempts = [...(state.probeAttempts ?? []), { kind, ...state.probes[kind] }]
  writePrivate(statePath, state)
  writePrivate(path.join(directory, 'report.private.json'), { schema, cases: Object.entries(state.cases).map(([id, value]) => ({ id, ...value })), probes: state.probes })
}
async function createProbeCase(id, tripTemplate, state, baseUrl) {
  const subject = `flightor-dsh-e2e-${id}`
  const identity = await new PostgresUserIdentityRepository(db).resolveWechat({ providerSubject: subject, nickname: `DSH ${id}`, avatarUrl: '' })
  const token = await issueAccessToken(identity, env)
  const previous = state.cases[id] ?? {}
  let tripId = previous.tripId, conversationId = previous.conversationId
  setupWritesAllowed = true
  try {
    if (!tripId) tripId = (await http('POST', `${baseUrl}/v1/trips`, token, tripTemplate)).trip.id
    if (!conversationId) conversationId = (await http('POST', `${baseUrl}/v1/conversations`, token, { trip_id: tripId })).conversation.id
  } finally { setupWritesAllowed = false }
  state.cases[id] = { tripId, conversationId, ownerId: identity.userId, publicId: identity.publicId }
  writePrivate(statePath, state)
  return { identity, token, tripId, conversationId }
}
async function runServiceProbe(kind, appContext, target, state) {
  const started = performance.now(), beforeBudget = readBudget(budgetPath)
  const { createDshManager, createDshService } = await import('../dist/agent/dsh/composition.js')
  const { DshSessionManager } = await import('../dist/agent/dsh/session-manager.js')
  const sessions = kind === 'model' ? new DshSessionManager({ root: env.DSH_DATA_DIRECTORY, metered: true,
    route: { provider: 'deepseek', model: env.DSH_MODEL, baseURL: env.DEEPSEEK_BASE_URL, maxTokens: env.DSH_MODEL_MAX_TOKENS },
    modelKey: env.DEEPSEEK_API_KEY, idleMs: env.DSH_IDLE_MS }) : createDshManager(appContext)
  const originalRun = sessions.run.bind(sessions)
  const allowed = kind === 'model' ? new Set(['get_trip_context']) : new Set(['get_trip_context', 'web_search', 'web_fetch'])
  const calls = [], receipts = [], webActivity = [], evidenceReceipts = []
  let managerResult
  sessions.run = async input => {
    const result = await originalRun({ ...input, tools: input.tools.filter(tool => allowed.has(tool.name)), onActivity: activity => {
      if (activity.type === 'tool_start' || activity.type === 'tool_end') webActivity.push(activity.toolName)
      input.onActivity?.(activity)
    }, execute: async (name, args, callId, signal) => {
    const internal = ['__model_admit', '__model_receipt', '__search_admit', '__search_receipt', '__web_search', '__web_fetch', '__record_web'].includes(name)
    if (!allowed.has(name) && !internal) return forbidden(`probe_tool_${name}`)
    calls.push(name)
    if (name === '__model_receipt' || name === '__search_receipt' || name === '__model_admit' || name === '__search_admit') receipts.push({ name, args })
    const value = await input.execute(name, args, callId, signal)
    if (name === '__record_web') evidenceReceipts.push({ tool: args?.tool, arguments: args?.args,
      sourceUrls: (args?.value?.sources ?? []).map(item => item.url), evidenceRefs: value?.evidenceRefs ?? [], urls: value?.urls ?? [] })
    return value
  } })
    managerResult = result
    return result
  }
  try {
    const service = createDshService(appContext, target.identity.userId, sessions)
    const message = kind === 'model'
      ? '请调用 get_trip_context 读取我的当前行程，然后仅用一句中文说明目的地。不要搜索、复述费用或日期，也不要修改行程。'
      : '先调用 get_trip_context。然后仅搜索一次 Tokyo Sensoji official tourism information，读取一条搜索所得官方页面以取得可用 evidenceRef。最后用一句中文概括文化看点，不输出引用ID或URL，不讨论价格/营业时间，不生成攻略、不修改行程。'
    const result = await service.runTurn({ requestId: randomUUID(), generationId: randomUUID(), tripId: target.tripId,
      conversationId: target.conversationId, message, locale: 'zh', signal: AbortSignal.timeout(330_000) })
    if (!result.reply.trim() || managerResult?.reason !== 'completed' || result.stopReason === 'model_failure'
      || result.warnings.includes('dsh_reply_withheld')) throw Error(`DSH_E2E_${kind.toUpperCase()}_INCOMPLETE_REPLY`)
    if (!calls.includes('get_trip_context')) throw Error(`DSH_E2E_${kind.toUpperCase()}_MISSING_CONTEXT_TOOL`)
    if (kind === 'model' && calls.some(name => ['__web_search', '__web_fetch', 'web_search', 'web_fetch', 'commit_travel_guide'].includes(name))) throw Error('DSH_E2E_MODEL_TOOL_SCOPE_VIOLATION')
    if (kind === 'search' && !calls.includes('__search_admit') && !calls.includes('__web_search')) throw Error('DSH_E2E_SEARCH_NOT_OBSERVED')
    if (kind === 'search' && calls.includes('commit_travel_guide')) throw Error('DSH_E2E_SEARCH_COMMITTED_GUIDE')
    if (kind === 'search' && !evidenceReceipts.some(item => item.tool === 'web_search' && item.arguments?.queries?.length && item.sourceUrls.some(url => /^https:\/\//i.test(url)))) throw Error('DSH_E2E_SEARCH_SOURCE_NOT_RECORDED')
    if (kind === 'search' && !evidenceReceipts.some(item => item.tool === 'web_fetch' && item.evidenceRefs.length > 0)) throw Error('DSH_E2E_FETCH_EVIDENCE_NOT_RECORDED')
    if (kind === 'model' && receipts.filter(item => item.name === '__model_receipt').length === 0) throw Error('DSH_E2E_MODEL_RECEIPT_MISSING')
    if (kind === 'search' && receipts.filter(item => item.name === '__search_receipt').length === 0 && !calls.includes('__web_search')) throw Error('DSH_E2E_SEARCH_RECEIPT_MISSING')
    saveProbeResult(state, kind, 'passed', { durationMs: performance.now() - started, beforeBudget, afterBudget: readBudget(budgetPath),
      calls: [...new Set(calls)], reply: result.reply, replyLength: result.reply.length, stopReason: result.stopReason,
      provider: kind === 'search' ? settings.DSH_SEARCH_PROVIDER : env.DSH_MODEL_PROVIDER, model: env.DSH_MODEL,
      execution: { reason: managerResult.reason, calls: managerResult.calls, resumed: managerResult.resumed }, webActivity: [...new Set(webActivity)], evidenceReceipts, receipts })
  } catch (error) {
    saveProbeResult(state, kind, 'failed', { errorCode: /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : `DSH_E2E_${kind.toUpperCase()}_FAILED`,
      durationMs: performance.now() - started, beforeBudget, afterBudget: readBudget(budgetPath),
      calls: [...new Set(calls)], provider: kind === 'search' ? settings.DSH_SEARCH_PROVIDER : env.DSH_MODEL_PROVIDER, model: env.DSH_MODEL,
      execution: managerResult ? { reason: managerResult.reason, calls: managerResult.calls, resumed: managerResult.resumed } : null,
      webActivity: [...new Set(webActivity)], evidenceReceipts, receipts })
    throw error
  } finally { await sessions.close() }
}

const runnerLock = acquireLock()
try {
  await admin.query(`create schema if not exists "${schema}"`)
  const migrationFolder = path.join(root, 'dist/db/migrations')
  const migrator = new Migrator({ db, migrationTableSchema: schema, provider: { async getMigrations() {
    const result = {}
    for (const file of fs.readdirSync(migrationFolder).filter(name => /^\d+_.+\.js$/.test(name)).sort()) result[file.slice(0, -3)] = await import(pathToFileURL(path.join(migrationFolder, file)).href)
    return result
  } } })
  const migrated = await migrator.migrateToLatest(); if (migrated.error) throw migrated.error
  if ((await sql`select current_schema() as name`.execute(db)).rows[0]?.name !== schema) throw Error('DSH_E2E_SCHEMA_NOT_ISOLATED')
  await installGuards()
  const providers = createProviders(env)
  providers.fares = new Proxy(providers.fares, { get(target, key) { const value = Reflect.get(target, key); return typeof value === 'function' ? async () => forbidden('fare_request') : value } })
  app = await buildApp({ db, env, providers })
  app.addHook('onRequest', async request => { recordEvent({ type: 'http', method: request.method, path: request.url.split('?')[0], at: new Date().toISOString() }) })
  app.addHook('onResponse', async (request, reply) => { recordEvent({ type: 'http_response', method: request.method,
    path: request.url.split('?')[0], statusCode: reply.statusCode, at: new Date().toISOString() }) })
  app.addHook('onRequest', (request, reply, done) => localizationRequest.run(request.url.includes('/localization'), done))
  const probesPassed = ['model', 'search', 'commit'].every(kind => priorState?.probes?.[kind]?.status === 'passed')
  app.addHook('preHandler', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
    const pathOnly = request.url.split('?')[0]
    if (request.method === 'POST' && /^\/v1\/agent\/turns\/[^/]+\/cancel$/.test(pathOnly)) return
    if (setupWritesAllowed && (request.method === 'POST' && ['/v1/trips', '/v1/conversations'].includes(pathOnly))) return
    const writesPlan = pathOnly === '/v1/agent/turns' || pathOnly === '/v1/agent/converse' || pathOnly.endsWith('/localization')
    if (executeCommit && probeCommitAllowed && request.method === 'POST' && pathOnly === '/v1/agent/turns') { probeCommitAllowed = false; return }
    if (!browserExecute || !probesPassed || !writesPlan) return reply.code(403).send({ error: { code: 'DSH_E2E_READ_ONLY' } })
  })
  await app.listen({ host: '127.0.0.1', port: Number(process.env.DSH_E2E_PORT ?? 3025) })
  const address = app.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const baseDate = priorState?.baseDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const travelFrom = priorState?.travelFrom ?? new Date(Date.parse(`${baseDate}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10)
  for (const item of [{ code: 'CN', name_zh: '中国', name_en: 'China' }, { code: 'JP', name_zh: '日本', name_en: 'Japan' }])
    await db.insertInto('countries').values(item).onConflict(oc => oc.column('code').doNothing()).execute()
  for (const city of [{ code: 'TYO', country: 'JP', zh: '东京', en: 'Tokyo' }, { code: 'BJS', country: 'CN', zh: '北京', en: 'Beijing' }]) {
    if (!await db.selectFrom('cities').select('id').where('iata_code', '=', city.code).executeTakeFirst())
      await db.insertInto('cities').values({ iata_code: city.code, country_code: city.country, name_zh: city.zh, name_en: city.en, timezone: city.country === 'JP' ? 'Asia/Tokyo' : 'Asia/Shanghai' }).execute()
  }
  const resolver = new (await import('../dist/aviation/location-resolver.js')).PostgresLocationResolver(db)
  const city = (await resolver.resolveLocation({ query: 'TYO', types: ['city'] })).matches.find(item => item.cityCode === 'TYO')
  const origin = (await resolver.resolveLocation({ query: 'PEK', types: ['airport'] })).matches.find(item => item.iata === 'PEK')
  if (!city || !origin) throw Error('DSH_E2E_REFERENCE_SEED_MISSING')
  const identityRepository = new PostgresUserIdentityRepository(db)
  const subject = priorState?.identitySubject ?? 'flightor-dsh-e2e-20260924-A'
  const identity = await identityRepository.resolveWechat({ providerSubject: subject, nickname: 'DSH E2E A', avatarUrl: '' })
  const token = await issueAccessToken(identity, env)
  const previousA = priorState?.cases?.A ?? {}
  let tripId = previousA.tripId, conversationId = previousA.conversationId
  if (!tripId) tripId = (await http('POST', `${baseUrl}/v1/trips`, token, { title: 'DSH E2E A Tokyo', initial_context: {
    origin, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] }, departureWindow: { from: travelFrom, to: travelFrom, precision: 'exact' },
    travelDays: 2, budget: { amount: 1500, currency: 'CNY', scope: 'trip' }, interests: ['文化', '小吃'], pace: 'relaxed', notes: ['机票自备，不查航班。两天合计预算。'] } })).trip.id
  if (!conversationId) conversationId = (await http('POST', `${baseUrl}/v1/conversations`, token, { trip_id: tripId })).conversation.id
  const state = { version: 1, schema, budgetPath, budgetBatchId: budgetSnapshot.batchId, probeAttempts: priorState?.probeAttempts ?? [], baseDate, travelFrom, identitySubject: subject,
    cases: { ...(priorState?.cases ?? {}), A: { tripId, conversationId } }, probes: priorState?.probes ?? {} }
  writePrivate(statePath, state)
  setupWritesAllowed = false
  const entries = [{ id: 'A', tripId, conversationId, token, user: { publicId: identity.publicId, nickname: identity.nickname },
    localStorage: { profile: { uid: identity.publicId, nickname: identity.nickname, avatarUrl: identity.avatarUrl, loginMethod: 'local' }, access_token: token, refresh_token: '' } }]
  const transportPath = path.join(directory, 'transport.private.json')
  writePrivate(transportPath, { baseUrl, entries, schema, budgetPath,
    browserContract: 'Use real fetch/XHR from H5 origin with Authorization bearer token; direct app.inject is not accepted as E2E evidence.' })
  const tripTemplate = { title: 'DSH isolated Tokyo probe', initial_context: { origin, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] },
    departureWindow: { from: travelFrom, to: travelFrom, precision: 'exact' }, travelDays: 2, budget: { amount: 1500, currency: 'CNY', scope: 'trip' },
    interests: ['文化', '小吃'], pace: 'relaxed', notes: ['机票自备，不查航班。两天合计预算。'] } }
  const appContext = { db, env, providers, redis: undefined }
  if (executeModel || executeSearch) {
    capacity(executeSearch ? 'search' : 'model')
    const target = await createProbeCase(executeModel ? 'MODEL' : 'SEARCH', tripTemplate, state, baseUrl)
    await runServiceProbe(executeModel ? 'model' : 'search', appContext, target, state)
  }
  if (executeCommit) {
    capacity('commit')
    // A publication probe must not inherit a previous failed turn's broader Goal.
    // Keep every prior scope/attempt and the same durable budget; this does not test warm recovery.
    const attemptNumber = state.probeAttempts.filter(attempt => attempt.kind === 'commit').length + 1
    const probeCaseId = `COMMIT-${attemptNumber}`
    const target = await createProbeCase(probeCaseId, { ...tripTemplate, initial_context: { ...tripTemplate.initial_context,
      interests: ['文化'], notes: ['机票自备，不查航班。最小文化攻略；预算仅作目标，不研究票券或预算可行性。'] } }, state, baseUrl)
    const commitStarted = performance.now(), beforeBudget = readBudget(budgetPath)
    let activeTurn
    try {
      const accepted = await http('POST', `${baseUrl}/v1/agent/turns`, target.token, { tripId: target.tripId, conversationId: target.conversationId,
        locale: 'zh', message: `机票自备，不查航班。请为${travelFrom}起的东京两天旅行研究并保存一份最小中文攻略：只研究浅草寺这一个文化景点，第一天安排参观，第二天留作自由休息，不需新增景点。预算是两天合计1500元的目标，不需证明满足。不要研究交通票券、小吃、价格或预算可行性，不承诺未知费用够用。` })
      activeTurn = accepted.turnId
      const deadline = Date.now() + 330_000
      let turn
      do {
        await new Promise(resolve => setTimeout(resolve, 1000))
        turn = await http('GET', `${baseUrl}/v1/agent/turns/${accepted.turnId}`, target.token)
        if (Date.now() > deadline) throw Error('DSH_E2E_COMMIT_POLL_DEADLINE')
      } while (!['completed', 'failed', 'cancelled'].includes(turn.status))
      const evidence = { status: turn.status, delivery: turn.response?.delivery?.status, artifactRefs: turn.response?.artifactRefs ?? [], stopReason: turn.response?.stopReason }
      writePrivate(path.join(directory, `commit-${accepted.turnId}.json`), { accepted, turn, durationMs: performance.now() - commitStarted })
      if (turn.status !== 'completed' || turn.response?.delivery?.status !== 'satisfied' || !evidence.artifactRefs.some(ref => ref.type === 'travel_guide')) throw Error('DSH_E2E_COMMIT_NOT_ACCEPTED')
      const ref = evidence.artifactRefs.find(ref => ref.type === 'travel_guide')
      const beforeGet = fs.readFileSync(budgetPath, 'utf8')
      const { artifact } = await http('GET', `${baseUrl}/v1/artifacts/${ref.id}?locale=zh`, target.token)
      const { PostgresArtifactRepository } = await import('../dist/artifacts/postgres.js')
      const persisted = await new PostgresArtifactRepository(db, target.identity.userId).get(ref.id)
      if (artifact.payload.publication?.status !== 'accepted' || persisted?.payload.publication?.finalization?.variants.zh?.status !== 'accepted') throw Error('DSH_E2E_PUBLICATION_NOT_ACCEPTED')
      if (fs.readFileSync(budgetPath, 'utf8') !== beforeGet) throw Error('DSH_E2E_GET_RESTARTED_MODEL')
      const { PostgresConversationRepository } = await import('../dist/conversations/postgres.js')
      const messages = await new PostgresConversationRepository(db, target.identity.userId).listMessages(target.conversationId)
      const assistant = messages.findLast(item => item.role === 'assistant')
      if (assistant?.metadata?.engine !== 'dsh') throw Error('DSH_E2E_WRONG_ENGINE')
      writePrivate(path.join(directory, `artifact-${ref.id}.json`), persisted)
      saveProbeResult(state, 'commit', 'passed', { ...evidence, probeCaseId, durationMs: performance.now() - commitStarted, beforeBudget, afterBudget: readBudget(budgetPath),
        turnId: accepted.turnId, artifactId: ref.id, contentHash: persisted.payload.publication.guideContentHash,
        publicReply: turn.response.reply, getBudgetUnchanged: true, engine: 'dsh', transport: 'authenticated loopback POST + GET polling' })
    } catch (error) {
      if (activeTurn) await http('POST', `${baseUrl}/v1/agent/turns/${activeTurn}/cancel`, target.token, {}).catch(() => {})
      saveProbeResult(state, 'commit', 'failed', { probeCaseId, durationMs: performance.now() - commitStarted, beforeBudget, afterBudget: readBudget(budgetPath),
        turnId: activeTurn, errorCode: /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'DSH_E2E_COMMIT_FAILED' })
      throw error
    }
  }
  const allProbesPassed = ['model', 'search', 'commit'].every(kind => state.probes[kind]?.status === 'passed')
  const report = { createdAt: new Date().toISOString(), schema, mode: browserExecute ? 'serve-execute' : executeModel ? 'probe-model'
    : executeSearch ? 'probe-search' : executeCommit ? 'probe-commit' : serve ? 'serve-read-only' : 'prepare', baseUrl,
    cases: entries.map(({ id, tripId, conversationId }) => ({ id, tripId, conversationId })), probes: state.probes, events,
    paidProbeDispatch: probeKind ?? 'not_performed', browserTransport: path.basename(transportPath),
    executionGate: allProbesPassed ? 'all model/search/commit probes passed; browser execution requires --serve --execute' : 'browser POST turn/localization blocked until model/search/commit probes pass' }
  writePrivate(path.join(directory, 'report.private.json'), report)
  console.log(JSON.stringify({ mode: report.mode, baseUrl, directory, transport: 'private file contains bearer tokens; do not share', paidProbeDispatch: report.paidProbeDispatch }))
  if (serve) await new Promise(resolve => { const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve() }; process.on('SIGINT', stop); process.on('SIGTERM', stop) })
} finally {
  await app?.close()
  recordEvent({ type: 'server_closed', at: new Date().toISOString(), observationWriteFailures: observation.writeFailures,
    forbiddenCalls: events.filter(event => event.type === 'forbidden').length })
  await db.destroy()
  await admin.end()
  fs.closeSync(runnerLock.descriptor)
  if (JSON.parse(fs.readFileSync(lockPath, 'utf8')).token === runnerLock.token) fs.unlinkSync(lockPath)
}
