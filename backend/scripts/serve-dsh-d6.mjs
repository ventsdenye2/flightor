import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Migrator, Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import dotenv from 'dotenv'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')
const args = process.argv.slice(2)
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
const required = name => { const value = arg(name); if (!value) throw Error(`D6_ARGUMENT_REQUIRED_${name.replace(/^--/, '').replaceAll('-', '_').toUpperCase()}`); return value }
if (args.includes('--help')) {
  console.log('node backend/scripts/serve-dsh-d6.mjs --database-url <loopback> --provider-env <path> --history-ledger <path> [--fare-env <path> --allow-fares] [--places-url URL --places-user-agent TEXT --places-proxy URL] [--run-dir <path> --resume] [--api-port N] [--h5-port N] [--execute]')
  process.exit(0)
}

const resume = args.includes('--resume')
const runDir = path.resolve(resume ? required('--run-dir') : arg('--run-dir') || path.join(repoRoot, 'backend/.demo/dsh-d6-runtime', randomUUID()))
const privateDir = path.join(runDir, 'private')
const manifestPath = path.join(privateDir, 'run-manifest.private.json')
const transportPath = path.join(privateDir, 'transport.private.json')
const previousManifest = resume ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) : undefined
if (resume && previousManifest?.version !== 1) throw Error('D6_RESUME_MANIFEST_INVALID')
const runtimeDir = path.resolve(arg('--runtime-dir') || previousManifest?.runtimeDir || path.join(repoRoot, 'backend/dist'))
const historyPath = path.resolve(required('--history-ledger'))
const envPath = path.resolve(required('--provider-env'))
const connectionUrl = required('--database-url')
const fareEnvPath = arg('--fare-env') ? path.resolve(arg('--fare-env')) : undefined
const allowFares = args.includes('--allow-fares')
if (allowFares && !fareEnvPath) throw Error('D6_FARE_ENV_REQUIRED')
const placesUrlArg = arg('--places-url')
const placesUserAgentArg = arg('--places-user-agent')
const placesProxyArg = arg('--places-proxy')
const apiPortArg = Number(arg('--api-port') || 0), h5PortArg = Number(arg('--h5-port') || 0)
const execute = args.includes('--execute')
for (const port of [apiPortArg, h5PortArg]) if (port && (!Number.isInteger(port) || port < 1 || port > 65535)) throw Error('D6_INVALID_PORT')
if (apiPortArg && h5PortArg && apiPortArg === h5PortArg) throw Error('D6_PORTS_MUST_DIFFER')
const dbTarget = new URL(connectionUrl)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(dbTarget.hostname) || !dbTarget.port || dbTarget.searchParams.has('options')) throw Error('D6_DEDICATED_LOOPBACK_DATABASE_REQUIRED')
const historyRaw = await fs.readFile(historyPath)
const history = JSON.parse(historyRaw.toString('utf8'))
if (!Array.isArray(history.entries)) throw Error('D6_HISTORY_LEDGER_INVALID')
const legacyFingerprint = { sha256: createHash('sha256').update(historyRaw).digest('hex'), entries: history.entries.length,
  pending: history.entries.filter(entry => !entry.receipt).length }
