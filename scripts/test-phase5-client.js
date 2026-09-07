// Phase 5 client transport/session contract regression.
// This test transpiles the pure service module with a tiny request stub so it
// never needs Taro, a running API, or a real access token.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const servicePath = path.resolve(process.cwd(), 'src', 'services', 'conversationService.ts')
const source = fs.readFileSync(servicePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  fileName: servicePath
}).outputText

const calls = []
const requestStub = async options => {
  calls.push(options)
  if (options.url === '/v1/trips') return { trip: { id: 'trip-1' } }
  if (options.url === '/v1/conversations') return { conversation: { id: 'conversation-1' } }
  return {
    conversationId: 'conversation-1',
    tripId: 'trip-1',
    reply: 'cloud reply',
    tripContextSummary: {
      version: 0,
      destinations: { mode: 'open', required: [], preferred: [], excluded: [] },
      interests: [],
      readyForRouteGeneration: false
    },
    artifactRefs: [],
    suggestedActions: [{ id: 'continue_planning', label: 'Continue planning', kind: 'message' }],
    warnings: [],
    stopReason: 'needs_user_input'
  }
}

const module = { exports: {} }
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  console,
  URL,
  require(specifier) {
    if (specifier === '../utils/request') return { request: requestStub, USE_MOCK: false }
    if (specifier === './budgetParser') return { parseBudget: () => null }
    throw new Error(`unexpected dependency: ${specifier}`)
  }
}, { filename: servicePath })
const service = module.exports

const routeServicePath = path.resolve(process.cwd(), 'src', 'services', 'routeGenerationService.ts')
const routeServiceSource = fs.readFileSync(routeServicePath, 'utf8')
const routeServiceCompiled = ts.transpileModule(routeServiceSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  fileName: routeServicePath
}).outputText
const routeModule = { exports: {} }
const routeRequestCalls = []
const routeRequestStub = async options => {
  routeRequestCalls.push(options)
  const run = {
    id: 'run-1', tripId: 'trip-1', conversationId: 'conversation-1', idempotencyKey: options.header?.['Idempotency-Key'] ?? 'key-1',
    contextVersion: 4, status: options.method === 'DELETE' ? 'cancelled' : 'queued',
    progress: { stage: options.method === 'DELETE' ? 'cancelled' : 'queued', percent: options.method === 'DELETE' ? 100 : 0 },
    warnings: [], createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z'
  }
  return options.method === 'POST' ? { run, created: true } : { run }
}
vm.runInNewContext(routeServiceCompiled, {
  module: routeModule,
  exports: routeModule.exports,
  console,
  require(specifier) {
    if (specifier === '../utils/request') return { request: routeRequestStub, USE_MOCK: false }
    throw new Error(`unexpected route dependency: ${specifier}`)
  }
}, { filename: routeServicePath })
const routeService = routeModule.exports

const historyPath = path.resolve(process.cwd(), 'src', 'stores', 'chatHistoryCore.ts')
const historySource = fs.readFileSync(historyPath, 'utf8')
const historyCompiled = ts.transpileModule(historySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  fileName: historyPath
}).outputText
const historyModule = { exports: {} }
vm.runInNewContext(historyCompiled, {
  module: historyModule,
  exports: historyModule.exports,
  console,
  URL
}, { filename: historyPath })
const history = historyModule.exports

