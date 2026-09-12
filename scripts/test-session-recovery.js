// Run actual auth/transport modules and the Plan event handlers with local adapters.
// No backend, provider calls, real credentials, or browser emulation is involved.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
let passed = 0
async function test(name, run) {
  await run()
  passed += 1
  console.log(`  PASS ${name}`)
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 16; i += 1) await Promise.resolve() }
const ok = data => ({ statusCode: 200, data })
const denied = statusCode => ({ statusCode, data: { error: { code: 'UNAUTHORIZED', message: 'Sign in' } } })

function loader(stubs, globals = {}) {
  const modules = new Map()
  function load(relative) {
    const filename = path.resolve(root, relative)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename
    }).outputText
    vm.runInNewContext(compiled, {
      module, exports: module.exports, console, URL, setTimeout, clearTimeout,
      FLIGHTOR_API_BASE_URL: 'https://flightor.test', FLIGHTOR_USE_MOCK: false, ...globals,
      require(specifier) {
        if (Object.hasOwn(stubs, specifier)) return stubs[specifier]
        if (specifier.endsWith('.scss')) return {}
        if (!specifier.startsWith('.')) throw new Error(`Unexpected dependency ${specifier}`)
        const resolved = path.resolve(path.dirname(filename), specifier)
        const candidates = [resolved + '.ts', resolved + '.tsx', path.join(resolved, 'index.ts'), path.join(resolved, 'index.tsx')]
        const target = candidates.find(candidate => fs.existsSync(candidate))
        if (!target) throw new Error(`Cannot resolve dependency ${specifier} from ${filename}`)
        return load(target)
      }
    }, { filename })
    return module.exports
  }
  return load
}

function authHarness(globals = {}) {
  const storage = new Map([
    ['access_token', 'access-old'], ['refresh_token', 'refresh-old'],
    ['flightor:profile', { uid: 'owner-old', nickname: '', avatarUrl: '' }]
  ])
  const calls = []
  let transport = async () => { throw new Error('Transport not configured') }
  const taro = {
    getStorageSync: key => storage.get(key) ?? '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => { calls.push(options); return transport(options) },
    login: async () => ({ code: 'local-login-code' }),
    showLoading() {}, hideLoading() {}, showToast() {}
  }
  const load = loader({ '@tarojs/taro': taro, '../i18n': { t: key => key },
    mobx: { makeAutoObservable() {}, runInAction: run => run() }, './chatHistory': { clearCloudChatHistory() {} } }, globals)
  const auth = load('src/utils/authSession.ts')
  const { request } = load('src/utils/request.ts')
  const { userStore, registerUserSessionClearHandler } = load('src/stores/userStore.ts')
  return { auth, request, userStore, registerUserSessionClearHandler, storage, calls, taro, setTransport: value => { transport = value } }
}

await test('concurrent 401s share one rotation and retry each request once', async () => {
  const h = authHarness()
  const refresh = deferred()
  let refreshes = 0
  h.setTransport(options => {
    if (options.url.endsWith('/auth/refresh')) { refreshes += 1; return refresh.promise }
    return Promise.resolve(options.header.Authorization === 'Bearer access-next' ? ok({ accepted: true }) : denied(401))
  })
  const a = h.request({ url: '/v1/trips', method: 'POST', data: { title: 'test' }, header: { 'Idempotency-Key': 'stable-key' }, retry: 0 })
  const b = h.request({ url: '/v1/memory', retry: 0 })
  await flush()
  assert.equal(refreshes, 1)
  refresh.resolve(ok({ accessToken: 'access-next', refreshToken: 'refresh-next' }))
  assert.equal((await a).accepted, true)
  assert.equal((await b).accepted, true)
  assert.equal(h.calls.filter(call => call.url.endsWith('/v1/trips')).length, 2)
  assert.ok(h.calls.filter(call => call.url.endsWith('/v1/trips')).every(call => call.header['Idempotency-Key'] === 'stable-key'))
  assert.equal(h.storage.get('refresh_token'), 'refresh-next')
})

await test('a delayed old 401 reuses completed rotation instead of rotating again', async () => {
  const h = authHarness()
  const oldResponse = deferred()
  let refreshes = 0
  h.setTransport(options => {
    if (options.url.endsWith('/auth/refresh')) { refreshes += 1; return Promise.resolve(ok({ accessToken: 'access-next', refreshToken: 'refresh-next' })) }
    if (options.header.Authorization === 'Bearer access-next') return Promise.resolve(ok({ value: 1 }))
    return options.url.endsWith('/slow') ? oldResponse.promise : Promise.resolve(denied(401))
  })
  const slow = h.request({ url: '/slow', retry: 0 })
  await h.request({ url: '/fast', retry: 0 })
  oldResponse.resolve(denied(401))
  await slow
  assert.equal(refreshes, 1)
})