const runId = previousManifest?.runId || randomUUID()
const schema = previousManifest?.schema || `dsh_d6_${runId.replaceAll('-', '')}`
const budgetPath = path.join(privateDir, 'budget.json')
const localKeyPath = path.join(privateDir, 'local-login-key.private')
const jwtSecretPath = path.join(privateDir, 'jwt-secret.private')
const localLoginKey = previousManifest ? await readPrivateString(localKeyPath) : randomUUID() + randomUUID()
const jwtSecret = previousManifest ? await readPrivateString(jwtSecretPath) : randomUUID() + randomUUID()
const outputRoot = previousManifest?.frontendOutputRoot || `dist-h5-d6-${runId.replaceAll('-', '')}`
const h5Root = path.join(repoRoot, outputRoot)
const apiPort = previousManifest?.apiPort ?? apiPortArg
const h5Port = previousManifest?.h5Port ?? h5PortArg
const runtimeFingerprint = async directory => {
  const hash = createHash('sha256')
  async function visit(folder, relative = '') {
    for (const item of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.join(relative, item.name)
      if (item.isDirectory()) await visit(path.join(folder, item.name), rel)
      else { hash.update(rel.replaceAll('\\', '/')); hash.update(await fs.readFile(path.join(folder, item.name))) }
    }
  }
  await visit(directory)
  return hash.digest('hex')
}
const sourceFingerprint = async () => {
  const hash = createHash('sha256')
  for (const relative of ['backend/src', 'src', 'config', 'scripts', 'backend/scripts']) {
    hash.update(relative)
    hash.update(await runtimeFingerprint(path.join(repoRoot, relative)))
  }
  for (const file of ['package.json', 'package-lock.json', 'backend/package.json', 'backend/package-lock.json']) {
    hash.update(file); hash.update(await fs.readFile(path.join(repoRoot, file)))
  }
  return hash.digest('hex')
}
const workerFingerprint = async directory => {
  const hash = createHash('sha256')
  const visit = async (folder, relative = '') => {
    for (const item of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.isDirectory() && ['node_modules', 'test', 'sessions'].includes(item.name)) continue
      const rel = path.join(relative, item.name)
      if (item.isDirectory()) await visit(path.join(folder, item.name), rel)
      else if (item.name === 'package.json' || item.name === 'package-lock.json' || item.name.endsWith('.mjs')) {
        hash.update(rel.replaceAll('\\', '/')); hash.update(await fs.readFile(path.join(folder, item.name)))
      }
    }
  }
  await visit(directory)
  return hash.digest('hex')
}
let admin, pool, db, app, staticServer, observation, guards
let lockHandle
let stage = 'configuration'

function writePrivate(file, value) { return fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' }) }
async function readPrivateString(file) {
  const value = JSON.parse(await fs.readFile(file, 'utf8'))
  if (typeof value !== 'string' || value.length < 32) throw Error('D6_PRIVATE_RUN_KEY_INVALID')
  return value
}
function safeError(value) { return /^[A-Z0-9_:-]{1,160}$/.test(value) ? value : 'D6_SETUP_FAILED' }
function closeHttpServer(server) {
  return server ? new Promise(resolve => server.close(() => resolve())) : Promise.resolve()
}
function staticHandler(root) {
  const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
  return http.createServer(async (request, response) => {
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname) } catch { response.writeHead(400).end(); return }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const target = path.resolve(root, relative)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return }
    try {
      const content = await fs.readFile(target)
      response.writeHead(200, { 'content-type': types[path.extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }).end(content)
    } catch (failure) { response.writeHead(failure.code === 'ENOENT' ? 404 : 500).end() }
  })
}