let passed = 0
let failed = 0
function check(name, condition) {
  if (condition) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}`)
  }
}

const bootstrap = await service.bootstrapCloudSession()
check('bootstrap creates Trip before Conversation', calls[0]?.url === '/v1/trips' && calls[1]?.url === '/v1/conversations')
check('bootstrap binds Conversation to returned Trip', JSON.stringify(calls[1]?.data) === JSON.stringify({ trip_id: 'trip-1' })
  && bootstrap.tripId === 'trip-1' && bootstrap.conversationId === 'conversation-1')

calls.length = 0
await service.converse({ tripId: 'trip-1', conversationId: 'conversation-1', message: '  latest request  ' })
check('Planner body contains exactly one new message', calls[0]?.url === '/v1/agent/converse'
  && JSON.stringify(calls[0]?.data) === JSON.stringify({
    tripId: 'trip-1', conversationId: 'conversation-1', message: 'latest request'
  }))
check('Planner body does not replay legacy messages or state', !('messages' in (calls[0]?.data ?? {})) && !('state' in (calls[0]?.data ?? {})))

routeRequestCalls.length = 0
await routeService.createRouteGenerationRun({ tripId: 'trip-1', conversationId: 'conversation-1', expectedTripVersion: 4, idempotencyKey: 'click-key-1' })
check('route POST uses the exact strict body and Idempotency-Key header', routeRequestCalls[0]?.url === '/v1/trips/trip-1/route-generation-runs'
  && JSON.stringify(routeRequestCalls[0]?.data) === JSON.stringify({ conversationId: 'conversation-1', expectedTripVersion: 4 })
  && routeRequestCalls[0]?.header?.['Idempotency-Key'] === 'click-key-1')
await routeService.createRouteGenerationRun({ tripId: 'trip-1', conversationId: 'conversation-1', expectedTripVersion: 4, idempotencyKey: 'click-key-1' })
check('retrying the same local request can reuse its idempotency key', routeRequestCalls[1]?.header?.['Idempotency-Key'] === routeRequestCalls[0]?.header?.['Idempotency-Key'])
await routeService.getRouteGenerationRun('run-1')
await routeService.cancelRouteGenerationRun('run-1')
check('poll and cancel use owner-scoped run endpoints', routeRequestCalls[2]?.url === '/v1/route-generation-runs/run-1'
  && routeRequestCalls[3]?.url === '/v1/route-generation-runs/run-1' && routeRequestCalls[3]?.method === 'DELETE')
check('terminal statuses are finite', routeService.isRouteGenerationTerminal('succeeded')
  && routeService.isRouteGenerationTerminal('failed') && routeService.isRouteGenerationTerminal('cancelled')
  && !routeService.isRouteGenerationTerminal('running'))

const cloudSession = history.createEmptyChatSession('cloud-session')
cloudSession.ownerId = 'user-a'
cloudSession.tripId = 'trip-1'
cloudSession.conversationId = 'conversation-1'
cloudSession.artifactRefs = [{ id: 'artifact-1', type: 'destination_set', schemaVersion: 1, presentationHint: 'destination_cards' }]
cloudSession.messages = [{ role: 'user', content: 'new cloud turn' }, { role: 'assistant', content: 'reply' }]
cloudSession.timeline = [{ id: 'turn-1', user: cloudSession.messages[0], assistant: cloudSession.messages[1], recommendations: [], suggestedActions: [], routes: [], warnings: [] }]
const cloudPayload = history.makeChatHistoryPayload('cloud-session', [cloudSession])
const cloudRestored = history.sanitizeHistoryPayload(cloudPayload).sessions[0]
check('owner-scoped cloud IDs and Artifact refs survive persistence', cloudRestored?.ownerId === 'user-a'
  && cloudRestored?.tripId === 'trip-1' && cloudRestored?.conversationId === 'conversation-1'
  && cloudRestored?.artifactRefs[0]?.id === 'artifact-1')

const legacy = history.createEmptyChatSession('legacy')
legacy.messages = [{ role: 'user', content: 'old history' }]
legacy.timeline = [{ id: 'legacy-turn', user: legacy.messages[0], assistant: null, recommendations: [], suggestedActions: [], routes: [], warnings: [] }]
check('legacy pending turns remain non-authoritative and are not restored', history.sanitizeHistoryPayload({ version: 1, currentSessionId: 'legacy', sessions: [legacy] }).sessions.length === 0)

const userStoreSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'stores', 'userStore.ts'), 'utf8')
check('logout clears credentials and owner cloud history only', userStoreSource.includes('clearAuthTokens()') && userStoreSource.includes('clearCloudChatHistory(ownerId)'))

const chatHistoryAdapterPath = path.resolve(process.cwd(), 'src', 'stores', 'chatHistory.ts')
const chatHistoryAdapterSource = fs.readFileSync(chatHistoryAdapterPath, 'utf8')
const chatHistoryAdapterCompiled = ts.transpileModule(chatHistoryAdapterSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  fileName: chatHistoryAdapterPath
}).outputText
const chatHistoryAdapterModule = { exports: {} }
const adapterStorage = {}
vm.runInNewContext(chatHistoryAdapterCompiled, {
  module: chatHistoryAdapterModule,
  exports: chatHistoryAdapterModule.exports,
  console,
  require(specifier) {
    if (specifier === '../utils/storage') return {
      getStorage: (key, fallback) => adapterStorage[key] ?? fallback,
      setStorage: (key, value) => { adapterStorage[key] = value },
      removeStorage: key => { delete adapterStorage[key] }
    }
    if (specifier === './chatHistoryCore') return history
    throw new Error(`unexpected ChatHistory dependency: ${specifier}`)
  }
}, { filename: chatHistoryAdapterPath })
const chatHistoryAdapter = chatHistoryAdapterModule.exports
const ownerALegacySession = history.createEmptyChatSession('owner-a-session')
ownerALegacySession.ownerId = 'owner-a'
ownerALegacySession.tripId = 'trip-owner-a'
ownerALegacySession.conversationId = 'conversation-owner-a'
const anonymousLegacySession = history.createEmptyChatSession('anonymous-session')
anonymousLegacySession.messages = [{ role: 'user', content: 'anonymous legacy request' }, { role: 'assistant', content: 'legacy reply' }]
anonymousLegacySession.timeline = [{ id: 'anonymous-turn', user: anonymousLegacySession.messages[0], assistant: anonymousLegacySession.messages[1], recommendations: [], suggestedActions: [], routes: [], warnings: [] }]
adapterStorage['chat-history-v1'] = history.makeChatHistoryPayload('anonymous-session', [ownerALegacySession, anonymousLegacySession])
const ownerBHistory = chatHistoryAdapter.loadChatHistory('owner-b')
const ownerAHistory = chatHistoryAdapter.loadChatHistory('owner-a')
check('owner-scoped history hides another owner while keeping anonymous migration history', ownerBHistory.sessions.every(session => session.ownerId !== 'owner-a')
  && ownerBHistory.sessions.some(session => session.id === 'anonymous-session')
  && ownerAHistory.sessions.some(session => session.id === 'anonymous-session'))

// Exercise the actual ChatStore route action without Taro, MobX reactions, or
// a live API. The route service is mocked at the module boundary, while the
// class still owns request IDs, persistence, polling, and cancellation logic.
const chatStorePath = path.resolve(process.cwd(), 'src', 'stores', 'chatStore.ts')
const chatStoreSource = fs.readFileSync(chatStorePath, 'utf8')
const chatStoreCompiled = ts.transpileModule(chatStoreSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  fileName: chatStorePath
}).outputText

const routeActionCalls = { create: [], get: [], cancel: [] }
const savedRouteSessions = []
let clearOwnerHistory = () => {}
let lastCreatedRouteKey = ''
const chatStoreUserStore = { profile: { uid: 'user-a' } }
let bootstrapCloudSessionStub = async () => ({ tripId: 'trip-1', conversationId: 'conversation-1' })
const routeAction = {
  createRouteGenerationRun: async options => {
    routeActionCalls.create.push(options)
    lastCreatedRouteKey = options.idempotencyKey
    return { run: cloneRun(routeAction.createRun(options)), created: true }
  },
  getRouteGenerationRun: async runId => {
    routeActionCalls.get.push(runId)
    return routeAction.getRun(runId)
  },
  cancelRouteGenerationRun: async runId => {
    routeActionCalls.cancel.push(runId)
    return cloneRun(routeAction.cancelRun(runId))
  },
  isRouteGenerationTerminal: status => status === 'succeeded' || status === 'failed' || status === 'cancelled',
  makeRouteGenerationIdempotencyKey: () => 'generated-test-key'
}
routeAction.createRun = () => { throw new Error('createRouteGenerationRun stub not configured') }
routeAction.getRun = () => { throw new Error('getRouteGenerationRun stub not configured') }
routeAction.cancelRun = () => { throw new Error('cancelRouteGenerationRun stub not configured') }

const chatHistoryRuntime = {
  ...history,
  loadChatHistory: () => ({ version: 1, currentSessionId: '', sessions: [] }),
  registerCloudChatHistoryClearHandler: handler => { clearOwnerHistory = handler },
  saveChatHistory: (currentSessionId, sessions) => {
    const current = sessions.find(session => session.id === currentSessionId)
    if (current?.routeGeneration) savedRouteSessions.push({ ...current, routeGeneration: cloneRun(current.routeGeneration) })
  }
}
const chatStoreModule = { exports: {} }
vm.runInNewContext(chatStoreCompiled, {
  module: chatStoreModule,
  exports: chatStoreModule.exports,
  console,
  URL,
  setTimeout: callback => { callback(); return 0 },
  require(specifier) {
    if (specifier === 'mobx') return { makeAutoObservable: () => {}, runInAction: callback => callback() }
    if (specifier === '../services/routeService') return { confirmPicks: async () => [] }
    if (specifier === '../services/conversationService') return {
      emptyTripState: service.emptyTripState,
      converse: async () => { throw new Error('conversation stub not configured') },
      bootstrapCloudSession: (...args) => bootstrapCloudSessionStub(...args)
    }
    if (specifier === './flightStore') return { flightStore: { select: () => {} } }
    if (specifier === '../i18n') return { t: key => key }
    if (specifier === './chatHistory') return chatHistoryRuntime
    if (specifier === '../utils/request') return { USE_MOCK: false }
    if (specifier === './userStore') return {
      userStore: chatStoreUserStore,
      registerUserSessionClearHandler: () => () => {}
    }
    if (specifier === '../services/routeGenerationService') return routeAction
    throw new Error(`unexpected ChatStore dependency: ${specifier}`)
  }
}, { filename: chatStorePath })
const ChatStore = chatStoreModule.exports.ChatStore

function cloneRun(run) {
  return JSON.parse(JSON.stringify(run))
}

function makeRun(status, overrides = {}) {
  const stage = status === 'succeeded' ? 'completed' : status === 'running' ? 'searching_connections' : status
  const percent = status === 'succeeded' || status === 'failed' || status === 'cancelled' ? 100 : status === 'running' ? 10 : 0
  return {
    id: 'run-test-1', tripId: 'trip-1', conversationId: 'conversation-1', idempotencyKey: lastCreatedRouteKey || 'route-test-key',
    contextVersion: 7, status, progress: { stage, percent },
    warnings: [], createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z',
    ...overrides
  }
}

function resetRouteActionHarness() {
  routeActionCalls.create.length = 0
  routeActionCalls.get.length = 0
  routeActionCalls.cancel.length = 0
  savedRouteSessions.length = 0
  lastCreatedRouteKey = ''
  clearOwnerHistory = () => {}
  routeAction.createRun = options => makeRun('queued', { idempotencyKey: options.idempotencyKey })
  routeAction.getRun = () => makeRun('succeeded', { resultArtifactId: 'artifact-route-1' })
  routeAction.cancelRun = () => makeRun('cancelled', { progress: { stage: 'cancelled', percent: 100 } })
}

function makeRouteStore() {
  const store = new ChatStore()
  const session = history.createEmptyChatSession('session-route')
  session.ownerId = 'user-a'
  session.tripId = 'trip-1'
  session.conversationId = 'conversation-1'
  const userMessage = { role: 'user', content: 'plan a trip' }
  const assistantMessage = { role: 'assistant', content: 'ready' }
  session.messages = [userMessage, assistantMessage]
  session.timeline = [{ id: 'turn-route', user: userMessage, assistant: assistantMessage, recommendations: [], suggestedActions: [], routes: [], warnings: [] }]
  store.activeOwnerId = 'user-a'
  store.currentSessionId = session.id
  store.sessions = [session]
  store.messages = session.messages.map(message => ({ ...message }))
  store.timeline = session.timeline.map(turn => ({ ...turn, user: { ...turn.user }, assistant: turn.assistant ? { ...turn.assistant } : null }))
  store.tripId = 'trip-1'
  store.conversationId = 'conversation-1'
  store.tripContextSummary = {
    version: 7,
    destinations: { mode: 'explicit', required: [], preferred: [], excluded: [] },
    interests: [],
    readyForRouteGeneration: true
  }
  store.routeGeneration = undefined
  store.routeGenerationIdempotencyKey = ''
  store.routeGenerationLoading = false
  store.routeGenerationError = ''
  return store
}

chatStoreUserStore.profile = { uid: 'user-a' }
let resolveLogoutBootstrap
bootstrapCloudSessionStub = () => new Promise(resolve => { resolveLogoutBootstrap = resolve })
const logoutDuringBootstrapStore = new ChatStore()
const logoutDuringBootstrap = logoutDuringBootstrapStore.send('start planning', 'en')
for (let attempt = 0; attempt < 8 && !resolveLogoutBootstrap; attempt += 1) await Promise.resolve()
chatStoreUserStore.profile = null
clearOwnerHistory('user-a')
resolveLogoutBootstrap({ tripId: 'late-trip', conversationId: 'late-conversation' })
await logoutDuringBootstrap
check('late bootstrap cannot resurrect cloud IDs after logout', logoutDuringBootstrapStore.activeOwnerId === ''
  && logoutDuringBootstrapStore.tripId === ''
  && logoutDuringBootstrapStore.conversationId === '')

chatStoreUserStore.profile = { uid: 'user-a' }
let resolveSwitchBootstrap
bootstrapCloudSessionStub = () => new Promise(resolve => { resolveSwitchBootstrap = resolve })
const switchDuringBootstrapStore = new ChatStore()
const switchDuringBootstrap = switchDuringBootstrapStore.send('start planning', 'en')
for (let attempt = 0; attempt < 8 && !resolveSwitchBootstrap; attempt += 1) await Promise.resolve()
const bootstrapTargetSession = history.createEmptyChatSession('session-after-switch')
bootstrapTargetSession.ownerId = 'user-a'
switchDuringBootstrapStore.sessions = [bootstrapTargetSession]
switchDuringBootstrapStore.switchSession('session-after-switch')
resolveSwitchBootstrap({ tripId: 'late-trip', conversationId: 'late-conversation' })
await switchDuringBootstrap
check('late bootstrap cannot resurrect cloud IDs after session switch', switchDuringBootstrapStore.currentSessionId === 'session-after-switch'
  && switchDuringBootstrapStore.tripId === ''
  && switchDuringBootstrapStore.conversationId === '')
bootstrapCloudSessionStub = async () => ({ tripId: 'trip-1', conversationId: 'conversation-1' })

const legacyMigrationStore = new ChatStore()
const legacyMigrationSession = history.createEmptyChatSession('legacy-migration-session')
legacyMigrationSession.messages = [{ role: 'user', content: 'old local request' }, { role: 'assistant', content: 'old local reply' }]
legacyMigrationSession.timeline = [{
  id: 'legacy-migration-turn',
  user: legacyMigrationSession.messages[0],
  assistant: legacyMigrationSession.messages[1],
  recommendations: [],
  suggestedActions: [],
  routes: [],
  warnings: []
}]
legacyMigrationStore.activeOwnerId = 'user-a'
legacyMigrationStore.currentSessionId = legacyMigrationSession.id
legacyMigrationStore.sessions = [legacyMigrationSession]
legacyMigrationStore.messages = legacyMigrationSession.messages.map(message => ({ ...message }))
legacyMigrationStore.timeline = legacyMigrationSession.timeline.map(turn => ({
  ...turn,
  user: { ...turn.user },
  assistant: turn.assistant ? { ...turn.assistant } : null
}))
await legacyMigrationStore.send('new cloud request', 'en')
check('legacy session migration creates a fresh cloud session before sending', legacyMigrationStore.tripId === 'trip-1'
  && legacyMigrationStore.conversationId === 'conversation-1'
  && legacyMigrationStore.currentSessionId !== legacyMigrationSession.id
  && legacyMigrationStore.sessions.some(session => session.id === legacyMigrationSession.id))

resetRouteActionHarness()
const successStore = makeRouteStore()
routeAction.getRun = () => makeRun('succeeded', {
  resultArtifactId: 'artifact-route-success',
  stale: true,
  warnings: ['partial_fare_coverage']
})
await successStore.generateRoute('en')
check('ChatStore route action reaches success and persists result metadata', routeActionCalls.create.length === 1
  && routeActionCalls.get.length === 1
  && successStore.routeGeneration?.status === 'succeeded'
  && successStore.routeGeneration.stale === true
  && successStore.routeGeneration.resultArtifactId === 'artifact-route-success'
  && successStore.routeGeneration.warnings[0] === 'partial_fare_coverage'
  && savedRouteSessions.at(-1)?.routeGeneration?.status === 'succeeded')

resetRouteActionHarness()
const failedStore = makeRouteStore()
routeAction.getRun = () => makeRun('failed', {
  progress: { stage: 'failed', percent: 100 },
  error: { code: 'ROUTE_GENERATION_FAILED', message: 'provider unavailable' }
})
await failedStore.generateRoute('en')
check('ChatStore preserves a failed terminal run and visible error', failedStore.routeGeneration?.status === 'failed'
  && failedStore.routeGeneration?.error?.code === 'ROUTE_GENERATION_FAILED'
  && failedStore.routeGenerationError === 'provider unavailable'
  && savedRouteSessions.at(-1)?.routeGeneration?.error?.message === 'provider unavailable')

resetRouteActionHarness()
const retryStore = makeRouteStore()
let rejectCreate = true
routeAction.createRun = options => {
  if (rejectCreate) throw new Error('temporary network failure')
  return makeRun('succeeded', { idempotencyKey: options.idempotencyKey, resultArtifactId: 'artifact-retry' })
}
await retryStore.generateRoute('en')
const firstKey = routeActionCalls.create[0]?.idempotencyKey
rejectCreate = false
await retryStore.generateRoute('en')
check('ChatStore reuses the same idempotency key after a retryable POST failure', routeActionCalls.create.length === 2
  && firstKey && routeActionCalls.create[1]?.idempotencyKey === firstKey
  && retryStore.routeGeneration?.status === 'succeeded')

resetRouteActionHarness()
const resumeStore = makeRouteStore()
const persistedResumeRun = makeRun('running', {
  id: 'run-resume',
  progress: { stage: 'planning_paths', percent: 40 }
})
const persistedResumeSession = resumeStore.currentSession
persistedResumeSession.routeGeneration = persistedResumeRun
persistedResumeSession.routeGenerationIdempotencyKey = persistedResumeRun.idempotencyKey
resumeStore.restoreSession(persistedResumeSession)
const restoredRunIsIdle = resumeStore.routeGenerationLoading === false
routeAction.getRun = () => makeRun('succeeded', {
  id: 'run-resume', resultArtifactId: 'artifact-resumed'
})
await resumeStore.generateRoute('en')
check('ChatStore resumes a persisted non-terminal run without a second POST', routeActionCalls.create.length === 0
  && routeActionCalls.get.length === 1
  && restoredRunIsIdle
  && resumeStore.routeGeneration?.status === 'succeeded'
  && resumeStore.routeGeneration.resultArtifactId === 'artifact-resumed')

resetRouteActionHarness()
const transientStore = makeRouteStore()
let transientPollAttempts = 0
routeAction.getRun = () => {
  transientPollAttempts += 1
  if (transientPollAttempts < 3) throw new Error('network timeout')
  return makeRun('succeeded', { resultArtifactId: 'artifact-after-retry' })
}
await transientStore.generateRoute('en')
check('ChatStore retries bounded transient GET failures before terminal success', transientPollAttempts === 3
  && transientStore.routeGeneration?.status === 'succeeded'
  && transientStore.routeGeneration.resultArtifactId === 'artifact-after-retry'
  && transientStore.routeGenerationLoading === false)

resetRouteActionHarness()
const cancelStore = makeRouteStore()
let resolveLateCancelPoll
routeAction.getRun = () => new Promise(resolve => { resolveLateCancelPoll = resolve })
const cancelGeneration = cancelStore.generateRoute('en')
for (let attempt = 0; attempt < 8 && routeActionCalls.get.length === 0; attempt += 1) await Promise.resolve()
await cancelStore.cancelRouteGeneration('en')
resolveLateCancelPoll(makeRun('succeeded', { resultArtifactId: 'artifact-late' }))
await cancelGeneration
check('ChatStore cancellation wins over an in-flight late poll response', routeActionCalls.cancel.length === 1
  && cancelStore.routeGeneration?.status === 'cancelled'
  && cancelStore.routeGeneration?.resultArtifactId === undefined
  && cancelStore.routeGenerationError === 'Route generation cancelled.')

resetRouteActionHarness()
const cancelWinnerStore = makeRouteStore()
cancelWinnerStore.routeGeneration = makeRun('running')
routeAction.cancelRun = () => makeRun('succeeded', { resultArtifactId: 'artifact-winner' })
await cancelWinnerStore.cancelRouteGeneration('en')
check('ChatStore keeps a worker-won success when cancellation loses the race', cancelWinnerStore.routeGeneration?.status === 'succeeded'
  && cancelWinnerStore.routeGeneration.resultArtifactId === 'artifact-winner'
  && cancelWinnerStore.routeGenerationError === '')

resetRouteActionHarness()
const lateStore = makeRouteStore()
let resolveLateSessionPoll
routeAction.getRun = () => new Promise(resolve => { resolveLateSessionPoll = resolve })
const lateGeneration = lateStore.generateRoute('en')
for (let attempt = 0; attempt < 8 && routeActionCalls.get.length === 0; attempt += 1) await Promise.resolve()
const otherSession = history.createEmptyChatSession('session-other')
otherSession.ownerId = 'user-a'
lateStore.sessions = [...lateStore.sessions, otherSession]
lateStore.switchSession('session-other')
resolveLateSessionPoll(makeRun('succeeded', { resultArtifactId: 'artifact-should-not-apply' }))
await lateGeneration
check('ChatStore ignores late poll updates after a session switch', lateStore.currentSessionId === 'session-other'
  && lateStore.routeGeneration === undefined)

resetRouteActionHarness()
const lateLogoutStore = makeRouteStore()
let resolveLateLogoutPoll
routeAction.getRun = () => new Promise(resolve => { resolveLateLogoutPoll = resolve })
const lateLogoutGeneration = lateLogoutStore.generateRoute('en')
for (let attempt = 0; attempt < 8 && routeActionCalls.get.length === 0; attempt += 1) await Promise.resolve()
clearOwnerHistory('user-a')
resolveLateLogoutPoll(makeRun('succeeded', { resultArtifactId: 'artifact-should-not-apply' }))
await lateLogoutGeneration
check('ChatStore ignores late poll updates after owner logout', lateLogoutStore.activeOwnerId === ''
  && lateLogoutStore.routeGeneration === undefined)

resetRouteActionHarness()
const cloudStore = makeRouteStore()
const cloudRef = { id: 'artifact-cloud', type: 'route_set', schemaVersion: 1 }
cloudStore.openCloudWorkspace({
  trip: { id: 'trip-cloud', title: 'Cloud trip' }, conversationId: 'conversation-cloud',
  tripContextSummary: cloudStore.tripContextSummary, routeGeneration: makeRun('running'),
  artifactRefs: [cloudRef], messages: [
    { id: 'cloud-user', role: 'user', content: 'my trip', artifactRefs: [] },
    { id: 'cloud-assistant', role: 'assistant', content: 'saved route', artifactRefs: [cloudRef] }
  ]
}, 'user-a')
check('Cloud workspace restores conversations, artifact links and active generation',
  cloudStore.currentSessionId === 'cloud-conversation-cloud' && cloudStore.tripId === 'trip-cloud'
  && cloudStore.messages.length === 2 && cloudStore.timeline[0].artifactRefs[0].id === cloudRef.id
  && cloudStore.routeGeneration?.status === 'running')
let rejectedOwner = false
try { cloudStore.openCloudWorkspace({ conversationId: 'foreign' }, 'user-b') } catch { rejectedOwner = true }
check('Cloud workspace rejects a response for another owner before mutation', rejectedOwner
  && cloudStore.currentSessionId === 'cloud-conversation-cloud')

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
