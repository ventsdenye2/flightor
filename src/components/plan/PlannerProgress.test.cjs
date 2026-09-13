// Offline rendering/lifecycle checks: no server turn, model call or chat persistence.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const file = path.join(__dirname, 'PlannerProgress.tsx')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText

function harness() {
  const slots = [], effects = [], intervals = new Map()
  let cursor = 0, dirty = false, tree, time = 20_000, timerId = 0
  const props = { compact: true, active: true, locale: 'zh', progress: { connection: 'connecting', startedAt: time } }
  class Clock extends Date { static now() { return time } }
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => {
        const next = typeof value === 'function' ? value(slots[index]) : value
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true }
      }]
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => {
          previous?.cleanup?.()
          slots[index] = { deps, cleanup: effect() }
        })
      }
    }
  }
  const component = { exports: {} }
  vm.runInNewContext(output, {
    module: component, exports: component.exports, Date: Clock,
    setInterval(callback) { const id = ++timerId; intervals.set(id, callback); return id },
    clearInterval(id) { intervals.delete(id) },
    require(dependency) {
      if (dependency === 'react') return hooks
      if (dependency === 'react/jsx-runtime') return { jsx: (type, properties) => ({ type, props: properties }), jsxs: (type, properties) => ({ type, props: properties }) }
      if (dependency === '@tarojs/components') return { View: 'View', Text: 'Text' }
      if (dependency.endsWith('.scss')) return {}
      throw new Error(`Unexpected progress dependency: ${dependency}`)
    }
  }, { filename: file })
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) {
      dirty = false; cursor = 0
      tree = component.exports.default(props)
      while (effects.length) effects.shift()()
      if (!dirty) return tree
    }
    throw new Error('Progress rendering did not settle')
  }
  function content(value = tree) {
    if (value === null || value === undefined || typeof value === 'boolean') return ''
    if (typeof value !== 'object') return String(value)
    if (Array.isArray(value)) return value.map(child => content(child ?? null)).join('')
    return content(value.props?.children ?? null)
  }
  function nodes(value = tree) {
    if (!value || typeof value !== 'object') return []
    if (Array.isArray(value)) return value.flatMap(child => nodes(child ?? null))
    return [value, ...nodes(value.props?.children ?? null)]
  }
  render()
  return {
    props, render, content, nodes, intervals,
    confirm(stage) { props.progress = { ...props.progress, connection: 'running', stage, lastConfirmedAt: time }; render() },
    advance(ms) { time += ms; for (const callback of intervals.values()) callback(); render() },
    unmount() { for (const slot of slots) slot?.cleanup?.() }
  }
}

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }

check('confirmed activities replace the single live status without accumulating a history', () => {
  const h = harness()
  assert.match(h.content(), /正在连接规划助手/)
  assert.doesNotMatch(h.content(), /连接正常|正在研究/)
  h.confirm('researching')
  assert.match(h.content(), /正在研究目的地与活动/)
  assert.match(h.content(), /连接正常/)
  h.confirm('building_itinerary')
  assert.match(h.content(), /正在安排游玩行程/)
  assert.doesNotMatch(h.content(), /正在研究目的地与活动/)
  assert.equal(h.nodes().filter(node => node.props?.role === 'status').length, 1)
  const live = h.nodes().find(node => node.props?.role === 'status')
  assert.doesNotMatch(h.content(live), /已等待/)
  assert.equal(h.intervals.size, 1)
  h.unmount()
})

check('heartbeat expiry labels old activity as last confirmed and recovery replaces it', () => {
  const h = harness()
  h.confirm('researching')
  h.advance(15_000)
  assert.match(h.content(), /正在确认连接/)
  assert.match(h.content(), /最近确认：正在研究目的地与活动/)
  assert.doesNotMatch(h.content(), /连接正常/)
  assert.match(h.content(), /已等待 15 秒/)
  h.confirm('finalizing')
  assert.match(h.content(), /正在整理结果/)
  assert.doesNotMatch(h.content(), /最近确认|正在研究目的地与活动|正在自动重连/)
  h.unmount()
})

check('a disconnect before confirmation never invents an activity', () => {
  const h = harness()
  h.props.progress = { ...h.props.progress, connection: 'reconnecting' }
  h.render()
  assert.match(h.content(), /正在确认连接/)
  assert.doesNotMatch(h.content(), /最近确认|连接正常|正在研究/)
  h.unmount()
})

check('completed work disappears immediately and disposes the interval', () => {
  const h = harness()
  h.confirm('finalizing')
  h.props.progress = { ...h.props.progress, connection: 'completed' }
  assert.equal(h.render(), null)
  assert.equal(h.content(), '')
  assert.equal(h.intervals.size, 0)
})

check('failure or cancellation deactivates status; the next turn starts with a fresh clock', () => {
  const h = harness()
  h.confirm('researching')
  h.advance(9_000)
  h.props.active = false
  h.props.progress = undefined
  assert.equal(h.render(), null)
  assert.equal(h.intervals.size, 0)
  h.advance(10_000)
  h.props.active = true
  h.props.progress = { connection: 'connecting', startedAt: 39_000 }
  h.render()
  assert.match(h.content(), /已等待 0 秒/)
  assert.doesNotMatch(h.content(), /正在研究|最近确认/)
  assert.equal(h.intervals.size, 1)
  h.unmount()
  assert.equal(h.intervals.size, 0)
})

check('only allowlisted stage labels render even if the transport object contains private fields', () => {
  const h = harness()
  h.props.locale = 'en'
  h.props.progress = { ...h.props.progress, reasoning: 'PRIVATE_REASONING', toolArguments: 'PRIVATE_ARGUMENTS' }
  h.confirm('updating_trip')
  assert.match(h.content(), /Updating your trip preferences/)
  assert.doesNotMatch(h.content(), /PRIVATE_REASONING|PRIVATE_ARGUMENTS/)
  h.unmount()
})

console.log(`\n${passed} PlannerProgress rendering and lifecycle checks passed (offline).`)
