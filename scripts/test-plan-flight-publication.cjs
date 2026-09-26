// Execute the production Plan page with a stateful hook harness and deferred transport.
// Offline only: this verifies integration state, not browser or WeChat rendering.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync('src/pages/plan/index.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve() }
const ref = id => ({ id, type: 'flight_search', schemaVersion: 1, presentationHint: 'flight_cards' })
const artifact = (id, tripId = 'trip-1') => ({ id, tripId, type: 'flight_search', schemaVersion: 1, payload: {} })
function collect(node, type) {
  if (!node) return []
  if (Array.isArray(node)) return node.flatMap(child => collect(child, type))
  if (typeof node !== 'object') return []
  return [...(node.type === type ? [node] : []), ...collect(node.props?.children, type)]
}

function harness() {
  const state = [], effects = []
  let cursor = 0, changed = false, show
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], value => {
        const next = typeof value === 'function' ? value(state[index]) : value
        if (next !== state[index]) { state[index] = next; changed = true }
      }]
    },
    useRef(initial) { const index = cursor++; return state[index] ?? (state[index] = { current: initial }) },
    useEffect(effect, deps) {
      const index = cursor++, previous = state[index]
      if (!previous || deps.some((value, offset) => value !== previous.deps[offset])) {
        effects.push(() => { previous?.cleanup?.(); state[index] = { deps, cleanup: effect() } })
      }
    }
  }
  const chatStore = { currentSessionId: 'session-1', tripId: 'trip-1', conversationId: 'conversation-1', timeline: [], artifactRefs: [ref('A')],
    isThinking: false, multiLoading: false, multiConfirming: false, multiError: '', requiresLogin: false,
    refreshWorkspace: async () => {}, send: async () => true, cancelTurn: async () => {} }
  const userStore = { profile: { uid: 'owner-1' }, sessionRevision: 1 }
  const requests = []
  let guideTransport = async () => { throw new Error('Unexpected guide load') }
  let transport = async id => artifact(id, chatStore.tripId)
  let workspace = async () => ({ trip: { id: chatStore.tripId, selectedFlight: { kind: 'offer', artifactId: 'A', offerId: 'offer-A', revision: 1 } } })
  const stubs = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    '@tarojs/components': { View: 'View' },
    '@tarojs/taro': { useDidShow: callback => { show = callback }, setNavigationBarTitle() {}, navigateTo() {} },
    'mobx-react-lite': { observer: component => component },
    '../../stores/chatStore': { chatStore }, '../../stores/userStore': { userStore },
    '../../i18n': { t: key => key, localeStore: { locale: 'zh' } },
    '../../components/navigation/ProductionTabBar': { useProductionTab() {} },
    '../../components/common/LoginSheet': { __esModule: true, default: 'LoginSheet' },
    '../../features/ui-experience/PlannerPage': { __esModule: true, default: 'PlannerPage' },
    '../../features/ui-experience/FlightDecisionPanel': { FlightDecisionPanel: 'FlightDecisionPanel' },
    '../../services/productionTripService': { loadProductionTrip: (...args) => guideTransport(...args) },
    '../../services/plannerTelemetry': { plannerTelemetry: { now: () => 100 } },
    '../../components/artifacts/payload': { record: value => value && typeof value === 'object' ? value : undefined,
      displayOffers: payload => payload.offers ?? [], displayOfferById: (payload, id) => payload.offers?.find(offer => offer.id === id) },
    '../../services/artifactService': { artifactService: { fetchArtifact: (id, scope) => { requests.push({ id, scope }); return transport(id, scope) } } },
    '../../services/workspaceService': { getCloudWorkspace: () => workspace() }, './index.scss': {}
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`)
    return stubs[name]
  } })
  const render = () => {
    let tree
    for (let index = 0; index < 20; index++) {
      changed = false; cursor = 0
      tree = module.exports.default()
      effects.splice(0).forEach(effect => effect())
      if (!changed) return tree
    }
    throw new Error('Unstable render')
  }
  return { chatStore, userStore, requests, render, show: () => show(), setTransport: value => { transport = value },
    setGuide: value => { guideTransport = value }, setWorkspace: value => { workspace = value }, planner: tree => collect(tree, 'PlannerPage')[0],
    panels: tree => collect(collect(tree, 'PlannerPage')[0]?.props.flightDecision, 'FlightDecisionPanel') }
}

let passed = 0
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`) }
async function selectedHarness() {
  const h = harness()
  h.render(); await flush(); h.render(); h.show(); await flush(); h.render()
  return h
}

