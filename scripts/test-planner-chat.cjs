// Exercise the production PlannerPage tree and event handlers without network or native UI.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const file = path.resolve(__dirname, '../src/features/ui-experience/PlannerPage.tsx')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText

function harness() {
  const state = [], effects = []
  let cursor = 0, changed = false
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
  const PlannerReply = ({ className, content }) => ({ type: 'Text', props: { className, children: content } })
  const stubs = {
    '../../i18n/trip': { tripText: (_locale, key) => key },
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    '@tarojs/components': { View: 'View', Text: 'Text', Button: 'Button', Textarea: 'Textarea' },
    './VisualMedia': { Icon: 'Icon', Photo: 'Photo' },
    './presentation': { formatPrice: () => '', tripDurationLabel: () => '', travelerLabel: () => '' },
    '../../components/plan/PlannerProgress': { __esModule: true, default: 'PlannerProgress' },
    '../../components/plan/PlannerReply': { __esModule: true, default: PlannerReply },
    './SharedUI': { DemoNote: 'DemoNote', PageHeader: ({ action }) => action ?? null },
    './experience.scss': {}, './planner.scss': {}
  }
  const loaded = { exports: {} }
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, require: name => {
    if (!(name in stubs)) throw new Error(`Unexpected PlannerPage dependency: ${name}`)
    return stubs[name]
  } }, { filename: file })

  const trip = { destination: 'Tokyo', title: 'Tokyo trip', route: ['Beijing'], durationDays: 3, days: [], flights: [] }
  let props = {
    trip, onOpenTrip() {}, onSearchFlights() {}, onSubmitPrompt() {},
    productionTimeline: [], productionBusy: false, productionPrompt: '', productionReply: '',
    productionResultAvailable: false, locale: 'zh'
  }
  function render() {
    let tree
    for (let pass = 0; pass < 20; pass++) {
      changed = false; cursor = 0
      tree = loaded.exports.default(props)
      effects.splice(0).forEach(effect => effect())
      if (!changed) return tree
    }
    throw new Error('Unstable PlannerPage render')
  }
  return { render, setProps: next => { props = { ...props, ...next } } }
}

function nodes(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (typeof value.type === 'function') return nodes(value.type(value.props ?? {}))
  return [value, ...nodes(value.props?.children)]
}
const text = value => value === undefined || value === null || typeof value === 'boolean' ? ''
  : typeof value !== 'object' ? String(value)
    : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children)
const byClass = (tree, className) => nodes(tree).filter(node => node.props?.className?.split(' ').includes(className))
const oneClass = (tree, className) => {
  const matches = byClass(tree, className)
  assert.equal(matches.length, 1, `expected one .${className}, found ${matches.length}`)
  return matches[0]
}
const timeline = () => [
  { id: 'turn-1', user: { content: 'Plan three days in Tokyo' }, assistant: { content: 'I will sketch a relaxed Tokyo route.' } },
  { id: 'turn-2', user: { content: 'Add a quiet garden on day two' }, assistant: { content: 'I added Shinjuku Gyoen to day two.' } }
]
let passed = 0
function check(label, fn) { fn(); passed++; console.log(`PASS ${label}`) }

check('renders ordered historical user prompts and replies, with latest live reply in its own turn', () => {
  const h = harness()
  h.setProps({ productionTimeline: timeline(), productionPrompt: 'Add a quiet garden on day two', productionReply: 'Current reply from the latest turn.' })
  const tree = h.render(), turns = byClass(tree, 'pl-turn')
  assert.equal(turns.length, 2)
  assert.equal(text(byClass(turns[0], 'pl-user-message')[0]), 'Plan three days in Tokyo')
  assert.equal(text(byClass(turns[0], 'pl-reply-copy')[0]), 'I will sketch a relaxed Tokyo route.')
  assert.equal(text(byClass(turns[1], 'pl-user-message')[0]), 'Add a quiet garden on day two')
  assert.equal(text(byClass(turns[1], 'pl-reply-copy')[0]), 'Current reply from the latest turn.')
})

check('an assistant-less newest user turn and prior replies remain visible while generating', () => {
  const h = harness(), rows = timeline()
  rows.push({ id: 'turn-3', user: { content: 'Keep the afternoons flexible' }, assistant: null })
  h.setProps({ productionTimeline: rows, productionBusy: true, productionPrompt: 'Keep the afternoons flexible' })
  const tree = h.render(), turns = byClass(tree, 'pl-turn')
  assert.equal(turns.length, 3)
  assert.equal(text(byClass(turns[0], 'pl-reply-copy')[0]), 'I will sketch a relaxed Tokyo route.')
  assert.equal(text(byClass(turns[1], 'pl-reply-copy')[0]), 'I added Shinjuku Gyoen to day two.')
  assert.equal(text(byClass(turns[2], 'pl-user-message')[0]), 'Keep the afternoons flexible')
  assert.equal(byClass(turns[2], 'pl-generating').length, 1)
  assert.equal(byClass(turns[2], 'pl-assistant-turn').length, 0)
})

check('composer sends the draft once, clears it, and busy state exposes only stop', () => {
  const h = harness(), sent = []
  h.setProps({ onSubmitPrompt: message => sent.push(message), onCancelProduction() {} })
  let tree = h.render(), input = oneClass(tree, 'pl-textarea')
  input.props.onInput({ detail: { value: '  Make day three easy  ' } })
  tree = h.render()
  assert.equal(oneClass(tree, 'pl-textarea').props.value, '  Make day three easy  ')
  oneClass(tree, 'pl-submit').props.onClick()
  tree = h.render()
  assert.deepEqual(sent, ['Make day three easy'])
  assert.equal(oneClass(tree, 'pl-textarea').props.value, '')
  assert.equal(oneClass(tree, 'pl-submit').props.disabled, true)

  h.setProps({ productionBusy: true })
  tree = h.render()
  assert.equal(byClass(tree, 'pl-stop').length, 1)
  assert.equal(byClass(tree, 'pl-submit').filter(button => !button.props.className.includes('pl-stop')).length, 0)
  assert.equal(oneClass(tree, 'pl-stop').props.disabled, false)
})

check('new conversation invokes callback when idle and is disabled while busy', () => {
  const h = harness(), starts = []
  h.setProps({ onNewConversation: () => starts.push('new') })
  let tree = h.render()
  let action = nodes(tree).find(node => node.type === 'Button' && text(node) === '新旅行')
  assert.ok(action)
  assert.equal(action.props.disabled, false)
  action.props.onClick()
  assert.deepEqual(starts, ['new'])
  h.setProps({ productionBusy: true })
  tree = h.render()
  action = nodes(tree).find(node => node.type === 'Button' && text(node) === '新旅行')
  assert.equal(action.props.disabled, true)
})

check('failed turn keeps saved transcript and locale selects the new-chat label', () => {
  const h = harness()
  h.setProps({ productionTimeline: timeline(), productionError: 'The reply could not be completed.', onNewConversation() {} })
  let tree = h.render()
  assert.ok(text(tree).includes('The reply could not be completed.'))
  assert.deepEqual(byClass(tree, 'pl-turn').map(turn => text(byClass(turn, 'pl-user-message')[0])), [
    'Plan three days in Tokyo', 'Add a quiet garden on day two'
  ])
  assert.equal(byClass(tree, 'pl-interrupted').length, 1)
  h.setProps({ productionError: '', locale: 'en' })
  tree = h.render()
  assert.ok(nodes(tree).some(node => node.type === 'Button' && text(node) === 'New trip'))
})

console.log(`Planner chat UI checks: ${passed} passed (offline rendered component tree).`)
