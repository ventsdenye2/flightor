// Real DevTools rendering with saved public projections; all wx.request calls are mocked.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const automator = require('miniprogram-automator')
const entries = JSON.parse(fs.readFileSync(process.env.FLIGHTOR_G1_PUBLICATION_FIXTURE || 'backend/.demo/g1-publication-current.json', 'utf8')).entries
const output = path.resolve(process.env.FLIGHTOR_G1_PUBLICATION_OUTPUT || 'output/weapp/g1-publication')
fs.mkdirSync(output, { recursive: true })
const report = { startedAt: new Date().toISOString(), entries: [], scope: 'DevTools page reLaunch; mocked transport and login, not cold process restart or device' }
let mini, storage, originalPage
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function bounded(operation, label) {
  let timer
  try { return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 15000) })]) }
  finally { clearTimeout(timer) }
}
async function text(page, selector = '.ux-app') {
  const element = await page.$(selector)
  assert.ok(element, `Missing ${selector}`)
  return (await element.text()).replace(/\s+/g, ' ').trim()
}
function includes(actual, expected) { for (const value of expected.filter(Boolean)) assert.ok(actual.includes(String(value).replace(/\s+/g, ' ').trim()), `Missing: ${value}`) }
async function inspect(entry, phase) {
  const start = performance.now(), guide = entry.guideArtifact
  const page = await mini.reLaunch(`/pages/route/index?artifactId=${encodeURIComponent(guide.id)}`)
  await pause(900)
  const overview = await text(page)
  includes(overview, [guide.payload.publication.budgetAssessment.notice, '2026-10-20', ...guide.payload.supportingEvidence.flatMap(item => [item.title, item.description])])
  if (entry.id === 'selectedFlight') includes(overview, ['08:00', '12:30', 'PEK', 'NRT'])
  await mini.screenshot({ path: path.join(output, `${entry.id}-${phase}-overview.png`) })
  const tabs = await page.$$('.ux-tab'); assert.equal(tabs.length, 3); await tabs[1].tap(); await pause(150)
  const dayTexts = [], details = []
  assert.equal((await page.$$('.ux-day-chip')).length, 2)
  for (let dayIndex = 0; dayIndex < guide.payload.days.length; dayIndex++) {
    await (await page.$$('.ux-day-chip'))[dayIndex].tap(); await pause(150)
    const day = guide.payload.days[dayIndex], dayText = await text(page); dayTexts.push(dayText)
    includes(dayText, day.items.flatMap(item => [typeof item.title === 'string' ? item.title : item.title.zh, {morning:'上午',afternoon:'下午',evening:'晚上',flexible:'灵活安排'}[item.timeOfDay]]))
    assert.equal((await page.$$('.ux-activity')).length, day.items.length)
    for (let itemIndex = 0; itemIndex < day.items.length; itemIndex++) {
      await (await page.$$('.ux-activity'))[itemIndex].tap(); await pause(150)
      const detail = await text(page); includes(detail, [day.items[itemIndex].description]); details.push(detail)
      if (itemIndex === 0) await mini.screenshot({ path: path.join(output, `${entry.id}-${phase}-day${dayIndex + 1}-detail.png`) })
      await (await page.$('.ux-sheet-close')).tap(); await pause(150)
    }
  }
  await mini.screenshot({ path: path.join(output, `${entry.id}-${phase}-days.png`) })
  return { overview, dayTexts, details, elapsedMs: performance.now() - start }
}
async function run() {
  mini = await bounded(() => automator.connect({ wsEndpoint: process.env.FLIGHTOR_WEAPP_WS || 'ws://127.0.0.1:9432' }), 'connect')
  const send = mini.connection.send.bind(mini.connection)
  mini.connection.send = (method, params) => bounded(() => send(method, params), method)
  report.build = JSON.parse(fs.readFileSync('dist/build-info.json', 'utf8'))
  report.systemInfo = await bounded(() => mini.systemInfo(), 'systemInfo')
  originalPage = (await mini.currentPage()).path
  // Require a guest simulator to avoid replacing a real user's in-memory identity.
  assert.equal(await mini.evaluate(() => !!wx.getStorageSync('flightor:profile')), false, 'Use a logged-out test simulator')
  storage = await mini.evaluate(() => wx.getStorageInfoSync().keys.map(key => [key, wx.getStorageSync(key)]))
  await mini.mockWxMethod('login', { code: 'g1-offline-fixture-code' })
  await mini.mockWxMethod('request', function(options, fixtures) {
    const url = options.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const method = options.method || 'GET'
    globalThis.__g1Requests = globalThis.__g1Requests || []
    let data, statusCode = 200
    if (url === '/v1/auth/wechat' && method === 'POST') data = { accessToken:'g1-fixture', refreshToken:'g1-fixture-refresh', user:{id:'g1-fixture',nickname:'G1 fixture',avatarUrl:''} }
    else if (method === 'GET') {
      for (const entry of fixtures) {
        if (url === `/v1/trips/${entry.workspace.trip.id}/workspace`) data = entry.workspace
        const artifact = [entry.guideArtifact, entry.routeArtifact, ...entry.artifacts].find(item => url === `/v1/artifacts/${item.id}`)
        if (artifact) data = { artifact }
      }
    }
    if (!data) { statusCode = 409; data = {code:'FIXTURE_UNEXPECTED_REQUEST'} }
    globalThis.__g1Requests.push({url,method,statusCode})
    const response = { data, statusCode, header:{'content-type':'application/json'}, errMsg:'request:ok' }
    // Automator invokes the original callbacks with the returned mock result.
    return response
  }, entries)
  const profile = await mini.reLaunch('/pages/profile/index'); await pause(400)
  await (await profile.$('.pr-identity .ux-text-button')).tap(); await pause(200)
  await (await profile.$('.login-sheet__confirm')).tap(); await pause(600)
  report.loginText = await text(profile, '.ux-app')
  assert.equal(await mini.evaluate(() => wx.getStorageSync('flightor:profile').uid), 'g1-fixture')
  for (const entry of entries) {
    assert.equal(entry.guideArtifact.payload.publication.legacy, entry.expectedLegacy === true)
    const before = await inspect(entry, 'before'), after = await inspect(entry, 'restored')
    for (const key of ['overview','dayTexts','details']) assert.deepEqual(after[key], before[key], `${entry.id} ${key} recovery`)
    report.entries.push({ id:entry.id, before, after })
    console.log(`${entry.id}: display ${before.elapsedMs.toFixed(0)}ms, reLaunch ${after.elapsedMs.toFixed(0)}ms`)
  }
}
run().catch(error => { report.failure = error.stack; process.exitCode = 1; console.error(error) }).finally(async () => {
  if (mini && storage) {
    try {
      report.network = await bounded(() => mini.evaluate(() => globalThis.__g1Requests || []), 'network')
      // A synthetic 401 would exercise refresh instead of resetting MobX. Use the real sign-out UI.
      await mini.mockWxMethod('showModal', {confirm:true,cancel:false})
      const profile = await mini.reLaunch('/pages/profile/index')
      await (await profile.$('.ux-header .ux-icon-button')).tap(); await pause(200)
      const logout = await profile.$('.pr-logout')
      if (logout) { await logout.tap(); await pause(200) }
      assert.equal(await mini.evaluate(() => !!wx.getStorageSync('flightor:profile')), false, 'Fixture logout failed')
      await mini.evaluate(saved => { for (const key of wx.getStorageInfoSync().keys) wx.removeStorageSync(key); for (const [key,value] of saved) wx.setStorageSync(key,value); delete globalThis.__g1Requests }, storage)
      for (const method of ['request','login','showModal']) await mini.restoreWxMethod(method)
      await mini.reLaunch(`/${originalPage}`)
      report.cleanup = 'original storage restored; guest identity restored; mocks removed'
    } catch (error) { report.cleanupError = String(error); process.exitCode = 1 }
  }
  mini?.disconnect()
  report.finishedAt = new Date().toISOString()
  const filename = report.failure || report.cleanupError ? `failure-${Date.now()}.json` : 'report.json'
  fs.writeFileSync(path.join(output, filename), JSON.stringify(report, null, 2))
  console.log(path.join(output, filename))
})
