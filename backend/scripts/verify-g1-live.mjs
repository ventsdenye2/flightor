// One explicitly authorized G1 smoke batch, not an A/B benchmark runner.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import dotenv from 'dotenv'
import pg from 'pg'
import { Kysely, PostgresDialect, Migrator } from 'kysely'
import { installG1Budget } from './g1-budget.mjs'

const root = path.resolve(import.meta.dirname, '..')
const sourceEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env')))
const safeJson = value => {
  let output = JSON.stringify(value, null, 2)
  for (const key of [sourceEnv.OPENROUTER_API_KEY, sourceEnv.SERPAPI_KEY, sourceEnv.AERODATABOX_API_KEY].filter(Boolean)) {
    for (const form of [key, encodeURIComponent(key)]) output = output.split(form).join('[REDACTED]')
  }
  return output
}
const model = sourceEnv.PLANNER_MODEL || sourceEnv.OPENROUTER_MODEL
const extendedCalls = process.env.G1_AUTHORIZED_CALL_LIMITS === '48/24'
const callLimits = extendedCalls ? { model: 48, serp: 24 } : { model: 24, serp: 12 }
const resumeDirectory = process.env.G1_RESUME_LEDGER_DIRECTORY
const resolvedResumeDirectory = resumeDirectory ? path.resolve(resumeDirectory) : undefined
if (resolvedResumeDirectory && (path.dirname(resolvedResumeDirectory) !== path.join(root, '.demo')
  || !path.basename(resolvedResumeDirectory).startsWith('g1-live-'))) throw Error('G1_LEDGER_DIRECTORY_FORBIDDEN')
if (model !== 'deepseek/deepseek-v4-flash-0731' || (sourceEnv.RESEARCH_MODEL || model) !== model
  || (sourceEnv.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '') !== 'https://openrouter.ai/api/v1'
  || (sourceEnv.NATIVE_RESEARCH_PROVIDER || 'serpapi') !== 'serpapi') throw Error('G1_CONFIG_NOT_ADMITTED')
const cases = [
  { id: 'self-ticket', withFlight: false, budget: 1500,
    prompt: '我的机票已自备，不查航班。请为2026年10月20日至21日东京两日游研究具体去处并保存攻略。本次两天游玩总预算1500元人民币，喜欢文化与小吃，节奏轻松，每天一个有来源的主景点，并提供实用交通或饮食信息。优先官方资料；未核实的价格、开放时间和交通耗时要明确说明。' },
  { id: 'selected-flight', withFlight: true, budget: 4000,
    prompt: '请根据我已采用的北京至东京直飞航班及全部航段时刻，安排2026年10月20日至21日东京两日攻略并保存。全程预算约束4000元人民币，喜欢文化与小吃、节奏轻松；抵达前不要安排活动，每天一个有来源的主景点，并补充实用信息。不要重新查票或更换航班，不需要演出展览；未知费用、开放时间和交通耗时保持未知。' }
]
const requestedCase = process.env.G1_CASE
if (requestedCase && !cases.some(item => item.id === requestedCase)) throw Error('G1_CASE_INVALID')
const selectedCases = requestedCase ? cases.filter(item => item.id === requestedCase) : cases
if (!process.argv.includes('--execute')) {
  const prior = resolvedResumeDirectory ? JSON.parse(fs.readFileSync(path.join(resolvedResumeDirectory, 'ledger.json'), 'utf8')) : undefined
  const used = prior?.calls.reduce((sum, call) => sum + Math.ceil((call.costUsd ?? call.reservedUsd) * 1_000_000), 0) / 1_000_000
  console.log(JSON.stringify({ mode: 'dry-run', model, limitUsd: 2, cases: selectedCases, stages: ['setup', 'fare_search_and_adoption', 'accepted', 'model/tool/http spans', 'first_saved_artifact_read', 'durable_verified', 'final_response', 'workspace_restore'],
    ...(prior ? { resume: { ledgerDirectory: resolvedResumeDirectory, accountingOnly: true, totalHeldOrSpentUsd: used,
      remainingUsd: prior.limitUsd - used, remainingModelCalls: callLimits.model - prior.calls.filter(c => c.kind === 'model').length,
      remainingSearchCalls: callLimits.serp - prior.calls.filter(c => c.kind === 'serp').length, callLimits } } : {}),
    executeRequires: 'G1_DATABASE_URL targeting dedicated flightor_g1_live, G1_AUTHORIZED_USD=2; provider and UI timing are distinct' }, null, 2))
  process.exit(0)
}
if (process.env.G1_AUTHORIZED_USD !== '2') throw Error('G1_CURRENT_AUTHORIZATION_REQUIRED')
const databaseUrl = process.env.G1_DATABASE_URL || ''
const target = new URL(databaseUrl)
if (target.hostname !== '127.0.0.1' || target.pathname !== '/flightor_g1_live' || !target.port) throw Error('G1_DEDICATED_DATABASE_REQUIRED')
if (!sourceEnv.OPENROUTER_API_KEY || !sourceEnv.SERPAPI_KEY) throw Error('G1_PROVIDER_CREDENTIALS_REQUIRED')
const runId = `g1-live-${new Date().toISOString().replace(/[:.]/g, '-')}`
const directory = path.join(root, '.demo', runId)
fs.mkdirSync(directory, { recursive: true })
const ledgerDirectory = resolvedResumeDirectory ?? directory
const rawFetch = globalThis.fetch
const catalogResponse = await rawFetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000), redirect: 'error' })
if (!catalogResponse.ok) throw Error('G1_PRICING_UNAVAILABLE')
const catalog = await catalogResponse.json()
const descriptor = catalog.data?.find(value => value.id === model)
if (!descriptor?.pricing) throw Error('G1_MODEL_PRICING_MISSING')
if (extendedCalls && !resumeDirectory) throw Error('G1_EXTENDED_CALLS_REQUIRE_ORIGINAL_LEDGER')
const meter = installG1Budget({ directory: ledgerDirectory, resume: Boolean(resumeDirectory), model, pricing: descriptor.pricing, limitUsd: 2, fetchImpl: rawFetch, callLimits })
const startingBudget = meter.snapshot()
process.once('exit', () => {
  try { meter.close() } catch { /* retain the lock if a request is still pending */ }
})
globalThis.fetch = meter.fetch
// Only this process opts into B2 and uses the dedicated database. No environment files are rewritten.
Object.assign(process.env, sourceEnv, { NODE_ENV: 'test', DATABASE_URL: databaseUrl, REDIS_ENABLED: 'false',
  PLANNER_LEAN_GOALS_ENABLED: 'true', LOG_LEVEL: 'error' })
