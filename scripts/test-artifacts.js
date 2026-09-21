// Phase 6 Artifact service and renderer registry contract regression.
// This test transpiles pure TypeScript modules and stubs the existing request
// transport, so it never needs Taro, a logged-in user, or a running API.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

function loadTypeScript(relativePath, dependencies = {}) {
  const filePath = path.resolve(process.cwd(), relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filePath
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    console,
    URL,
    require(specifier) {
      if (dependencies[specifier]) return dependencies[specifier]
      throw new Error(`unexpected dependency: ${specifier}`)
    }
  }, { filename: filePath })
  return module.exports
}

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

const requestCalls = []
const requestStub = async options => {
  requestCalls.push(options)
  const id = decodeURIComponent(options.url.split('/').at(-1))
  return {
    artifact: {
      id,
      tripId: 'trip-1',
      type: 'flight_search',
      schemaVersion: 1,
      payload: { id, type: 'flight_search', offers: [] },
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z'
    }
  }
}

const airportTime = loadTypeScript('src/services/airportTime.ts')
const flightConnections = loadTypeScript('src/services/flightConnections.ts')
const payload = loadTypeScript('src/components/artifacts/payload.ts', {
  '../../services/airportTime': { airportTimeDisplay: () => null, isUnconfirmedField: () => false },
  '../../services/flightConnections': { flightConnections: () => [] }
})
const service = loadTypeScript('src/services/artifactService.ts', {
  './airportTime': airportTime,
  '../utils/request': { request: requestStub }
})
const registry = loadTypeScript('src/components/artifacts/registry.ts', {
  '../../services/artifactService': {}
})
const flightService = loadTypeScript('src/services/flightService.ts', {
  './airportTime': airportTime,
  './flightConnections': flightConnections,
  '../mocks/airports': { findAirport: () => undefined, distanceKm: () => 0 },
  '../utils/request': { USE_MOCK: false, request: async () => { throw new Error('unexpected request') } },
  '../utils/format': { toDateString: () => '2026-09-07' },
  '../utils/flightRecommendation': { sortByRecommendation: values => values },
  './artifactService': { artifactService: { fetchArtifact: async () => { throw new Error('unexpected artifact fetch') } } },
  '../../cloud/searchProxy/connectivity': { TOPOLOGY_VERSION: 'test', canFly: () => false, validateItinerary: () => ({ valid: true, reasons: [] }), edgeCount: () => 0 }
})

console.log('\n【Artifact envelope】bounded validation')
console.log('\n【Source applicability formatter】conservative compatibility')
const expectedApplicability = '以下为来源资料摘要；其中价格、开放时间和交通时长的当前及出行日适用性尚未核实，请以运营方届时公告为准。'
check('uses the fixed notice for old and malformed applicability fields', payload.formatResearchDescription('原始资料', undefined).notice === expectedApplicability && payload.formatResearchDescription('原始资料', { status: 'verified', notice: '已核验' }).notice === expectedApplicability)
check('preserves source text while keeping the fixed notice separate', payload.formatResearchDescription(`原始资料。${expectedApplicability}`, { status: 'reference_only', notice: expectedApplicability }).description.endsWith(expectedApplicability) && payload.formatResearchDescription(`原始资料。${expectedApplicability}`).notice === expectedApplicability)
const displayEvidence = payload.displaySupportingEvidence([{ sourceArtifactId: 'a', sourceFindingId: 'f', title: '交通', description: '机场到市区', category: 'practical', verification: { status: 'verified' }, sourceApplicability: { status: 'reference_only', notice: '任意提示' } }])
check('normalizes supporting evidence with a conservative notice', displayEvidence[0]?.sourceApplicabilityNotice === expectedApplicability)
const valid = {
  id: 'artifact-1', tripId: 'trip-1', type: 'flight_search', schemaVersion: 1,
  payload: { id: 'artifact-1', type: 'flight_search', offers: [] },
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z'
}
check('accepts a bounded common envelope', service.validateArtifactEnvelope(valid).id === 'artifact-1')
check('rejects a missing payload object', (() => {
  try { service.validateArtifactEnvelope({ ...valid, payload: null }); return false } catch { return true }
})())
check('rejects an unbounded schema version', (() => {
  try { service.validateArtifactEnvelope({ ...valid, schemaVersion: 1001 }); return false } catch { return true }
})())

