const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Render the production exports with native-component stand-ins. No service is contacted.
function harness(relative, name, props, extra = {}) {
  let cursor = 0, tree
  const slots = []
  const jsx = (type, values) => typeof type === 'function' ? type(values) : { type, props: values }
  const component = (type, children, rest = {}) => ({ type, props: { children, ...rest } })
  const shared = {
    PageHeader: value => component('View', [value.title, value.action]),
    EmptyState: value => component('View', [value.title, value.description, component('Button', value.actionLabel, { onClick: value.onAction })]),
    Sheet: value => component('View', [value.title, value.children]),
    SectionHeading: value => component('View', value.title),
    MenuRow: value => component('Button', [value.title, value.value, value.description], { onClick: value.onClick }),
    DemoNote: value => component('Text', value.text)
  }
  const file = path.resolve(__dirname, '..', relative)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(output, { module: loaded, exports: loaded.exports, setTimeout: () => 1, require: dependency => {
    if (dependency === 'react') return { useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] }, useEffect: () => {} }
    if (dependency === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    if (dependency === '@tarojs/components') return Object.fromEntries(['View', 'Text', 'Button', 'Input', 'Image', 'Slider'].map(value => [value, value]))
    if (dependency.endsWith('SharedUI')) return shared
    if (dependency.endsWith('VisualMedia')) return { Icon: 'Icon', Photo: 'Photo' }
    if (dependency.endsWith('.scss') || dependency === './presentation' || dependency === './media') return {}
    if (dependency in extra) return extra[dependency]
    throw new Error(`Unexpected dependency: ${dependency}`)
  } }, { filename: file })
  const render = () => { cursor = 0; tree = loaded.exports[name](props); return tree }
  render()
  return { render, get tree() { return tree } }
}
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)]
const text = value => value === undefined || value === null || typeof value === 'boolean' ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children)
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node) === label)
let passed = 0
function check(label, run) { run(); passed += 1; console.log(`PASS ${label}`) }

const trip = { id: 'cloud-trip', title: '东京两天', status: 'saved', updatedAt: '2026-09-13T09:00:00Z', contextVersion: 2, savedRoute: { artifactId: 'artifact-1', routeId: 'route-1', contextVersion: 1 } }
function tripsHarness(overrides = {}) {
  const calls = []
  const props = { signedIn: true, trips: [], loading: false, busy: false, hasMore: false, workspace: null, locale: 'zh',
    ...Object.fromEntries(['onLogin', 'onPlan', 'onFilter', 'onRetry', 'onLoadMore', 'onOpenTrip', 'onDetails', 'onArchive', 'onSavedRoute', 'onArtifact', 'onCloseWorkspace'].map(name => [name, (...args) => calls.push([name, ...args])])), ...overrides }
  return { ...harness('src/features/ui-experience/LibraryPages.tsx', 'CloudTripsPage', props), calls }
}

check('a signed-out library hides stale account records and opens real login', () => {
  const h = tripsHarness({ signedIn: false, trips: [trip], workspace: { trip, conversations: [], artifactRefs: [] } })
  assert.ok(!text(h.tree).includes(trip.title))
  button(h.tree, '登录与同步').props.onClick()
  assert.deepEqual(h.calls, [['onLogin']])
})
check('empty and failed cloud loads do not invent sample trips or claim an empty account on failure', () => {
  const empty = tripsHarness()
  assert.ok(text(empty.tree).includes('下一站，还没写下'))
  assert.ok(!text(empty.tree).includes('示例'))
  const failed = tripsHarness({ error: '服务不可用' })
  assert.ok(text(failed.tree).includes('服务不可用'))
  assert.ok(!text(failed.tree).includes('下一站，还没写下'))
  button(failed.tree, '重新加载').props.onClick()
  assert.deepEqual(failed.calls, [['onRetry']])
})
check('saved cloud trip actions preserve record identity and changed-context warning', () => {
  const h = tripsHarness({ trips: [trip] })
  assert.ok(text(h.tree).includes('条件已变更'))
  assert.ok(!nodes(h.tree).some(node => node.type === 'Photo'))
  button(h.tree, '继续安排').props.onClick()
  button(h.tree, '归档行程').props.onClick()
  button(h.tree, '查看保存的路线 · 条件已变更').props.onClick()
  assert.equal(h.calls[0][1], trip)
  assert.equal(h.calls[1][1], trip)
  assert.equal(h.calls[2][1], trip)
})
check('workspace actions use the chosen conversation and artifact rather than preview state', () => {
  const artifact = { id: 'guide-7', type: 'travel_guide' }
  const h = tripsHarness({ workspace: { trip, conversations: [{ id: 'conversation-2', title: '修改第二天' }], artifactRefs: [artifact] } })
  button(h.tree, '修改第二天').props.onClick()
  button(h.tree, '每日攻略').props.onClick()
  assert.deepEqual(h.calls, [['onOpenTrip', trip, 'conversation-2'], ['onArtifact', artifact]])
})