await test('expired refresh clears credentials and owner state', async () => {
  const h = authHarness()
  const cleared = []
  h.registerUserSessionClearHandler(owner => cleared.push(owner))
  h.setTransport(async () => denied(401))
  await assert.rejects(h.request({ url: '/private', retry: 2 }))
  assert.equal(h.userStore.profile, null)
  assert.equal(h.storage.has('access_token'), false)
  assert.equal(h.storage.has('refresh_token'), false)
  assert.deepEqual(cleared, ['owner-old'])
})

await test('a second 401 after renewal stops, without a refresh loop', async () => {
  const h = authHarness()
  h.setTransport(async options => options.url.endsWith('/auth/refresh') ? ok({ accessToken: 'next', refreshToken: 'next-refresh' }) : denied(401))
  await assert.rejects(h.request({ url: '/private' }))
  assert.equal(h.calls.filter(call => call.url.endsWith('/private')).length, 2)
  assert.equal(h.calls.filter(call => call.url.endsWith('/auth/refresh')).length, 1)
  assert.equal(h.userStore.profile, null)
})

await test('transient refresh failure preserves login and does not replay the original mutation', async () => {
  const h = authHarness()
  h.setTransport(async options => {
    if (options.url.endsWith('/auth/refresh')) throw new Error('offline')
    return denied(401)
  })
  await assert.rejects(h.request({ url: '/private', method: 'POST', retry: 2 }))
  assert.equal(h.calls.length, 2)
  assert.equal(h.storage.get('refresh_token'), 'refresh-old')
  assert.equal(h.userStore.profile.uid, 'owner-old')
})

await test('403 remains a permission error without refreshing or logging out', async () => {
  const h = authHarness()
  h.setTransport(async () => denied(403))
  await assert.rejects(h.request({ url: '/private' }), error => error.status === 403)
  assert.equal(h.calls.length, 1)
  assert.equal(h.userStore.profile.uid, 'owner-old')
})

await test('logout during refresh cannot overwrite a later login', async () => {
  const h = authHarness()
  const refresh = deferred()
  h.setTransport(async options => {
    if (options.url.endsWith('/auth/refresh')) return refresh.promise
    if (options.url.endsWith('/auth/wechat')) return ok({ accessToken: 'new-owner-access', refreshToken: 'new-owner-refresh', user: { id: 'owner-new', nickname: '', avatarUrl: '' } })
    return denied(401)
  })
  const old = h.request({ url: '/private', retry: 0 }).then(() => 'resolved', error => error.message)
  await flush()
  h.userStore.logout()
  assert.equal(await h.userStore.login(), true)
  refresh.resolve(ok({ accessToken: 'stale-access', refreshToken: 'stale-refresh' }))
  assert.equal(await old, 'AUTH_SESSION_CHANGED')
  assert.equal(h.userStore.profile.uid, 'owner-new')
  assert.equal(h.storage.get('access_token'), 'new-owner-access')
  assert.equal(h.storage.get('refresh_token'), 'new-owner-refresh')
})

await test('a late login response cannot clear or replace the newer owner session', async () => {
  const h = authHarness()
  const firstLogin = deferred()
  let logins = 0
  h.setTransport(async () => ++logins === 1 ? firstLogin.promise : ok({ accessToken: 'second-access', refreshToken: 'second-refresh', user: { id: 'owner-second', nickname: '', avatarUrl: '' } }))
  const old = h.userStore.login()
  await flush()
  h.userStore.logout()
  await h.userStore.login()
  firstLogin.resolve(ok({ accessToken: 'first-access', refreshToken: 'first-refresh', user: { id: 'owner-first', nickname: '', avatarUrl: '' } }))
  assert.equal(await old, false)
  assert.equal(h.storage.get('access_token'), 'second-access')
  assert.equal(h.userStore.profile.uid, 'owner-second')
  assert.equal(h.userStore.isLoggingIn, false)
})

await test('late successful requests are discarded after identity changes', async () => {
  const h = authHarness()
  const response = deferred()
  h.setTransport(() => response.promise)
  const request = h.request({ url: '/private' }).then(() => 'resolved', error => error.message)
  h.userStore.logout()
  response.resolve(ok({ privateData: 'old-owner' }))
  assert.equal(await request, 'AUTH_SESSION_CHANGED')
  assert.equal(h.calls.length, 1)
})

