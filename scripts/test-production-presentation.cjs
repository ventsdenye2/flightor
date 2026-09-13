const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const file = path.join(root, 'src/features/ui-experience/productionPresentation.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
const loadedModule = { exports: {} }
const displayPayload = {
  record: value => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined,
  records: (value, max) => Array.isArray(value) ? value.slice(0, max).filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [],
  text: value => typeof value === 'string' && value.trim() ? value : undefined,
  numberValue: value => typeof value === 'number' && Number.isFinite(value) ? value : undefined,
  firstText: (...values) => values.find(value => typeof value === 'string' && value.trim())
}
vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, URL, require: dependency => {
  if (dependency.endsWith('/components/artifacts/payload')) return displayPayload
  throw new Error(`Unexpected runtime dependency: ${dependency}`)
} }, { filename: file })
const { artifactToTripPresentation, safeSourceUrl } = loadedModule.exports
const location = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', latitude: 35.6, longitude: 139.7 }
const route = { kind: 'trip_route_plan', schemaVersion: 1, tripContextVersion: 4, cities: [{ location, stayDays: 2, role: 'visit', reasons: ['culture'] }], days: [{ day: 1, city: location, activityRefs: [] }, { day: 2, city: location, activityRefs: [] }], warnings: [], landTransfers: [] }
const routeArtifact = { id: 'route-1', tripId: 'trip-1', type: 'route', schemaVersion: 1, payload: route }
const guideItem = { id: 'activity-1', title: '浅草', description: '寺院与街区', city: location, category: 'activity', verification: { status: 'partially_verified', sources: [{ provider: 'provider-x', reference: 'https://example.com/a' }, { provider: 'bad', reference: 'https://user:pass@example.com/private' }, { provider: 'ftp', reference: 'ftp://example.com/a' }] }, timeOfDay: 'morning' }
const guide = { kind: 'trip_travel_guide', schemaVersion: 1, routeArtifactId: 'route-1', days: [{ day: 1, city: location, theme: '慢慢走', items: [guideItem] }], warnings: [] }
const guideArtifact = { id: 'guide-1', tripId: 'trip-1', type: 'travel_guide', schemaVersion: 1, payload: guide }
const workspace = { trip: { id: 'trip-1', title: '东京周末', contextVersion: 4 }, tripContextSummary: { departureWindow: { from: '2026-10-01', to: '2026-10-09', precision: 'exact' }, returnWindow: { from: '2026-10-03', to: '2026-10-03', precision: 'exact' }, travelDays: 3 }, messages: [{ delivery: { status: 'satisfied', artifactIds: ['guide-1'] } }] }
let passed = 0
function check(label, fn) { fn(); passed += 1; console.log(`PASS ${label}`) }