check('profile uses supplied account and keeps the real preference editor mounted across its pages', () => {
  const calls = [], memory = { type: 'MemoryEditor', props: { children: '真实偏好编辑器' } }
  const props = { profile: { uid: 'user-1', nickname: '测试旅行者', loginMethod: 'local' }, locale: 'zh', preferences: memory,
    ...Object.fromEntries(['onLogin', 'onLogout', 'onTrips', 'onAlerts', 'onPlan', 'onLocaleChange', 'onAbout'].map(name => [name, () => calls.push(name)])) }
  const h = harness('src/features/ui-experience/ProfilePage.tsx', 'CloudProfilePage', props)
  assert.ok(text(h.tree).includes('测试旅行者'))
  assert.ok(text(h.tree).includes('本地测试账户'))
  assert.ok(!text(h.tree).includes('我的收藏'))
  const memoryBefore = nodes(h.tree).find(node => node.type === 'MemoryEditor')
  button(h.tree, '编辑旅行偏好').props.onClick()
  h.render()
  assert.equal(nodes(h.tree).find(node => node.type === 'MemoryEditor'), memoryBefore)
  assert.equal(nodes(h.tree).find(node => node.props.className === 'pr-cloud-memory').props.style.display, 'block')
})

function alertHarness(params = {}, signedIn = true) {
  const calls = []
  const store = { isLoggedIn: signedIn, alerts: [], addAlert: value => calls.push(value) }
  const taro = { setNavigationBarTitle: () => {}, showToast: () => {}, navigateBack: () => Promise.resolve(), switchTab: () => Promise.resolve() }
  const h = harness('src/subpages/price-alert/index.tsx', 'default', {}, {
    '@tarojs/taro': { default: taro, useRouter: () => ({ params }) },
    'mobx-react-lite': { observer: value => value },
    '../../components/search/AirportSelector': { default: 'AirportSelector' },
    '../../components/common/LoginSheet': { default: 'LoginSheet' },
    '../../stores/userStore': { userStore: store },
    '../../i18n': { localeStore: { locale: 'zh' }, t: key => key },
    '../../utils/format': { formatPrice: value => `¥${value}` }
  })
  return { h, calls, store }
}
check('opening target prices without a search does not manufacture airports or a reference fare', () => {
  const { h, calls } = alertHarness()
  assert.ok(!text(h.tree).includes('PVG'))
  assert.ok(!text(h.tree).includes('LHR'))
  assert.ok(!text(h.tree).includes('搜索结果参考价'))
  assert.ok(text(h.tree).includes('暂未开启自动查价与消息推送'))
  button(h.tree, '保存目标价').props.onClick()
  h.render()
  assert.ok(text(h.tree).includes('请选择不同的出发与到达机场'))
  assert.equal(calls.length, 0)
})
check('a search-supplied route saves only its chosen local target and preserves the login gate', () => {
  const params = { origin: 'pvg', destination: 'NRT', current: '4800' }
  const { h, calls } = alertHarness(params)
  assert.ok(text(h.tree).includes('搜索结果参考价：¥4800'))
  button(h.tree, '保存目标价').props.onClick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].origin, 'PVG')
  assert.equal(calls[0].destination, 'NRT')
  assert.equal(calls[0].targetPrice, 4100)
  const guest = alertHarness(params, false)
  button(guest.h.tree, '保存目标价').props.onClick()
  guest.h.render()
  assert.equal(guest.calls.length, 0)
  assert.equal(nodes(guest.h.tree).find(node => node.type === 'LoginSheet').props.visible, true)
})

console.log(`Production library behavior checks: ${passed} passed.`)
