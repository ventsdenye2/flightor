// D4 bounded live acceptance. Default is a read-only dry run; never rerun a failed case automatically.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import dotenv from 'dotenv'
import pg from 'pg'
import { Kysely, PostgresDialect, Migrator, sql } from 'kysely'

const root = path.resolve(import.meta.dirname, '..')
const directory = path.join(root, '.demo', 'dsh-live-20260924')
const schema = 'dsh_live_20260924'
const execute = process.argv.includes('--execute') && !process.argv.includes('--dry-run')
const serve = process.argv.includes('--serve')
const caseArg = process.argv.find(value => value.startsWith('--case='))?.slice(7)
  ?? (process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : undefined)
if (caseArg !== undefined && !['A', 'B'].includes(caseArg)) throw Error('DSH_LIVE_CASE_INVALID')
const selected = caseArg ? [caseArg] : ['A', 'B']
const basePath = process.env.FLIGHTOR_BASE_ENV_PATH
const base = basePath ? dotenv.parse(fs.readFileSync(path.resolve(basePath))) : {}
const overlayPath = process.env.FLIGHTOR_DSH_ENV_PATH ?? path.join(root, '.env.dsh.local')
const overlay = fs.existsSync(overlayPath) ? dotenv.parse(fs.readFileSync(overlayPath)) : {}
const settings = { ...base, ...overlay }
const budgetPath = path.resolve(root, settings.DSH_BUDGET_PATH || '.dsh-data/budget.json')
const dataDirectory = path.resolve(root, settings.DSH_DATA_DIRECTORY || '.dsh-data')
const statePath = path.join(directory, 'state.json')
const prior = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : undefined
if (prior && (prior.version !== 1 || prior.schema !== schema || prior.budgetPath !== budgetPath)) throw Error('DSH_LIVE_EXISTING_BATCH_MISMATCH')
const date = prior?.baseDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (date, count) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10)
const travelFrom = addDays(date, 30), travelTo = addDays(date, 31)
const specifications = {
  A: { withFlight: false, budget: 1500, messages: [
    `机票自备，不查航班。${travelFrom}到${travelTo}东京两天，两天合计1500元，文化和小吃，轻松一点，安排并保存。`,
    '为什么第二天上午推荐这个地方？只解释，不改行程。',
    '第一天不动，只把第二天下午换成室内文化场所。',
    '预算改成两天合计1200，不是每天；不要承诺未知费用肯定够。'
  ] },
  B: { withFlight: true, budget: 4000, messages: [
    `请根据我已明确采用航班的所有航段与抵达时刻，安排并保存${travelFrom}到${travelTo}东京两天行程，文化和小吃、轻松一点；全程合计4000元。不重新查票或更换航班，抵达前不要安排活动。`,
    '为什么第二天上午推荐这个地方？只解释，不改行程，也不要重查或更换航班。',
    '第一天不动，只把第二天下午换成室内文化场所；已采用航班和其他日程保持不变。'
  ] }
}
const secrets = Object.entries(settings).filter(([key, value]) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key) && value?.length >= 8).map(([, value]) => value)
const privateValues = new Set(secrets)
function safeJson(value) {
  let text = JSON.stringify(value, null, 2)
  for (const secret of privateValues) for (const form of [secret, encodeURIComponent(secret)]) text = text.split(form).join('[REDACTED]')
  return `${text}\n`
}
const rawBudget = fs.existsSync(budgetPath) ? JSON.parse(fs.readFileSync(budgetPath, 'utf8')) : null
if (!execute && !serve) {
  console.log(safeJson({ mode: 'dry-run', schema, baseDate: date, travelFrom, travelTo,
    baseEnvironmentSupplied: Boolean(basePath), overlayPresent: fs.existsSync(overlayPath),
    modelProvider: settings.DSH_MODEL_PROVIDER ?? 'openrouter', model: settings.DSH_MODEL ?? 'default pending parseEnv',
    searchProvider: settings.DSH_SEARCH_PROVIDER ?? 'serpapi-raw', budgetPath, existingBudget: rawBudget,
    authorizationConfigured: { usd: Number(settings.DSH_AUTHORIZED_USD ?? 0), modelCalls: Number(settings.DSH_AUTHORIZED_MODEL_CALLS ?? 0), searchCalls: Number(settings.DSH_AUTHORIZED_SEARCH_CALLS ?? 0) },
    cases: selected.map(id => ({ id, ...specifications[id], priorStatus: prior?.cases?.[id]?.status ?? 'not_started' })),
    policy: ['No database or provider call in dry-run', 'No automatic retry of a failed/interrupted case',
      'B uses a labelled synthetic flight and real explicit adoption, never live fare shopping',
      'Explicit localization is separately timed and charged', 'GET restoration must not change the budget', 'No G1 or UI acceptance inferred'] }))
  process.exit(0)
}
if (!basePath) throw Error('FLIGHTOR_BASE_ENV_PATH_REQUIRED')
if (!fs.existsSync(path.join(root, 'dist', 'agent', 'dsh', 'budget.js'))) throw Error('DSH_BACKEND_BUILD_REQUIRED')
if (execute && (Number(settings.DSH_AUTHORIZED_USD) !== 2 || Number(settings.DSH_AUTHORIZED_MODEL_CALLS) !== 48 || Number(settings.DSH_AUTHORIZED_SEARCH_CALLS) !== 12)) throw Error('DSH_LIVE_CURRENT_2_USD_48_MODEL_12_SEARCH_AUTHORIZATION_REQUIRED')
const dbFile = process.env.DSH_DB_ENV_PATH ?? path.join(root, '.demo', 'dsh-db-env.json')
const dbConfig = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
const connectionUrl = dbConfig.TEST_DATABASE_URL
const target = new URL(connectionUrl)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.port || target.searchParams.has('options')) throw Error('DSH_LIVE_DEDICATED_LOOPBACK_DATABASE_REQUIRED')
privateValues.add(connectionUrl)
fs.mkdirSync(directory, { recursive: true })
const runnerLockPath = path.join(directory, 'runner.lock')
// No fallback to the main workspace's env, database or historical authorization.
Object.assign(process.env, settings, { NODE_ENV: 'development', HOST: '127.0.0.1', DATABASE_URL: connectionUrl,
  REDIS_ENABLED: 'false', FLIGHTOR_AGENT_ENGINE: 'dsh', DSH_BUDGET_PATH: budgetPath, DSH_DATA_DIRECTORY: dataDirectory, LOG_LEVEL: 'error' })