check('rejects non-route and wrong route payloads', () => { assert.throws(() => artifactToTripPresentation({ ...routeArtifact, type: 'research' }), /不支持/); assert.throws(() => artifactToTripPresentation({ ...routeArtifact, payload: { ...route, kind: 'wrong' } }), /不支持/) })
check('rejects guide trip and route identity mismatches', () => { assert.throws(() => artifactToTripPresentation(routeArtifact, { ...guideArtifact, tripId: 'trip-2' }), /不匹配/); assert.throws(() => artifactToTripPresentation(routeArtifact, { ...guideArtifact, payload: { ...guide, routeArtifactId: 'route-2' } }), /不匹配/) })
check('accepts only safe source URLs and preserves provider/status', () => { assert.equal(safeSourceUrl('ftp://example.com/a'), undefined); assert.equal(safeSourceUrl('https://user:pass@example.com/a'), undefined); assert.equal(safeSourceUrl('https://example.com/a'), 'https://example.com/a'); const sources = artifactToTripPresentation(routeArtifact, guideArtifact, workspace).sources; assert.equal(sources[0].label, 'provider-x'); assert.equal(sources[0].url, 'https://example.com/a'); assert.equal(sources[0].status, 'partial'); assert.equal(sources.some(source => source.url === 'ftp://example.com/a' || source.url?.includes('@')), false) })
check('does not treat city center as activity coordinates or invent media', () => { const activity = artifactToTripPresentation(routeArtifact, guideArtifact, workspace).days[0].activities[0]; assert.equal(activity.latitude, null); assert.equal(activity.longitude, null); assert.equal(activity.media, null) })
check('uses exact departure and return windows from matching context', () => { const trip = artifactToTripPresentation(routeArtifact, guideArtifact, workspace); assert.equal(trip.dates.start, '2026-10-01'); assert.equal(trip.dates.end, '2026-10-03'); assert.equal(trip.durationDays, 3); const old = artifactToTripPresentation({ ...routeArtifact, payload: { ...route, tripContextVersion: 3 } }, guideArtifact, workspace); assert.equal(old.dates.start, null); assert.equal(old.dates.end, null) })
check('delivery satisfaction controls ready status', () => { assert.equal(artifactToTripPresentation(routeArtifact, guideArtifact, workspace).status, 'ready'); assert.equal(artifactToTripPresentation(routeArtifact, guideArtifact, { ...workspace, messages: [{ delivery: { status: 'partial', artifactIds: ['guide-1'] } }] }).status, 'partial') })
check('route-only snapshots stay partial with unknown travelers and prices', () => { const trip = artifactToTripPresentation(routeArtifact, undefined, workspace); assert.equal(trip.status, 'partial'); assert.equal(trip.days[0].status, 'pending'); assert.equal(trip.travelers, null); assert.equal(trip.flights.length, 0) })
check('guide activities preserve identity and unknown time fields', () => { const activity = artifactToTripPresentation(routeArtifact, guideArtifact, workspace).days[0].activities[0]; assert.equal(activity.id, 'activity-1'); assert.equal(activity.time, '上午'); assert.equal(activity.until, null) })

// Render the actual PlannerPage with a small hook adapter. This exercises the
// server outcome -> visible state -> retry event without a backend or provider.
function plannerHarness(overrides = {}) {
  const slots = [], effects = [], sent = []
  let cursor = 0, dirty = false, tree
  const props = { trip: { ...artifactToTripPresentation(routeArtifact, undefined, workspace), description: 'FALLBACK_DESCRIPTION', days: [] },
    onOpenTrip() {}, onSearchFlights() {}, onSubmitPrompt: message => sent.push(message),
    productionPrompt: '东京玩两天，文化景点和街区散步。', productionReply: '本轮处理未完整结束。',
    productionResultAvailable: false, ...overrides }
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true } }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useEffect(effect, dependencies) { const index = cursor++; const previous = slots[index]; if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) { slots[index] = dependencies; effects.push(effect) } }
  }
  const componentFile = path.join(root, 'src/features/ui-experience/PlannerPage.tsx')
  const output = ts.transpileModule(fs.readFileSync(componentFile, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const componentModule = { exports: {} }
  vm.runInNewContext(output, { module: componentModule, exports: componentModule.exports, setTimeout, clearTimeout, require: dependency => {
    if (dependency === 'react') return hooks
    if (dependency === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
    if (dependency === '@tarojs/components') return Object.fromEntries(['View', 'Text', 'Button', 'Textarea'].map(name => [name, name]))
    if (dependency === './VisualMedia') return { Icon: 'Icon', Photo: 'Photo' }
    if (dependency === './SharedUI') return { DemoNote: 'DemoNote', PageHeader: 'PageHeader' }
    if (dependency === './presentation') return { formatPrice: () => '待确认', priceStatusLabel: () => '价格待确认', tripDurationLabel: () => '两天', travelerLabel: () => '人数待确认' }
    if (dependency.endsWith('.scss')) return {}
    throw new Error(`Unexpected planner dependency: ${dependency}`)
  } }, { filename: componentFile })
  function render() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      dirty = false; cursor = 0
      tree = componentModule.exports.PlannerPage(props)
      while (effects.length) effects.shift()()
      if (!dirty) return tree
    }
    throw new Error('Planner render did not settle')
  }
  function nodes(value = tree) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(item => nodes(item ?? null)); return [value, ...nodes(value.props?.children ?? null)] }
  function content(value = tree) { if (value === null || value === undefined || typeof value === 'boolean') return ''; if (typeof value !== 'object') return String(value); if (Array.isArray(value)) return value.map(item => content(item ?? null)).join(''); return value.type === 'DemoNote' ? value.props.text : content(value.props?.children ?? null) }
  render()
  return { props, sent, render, nodes, content, button: label => nodes().find(node => node.type === 'Button' && content(node) === label) }
}