const { parseEnv } = await import('../dist/config/env.js')
const env = parseEnv(process.env)
const { buildApp } = await import('../dist/app.js')
const { createProviders } = await import('../dist/providers/index.js')
const { PostgresUserIdentityRepository } = await import('../dist/identity/postgres.js')
const { issueAccessToken } = await import('../dist/auth/tokens.js')
const { PostgresLocationResolver } = await import('../dist/aviation/location-resolver.js')
const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 })
const db = new Kysely({ dialect: new PostgresDialect({ pool }) })
const manifest = { runId, startedAt: new Date().toISOString(), codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirtyDiffHash: createHash('sha256').update(execFileSync('git', ['diff', '--', 'backend'], { cwd: root })).digest('hex'),
  runnerHash: createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'), model, pricing: descriptor.pricing,
  meterHash: createHash('sha256').update(fs.readFileSync(path.join(root, 'scripts/g1-budget.mjs'))).digest('hex'),
  priceSources: ['https://openrouter.ai/api/v1/models', 'https://serpapi.com/pricing'],
  authorizedUsd: 2, callLimits, ledgerDirectory, startingBudget, resumedBudget: Boolean(resumeDirectory),
  leanProtocol: true, research: 'real SerpApi plus existing synthesis', uiPaintMeasured: false, evidenceLayer: 'real providers + real PostgreSQL + authenticated Fastify inject', cases: [] }