const { parseEnv } = await import('../dist/config/env.js')
const env = parseEnv(process.env)
const { buildApp } = await import('../dist/app.js')
const { createProviders } = await import('../dist/providers/index.js')
const { PostgresUserIdentityRepository } = await import('../dist/identity/postgres.js')
const { PostgresArtifactRepository } = await import('../dist/artifacts/postgres.js')
const { PostgresConversationRepository } = await import('../dist/conversations/postgres.js')
const { PostgresLocationResolver } = await import('../dist/aviation/location-resolver.js')
const { issueAccessToken } = await import('../dist/auth/tokens.js')
const { FileDshBudget } = await import('../dist/agent/dsh/budget.js')
const budget = new FileDshBudget({ path: budgetPath, authorizedUsd: env.DSH_AUTHORIZED_USD,
  maxModelCalls: env.DSH_AUTHORIZED_MODEL_CALLS, maxSearchCalls: env.DSH_AUTHORIZED_SEARCH_CALLS })
const admin = new pg.Pool({ connectionString: connectionUrl, max: 2 })
const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: connectionUrl, options: `-c search_path=${schema}`, max: 8 }) }) })
const state = prior ?? { version: 1, schema, budgetPath, baseDate: date, travelFrom, travelTo, cases: {}, createdAt: new Date().toISOString() }
const routeConfiguration = { modelProvider: env.DSH_MODEL_PROVIDER, model: env.DSH_MODEL,
  modelBaseUrl: env.DSH_MODEL_PROVIDER === 'deepseek' ? env.DEEPSEEK_BASE_URL : env.OPENROUTER_BASE_URL,
  searchProvider: env.DSH_SEARCH_PROVIDER, searchBaseUrl: env.DEEPSEEK_SEARCH_BASE_URL, searchModel: env.DEEPSEEK_SEARCH_MODEL }