try {
  stage = 'provider_env_read'
  const providerVars = dotenv.parse(await fs.readFile(envPath))
  Object.assign(process.env, providerVars)
  if (!allowFares) process.env.SERPAPI_KEY = ''
  stage = 'environment_parse'
  let fareCredentialPresent = false
  if (allowFares) {
    const fareVars = dotenv.parse(await fs.readFile(fareEnvPath))
    if (!fareVars.SERPAPI_KEY) throw Error('D6_SERPAPI_CREDENTIAL_MISSING')
    process.env.SERPAPI_KEY = fareVars.SERPAPI_KEY
    fareCredentialPresent = true
  }
  Object.assign(process.env, {
    NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(apiPort || 3000), DATABASE_URL: connectionUrl,
    DATABASE_POOL_MIN: '0', DATABASE_POOL_MAX: '12', REDIS_URL: 'redis://127.0.0.1:6379', REDIS_ENABLED: 'false',
    JWT_SECRET: jwtSecret, LOCAL_LOGIN_ENABLED: 'true', LOCAL_LOGIN_KEY: localLoginKey,
    ...(placesUrlArg !== undefined ? { PLACES_NOMINATIM_URL: placesUrlArg } : {}),
    ...(placesUserAgentArg !== undefined ? { PLACES_USER_AGENT: placesUserAgentArg } : {}),
    ...(placesProxyArg !== undefined ? { PLACES_PROXY_URL: placesProxyArg } : {}),
    FLIGHTOR_AGENT_ENGINE: 'dsh', DSH_AUTHORIZED_USD: '0', DSH_AUTHORIZED_MODEL_CALLS: '10000',
    DSH_AUTHORIZED_SEARCH_CALLS: '10000', DSH_BUDGET_UNLIMITED: 'true', DSH_BUDGET_PATH: budgetPath,
    DSH_DATA_DIRECTORY: path.join(privateDir, 'dsh-data'), LOG_LEVEL: 'error'
  })
  const { parseEnv } = await import(pathToFileURL(path.join(runtimeDir, 'config/env.js')).href)
  const env = parseEnv(process.env)
  stage = 'route_guard'
  if (!env.DEEPSEEK_API_KEY || env.DSH_MODEL_PROVIDER !== 'deepseek' || env.DSH_MODEL !== 'deepseek-v4-flash'
    || env.DSH_SEARCH_PROVIDER !== 'deepseek-official') throw Error('D6_CONFIGURED_DEEPSEEK_ROUTE_REQUIRED')
  const coreConfig = { modelProvider: env.DSH_MODEL_PROVIDER, model: env.DSH_MODEL, searchProvider: env.DSH_SEARCH_PROVIDER,
    maxTokens: env.DSH_MODEL_MAX_TOKENS, thinking: 'disabled', nativeResearchProvider: env.NATIVE_RESEARCH_PROVIDER,
    places: { url: env.PLACES_NOMINATIM_URL, userAgent: env.PLACES_USER_AGENT, proxy: env.PLACES_PROXY_URL } }
  const sourceHash = await sourceFingerprint()
  const selectedWorkerDir = path.resolve(runtimeDir, 'agent/dsh/../../../dsh-runtime')
  const selectedWorkerHash = await workerFingerprint(selectedWorkerDir)
  if (previousManifest && (previousManifest.legacyLedger?.sha256 !== legacyFingerprint.sha256
    || JSON.stringify(previousManifest.coreConfig) !== JSON.stringify(coreConfig)
    || previousManifest.sourceFingerprint !== sourceHash
    || previousManifest.selectedWorkerFingerprint !== selectedWorkerHash
    || Boolean(previousManifest.fareAudit?.authorized) !== allowFares)) throw Error('D6_RESUME_CONFIG_CHANGED')
  if (!resume) {
    await fs.mkdir(runDir, { recursive: true })
    await fs.mkdir(privateDir, { recursive: true })
  }
  lockHandle = await fs.open(path.join(privateDir, 'server.lock'), 'wx')
  await lockHandle.writeFile(JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() }))
  if (!resume) {
    await writePrivate(localKeyPath, localLoginKey)
    await writePrivate(jwtSecretPath, jwtSecret)
    await writePrivate(path.join(privateDir, 'budget-history-link.json'), { version: 1, d6RunId: runId, createdAt: new Date().toISOString(),
      legacyLedger: legacyFingerprint, note: 'Reference only. D6 ledger below is new and does not inherit legacy authorization or receipts.' })
  } else if (!await fs.stat(budgetPath).catch(() => undefined)) throw Error('D6_RESUME_LEDGER_MISSING')
  const { FileDshBudget } = await import(pathToFileURL(path.join(runtimeDir, 'agent/dsh/budget.js')).href)
  stage = 'fresh_ledger'
  const d6Budget = new FileDshBudget({ path: budgetPath, authorizedUsd: 0, maxModelCalls: 10000, maxSearchCalls: 10000, unlimited: true })
  const budget = await d6Budget.readSnapshot()
  if (!resume && budget.entries.length) throw Error('D6_FRESH_LEDGER_NOT_EMPTY')
  let observerInfo = { status: 'unobserved', reason: 'selected backend runtime differs from the D6 observer target' }
  if (runtimeDir === path.resolve(repoRoot, 'backend/dist')) {
    const { installDshE2eObservation } = await import(pathToFileURL(path.join(scriptDir, 'dsh-e2e-observation.mjs')).href)
    observation = await installDshE2eObservation({ directory: path.join(privateDir, 'observation'), dataDirectory: env.DSH_DATA_DIRECTORY })
    observerInfo = { status: 'installed', directory: observation.directory }
  }

  admin = new pg.Pool({ connectionString: connectionUrl, max: 2, application_name: `${schema}_admin` })
  stage = 'database_schema'
  if (!resume) await admin.query(`create schema "${schema}"`)
  else if (!(await admin.query('select 1 from information_schema.schemata where schema_name = $1', [schema])).rowCount) throw Error('D6_RESUME_SCHEMA_MISSING')
  pool = new pg.Pool({ connectionString: connectionUrl, options: `-c search_path=${schema}`, max: 12, application_name: schema })
  db = new Kysely({ dialect: new PostgresDialect({ pool }) })
  const migrationFolder = path.join(runtimeDir, 'db/migrations')
  const migrator = new Migrator({ db, migrationTableSchema: schema, provider: { async getMigrations() {
    const migrations = {}
    for (const file of (await fs.readdir(migrationFolder)).filter(name => /^\d+_.+\.js$/.test(name)).sort())
      migrations[file.slice(0, -3)] = await import(pathToFileURL(path.join(migrationFolder, file)).href)
    return migrations
  } } })
  const migrated = await migrator.migrateToLatest()
  stage = 'database_migrations'
  if (migrated.error) throw migrated.error
  if ((await sql`select current_schema() as name`.execute(db)).rows[0]?.name !== schema) throw Error('D6_SCHEMA_NOT_ISOLATED')

  const { installD6RuntimeGuards } = await import(pathToFileURL(path.join(scriptDir, 'd6-runtime-guards.mjs')).href)
  guards = await installD6RuntimeGuards({ runtimeDir, auditPath: path.join(privateDir, 'runtime-guard-audit.private.jsonl') })
  const { buildApp } = await import(pathToFileURL(path.join(runtimeDir, 'app.js')).href)
  stage = 'backend_start'
  const { createProviders } = await import(pathToFileURL(path.join(runtimeDir, 'providers/index.js')).href)
  const providers = createProviders(env)
  const priorFareAudit = resume ? JSON.parse(await fs.readFile(path.join(privateDir, 'fare-audit.private.json'), 'utf8')) : undefined
  const fareAudit = { provider: allowFares ? 'serpapi' : 'disabled', credentialPresent: fareCredentialPresent,
    authorized: allowFares, authorization: allowFares ? 'existing SerpAPI allowance; no purchase' : 'not enabled for this run', calls: priorFareAudit?.calls || 0 }
  const fareLogPath = path.join(privateDir, 'fare-calls.private.jsonl')
  providers.fares = new Proxy(providers.fares, { get(target, key) {
    const value = Reflect.get(target, key, target)
    if (typeof value !== 'function') return value
    if (!allowFares) return async () => { throw Object.assign(new Error('D6_FARE_CALL_NOT_AUTHORIZED'), { code: 'D6_FARE_CALL_NOT_AUTHORIZED' }) }
    return async (...input) => {
      const event = { at: new Date().toISOString(), method: String(key), outcome: 'pending' }
      fareAudit.calls++
      try {
        const result = await value.apply(target, input)
        event.outcome = 'returned'
        if (Array.isArray(result?.offers)) event.resultCount = result.offers.length
        return result
      } catch (failure) {
        event.outcome = 'failed'
        event.errorCode = /^[A-Z0-9_]{1,120}$/.test(failure?.code || '') ? failure.code : 'PROVIDER_ERROR'
        throw failure
      } finally {
        await fs.appendFile(fareLogPath, `${JSON.stringify(event)}\n`, { mode: 0o600 })
        await fs.writeFile(path.join(privateDir, 'fare-audit.private.json'), JSON.stringify(fareAudit, null, 2), { mode: 0o600 })
      }
    }
  } })
  app = await buildApp({ db, env, providers })
  guards.installHttpHooks(app)
  app.addHook('preHandler', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.url === '/v1/auth/local' || request.url === '/v1/auth/refresh') return
    if (!execute) return reply.code(403).send({ error: { code: 'D6_EXECUTE_GATE_CLOSED' } })
  })
  const runtimeHash = await runtimeFingerprint(runtimeDir)
  if (previousManifest && previousManifest.runtimeHash !== runtimeHash) throw Error('D6_RESUME_BACKEND_CHANGED')
  const sourceProvenance = {
    backend: runtimeDir === path.resolve(repoRoot, 'backend/dist') ? 'current-worktree-build' : 'selected-runtime-archive',
    frontend: 'current-worktree-build'
  }
  if (previousManifest && JSON.stringify(previousManifest.sourceProvenance) !== JSON.stringify(sourceProvenance)) throw Error('D6_RESUME_SOURCE_PROVENANCE_CHANGED')
  await app.listen({ host: '127.0.0.1', port: apiPort || 0 })
  const actualApiPort = app.server.address().port
  const baseUrl = `http://127.0.0.1:${actualApiPort}`
  const actualH5Port = h5Port || 0
  if (previousManifest && previousManifest.apiPort !== actualApiPort) throw Error('D6_RESUME_API_PORT_CHANGED')
  if (!previousManifest) {
    stage = 'frontend_build'
    const buildEnv = { ...process.env, NODE_ENV: 'production', FLIGHTOR_API_BASE_URL: baseUrl, FLIGHTOR_LOCAL_LOGIN_KEY: localLoginKey,
      FLIGHTOR_USE_MOCK: 'false', FLIGHTOR_OUTPUT_ROOT: outputRoot, TARO_ENV: 'h5', FLIGHTOR_BUILD_MODE: 'dsh-d6',
      FLIGHTOR_BUILD_FINGERPRINT: sourceHash, FLIGHTOR_BUILD_DIRTY: 'true' }
    const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout?.trim()
    if (gitSha) buildEnv.FLIGHTOR_BUILD_SHA = gitSha
    const cliPath = path.join(repoRoot, 'node_modules', '@tarojs', 'cli', 'bin', 'taro')
    const build = spawnSync(process.execPath, [cliPath, 'build', '--type', 'h5'], { cwd: repoRoot, env: buildEnv, encoding: 'utf8', stdio: 'inherit' })
    if (build.status !== 0) throw Error('D6_H5_BUILD_FAILED')
  }
  if (previousManifest && previousManifest.frontendHash !== await runtimeFingerprint(h5Root)) throw Error('D6_RESUME_FRONTEND_CHANGED')
  staticServer = staticHandler(h5Root)
  stage = 'frontend_server'
  await new Promise((resolve, reject) => { staticServer.once('error', reject); staticServer.listen(actualH5Port, '127.0.0.1', resolve) })
  const h5ActualPort = staticServer.address().port
  if (previousManifest && previousManifest.h5Port !== h5ActualPort) throw Error('D6_RESUME_H5_PORT_CHANGED')
  const h5Url = `http://127.0.0.1:${h5ActualPort}`
  if (previousManifest) {
    const transport = JSON.parse(await fs.readFile(transportPath, 'utf8'))
    if (transport.baseUrl !== baseUrl || transport.h5Url !== h5Url || transport.runId !== runId) throw Error('D6_RESUME_TRANSPORT_CHANGED')
  } else {
    const frontendHash = await runtimeFingerprint(h5Root)
    await writePrivate(transportPath, { version: 1, runId, baseUrl, h5Url, localLoginKey,
      localStorage: {}, user: { nickname: 'D6 local acceptance' }, schema,
      note: 'Use visible local login in the H5 UI. Trip, conversation, itinerary, and flight selection are created only through UI actions.' })
    await writePrivate(manifestPath, { version: 1, runId, schema, databaseHost: dbTarget.hostname,
      databasePort: dbTarget.port, apiPort: actualApiPort, h5Port: h5ActualPort, executeGate: execute ? 'open-by-explicit-flag' : 'closed', coreConfig,
      ledgerPath: budgetPath, legacyLedger: legacyFingerprint, frontendOutputRoot: outputRoot, frontendHash,
      runtimeDir, runtimeHash, sourceFingerprint: sourceHash, sourceProvenance,
      selectedWorkerDir, selectedWorkerFingerprint: selectedWorkerHash, observerInfo,
      fareAudit: { provider: fareAudit.provider, credentialPresent: fareAudit.credentialPresent, authorized: allowFares },
      createdAt: new Date().toISOString() })
  }
  await fs.writeFile(path.join(privateDir, 'fare-audit.private.json'), JSON.stringify(fareAudit, null, 2), { mode: '600' })
  console.log(JSON.stringify({ status: 'ready', runId, schema, apiUrl: baseUrl, h5Url, executeGate: execute ? 'open' : 'closed',
    transportPath, manifestPath: path.join(privateDir, 'run-manifest.private.json'), ledgerPath: budgetPath,
    model: env.DSH_MODEL, search: env.DSH_SEARCH_PROVIDER, observer: observerInfo, fares: fareAudit }))
  await new Promise(resolve => {
    const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve() }
    process.on('SIGINT', stop); process.on('SIGTERM', stop)
  })
} catch (error) {
  const errorCode = typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,120}$/.test(error.code) ? error.code : safeError(error.message)
  console.error(JSON.stringify({ status: 'failed', runId, stage, error: errorCode, errorType: error?.name || 'Error' }))
  process.exitCode = 1
} finally {
  await closeHttpServer(staticServer).catch(() => {})
  await app?.close().catch(() => {})
  guards?.close()
  await db?.destroy().catch(() => {})
  if (admin) await admin.end().catch(() => {})
  observation?.uninstall?.()
  await lockHandle?.close().catch(() => {})
  if (lockHandle) await fs.unlink(path.join(privateDir, 'server.lock')).catch(() => {})
}