console.log('\n【Renderer registry】explicit dispatch and fallback')
const envelope = (type, schemaVersion, payload) => ({ type, schemaVersion, payload })
check('dispatches flight_search v1', registry.resolveArtifactRenderer(envelope('flight_search', 1, { id: 'f', type: 'flight_search', offers: [] })).key === 'flight_search')
check('dispatches research v2', registry.resolveArtifactRenderer(envelope('research', 2, { id: 'r', type: 'research', findings: [] })).key === 'research')
check('dispatches travel guide payload kind', registry.resolveArtifactRenderer(envelope('travel_guide', 1, { kind: 'trip_travel_guide', schemaVersion: 1, days: [] })).key === 'travel_guide')
check('dispatches route_set by payload kind', registry.resolveArtifactRenderer(envelope('route_set', 1, { kind: 'flight_paths', schemaVersion: 1, paths: [] })).key === 'route_set:flight_paths')
check('unsupported schema uses bounded fallback', registry.resolveArtifactRenderer(envelope('flight_search', 99, { id: 'f', type: 'flight_search', offers: [] })).key === 'unavailable')
check('unknown route kind uses bounded fallback', registry.resolveArtifactRenderer(envelope('route_set', 1, { kind: 'future_kind', schemaVersion: 1 })).key === 'unavailable')
const researchCardSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/artifacts/ResearchCard.tsx'), 'utf8')
check('research card attributes source document references instead of generated finding prose', researchCardSource.includes('source.title') && researchCardSource.includes('source.reference') && researchCardSource.includes('来源资料标题（未核实适用性）') && !researchCardSource.includes('firstText(finding.title)') && !researchCardSource.includes('firstText(finding.summary)'))

const jsx = (type, props) => ({ type: typeof type === 'string' ? type : 'Component', props })
const visibleText = node => Array.isArray(node) ? node.map(visibleText).join(' ')
  : typeof node === 'string' || typeof node === 'number' ? String(node)
  : node?.props ? [node.props.title, node.props.summary, node.props.label, node.props.actionLabel, node.props.children].map(visibleText).join(' ') : ''
const cardDependencies = { 'react/jsx-runtime': { jsx, jsxs: jsx }, '@tarojs/components': { View: 'View', Text: 'Text' },
  './ArtifactCard': { ArtifactCard: 'ArtifactCard' }, './payload': payload, './TravelGuideCard.scss': {}, './ResearchCard.scss': {} }