if (state.routeConfiguration && JSON.stringify(state.routeConfiguration) !== JSON.stringify(routeConfiguration)) throw Error('DSH_LIVE_BATCH_ROUTE_CHANGED')
state.routeConfiguration = routeConfiguration
const reportPath = path.join(directory, 'report.json')
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { version: 1, batch: 'dsh-live-20260924', schema,
  baseDate: date, travelFrom, travelTo, engine: 'dsh', modelProvider: env.DSH_MODEL_PROVIDER, model: env.DSH_MODEL, searchProvider: env.DSH_SEARCH_PROVIDER,
  cases: {}, runs: [], scope: 'Real authenticated production API + isolated PostgreSQL + real DSH; B flight fixture, no live airfare',
  ui: 'not_assessed', g1: 'not_passed', selectionRevisionRace: 'separate offline/database coverage; not changed in these live cases' }
const run = { id: randomUUID(), startedAt: new Date().toISOString(), execute, selectedCases: selected,
  codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  backendDiffHash: createHash('sha256').update(execFileSync('git', ['diff', '--', 'backend'], { cwd: root })).digest('hex'),
  runnerHash: createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'), forbiddenCalls: [], requests: [] }
report.runs.push(run)
const runnerLock = fs.openSync(runnerLockPath, 'wx', 0o600)
fs.writeFileSync(runnerLock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
function atomicJson(file, value, privateFile = false) {
  const temp = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(temp, privateFile ? `${JSON.stringify(value, null, 2)}\n` : safeJson(value), { mode: 0o600 })
  fs.renameSync(temp, file)
}
function write() { atomicJson(statePath, state); atomicJson(reportPath, report) }
let app, localizationAllowed = false, harnessPaidAction = false, shuttingDown = false
const nonce = randomUUID()
privateValues.add(nonce)
const tokens = {}, transportEntries = []
function forbidden(name) { run.forbiddenCalls.push({ name, at: new Date().toISOString() }); write(); throw Error(`DSH_LIVE_FORBIDDEN_${name.toUpperCase()}`) }
async function installGuards() {
  for (const [file, exportName, method] of [
    ['agent/cloud/service', 'CloudPlannerService', 'runTurn'], ['agent/runtime/runtime', 'AgentRuntime', 'run'],
    ['research-agent/production', 'ProductionResearchAgent', 'research'], ['research-agent/native', 'NativeResearchAgent', 'research'],
    ['providers/openrouter/research', 'OpenRouterResearchSynthesisModel', 'synthesize']
  ]) {
    const object = (await import(`../dist/${file}.js`))[exportName]?.prototype
    if (typeof object?.[method] === 'function') object[method] = async () => forbidden(`${exportName}_${method}`)
  }
  const { GuideFinalizer } = await import('../dist/travel-guides/finalization.js')
  const original = GuideFinalizer.prototype.generate
  GuideFinalizer.prototype.generate = function (...args) {
    if (!localizationAllowed) return forbidden('initial_finalizer')
    return original.apply(this, args)
  }
}
function check(condition, code) { if (!condition) throw Error(code) }
async function request(caseId, method, url, payload) {
  const started = performance.now()
  const response = await app.inject({ method, url, headers: { authorization: `Bearer ${tokens[caseId]}`, 'x-dsh-harness': nonce },
    ...(payload === undefined ? {} : { payload }) })
  let body
  try { body = response.json() } catch { body = { error: { code: 'NON_JSON_RESPONSE' } } }
  run.requests.push({ caseId, method, url, statusCode: response.statusCode, durationMs: performance.now() - started })
  if (response.statusCode >= 400) throw Object.assign(Error(body.error?.code ?? `HTTP_${response.statusCode}`), { body })
  return body
}
async function seedReferences() {
  for (const country of [{ code: 'CN', name_zh: '中国', name_en: 'China' }, { code: 'JP', name_zh: '日本', name_en: 'Japan' }]) {
    await db.insertInto('countries').values(country).onConflict(oc => oc.column('code').doNothing()).execute()
  }
  for (const city of [{ code: 'TYO', country: 'JP', zh: '东京', en: 'Tokyo', timezone: 'Asia/Tokyo' }, { code: 'BJS', country: 'CN', zh: '北京', en: 'Beijing', timezone: 'Asia/Shanghai' }]) {
    const current = await db.selectFrom('cities').select('id').where('iata_code', '=', city.code).executeTakeFirst()
    if (!current) await db.insertInto('cities').values({ iata_code: city.code, country_code: city.country, name_zh: city.zh, name_en: city.en, timezone: city.timezone }).execute()
  }
  for (const airport of [{ code: 'PEK', city: 'BJS', country: 'CN', zh: '北京首都国际机场', en: 'Beijing Capital International Airport' },
    { code: 'NRT', city: 'TYO', country: 'JP', zh: '成田国际机场', en: 'Narita International Airport' }]) {
    const current = await db.selectFrom('airports').select('id').where('iata_code', '=', airport.code).executeTakeFirst()
    const city = await db.selectFrom('cities').select('id').where('iata_code', '=', airport.city).executeTakeFirstOrThrow()
    if (!current) await db.insertInto('airports').values({ iata_code: airport.code, city_id: city.id, country_code: airport.country,
      name_zh: airport.zh, name_en: airport.en, timezone: airport.country === 'CN' ? 'Asia/Shanghai' : 'Asia/Tokyo', active: true }).execute()
  }
}
async function setupCase(id, city, origin) {
  const identity = await new PostgresUserIdentityRepository(db).resolveWechat({ providerSubject: `dsh-live-isolated-fixture-20260924-${id}`, nickname: `DSH isolated test ${id}`, avatarUrl: '' })
  tokens[id] = await issueAccessToken(identity, env); privateValues.add(tokens[id])
  let entry = state.cases[id]
  if (!entry) {
    const { trip } = await request(id, 'POST', '/v1/trips', { title: `DSH D4 ${id} isolated acceptance`, initial_context: {
      origin, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] },
      departureWindow: { from: travelFrom, to: travelFrom, precision: 'exact' }, travelDays: 2,
      budget: { amount: specifications[id].budget, currency: 'CNY', scope: 'trip' }, interests: ['文化', '小吃'], pace: 'relaxed',
      notes: [id === 'A' ? '机票自备，不查航班。两天合计预算，不是每天。' : '已采用航班仅为隔离验收合成fixture；不查票、不换航班。'] } })
    const { conversation } = await request(id, 'POST', '/v1/conversations', { trip_id: trip.id })
    entry = state.cases[id] = { tripId: trip.id, conversationId: conversation.id, status: 'prepared', rounds: [], ownerPublicId: identity.publicId }
    write()
  }
  check(entry.ownerPublicId === identity.publicId, 'DSH_LIVE_OWNER_CHANGED')
  if (id === 'B' && !entry.selection) {
    const workspace = await request(id, 'GET', `/v1/trips/${entry.tripId}/workspace`)
    check(!workspace.trip.selectedFlight, 'DSH_LIVE_UNEXPECTED_EXISTING_SELECTION')
    const sample = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/g1-publication-v1-original-samples.json'), 'utf8')).cases.find(value => value.id === 'selectedFlight').legacy.selectedFlightArtifact.payload
    const offer = structuredClone(sample.offers.find(value => value.transferType === 'direct' && value.segments.length === 1))
    check(offer, 'DSH_LIVE_FLIGHT_FIXTURE_MISSING')
    offer.id = `fixture-direct-PEK-NRT-${travelFrom}`
    delete offer.bookingUrl
    offer.segments = offer.segments.map(segment => ({ ...segment, departsAt: `${travelFrom} 08:00`, arrivesAt: `${travelFrom} 12:30` }))
    const now = new Date().toISOString(), artifactId = randomUUID()
    const verification = { status: 'verified', checkedAt: now, confidence: 1, sources: [{ provider: 'synthetic-dsh-acceptance-fixture', reference: 'fixture-not-live-price' }] }
    const flight = await new PostgresArtifactRepository(db, identity.userId).create({ id: artifactId, tripId: entry.tripId, conversationId: entry.conversationId,
      tripContextVersion: workspace.trip.contextVersion, type: 'flight_search', schemaVersion: 1, sourceArtifactIds: [],
      payload: { id: artifactId, type: 'flight_search', query: { ...sample.query, departureDate: travelFrom }, offers: [offer],
        provider: 'synthetic-dsh-acceptance-fixture', checkedAt: now, verification }, verification })
    const adopted = await request(id, 'PATCH', `/v1/trips/${entry.tripId}`, { expectedVersion: workspace.trip.version,
      selectedFlight: { kind: 'offer', artifactId: flight.id, offerId: offer.id, layoverPreference: 'airport_only' } })
    entry.selection = adopted.trip.selectedFlight; entry.flightFixture = { artifactId, offerId: offer.id, provenance: 'synthetic, not a live fare or booking', segments: offer.segments }
    write()
  }
  transportEntries.push({ id, tripId: entry.tripId, conversationId: entry.conversationId, token: tokens[id], user: { publicId: identity.publicId, nickname: identity.nickname } })
  return { entry, identity }
}
async function restore(id, locale = 'zh') {
  const entry = state.cases[id], before = await budget.readSnapshot(), started = performance.now()
  const workspace = await request(id, 'GET', `/v1/trips/${entry.tripId}/workspace?conversationId=${entry.conversationId}&locale=${locale}`)
  const messages = await request(id, 'GET', `/v1/conversations/${entry.conversationId}/messages?locale=${locale}`)
  const guides = []
  for (const reference of workspace.artifactRefs.filter(value => value.type === 'travel_guide')) {
    guides.push((await request(id, 'GET', `/v1/artifacts/${reference.id}?locale=${locale}`)).artifact)
  }
  const after = await budget.readSnapshot()
  check(JSON.stringify(before.entries) === JSON.stringify(after.entries), 'DSH_LIVE_GET_RESTARTED_AGENT')
  const value = { durationMs: performance.now() - started, workspace, messages, guides, readOnlyBudgetUnchanged: true }
  atomicJson(path.join(directory, `${id}-restore-${locale}.json`), value)
  return value
}
const acceptedGuide = restored => restored.guides.find(guide => guide.payload?.publication?.status === 'accepted')
async function runCase(id, identity) {
  const entry = state.cases[id]
  if (entry.status !== 'prepared') {
    if (entry.status === 'passed') { report.cases[id].subsequentRead = await restore(id); return }
    throw Error(`DSH_LIVE_${id}_FAILED_OR_INTERRUPTED_CASE_NOT_RETRIED`)
  }
  const result = report.cases[id] = { specification: specifications[id], tripId: entry.tripId, conversationId: entry.conversationId,
    status: 'running', rounds: [], localization: null, flightFixture: entry.flightFixture ?? null,
    semanticContentReview: 'manual_review_required', pixelPaint: 'not_measured' }
  entry.status = 'running'; write()
  const started = performance.now()
  let activeTurn
  try {
    let last = await restore(id)
    for (const [index, message] of specifications[id].messages.entries()) {
      const before = await budget.readSnapshot(), beforeGuide = acceptedGuide(last), roundStart = performance.now()
      const round = { index: index + 1, message, status: 'running', startedAt: new Date().toISOString(), beforeBudget: before, milestones: {}, pollStages: [] }
      result.rounds.push(round); entry.rounds.push({ index: index + 1, status: 'running' }); write()
      harnessPaidAction = true
      const accepted = await request(id, 'POST', '/v1/agent/turns', { tripId: entry.tripId, conversationId: entry.conversationId, locale: 'zh', message })
      activeTurn = accepted.turnId; round.turnId = accepted.turnId; entry.activeTurnId = accepted.turnId
      round.milestones.apiAcceptedMs = performance.now() - roundStart; write()
      let view, lastStage
      do {
        await delay(1000)
        view = await request(id, 'GET', `/v1/agent/turns/${accepted.turnId}`)
        const stage = view.stage ?? view.status
        if (lastStage !== stage) { round.pollStages.push({ stage, elapsedMs: performance.now() - roundStart }); lastStage = stage }
        for (const ref of view.artifactRefs ?? []) {
          if (ref.type !== 'travel_guide') continue
          round.milestones.firstSavedArtifactMs ??= performance.now() - roundStart
          const { artifact } = await request(id, 'GET', `/v1/artifacts/${ref.id}?locale=zh`)
          if (artifact.payload?.publication?.status === 'accepted') round.milestones.firstAcceptedTextMs ??= performance.now() - roundStart
        }
        if (performance.now() - roundStart > 330_000) throw Error('DSH_LIVE_POLL_DEADLINE')
      } while (!['completed', 'failed', 'cancelled'].includes(view.status))
      harnessPaidAction = false; activeTurn = undefined; delete entry.activeTurnId
      round.milestones.finalApiMs = performance.now() - roundStart; round.response = view.response ?? null
      round.afterBudget = await budget.readSnapshot()
      round.receipts = round.afterBudget.entries.filter(value => !before.entries.some(prior => prior.id === value.id))
      round.observation = { dshStartMs: null, firstUsefulReplyMs: round.milestones.firstAcceptedTextMs ?? round.milestones.finalApiMs,
        researchWallMs: null, note: 'Only measured API/receipt clocks are present; no inferred worker or overlapping span total.' }
      check(view.status === 'completed', view.error?.code ?? 'DSH_LIVE_TURN_FAILED')
      const allowedStopReasons = index === 1 || id === 'A' && index === 3 ? ['responded', 'completed'] : ['completed']
      check(allowedStopReasons.includes(view.response?.stopReason), 'DSH_LIVE_TURN_INCOMPLETE')
      const messages = await new PostgresConversationRepository(db, identity.userId).listMessages(entry.conversationId)
      const assistant = [...messages].reverse().find(value => value.role === 'assistant')
      check(assistant?.metadata?.engine === 'dsh', 'DSH_LIVE_ENGINE_NOT_DSH')
      round.engineEvidence = { engine: assistant.metadata.engine, modelCalls: assistant.metadata.model_calls, resumed: assistant.metadata.resumed }
      last = await restore(id); round.restoration = last
      const guide = acceptedGuide(last)
      if (index === 0 || index === 2) {
        check(view.response.delivery?.status === 'satisfied' && guide, 'DSH_LIVE_GUIDE_NOT_ACCEPTED_OR_SATISFIED')
        check(guide.payload.days.some(day => day.day === 2 && day.items.some(item => item.timeOfDay === 'morning'))
          && guide.payload.days.some(day => day.day === 2 && day.items.some(item => item.timeOfDay === 'afternoon')), 'DSH_LIVE_REQUIRED_FOLLOWUP_SLOTS_MISSING')
      }
      if (index === 1) {
        check(beforeGuide && guide?.id === beforeGuide.id && JSON.stringify(last.guides) === JSON.stringify(round.index === 2 ? result.rounds[0].restoration.guides : []), 'DSH_LIVE_EXPLANATION_REWROTE_GUIDE')
        check(view.response.reply.trim() !== beforeGuide.payload.publication.reply?.trim(), 'DSH_LIVE_EXPLANATION_REPEATED_SAVED_REPLY')
      }
      if (index === 2) {
        check(JSON.stringify(guide.payload.days.find(day => day.day === 1)) === JSON.stringify(beforeGuide.payload.days.find(day => day.day === 1)), 'DSH_LIVE_PATCH_CHANGED_DAY_ONE')
        check(JSON.stringify(guide.payload.days.find(day => day.day === 2).items.filter(item => item.timeOfDay !== 'afternoon'))
          === JSON.stringify(beforeGuide.payload.days.find(day => day.day === 2).items.filter(item => item.timeOfDay !== 'afternoon')), 'DSH_LIVE_PATCH_CHANGED_OTHER_SLOTS')
      }
      if (id === 'A' && index === 3) check(last.workspace.tripContextSummary.budget?.amount === 1200 && last.workspace.tripContextSummary.budget.scope === 'trip', 'DSH_LIVE_TOTAL_BUDGET_NOT_PRESERVED')
      if (id === 'B') check(JSON.stringify(last.workspace.trip.selectedFlight) === JSON.stringify(entry.selection), 'DSH_LIVE_SELECTED_FLIGHT_CHANGED')
      if (id === 'A') check(!last.workspace.trip.selectedFlight, 'DSH_LIVE_SELF_TICKET_SELECTION_CHANGED')
      round.status = 'passed'; round.durationMs = performance.now() - roundStart; entry.rounds[index].status = 'passed'; write()
    }
    const beforeLocalize = await restore(id), guide = acceptedGuide(beforeLocalize)
    check(guide, 'DSH_LIVE_LOCALIZATION_BASE_UNAVAILABLE')
    const before = await budget.readSnapshot(), localeStart = performance.now()
    result.localization = { artifactId: guide.id, status: 'running', beforeBudget: before, separateFromMainAgent: true }
    localizationAllowed = true; harnessPaidAction = true
    let localized
    try {
      localized = await request(id, 'POST', `/v1/artifacts/${guide.id}/localization`, { locale: 'en' })
      result.localization.response = localized
      result.localization.status = localized.artifact?.payload?.publication?.status === 'accepted' ? 'passed' : 'failed'
    } finally {
      localizationAllowed = false; harnessPaidAction = false
      const after = await budget.readSnapshot()
      result.localization.durationMs = performance.now() - localeStart
      result.localization.afterBudget = after
      result.localization.receipts = after.entries.filter(value => !before.entries.some(prior => prior.id === value.id))
    }
    check(localized.artifact?.payload?.publication?.status === 'accepted', 'DSH_LIVE_ENGLISH_LOCALIZATION_NOT_ACCEPTED')
    result.englishRestoration = await restore(id, 'en')
    check(result.englishRestoration.guides.some(value => value.id === guide.id && value.payload.publication?.status === 'accepted'), 'DSH_LIVE_ENGLISH_RESTORE_FAILED')
    result.status = entry.status = 'passed'
  } catch (error) {
    result.status = entry.status = 'failed'
    result.errorCode = /^[A-Z0-9_]{1,120}$/.test(error.message) ? error.message : 'DSH_LIVE_CASE_FAILED'
    if (error.body) result.failureResponse = error.body
    const round = result.rounds.at(-1)
    if (round?.status === 'running') {
      round.status = 'failed'; round.errorCode = result.errorCode; entry.rounds.at(-1).status = 'failed'
      round.durationMs = Date.now() - Date.parse(round.startedAt)
      round.afterBudget = await budget.readSnapshot()
      round.receipts = round.afterBudget.entries.filter(value => !round.beforeBudget.entries.some(prior => prior.id === value.id))
    }
    if (result.localization?.status === 'running') { result.localization.status = 'failed'; result.localization.errorCode = result.errorCode }
    if (activeTurn) await request(id, 'POST', `/v1/agent/turns/${activeTurn}/cancel`, {}).catch(() => {})
    result.failureRestore = await restore(id).catch(() => null)
    process.exitCode = 1
  } finally {
    harnessPaidAction = false; localizationAllowed = false; delete entry.activeTurnId
    result.totalWallMs = performance.now() - started
    result.finalBudget = await budget.readSnapshot()
    write()
    console.log(safeJson({ case: id, status: result.status, errorCode: result.errorCode, totalWallMs: result.totalWallMs }))
  }
}
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await app?.close(); await db.destroy(); await admin.end()
  fs.closeSync(runnerLock); fs.unlinkSync(runnerLockPath)
}
try {
  run.startingBudget = await budget.readSnapshot()
  await admin.query(`create schema if not exists "${schema}"`)
  const migrationFolder = path.join(root, 'dist/db/migrations')
  const migrator = new Migrator({ db, migrationTableSchema: schema, provider: { async getMigrations() {
    const result = {}
    for (const file of fs.readdirSync(migrationFolder).filter(file => /^\d+_.+\.js$/.test(file)).sort()) result[file.slice(0, -3)] = await import(pathToFileURL(path.join(migrationFolder, file)).href)
    return result
  } } })
  const migrated = await migrator.migrateToLatest(); if (migrated.error) throw migrated.error
  check((await sql`select current_schema() as name`.execute(db)).rows[0]?.name === schema, 'DSH_LIVE_SCHEMA_NOT_ISOLATED')
  await seedReferences(); await installGuards()
  const providers = createProviders(env)
  providers.fares = new Proxy(providers.fares, { get(target, property) { const value = Reflect.get(target, property); return typeof value === 'function' ? async () => forbidden('fare_request') : value } })
  app = await buildApp({ db, env, providers })
  app.addHook('preHandler', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
    if (request.headers['x-dsh-harness'] !== nonce) return reply.code(403).send({ error: { code: 'DSH_LIVE_UI_READ_ONLY' } })
    if ((request.url.startsWith('/v1/agent/turns') && !request.url.endsWith('/cancel') || request.url.endsWith('/localization')) && (!execute || !harnessPaidAction)) {
      return reply.code(403).send({ error: { code: 'DSH_LIVE_PAID_EXECUTION_DISABLED' } })
    }
  })
  await app.listen({ host: '127.0.0.1', port: serve ? Number(process.env.DSH_LIVE_PORT ?? 3024) : 0 })
  const address = app.server.address(), baseUrl = `http://127.0.0.1:${address.port}`
  const locations = new PostgresLocationResolver(db)
  const city = (await locations.resolveLocation({ query: 'TYO', types: ['city'] })).matches.find(value => value.cityCode === 'TYO')
  const origin = (await locations.resolveLocation({ query: 'PEK', types: ['airport'] })).matches.find(value => value.iata === 'PEK')
  check(city && origin, 'DSH_LIVE_REFERENCE_SEED_MISSING')
  for (const id of selected) {
    const { identity } = await setupCase(id, city, origin)
    atomicJson(path.join(directory, 'transport.private.json'), { baseUrl, entries: transportEntries }, true)
    if (execute) await runCase(id, identity)
    else if (report.cases[id]) report.cases[id].subsequentRead = await restore(id)
  }
  run.finishedAt = new Date().toISOString(); run.finalBudget = await budget.readSnapshot(); write()
  console.log(safeJson({ mode: execute ? 'executed' : 'serve-read-only', baseUrl, directory,
    cases: selected.map(id => ({ id, status: state.cases[id].status })), budget: run.finalBudget,
    transport: 'transport.private.json contains test tokens: never commit or share', g1: 'not_passed' }))
  if (serve) {
    process.once('SIGINT', () => { void shutdown() }); process.once('SIGTERM', () => { void shutdown() })
  } else await shutdown()
} catch (error) {
  run.failure = /^[A-Z0-9_]{1,120}$/.test(error.message) ? error.message : 'DSH_LIVE_SETUP_FAILED'
  run.finishedAt = new Date().toISOString(); write()
  await shutdown(); process.exitCode = 1
  console.error(safeJson({ error: run.failure, directory }))
}
