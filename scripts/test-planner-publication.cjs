// Real component execution with deterministic hooks/Taro stubs; no browser or Provider.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const tripCopy = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/i18n/trip.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {module:tripCopy,exports:tripCopy.exports})
function harness(file, name, props, dependencies = {}) {
  const slots = [], effects = []
  let cursor = 0, dirty = false, tree
  const hooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => {
        const next = typeof value === 'function' ? value(slots[i]) : value
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true }
      }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i]
      if (!previous || deps.some((v, j) => !Object.is(v, previous.deps[j]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() } })
      }
    }
  }
  const component = { exports: {} }, jsx = (type, props) => ({ type, props })
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    module: component, exports: component.exports, setTimeout, clearTimeout,
    require(dep) {
      if (dep in dependencies) return dependencies[dep]
      if (dep.endsWith('/i18n/trip')) return tripCopy.exports
      if (dep === 'react') return hooks
      if (dep === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (dep === '@tarojs/components') return { View: 'View', Text: 'Text', Button: 'Button', Textarea: 'Textarea' }
      if (dep.endsWith('/VisualMedia')) return { Icon: 'Icon', Photo: 'Photo' }
      if (dep.endsWith('/presentation')) return { formatPrice: () => '', priceStatusLabel: () => '', tripDurationLabel: () => '', travelerLabel: () => '' }
      if (dep.endsWith('/PlannerProgress')) return { default: 'PlannerProgress' }
      if (dep.endsWith('/PlannerReply')) return { default: 'PlannerReply' }
      if (dep.endsWith('/SharedUI')) return { DemoNote: 'DemoNote', PageHeader: 'PageHeader' }
      if (dep.endsWith('.scss')) return {}
      throw new Error(`Unexpected dependency: ${dep}`)
    }
  }, { filename: file })
  function render() {
    for (let i = 0; i < 15; i++) {
      cursor = 0; dirty = false; tree = component.exports[name](props)
      while (effects.length) effects.shift()()
      if (!dirty) return tree
    }
    throw new Error('Component did not settle')
  }
  function nodes(value) {
    if (!value || typeof value !== 'object') return []
    if (Array.isArray(value)) return value.flatMap(nodes)
    return [value, ...nodes(value.props?.children)]
  }
  function content(value) {
    if (value == null || typeof value === 'boolean') return ''
    if (Array.isArray(value)) return value.map(content).join('')
    return typeof value === 'object' ? content(value.props?.children) : String(value)
  }
  render()
  return { props, render, nodes: () => nodes(tree), content: (value = tree) => content(value),
    find: cls => nodes(tree).find(n => n.props?.className?.split(' ').includes(cls)) }
}
let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const trip = { destination: '东京', country: '日本', title: '已保存攻略', route: ['北京', '东京'], days: [], flights: [], description: '' }
function planner(overrides = {}) {
  return harness('src/features/ui-experience/PlannerPage.tsx', 'PlannerPage', {
    trip, onOpenTrip() {}, onSearchFlights() {}, onSubmitPrompt() {}, productionBusy: true,
    productionPrompt: '安排旅行', productionResultAvailable: true, onCancelProduction() {},
    flightDecision: { type: 'FlightDecision', props: { children: '已提交航班卡片' } }, ...overrides
  })
}
check('busy renders committed guide and flight before final prose', () => {
  let opened = 0
  const h = planner({ onOpenTrip() { opened++ } })
  assert.match(h.content(), /已保存，仍在整理\/核验/)
  assert.match(h.content(), /已提交航班卡片/)
  h.find('pl-result').props.onClick(); assert.equal(opened, 1)
})
check('unsaved guide never appears as a saved card', () => {
  const h = planner({ productionResultAvailable: false })
  assert.equal(h.find('pl-result'), undefined); assert.match(h.content(), /已提交航班卡片/)
})
check('empty busy draft remains editable while submit is disabled', () => {
  const h = planner()
  assert.equal(h.find('pl-textarea').props.value, '')
  assert.notEqual(h.find('pl-textarea').props.disabled, true)
  assert.equal(h.find('pl-submit').props.disabled, true)
})
check('draft survives completion and can then submit once', () => {
  const messages = [], h = planner({ onSubmitPrompt(message) { messages.push(message) } })
  h.find('pl-textarea').props.onInput({ detail: { value: '增加一天' } }); h.render()
  h.find('pl-submit').props.onClick(); h.render(); assert.equal(messages.length, 0)
  h.props.productionBusy = false; h.render()
  assert.equal(h.find('pl-textarea').props.value, '增加一天')
  assert.equal(h.find('pl-submit').props.disabled, false)
  h.find('pl-submit').props.onClick(); h.render(); assert.deepEqual(messages, ['增加一天'])
})
check('cancel awaits acknowledgement; failure stays visible while busy', () => {
  let cancellations = 0
  const h = planner({ onCancelProduction() { cancellations++ } })
  const cancel = () => h.nodes().find(n => n.type === 'Button' && /取消规划|正在取消/.test(h.content(n)))
  cancel().props.onClick(); h.render()
  assert.equal(cancellations, 1); assert.equal(h.find('pl-submit').props.disabled, true)
  assert.doesNotMatch(h.content(), /已取消规划/)
  h.props.productionCancelling = true; h.render(); assert.equal(cancel().props.disabled, true)
  h.props.productionCancelling = false; h.props.productionError = '未能确认停止，仍在等待服务端结果'; h.render()
  assert.match(h.content(), /未能确认停止/); assert.equal(h.find('pl-submit').props.disabled, true)
})
const offer = { id: 'offer-1', segments: [{ departure: '2026-10-01T10:00', arrival: '2026-10-01T14:00', flightNumber: 'CA123' }], airlines: [], layovers: [] }
function flight(selection) {
  return harness('src/features/ui-experience/FlightDecisionPanel.tsx', 'FlightDecisionPanel', {
    artifact: { id: 'artifact-1', payload: {} }, selection, busy: true,
    onOpenCandidates() { throw new Error('Mutation while busy') }, onChange() {}, onPlan() {}
  }, {
    '../../components/artifacts/FlightSearchCard': { FlightSearchCard: 'FlightSearchCard' },
    '../../components/artifacts/payload': { record: v => v, displayOffers: () => [offer], displayOfferById: () => offer },
    '../../services/flightConnections': { flightPath: () => 'PEK → HND', connectionLabel: () => '' }
  })
}
check('new candidates expose readonly segments without adopt while busy', () => {
  const h = flight()
  assert.equal(h.nodes().find(n => n.type === 'FlightSearchCard').props.onAction, undefined)
  h.find('flight-decision__details-toggle').props.onClick(); h.render(); assert.match(h.content(), /CA123/)
})
check('adopted segments remain readable with change and plan disabled', () => {
  const h = flight({ kind: 'offer', artifactId: 'artifact-1', offerId: 'offer-1', revision: 1 })
  h.find('flight-decision__details-toggle').props.onClick(); h.render(); assert.match(h.content(), /CA123/)
  assert.equal(h.find('ux-secondary').props.disabled, true); assert.equal(h.find('ux-primary').props.disabled, true)
})
check('telemetry observes committed result branches rather than merely receiving refs', () => {
  const commits = []
  const h = planner({ productionResultAvailable: false, flightDecision: undefined,
    productionTelemetry: { id: 'turn-local', flights: [], finalReady: false },
    onProductionCommit: (id, event) => commits.push({ id, ...event }) })
  assert.equal(commits.length, 0)
  h.props.flightDecision = { type: 'FlightDecision', props: { children: 'loaded flight' } }
  h.props.productionTelemetry = { id: 'turn-local', flights: [{ id: 'flight', verificationStatus: 'partial' }], finalReady: false }
  h.render()
  assert.ok(commits.some(value => value.kind === 'flight' && value.artifactId === 'flight'))
  assert.equal(commits.some(value => value.kind === 'guide' || value.kind === 'final'), false)
  h.props.productionResultAvailable = true
  h.props.productionTelemetry = { ...h.props.productionTelemetry, guide: { id: 'guide', verificationStatus: 'verified' } }
  h.render()
  assert.ok(commits.some(value => value.kind === 'guide' && value.verificationStatus === 'verified'))
  assert.equal(commits.some(value => value.kind === 'final'), false)
  h.props.productionBusy = false; h.props.productionReply = 'Saved and checked.'
  h.props.productionTelemetry = { ...h.props.productionTelemetry, finalReady: true }
  h.render()
  assert.ok(commits.some(value => value.kind === 'final' && value.id === 'turn-local'))
})
check('failure and cancellation views do not fabricate a final commit', () => {
  const commits = [], h = planner({ productionBusy: false, productionError: 'Stopped', productionResultAvailable: false,
    productionTelemetry: { id: 'cancelled-turn', flights: [], finalReady: false }, onProductionCommit: (_id, event) => commits.push(event) })
  h.render()
  assert.equal(commits.some(value => value.kind === 'final'), false)
})
console.log(`${passed} Planner publication component checks passed (deterministic hooks; no browser/device).`)