await test('public login requests never send the old bearer or renew it', async () => {
  const h = authHarness()
  h.setTransport(async () => denied(401))
  await assert.rejects(h.request({ url: '/v1/auth/wechat', method: 'POST', auth: 'none' }))
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].header.Authorization, undefined)
  assert.equal(h.storage.get('access_token'), 'access-old')
})

function hooks(forceFirstBooleanFalse = false) {
  const values = []
  let cursor = 0
  let effects = []
  return {
    begin() { cursor = 0; effects = [] },
    finish() { effects.forEach(run => run()) },
    useState(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = forceFirstBooleanFalse && index === 0 && initial === true ? false : typeof initial === 'function' ? initial() : initial
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = { current: initial }
      return values[index]
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      const previous = values[index]
      if (!previous || dependencies.some((value, i) => value !== previous[i])) effects.push(effect)
      values[index] = dependencies
    }
  }
}
function find(node, predicate) {
  if (!node) return undefined
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean)
  if (typeof node !== 'object') return undefined
  return predicate(node) ? node : find(node.props?.children, predicate)
}
function uiHarness() {
  let engine = hooks(true)
  const sessionListeners = []
  const chatStore = {
    currentSessionId: 'session', currentSession: undefined, sessions: [], messages: [], timeline: [], artifactRefs: [],
    suggestedActions: [], requiresLogin: true, isThinking: false, multiLoading: false, multiConfirming: false,
    multiError: '', routeGenerationError: '', routeGeneration: undefined, tripContextSummary: undefined,
    send: async () => true, refreshWorkspace: async () => {}
  }
  const userStore = { profile: null }
  function LoginSheet() {}
  const stubs = {
    react: { useState: (...args) => engine.useState(...args), useRef: (...args) => engine.useRef(...args), useEffect: (...args) => engine.useEffect(...args) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    mobx: { makeAutoObservable() {}, runInAction: run => run() },
    '@tarojs/components': { View: 'View', Text: 'Text', Input: 'Input', ScrollView: 'ScrollView' },
    '@tarojs/taro': { useDidShow() {}, setNavigationBarTitle() {} },
    'mobx-react-lite': { observer: component => component },
    '../../stores/chatStore': { chatStore, registerChatSessionChangeHandler: handler => { sessionListeners.push(handler); return () => {} }, formatConversationWarning: warning => warning, isConversationTurnInteractive: () => false },
    '../../services/routeService': { cityByIata: () => '' },
    '../../services/routeGenerationService': { isRouteGenerationTerminal: status => ['succeeded', 'failed', 'cancelled'].includes(status) },
    '../../i18n': { t: key => key, localeStore: { locale: 'zh' } },
    '../../utils/format': { formatPrice: value => value, formatMonthDay: value => value },
    '../../components/plan/TripContextChipsView': () => null,
    '../../components/artifacts': { ArtifactTimelineItem: () => null },
    '../../services/artifactService': { artifactService: { setSession() {}, fetchArtifact: async () => { throw new Error('not used in classic Plan harness') } } },
    '../../features/ui-experience/PlannerPage': { default: () => null },
    '../../features/ui-experience/productionPresentation': { artifactToTripPresentation: () => ({}) },
    '../../stores/userStore': { userStore },
    '../../components/common/LoginSheet': LoginSheet,
    '../../components/common/DemoBadge': () => null
  }
  const load = loader(stubs)
  const PlanPage = load('src/pages/plan/index.tsx').default
  engine.begin()
  const page = PlanPage()
  engine.finish()
  const AgentChat = page.props.children[1].type
  engine = hooks()
  const render = () => { engine.begin(); const tree = AgentChat({ onOpenExperience() {} }); engine.finish(); return tree }
  const input = tree => find(tree, node => node.type === 'Input')
  const login = tree => find(tree, node => node.type === LoginSheet)
  const edit = text => { input(render()).props.onInput({ detail: { value: text } }); return render() }
  return { chatStore, userStore, render, input, login, edit, sessionListeners, load }
}

await test('Plan opens login and retains the draft when login is cancelled', async () => {
  const h = uiHarness()
  h.input(h.edit('东京五天')).props.onConfirm()
  await flush()
  assert.equal(h.login(h.render()).props.visible, true)
  h.login(h.render()).props.onClose()
  assert.equal(h.input(h.render()).props.value, '东京五天')
  assert.equal(h.login(h.render()).props.visible, false)
})

await test('a suggested first message uses the same login and draft path', async () => {
  const h = uiHarness()
  const tree = h.render()
  find(tree, node => node.props.className === 'agent-chat__suggest ').props.onClick()
  await flush()
  assert.equal(h.login(h.render()).props.visible, true)
  assert.equal(h.input(h.render()).props.value, 'chat.eg1')
})

await test('closing a pending login sheet prevents a late success from resuming the action', async () => {
  const engine = hooks()
  const login = deferred()
  let closed = 0, resumed = 0
  const load = loader({
    react: { useState: (...args) => engine.useState(...args), useRef: (...args) => engine.useRef(...args), useEffect: (...args) => engine.useEffect(...args) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@tarojs/components': { View: 'View', Text: 'Text', Input: 'Input', Button: 'Button', Image: 'Image' },
    '@tarojs/taro': { showToast() {} },
    'mobx-react-lite': { observer: component => component },
    '../../stores/userStore': { userStore: { isLoggingIn: false, login: () => login.promise } },
    '../../services/authService': { persistAvatar: async value => value },
    '../../i18n': { t: key => key }
  })
  const Sheet = load('src/components/common/LoginSheet.tsx').default
  engine.begin()
  const tree = Sheet({ visible: true, onClose: () => { closed += 1 }, onSuccess: () => { resumed += 1 } })
  engine.finish()
  const pending = find(tree, node => node.props.className === 'login-sheet__confirm ').props.onClick()
  find(tree, node => node.props.className === 'login-sheet__mask').props.onClick()
  login.resolve(true)
  await pending
  assert.equal(closed, 1)
  assert.equal(resumed, 0)
})

await test('Plan keeps rejected input, shows initialization errors and clears only accepted input', async () => {
  const h = uiHarness()
  h.chatStore.requiresLogin = false
  h.chatStore.send = async () => { h.chatStore.multiError = '云端会话初始化失败，请重试。'; return false }
  h.input(h.edit('保留这段需求')).props.onConfirm()
  await flush()
  let tree = h.render()
  assert.equal(h.input(tree).props.value, '保留这段需求')
  assert.ok(find(tree, node => node.type === 'Text' && node.props.children === h.chatStore.multiError))
  h.chatStore.send = async () => true
  h.input(tree).props.onConfirm()
  await flush()
  assert.equal(h.input(h.render()).props.value, '')
})

await test('successful login resumes the preserved user request', async () => {
  const h = uiHarness()
  let message
  h.chatStore.send = async text => { message = text; return true }
  h.input(h.edit('查询真实机票')).props.onConfirm()
  await flush()
  h.chatStore.requiresLogin = false
  h.login(h.render()).props.onSuccess()
  await flush()
  assert.equal(message, '查询真实机票')
  assert.equal(h.input(h.render()).props.value, '')
})

await test('late acceptance cannot clear a new workspace draft', async () => {
  const h = uiHarness()
  h.chatStore.requiresLogin = false
  const result = deferred()
  h.chatStore.send = () => result.promise
  h.input(h.edit('旧需求')).props.onConfirm()
  h.sessionListeners.forEach(handler => handler('next-session', 'owner'))
  h.edit('新的需求')
  result.resolve(true)
  await flush()
  assert.equal(h.input(h.render()).props.value, '新的需求')
})

await test('expiry during submission retains the draft for login', async () => {
  const h = uiHarness()
  h.chatStore.requiresLogin = false
  const result = deferred()
  h.chatStore.send = () => result.promise
  h.input(h.edit('续办这个行程')).props.onConfirm()
  h.chatStore.requiresLogin = true
  h.sessionListeners.forEach(handler => handler('anonymous-session', undefined))
  result.resolve(false)
  await flush()
  assert.equal(h.input(h.render()).props.value, '续办这个行程')
})

await test('delivery labels never equate a model response or pending goal with completion', async () => {
  const load = loader({})
  const { conversationDeliveryLabel } = load('src/components/plan/conversationDelivery.ts')
  assert.equal(conversationDeliveryLabel(undefined, 'zh'), '')
  assert.equal(conversationDeliveryLabel({ status: 'not_requested' }, 'zh'), '')
  assert.match(conversationDeliveryLabel({ status: 'pending' }, 'zh'), /尚未完成/)
  assert.match(conversationDeliveryLabel({ status: 'partial' }, 'zh'), /待完成/)
  assert.match(conversationDeliveryLabel({ status: 'satisfied' }, 'zh'), /已完成并保存/)
})

const localBuild = { FLIGHTOR_API_BASE_URL: 'http://127.0.0.1:3000', FLIGHTOR_LOCAL_LOGIN_KEY: 'local-test-client-key-with-at-least-32-characters' }

await test('explicit local sign-in uses the real API, no WeChat call and no previous bearer', async () => {
  const h = authHarness(localBuild)
  let wechatCalls = 0
  h.taro.login = async () => { wechatCalls += 1; throw new Error('WeChat must not be called') }
  h.setTransport(async options => {
    assert.equal(options.url, 'http://127.0.0.1:3000/v1/auth/local')
    assert.equal(options.header.Authorization, undefined)
    assert.equal(options.header['x-local-login-key'], localBuild.FLIGHTOR_LOCAL_LOGIN_KEY)
    return ok({ accessToken: 'local-access', refreshToken: 'local-refresh', user: { id: 'local-owner', nickname: 'Local', avatarUrl: '' } })
  })
  assert.equal(await h.userStore.login(undefined, { method: 'local' }), true)
  assert.equal(wechatCalls, 0)
  assert.equal(h.userStore.profile.loginMethod, 'local')
  assert.equal(h.storage.get('access_token'), 'local-access')
  assert.equal(h.storage.get('refresh_token'), 'local-refresh')
})

await test('local login is unavailable without opt-in or with a remote API, before any request', async () => {
  for (const config of [{}, { ...localBuild, FLIGHTOR_API_BASE_URL: 'https://flightor.test' }, { ...localBuild, FLIGHTOR_USE_MOCK: true }]) {
    const h = authHarness(config)
    await assert.rejects(h.userStore.login(undefined, { method: 'local' }), /LOCAL_LOGIN_DISABLED/)
    assert.equal(h.calls.length, 0)
  }
})

await test('logout invalidates a pending local login response and clears its credentials', async () => {
  const h = authHarness(localBuild)
  const reply = deferred()
  h.setTransport(() => reply.promise)
  const login = h.userStore.login(undefined, { method: 'local' })
  h.userStore.logout()
  reply.resolve(ok({ accessToken: 'late-local-access', refreshToken: 'late-local-refresh', user: { id: 'local-owner', nickname: '', avatarUrl: '' } }))
  assert.equal(await login, false)
  assert.equal(h.userStore.profile, null)
  assert.equal(h.storage.has('access_token'), false)
})

await test('WeChat configuration errors remain explicit without fallback or generic network toast', async () => {
  const h = authHarness(localBuild)
  let toasts = 0
  h.taro.showToast = () => { toasts += 1 }
  h.setTransport(async () => ({ statusCode: 503, data: { error: { code: 'WECHAT_NOT_CONFIGURED', message: 'Missing config' } } }))
  await assert.rejects(h.userStore.login(), error => error.code === 'WECHAT_NOT_CONFIGURED')
  assert.equal(h.calls.length, 1)
  assert.ok(h.calls[0].url.endsWith('/auth/wechat'))
  assert.equal(toasts, 0)
})

function loginSheetHarness(login, localAvailable) {
  const engine = hooks()
  let resumed = 0
  const load = loader({
    react: { useState: (...args) => engine.useState(...args), useRef: (...args) => engine.useRef(...args), useEffect: (...args) => engine.useEffect(...args) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@tarojs/components': { View: 'View', Text: 'Text', Input: 'Input', Button: 'Button', Image: 'Image' },
    '@tarojs/taro': { showToast() {} }, 'mobx-react-lite': { observer: component => component },
    '../../stores/userStore': { userStore: { isLoggingIn: false, login } },
    '../../services/authService': { persistAvatar: async value => value, LOCAL_LOGIN_AVAILABLE: localAvailable },
    '../../i18n': { t: key => key }
  })
  const Sheet = load('src/components/common/LoginSheet.tsx').default
  return {
    render() { engine.begin(); const tree = Sheet({ visible: true, onClose() {}, onSuccess() { resumed += 1 } }); engine.finish(); return tree },
    get resumed() { return resumed }
  }
}

await test('the local button appears only when available and resumes the interrupted action', async () => {
  let method
  const h = loginSheetHarness(async (_profile, options) => { method = options.method; return true }, true)
  await find(h.render(), node => node.props.className === 'login-sheet__local-button').props.onClick()
  assert.equal(method, 'local')
  assert.equal(h.resumed, 1)
  assert.equal(find(loginSheetHarness(async () => true, false).render(), node => node.props.className === 'login-sheet__local-button'), undefined)
})

await test('the login form keeps an actionable configuration error visible', async () => {
  const h = loginSheetHarness(async () => { throw { code: 'WECHAT_NOT_CONFIGURED' } }, true)
  await find(h.render(), node => node.props.className === 'login-sheet__confirm ').props.onClick()
  assert.equal(find(h.render(), node => node.props.className === 'login-sheet__error').props.children, 'login.notConfigured')
  assert.equal(h.resumed, 0)
})

console.log(`\nSession recovery: ${passed} passed`)