async function main() {
  await test('planner receives the complete retained transcript and new trip starts a separate session', async () => {
    const h = harness()
    const turns = [
      { id: 'one', user: { content: '推荐两个国家' }, assistant: { content: '葡萄牙、意大利' } },
      { id: 'two', user: { content: '第二个呢？' }, assistant: { content: '意大利适合文化旅行。' } }
    ]
    h.chatStore.timeline = turns
    let resets = 0
    h.chatStore.reset = () => { resets++; h.chatStore.currentSessionId = 'new-session'; h.chatStore.tripId = ''; h.chatStore.timeline = [] }
    assert.equal(h.planner(h.render()).props.productionTimeline, turns)
    h.planner(h.render()).props.onNewConversation()
    assert.equal(resets, 1)
    assert.equal(h.chatStore.tripId, '')
    assert.equal(h.planner(h.render()).props.productionTimeline.length, 0)
    assert.equal(turns.length, 2, 'starting a new trip must not mutate the previous transcript')
  })
  await test('new trip is guarded while a turn is running, including a stale click callback', async () => {
    const h = harness()
    let resets = 0
    h.chatStore.reset = () => { resets++ }
    const callback = h.planner(h.render()).props.onNewConversation
    h.chatStore.isThinking = true
    callback()
    h.planner(h.render()).props.onNewConversation()
    assert.equal(resets, 0)
  })
  await test('current explanation overrides old publication reply without changing the guide; commits retain accepted reply', async () => {
    const h = harness()
    h.chatStore.artifactRefs = [{ id: 'guide', type: 'travel_guide', schemaVersion: 1 }]
    h.setGuide(async () => ({ guide: { id: 'guide', payload: { publication: { reply: '攻略已保存。' } } },
      presentation: { destination: 'Tokyo', route: [], days: [], publication: { status: 'accepted' } } }))
    h.chatStore.timeline = [{ user: { content: '为什么推荐？' }, assistant: { content: '谷根千适合慢慢看老街文化。', locale: 'zh' },
      stopReason: 'responded', delivery: { status: 'not_requested' }, artifactRefs: [] }]
    h.render(); await flush()
    assert.equal(h.planner(h.render()).props.productionReply, '谷根千适合慢慢看老街文化。')
    h.chatStore.timeline[0].assistant.locale = 'en'
    assert.equal(h.planner(h.render()).props.productionReply, undefined)
    h.chatStore.timeline[0].assistant = { content: '未经接纳的模型尾句', locale: 'zh' }
    h.chatStore.timeline[0].stopReason = 'completed'
    h.chatStore.timeline[0].delivery = { status: 'satisfied' }
    assert.equal(h.planner(h.render()).props.productionReply, '攻略已保存。')
    h.chatStore.timeline.push({ user: { content: '下一轮追问' }, assistant: null, artifactRefs: [] })
    h.chatStore.isThinking = true
    assert.equal(h.planner(h.render()).props.productionReply, undefined, 'pending turn cannot borrow the previous guide confirmation')
  })

  await test('completed budget update uses current confirmation with locale and guide-commit guards', async () => {
    const h = harness()
    h.chatStore.artifactRefs = [{ id: 'guide', type: 'travel_guide', schemaVersion: 1 }]
    h.setGuide(async () => ({ guide: { id: 'guide', payload: { publication: { reply: '第二天下午已修改。' } } },
      presentation: { destination: 'Tokyo', route: [], days: [], publication: { status: 'accepted' } } }))
    h.chatStore.timeline = [{ user: { content: '预算改为两天合计1200元。' },
      assistant: { content: '预算目标已保存为两天合计1200元，不承诺未知费用一定够。', locale: 'zh' },
      stopReason: 'completed', delivery: { kind: 'trip_context_update', status: 'satisfied' }, artifactRefs: [] }]
    h.render(); await flush()
    assert.equal(h.planner(h.render()).props.productionReply, h.chatStore.timeline[0].assistant.content)
    h.chatStore.timeline[0].assistant.locale = 'en'
    assert.equal(h.planner(h.render()).props.productionReply, undefined)
    h.chatStore.timeline[0].assistant.locale = 'zh'
    for (const status of ['partial', 'blocked']) {
      h.chatStore.timeline[0].delivery.status = status
      assert.equal(h.planner(h.render()).props.productionReply, '第二天下午已修改。')
    }
    h.chatStore.timeline[0].delivery = { kind: 'trip_context_update', status: 'satisfied' }
    h.chatStore.timeline[0].stopReason = 'model_failure'
    assert.equal(h.planner(h.render()).props.productionReply, '第二天下午已修改。')
    h.chatStore.timeline[0].stopReason = 'completed'
    h.chatStore.timeline[0].delivery.kind = 'travel_guide'
    assert.equal(h.planner(h.render()).props.productionReply, '第二天下午已修改。')
  })

  await test('adopted A and newly published B both load and render before final reply', async () => {
    const h = await selectedHarness()
    h.chatStore.isThinking = true
    h.chatStore.timeline = [{ user: { content: 'compare alternatives' }, assistant: null, artifactRefs: [ref('B')] }]
    h.chatStore.artifactRefs.push(ref('B'))
    h.render(); await flush()
    const panels = h.panels(h.render())
    assert.deepEqual(panels.map(panel => panel.props.artifact.id), ['A', 'B'])
    assert.equal(panels[0].props.selection.artifactId, 'A')
    assert.equal(panels[1].props.selection, undefined)
    assert.ok(panels.every(panel => panel.props.busy))
    assert.equal(h.requests.filter(request => request.id === 'B').length, 1)
  })
  await test('matching adopted and published IDs render and fetch only once', async () => {
    const h = await selectedHarness()
    h.chatStore.timeline = [{ user: { content: 'same selection' }, artifactRefs: [ref('A')] }]
    h.render(); await flush()
    assert.equal(h.panels(h.render()).length, 1)
    assert.equal(h.requests.filter(request => request.id === 'A').length, 1)
  })
  await test('failed alternative fetch keeps the adopted flight visible', async () => {
    const h = await selectedHarness()
    h.setTransport(async id => { if (id === 'B') throw new Error('offline'); return artifact(id) })
    h.chatStore.artifactRefs.push(ref('B'))
    h.render(); await flush()
    assert.deepEqual(h.panels(h.render()).map(panel => panel.props.artifact.id), ['A'])
  })
  for (const dimension of ['owner', 'auth', 'session', 'trip']) {
    await test(`late alternative success or failure cannot cross ${dimension} scope`, async () => {
      for (const fails of [false, true]) {
        const h = await selectedHarness(), old = deferred()
        h.setTransport(id => id === 'B' ? old.promise : Promise.resolve(artifact(id)))
        h.chatStore.artifactRefs.push(ref('B')); h.render()
        if (dimension === 'owner') h.userStore.profile = { uid: 'owner-2' }
        if (dimension === 'auth') h.userStore.sessionRevision++
        if (dimension === 'session') h.chatStore.currentSessionId = 'session-2'
        if (dimension === 'trip') h.chatStore.tripId = 'trip-2'
        h.setTransport(async id => ({ ...artifact(id, h.chatStore.tripId), scopeMarker: 'new' }))
        h.render(); await flush(); h.render()
        if (fails) old.reject(new Error('old request failed'))
        else old.resolve({ ...artifact('B'), scopeMarker: 'old' })
        await flush()
        const panels = h.panels(h.render())
        assert.equal(panels.length, 1)
        assert.equal(panels[0].props.artifact.scopeMarker, 'new')
      }
    })
  }
  await test('a cancelled old send cannot report failure over a newer turn', async () => {
    const h = await selectedHarness(), old = deferred(), newer = deferred()
    h.chatStore.send = () => old.promise
    h.planner(h.render()).props.onSubmitPrompt('old request')
    h.planner(h.render()).props.onCancelProduction()
    h.chatStore.send = () => newer.promise
    h.planner(h.render()).props.onSubmitPrompt('new request')
    old.resolve(false); await flush()
    assert.equal(h.planner(h.render()).props.productionError, '')
    newer.resolve(true); await flush()
    assert.equal(h.planner(h.render()).props.productionError, '')
  })
  await test('late send failure cannot cross session scope or return after switching away and back', async () => {
    const h = await selectedHarness(), old = deferred()
    h.chatStore.send = () => old.promise
    h.planner(h.render()).props.onSubmitPrompt('old request')
    h.chatStore.currentSessionId = 'other-session'; h.render()
    h.chatStore.currentSessionId = 'session-1'; h.render()
    old.resolve(false); await flush()
    assert.equal(h.planner(h.render()).props.productionError, '')
  })
  await test('bootstrap may activate a session and create its Trip without hiding current failure', async () => {
    const h = harness(), bootstrap = deferred()
    h.chatStore.send = () => {
      h.chatStore.currentSessionId = 'activated-session'; h.chatStore.tripId = ''
      return bootstrap.promise
    }
    h.planner(h.render()).props.onSubmitPrompt('first request')
    h.render()
    h.chatStore.tripId = 'bootstrapped-trip'; h.render()
    h.chatStore.multiError = 'Current request failed'
    bootstrap.resolve(false); await flush()
    assert.equal(h.planner(h.render()).props.productionError, 'Current request failed')
  })
  await test('bootstrap failure before Trip creation remains visible and can be retried', async () => {
    const h = harness()
    h.chatStore.tripId = ''
    h.chatStore.send = async () => false
    h.planner(h.render()).props.onSubmitPrompt('first request')
    await flush()
    assert.equal(h.planner(h.render()).props.productionError, '规划请求未完成，请查看规划记录')
    h.chatStore.send = async () => true
    h.planner(h.render()).props.onSubmitPrompt('retry')
    await flush()
    assert.equal(h.planner(h.render()).props.productionError, '')
  })
  await test('render telemetry excludes empty flight snapshots until usable offers load', async () => {
    const h = await selectedHarness()
    h.chatStore.turnTelemetryId = 'measurement'
    h.chatStore.turnTelemetryFinalReady = false
    assert.equal(h.planner(h.render()).props.productionTelemetry.flights.length, 0)
    h.setTransport(async id => ({ ...artifact(id), payload: { offers: [{ id: 'offer-B' }] }, verification: { status: 'partial' } }))
    h.chatStore.artifactRefs.push(ref('B')); h.render(); await flush()
    const measurement = h.planner(h.render()).props.productionTelemetry
    assert.equal(measurement.flights.length, 1)
    assert.equal(measurement.flights[0].id, 'B')
    assert.equal(measurement.flights[0].verificationStatus, 'partial')
    assert.equal(measurement.finalReady, false)
  })
  console.log(`${passed} Plan flight publication checks passed (offline hook integration).`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