check('an interrupted turn without an artifact shows retry and no empty result claims', () => {
  const h = plannerHarness({ productionStopReason: 'max_tool_steps' })
  assert.ok(h.content().includes('本次规划未完成'))
  assert.ok(!h.content().includes('每日安排尚未补充'))
  assert.ok(!h.content().includes('FALLBACK_DESCRIPTION'))
  assert.ok(!h.content().includes('结果来自当前登录行程'))
  assert.ok(!h.content().includes('限流'))
  assert.equal(h.button('查看航班'), undefined)
  assert.equal(h.nodes().some(node => node.props?.className === 'pl-result'), false)
  h.button('重试这次规划').props.onClick()
  assert.deepEqual(h.sent, [h.props.productionPrompt])
  h.render()
  assert.ok(h.content().includes('正在规划你的旅程'))
})
check('rate limiting is explained only when explicitly reported on an unfinished turn', () => {
  const h = plannerHarness({ productionStopReason: 'max_tool_steps', productionWarnings: ['research_provider_rate_limited'] })
  assert.ok(h.content().includes('联网研究服务暂时限流，本次未生成新攻略，请稍后重试。'))
})
check('a transport failure is an error with retry instead of a voluntary pause', () => {
  const h = plannerHarness({ productionError: '规划服务暂时不可用，请重试。' })
  assert.ok(h.content().includes('规划服务暂时不可用，请重试。'))
  assert.ok(!h.content().includes('已暂停'))
  assert.ok(h.button('重试这次规划'))
})
check('a finished model turn with pending delivery and rate limiting offers an explicit retry', () => {
  const h = plannerHarness({ productionStopReason: 'goal_pending', productionWarnings: ['research_provider_rate_limited'],
    productionDelivery: { status: 'pending', artifactIds: [], missing: ['research'], warnings: [] } })
  assert.ok(h.content().includes('联网研究服务暂时限流'))
  assert.ok(h.button('重试这次规划'))
})
check('partial delivery retains its saved result alongside the retry action', () => {
  const h = plannerHarness({ productionStopReason: 'goal_partial', productionResultAvailable: true,
    productionDelivery: { status: 'partial', artifactIds: ['route-1'], missing: ['travel_guide'], warnings: [] } })
  assert.ok(h.content().includes('本次规划未完成'))
  assert.ok(h.nodes().some(node => node.props?.className === 'pl-result'))
  assert.ok(h.button('重试这次规划'))
})
check('a satisfied result stays successful even after a research rate-limit warning', () => {
  const h = plannerHarness({ productionStopReason: 'completed', productionResultAvailable: true, productionReply: '两天攻略已完成并保存。',
    productionWarnings: ['research_provider_rate_limited'], productionDelivery: { status: 'satisfied', artifactIds: ['guide-1'], missing: [], warnings: [] } })
  assert.ok(h.content().includes('两天攻略已完成并保存。'))
  assert.ok(!h.content().includes('本次规划未完成'))
  assert.ok(!h.content().includes('限流'))
  assert.equal(h.button('重试这次规划'), undefined)
  assert.ok(h.nodes().some(node => node.props?.className === 'pl-result'))
})
check('clarification without an artifact stays a conversation instead of a result', () => {
  const h = plannerHarness({ productionStopReason: 'responded', productionReply: '想从哪里出发？' })
  assert.ok(h.content().includes('想从哪里出发？'))
  assert.ok(!h.content().includes('本次规划未完成'))
  assert.ok(!h.content().includes('每日安排尚未补充'))
  assert.ok(h.button('继续补充想法'))
})
console.log(`Production presentation behavior checks: ${passed} passed.`)