const write = () => {
  fs.writeFileSync(path.join(directory, 'report.json'), safeJson({ ...manifest, budget: meter.snapshot() }))
}
let app
try {
  const migrationFolder = path.join(root, 'dist/db/migrations')
  const migrator = new Migrator({ db, provider: { async getMigrations() {
    const migrations = {}
    for (const file of fs.readdirSync(migrationFolder).filter(file => /^\d+_.+\.js$/.test(file)).sort()) {
      migrations[file.slice(0, -3)] = await import(pathToFileURL(path.join(migrationFolder, file)).href)
    }
    return migrations
  } } })
  const migrated = await migrator.migrateToLatest()
  if (migrated.error) throw migrated.error
  const providers = createProviders(env)
  const originalChat = providers.openrouter.chat.bind(providers.openrouter)
  let receiptNumber = 0
  providers.openrouter.chat = async (...args) => {
    const response = await originalChat(...args)
    // Explicit local test evidence; omit prompts, reasoning traces and credentials.
    fs.writeFileSync(path.join(directory, `model-receipt-${++receiptNumber}.json`), safeJson({ id: response.id, model: response.model,
      provider: response.provider, usage: response.usage, choices: response.choices?.map(choice => ({ finish_reason: choice.finish_reason,
        message: { role: choice.message?.role, content: choice.message?.content, tool_calls: choice.message?.tool_calls } })) }))
    return response
  }
  app = await buildApp({ db, env, providers })
  const originalInfo = app.log.info.bind(app.log)
  app.log.info = (value, ...args) => {
    if (value?.plannerObservation) {
      const observation = value.plannerObservation
      const active = manifest.cases.find(entry => entry.tripId === observation.tripId)
      if (active) { active.observation = observation; write() }
    }
    return originalInfo(value, ...args)
  }
  const locations = new PostgresLocationResolver(db)
  const city = (await locations.resolveLocation({ query: 'Tokyo', types: ['city'], limit: 5 })).matches.find(value => value.cityCode === 'TYO')
  const origin = (await locations.resolveLocation({ query: 'PEK', types: ['airport'], limit: 5 })).matches.find(value => value.iata === 'PEK')
  if (!city || !origin) throw Error('G1_REFERENCE_SEED_MISSING')
  for (const specification of selectedCases) {
    const entry = { caseId: specification.id, prompt: specification.prompt, status: 'running', stages: {}, firstArtifacts: {}, artifacts: [], pollStages: [] }
    manifest.cases.push(entry); write()
    const caseStart = performance.now()
    let accepted, request
    try {
      const identity = await new PostgresUserIdentityRepository(db).resolveWechat({ providerSubject: `g1-${runId}-${specification.id}-${randomUUID()}`, nickname: 'G1 acceptance', avatarUrl: '' })
      const token = await issueAccessToken(identity, env)
      request = async (method, url, payload, headers = {}) => {
        const response = await app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, ...(payload === undefined ? {} : { payload }) })
        const body = response.json()
        if (response.statusCode >= 400) throw Object.assign(Error(body.error?.code || `HTTP_${response.statusCode}`), { statusCode: response.statusCode })
        return body
      }
      const initial = { origin, destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] },
        departureWindow: { from: '2026-10-20', to: '2026-10-20', precision: 'exact' }, travelDays: 2,
        budget: { amount: specification.budget, currency: 'CNY', scope: 'trip' }, interests: ['文化', '小吃'], pace: 'relaxed',
        notes: [specification.withFlight ? '使用已采用航班安排抵达后的行程；不再查票。' : '机票自备；本次预算为两天游玩总额，不查机票。'] }
      const { trip } = await request('POST', '/v1/trips', { title: `G1 ${specification.id}`, initial_context: initial })
      entry.tripId = trip.id
      const { conversation } = await request('POST', '/v1/conversations', { trip_id: trip.id })
      entry.conversationId = conversation.id
      entry.stages.setupMs = performance.now() - caseStart
      if (specification.withFlight) {
        const started = performance.now()
        const search = await request('POST', '/v1/flight-searches', { tripId: trip.id, conversationId: conversation.id, origin: 'PEK', destination: 'NRT', departureDate: '2026-10-20', currency: 'CNY', travelClass: 1 }, { 'idempotency-key': `g1-${runId}` })
        const { artifact } = await request('GET', `/v1/artifacts/${search.artifactRef.id}`)
        fs.writeFileSync(path.join(directory, `${specification.id}-flight.json`), safeJson(artifact))
        const offer = (artifact.payload.offers || []).filter(value => value.segments.length === 1 && value.segments[0].arrivesAt.slice(0, 10) === '2026-10-20')
          .sort((a, b) => a.totalAmount - b.totalAmount)[0]
        if (!offer) throw Error('G1_NO_SAME_DAY_DIRECT_OFFER')
        const workspace = await request('GET', `/v1/trips/${trip.id}/workspace`)
        const adopted = await request('PATCH', `/v1/trips/${trip.id}`, { expectedVersion: workspace.trip.version,
          selectedFlight: { kind: 'offer', artifactId: artifact.id, offerId: offer.id, layoverPreference: 'airport_only' } })
        entry.selection = adopted.trip.selectedFlight
        entry.stages.fareSearchAndAdoptionMs = performance.now() - started
      }
      const submittedAt = performance.now()
      accepted = await request('POST', '/v1/agent/turns', { tripId: trip.id, conversationId: conversation.id, message: specification.prompt })
      entry.turnId = accepted.turnId; entry.generationId = accepted.generationId
      entry.stages.apiAcceptedMs = performance.now() - submittedAt; write()
      let view, lastStage
      do {
        await delay(800)
        view = await request('GET', `/v1/agent/turns/${accepted.turnId}`)
        const stage = view.stage ?? view.status
        if (stage !== lastStage) { entry.pollStages.push({ stage, elapsedMs: performance.now() - submittedAt }); lastStage = stage }
        for (const ref of view.artifactRefs || []) {
          if (!['flight_search', 'travel_guide'].includes(ref.type) || entry.artifacts.some(value => value.id === ref.id)) continue
          const { artifact } = await request('GET', `/v1/artifacts/${ref.id}`)
          entry.artifacts.push({ id: artifact.id, type: artifact.type })
          entry.firstArtifacts[ref.type] ??= { artifactId: ref.id, apiReadElapsedMs: performance.now() - submittedAt }
          fs.writeFileSync(path.join(directory, `${specification.id}-${ref.type}-${ref.id}.json`), safeJson(artifact))
        }
        write()
        if (performance.now() - submittedAt > 330000) throw Error('G1_POLL_DEADLINE')
      } while (view.status !== 'completed' && view.status !== 'failed')
      entry.stages.finalResponseMs = performance.now() - submittedAt
      entry.response = view.response ?? null
      if (view.status !== 'completed') throw Error(view.error?.code || 'G1_TURN_FAILED')
      const restoreStart = performance.now()
      const workspace = await request('GET', `/v1/trips/${trip.id}/workspace?conversationId=${conversation.id}`)
      entry.stages.workspaceRestoreMs = performance.now() - restoreStart
      fs.writeFileSync(path.join(directory, `${specification.id}-workspace.json`), safeJson(workspace))
      const guideRef = view.response.artifactRefs.find(value => value.type === 'travel_guide' && view.response.delivery?.artifactIds?.includes(value.id))
      entry.restored = Boolean(guideRef && workspace.artifactRefs.some(ref => ref.id === guideRef.id)
        && workspace.messages.some(message => message.delivery?.status === 'satisfied' && message.artifactRefs.some(ref => ref.id === guideRef.id)))
      entry.status = view.response.delivery?.status === 'satisfied' && view.response.stopReason === 'completed' && entry.restored ? 'passed' : 'failed'
      if (entry.status === 'failed') entry.errorCode = 'G1_NOT_SATISFIED_OR_NOT_RESTORED'
    } catch (error) {
      entry.status = 'failed'; entry.errorCode = /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'G1_EXECUTION_FAILED'
      entry.errorDetail = String(error.message).slice(0, 1000)
      if (accepted && request) await request('POST', `/v1/agent/turns/${accepted.turnId}/cancel`, {}).catch(() => {})
      if (entry.tripId && request) {
        const started = performance.now()
        const workspace = await request('GET', `/v1/trips/${entry.tripId}/workspace`).catch(() => null)
        entry.stages.failureWorkspaceReadMs = performance.now() - started
        if (workspace) fs.writeFileSync(path.join(directory, `${specification.id}-failed-workspace.json`), safeJson(workspace))
      }
    } finally {
      entry.stages.totalCaseMs = performance.now() - caseStart; write()
      console.log(JSON.stringify({ caseId: entry.caseId, status: entry.status, errorCode: entry.errorCode, stages: entry.stages }))
    }
  }
} catch (error) {
  manifest.setupFailure = /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'G1_SETUP_FAILED'
  manifest.setupErrorDetail = String(error.message).slice(0, 1000)
  process.exitCode = 1
} finally {
  await app?.close()
  await db.destroy()
  globalThis.fetch = rawFetch
  manifest.finishedAt = new Date().toISOString(); write()
  meter.close()
  if (manifest.cases.length !== selectedCases.length || manifest.cases.some(entry => entry.status !== 'passed')) process.exitCode = 1
  console.log(JSON.stringify({ evidenceDirectory: directory, cases: manifest.cases.map(entry => ({ id: entry.caseId, status: entry.status })), budget: meter.snapshot() }))
}