const guideCard = loadTypeScript('src/components/artifacts/TravelGuideCard.tsx', cardDependencies).TravelGuideCard
const published = { version: 1, artifactId: 'guide-1', tripContextVersion: 1, contentContract: 'limited', evidenceCoverage: 'unknown',
  legacy: false, reply: '攻略已保存', budgetAssessment: { status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete', notice: '目前不能确认总支出是否满足预算。' } }
const renderGuide = publication => visibleText(guideCard({ artifact: { id: 'guide-1', type: 'travel_guide', schemaVersion: 1,
  payload: { publication, days: [{ day: 1, items: [{ title: 'UNSAFE_OLD_FREE', description: 'UNSAFE_OLD_BUDGET' }] }] } } }))
check('rendered guide card shows budget unknown and rejects old prose without publication',
  renderGuide(published).includes(published.budgetAssessment.notice) && !renderGuide(undefined).includes('UNSAFE_OLD'))
const researchCard = loadTypeScript('src/components/artifacts/ResearchCard.tsx', cardDependencies).ResearchCard
const researchTree = visibleText(researchCard({ artifact: { id: 'research-1', schemaVersion: 2, type: 'research', payload: {
  findings: [{ title: 'UNSAFE_FREE', summary: 'UNSAFE_BUDGET', sources: [{ title: 'Museum source', url: 'https://example.com/museum' }] }]
} } }))
check('rendered research card retains attributed references without generated assertions', researchTree.includes('Museum source') && !researchTree.includes('UNSAFE_'))

console.log('\n【Flight Artifact adapter】strict payload parsing')
const validFlightPayload = {
  id: 'flight-artifact-1',
  type: 'flight_search',
  query: { origin: 'PVG', destination: 'NRT', departureDate: '2026-10-01', currency: 'CNY', travelClass: 1 },
  offers: [{
    id: 'offer-1',
    segments: [{ flightNumber: 'MU1', airline: 'China Eastern', origin: 'PVG', destination: 'NRT', departsAt: '2026-10-01T01:00:00Z', arrivesAt: '2026-10-01T04:00:00Z', durationMinutes: 180 }],
    totalAmount: 1800,
    currency: 'CNY',
    totalDurationMinutes: 180,
    airlines: ['China Eastern'],
    transferType: 'direct'
  }]
}
const validResponse = flightService.responseFromFlightSearchArtifact(validFlightPayload, { id: 'flight-artifact-1', type: 'flight_search', schemaVersion: 1 }, '2026-09-07T00:00:00.000Z')
check('valid payload maps without coercion', validResponse.direct[0]?.totalPrice === 1800 && validResponse.direct[0]?.segments[0]?.origin === 'PVG')
check('string prices are rejected instead of coerced', (() => {
  try {
    flightService.responseFromFlightSearchArtifact({ ...validFlightPayload, offers: [{ ...validFlightPayload.offers[0], totalAmount: '1800' }] }, { id: 'flight-artifact-1', type: 'flight_search', schemaVersion: 1 }, '2026-09-07T00:00:00.000Z')
    return false
  } catch { return true }
})())
check('malformed segment endpoints are rejected', (() => {
  try {
    flightService.responseFromFlightSearchArtifact({ ...validFlightPayload, offers: [{ ...validFlightPayload.offers[0], segments: [{ ...validFlightPayload.offers[0].segments[0], origin: 'Shanghai' }] }] }, { id: 'flight-artifact-1', type: 'flight_search', schemaVersion: 1 }, '2026-09-07T00:00:00.000Z')
    return false
  } catch { return true }
})())

console.log('\n【Flight store】request generation and session cleanup')
let settleSearch
let failSearch
const sessionHandlers = []
const authHandlers = []
const chatStoreStub = {
  currentSessionId: 'session-a',
  prepareCloudSession: async () => ({ tripId: 'trip-1', conversationId: 'conversation-1' }),
  addArtifactRef: () => {}
}
const flightStoreModule = loadTypeScript('src/stores/flightStore.ts', {
  mobx: { makeAutoObservable: () => {}, runInAction: action => action() },
  '../services/flightService': {
    searchFlights: () => new Promise((resolve, reject) => { settleSearch = resolve; failSearch = reject }),
    buildPriceMatrix: () => null,
    paramsFromFlightSearchArtifact: () => { throw new Error('unexpected') },
    responseFromFlightSearchArtifact: () => { throw new Error('unexpected') },
    makeFlightSearchIdempotencyKey: () => 'flight-test-key'
  },
  '../services/artifactService': { artifactService: { setSession: () => {}, fetchArtifact: async () => { throw new Error('unexpected') } } },
  '../components/artifacts/registry': { resolveArtifactRenderer: () => ({ key: 'unavailable', supported: false }) },
  '../utils/request': { USE_MOCK: true },
  '../utils/flightRecommendation': { isExcludedByCountry: () => false, sortByRecommendation: values => values },
  './chatStore': { chatStore: chatStoreStub, registerChatSessionChangeHandler: handler => { sessionHandlers.push(handler) } },
  './userStore': { userStore: { profile: null }, registerUserSessionClearHandler: handler => { authHandlers.push(handler) } },
  '../i18n': { localeStore: { locale: 'zh' } }
})
const searchParams = {
  origin: 'PVG', originCandidates: ['PVG'], destination: 'NRT', destinationCandidates: ['NRT'],
  departDate: '2026-10-01', tripType: 'oneway', budgetRange: [0, 99999], transferPref: 'any',
  transitCountryPreferences: { preferred: [], excluded: [] }, interests: []
}
const storeUnderTest = new flightStoreModule.FlightStore()
const pendingSearch = storeUnderTest.search(searchParams)
chatStoreStub.currentSessionId = 'session-b'
sessionHandlers.at(-1)('session-b', 'mock-local')
settleSearch({ direct: [], selfTransfer: [], airlineTransfer: [], metadata: { searchId: 'old', cacheTime: '2026-09-07T00:00:00.000Z', priceDisclaimer: 'test' } })
await pendingSearch
check('late response after session switch is ignored', storeUnderTest.result === null && storeUnderTest.isLoading === false)
chatStoreStub.currentSessionId = 'session-c'
const failedSearch = storeUnderTest.search(searchParams)
failSearch(new Error('provider unavailable'))
await failedSearch
check('failed replacement search cannot leave stale results', storeUnderTest.result === null && storeUnderTest.error === 'provider unavailable')
storeUnderTest.result = { direct: [], selfTransfer: [], airlineTransfer: [], metadata: { searchId: 'owned', cacheTime: '2026-09-07T00:00:00.000Z', priceDisclaimer: 'test' } }
authHandlers.at(-1)('owner-a')
check('logout handler clears owner-scoped result', storeUnderTest.result === null && storeUnderTest.selected === null)

console.log('\n【Auth store】logout invalidates an in-flight login')
let settleLogin
const loginResponse = new Promise(resolve => { settleLogin = resolve })
const authStorage = new Map()
const authSessionModule = loadTypeScript('src/utils/authSession.ts', {
  '@tarojs/taro': { default: {
    getStorageSync: key => authStorage.get(key),
    setStorageSync: (key, value) => authStorage.set(key, value),
    removeStorageSync: key => authStorage.delete(key)
  } }
})
const authServiceModule = loadTypeScript('src/services/authService.ts', {
  '../utils/authSession': authSessionModule,
  '@tarojs/taro': {
    default: {
      login: async () => ({ code: 'wx-code' }),
      getStorageSync: key => authStorage.get(key),
      setStorageSync: (key, value) => authStorage.set(key, value),
      removeStorageSync: key => authStorage.delete(key)
    }
  },
  '../utils/request': {
    USE_MOCK: false,
    request: () => loginResponse
  }
})
const userStoreModule = loadTypeScript('src/stores/userStore.ts', {
  '../utils/authSession': authSessionModule,
  mobx: { makeAutoObservable: () => {}, runInAction: action => action() },
  '../utils/storage': { getStorage: (_key, fallback) => fallback, setStorage: () => {} },
  '../services/authService': authServiceModule,
  './chatHistory': { clearCloudChatHistory: () => {} }
})
const authStoreUnderTest = new userStoreModule.UserStore()
const pendingLogin = authStoreUnderTest.login()
await Promise.resolve()
await Promise.resolve()
authStoreUnderTest.logout()
settleLogin({
  accessToken: 'late-access',
  refreshToken: 'late-refresh',
  user: { id: 'late-owner', nickname: 'Late', avatarUrl: '' }
})
await pendingLogin
check('late login cannot restore profile or bearer credentials after logout',
  authStoreUnderTest.profile === null &&
  !authStorage.has('access_token') &&
  !authStorage.has('refresh_token'))

console.log('\n【Artifact service】owner/session cache')
const cache = new service.BoundedArtifactCache()
const artifactService = new service.ArtifactService(requestStub, cache)
await artifactService.fetchArtifact('one', { ownerId: 'owner-a', sessionId: 'session-a' })
await artifactService.fetchArtifact('one', { ownerId: 'owner-a', sessionId: 'session-a' })
check('cache prevents a duplicate owner/session fetch', requestCalls.length === 1)
await artifactService.fetchArtifact('one', { ownerId: 'owner-b', sessionId: 'session-b' })
check('owner/session changes clear cached authority', requestCalls.length === 2 && cache.size === 1)
for (let i = 0; i < service.ARTIFACT_CACHE_LIMIT + 4; i++) {
  await artifactService.fetchArtifact(`bounded-${i}`, { ownerId: 'owner-b', sessionId: 'session-b' })
}
check('cache remains bounded', cache.size === service.ARTIFACT_CACHE_LIMIT)

console.log(`\nArtifact 回归：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
