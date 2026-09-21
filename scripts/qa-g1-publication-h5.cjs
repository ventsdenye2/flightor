// G1 publication v1 H5 smoke acceptance.
// Uses the real built Taro H5 app and Playwright, but intercepts only the
// authenticated workspace/artifact reads with a frozen projected fixture.
// No model, provider, or mutation request is made.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const baseUrl = process.env.FLIGHTOR_H5_URL || 'http://127.0.0.1:10086'
const fixturePath = path.resolve(process.env.FLIGHTOR_G1_PUBLICATION_FIXTURE || 'backend/.demo/g1-publication-current.json')
const output = path.resolve(process.env.FLIGHTOR_G1_PUBLICATION_OUTPUT || 'output/playwright/g1-publication')
let activeReport = null
let activePage = null
if (!fs.existsSync(fixturePath)) throw new Error(`Missing projected fixture: ${fixturePath}`)
const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const entries = Array.isArray(raw) ? raw : raw.entries || raw.cases || raw.samples
if (!Array.isArray(entries) || entries.length < 2) throw new Error('Fixture must contain at least two projected entries')
fs.mkdirSync(output, { recursive: true })

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined }
function artifactOf(entry, type) {
  const aliases = type === 'travel_guide' ? ['travelGuideArtifact', 'guideArtifact', 'travelGuide', 'guide'] : type === 'route' ? ['routeArtifact', 'route'] : [`${type}Artifact`, type]
  const direct = aliases.map(key => entry[key]).find(value => value !== undefined)
  if (direct?.artifact?.type === type) return direct.artifact
  if (direct?.type === type) return direct
  if (direct && (direct.kind || direct.payload?.kind)) return direct
  return (Array.isArray(entry.artifacts) ? entry.artifacts : []).find(item => item?.type === type)
}
function envelope(entry, type) {
  const value = artifactOf(entry, type)
  if (!value) throw new Error(`Entry ${entry.id || '?'} has no ${type} artifact`)
  if (value.payload) return value
  return { id: entry[`${type}ArtifactId`] || `${entry.id}-${type}`, tripId: entry.tripId, type, schemaVersion: 1, payload: value, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z' }
}
function expectedStrings(entry, guide) {
  const publication = record(record(guide.payload)?.publication)
  const payload = record(guide.payload) || {}
  const days = Array.isArray(payload.days) ? payload.days : []
  const bilingual = value => { const item = record(value); return [item?.zh, item?.en].filter(value => typeof value === 'string' && value.trim()) }
  const items = days.flatMap(day => Array.isArray(day?.items) ? day.items : []).map(record).filter(Boolean)
  const titles = items.flatMap(item => [item.title, ...bilingual(item.title)])
  const times = items.map(item => ({ morning: '上午', afternoon: '下午', evening: '晚上', flexible: '灵活安排' }[item.timeOfDay])).filter(Boolean)
  const evidence = Array.isArray(payload.supportingEvidence) ? payload.supportingEvidence.map(record).filter(Boolean) : []
  const referenceText = evidence.flatMap(item => [item.title, item.description]).filter(value => typeof value === 'string' && value.trim())
  const explicit = entry.expectations || entry.expected || {}
  return [...new Set([
    ...(Array.isArray(explicit.text) ? explicit.text : []),
    ...(Array.isArray(explicit.names) ? explicit.names : []),
    ...(Array.isArray(explicit.times) ? explicit.times : []),
    ...(Array.isArray(explicit.references) ? explicit.references : []),
    ...(explicit.requireTwoDayNames === false ? [] : titles), ...times, ...referenceText,
    publication?.budgetAssessment?.notice
  ].filter(value => typeof value === 'string' && value.trim()))]
}
function titleFor(entry, guide) { return entry.id || guide.id }
function titleVariants(value) { const item = record(value); return [typeof value === 'string' ? value : undefined, item?.zh, item?.en].filter(value => typeof value === 'string' && value.trim()) }
async function bodyText(page) { return (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim() }
function requireTexts(text, values, phase, id) {
  for (const expected of values) {
    const comparable = String(expected).replace(/\s+/g, ' ').trim()
    assert.ok(text.includes(comparable), `${id} missing ${phase} text: ${comparable}; observed=${text.slice(0, 1800)}`)
  }
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const report = { fixturePath, baseUrl, startedAt: new Date().toISOString(), entries: [], network: [] }
  activeReport = report
  try {
    for (const entry of entries.slice(0, 2)) {
      const entryStarted = performance.now()
      const guide = envelope(entry, 'travel_guide')
      assert.equal(guide.payload?.publication?.legacy, entry.expectedLegacy === true, `${titleFor(entry, guide)} publication mode mismatch`)
      const route = envelope(entry, 'route')
      const workspace = entry.workspace || entry.cloudWorkspace
      if (!workspace) throw new Error(`Entry ${entry.id || guide.id} has no workspace`)
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
      page.setDefaultTimeout(10000)
      activePage = page
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.addInitScript(({ profile }) => {
        // Taro H5 storage serializes values as { data: ... }; raw JSON here
        // is ignored by the real login gate and would only test its login page.
        localStorage.setItem('flightor:profile', JSON.stringify({ data: profile }))
        localStorage.setItem('access_token', JSON.stringify({ data: 'g1-publication-fixture-access' }))
        localStorage.setItem('refresh_token', JSON.stringify({ data: 'g1-publication-fixture-refresh' }))
      }, { profile: { uid: 'g1-publication-fixture-owner', nickname: 'G1 fixture', avatarUrl: '', loginMethod: 'local' } })
      await page.route('**/v1/**', async routeRequest => {
        const url = new URL(routeRequest.request().url())
        report.network.push({ entry: titleFor(entry, guide), method: routeRequest.request().method(), path: url.pathname })
        if (url.pathname === '/v1/auth/local') return routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', user: { id: 'g1-publication-fixture-owner', nickname: 'G1 fixture', avatarUrl: '' } }) })
        const artifactMatch = url.pathname.match(/^\/v1\/artifacts\/([^/]+)$/)
        if (artifactMatch) {
          const id = decodeURIComponent(artifactMatch[1])
          const artifacts = [guide, route, ...(Array.isArray(entry.artifacts) ? entry.artifacts : [])]
          const found = artifacts.find(item => item.id === id) || (id === guide.id ? guide : id === route.id ? route : undefined)
          if (found) return routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ artifact: found }) })
        }
        const workspaceMatch = url.pathname.match(/^\/v1\/trips\/([^/]+)\/workspace$/)
        if (workspaceMatch && workspace.trip?.id === decodeURIComponent(workspaceMatch[1])) return routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspace) })
        return routeRequest.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'FIXTURE_UNEXPECTED_REQUEST' }) })
      })
      const routeUrl = `${baseUrl}/#/pages/route/index?artifactId=${encodeURIComponent(guide.id)}`
      await page.goto(routeUrl, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForTimeout(700)
      const performanceBefore = await page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(item => ({ duration: item.duration, domContentLoaded: item.domContentLoadedEventEnd, load: item.loadEventEnd })), now: performance.now() }))
      const overviewBefore = await bodyText(page)
      await page.screenshot({ path: path.join(output, `${entry.id}-overview.png`), fullPage: true })
      const overviewExpected = expectedStrings(entry, guide).filter(value => value === record(guide.payload.publication)?.budgetAssessment?.notice || (Array.isArray(guide.payload.supportingEvidence) && guide.payload.supportingEvidence.some(item => item.title === value || item.description === value)))
      requireTexts(overviewBefore, overviewExpected, 'overview before-refresh', titleFor(entry, guide))
      requireTexts(overviewBefore, ['2026-10-20'], 'original departure date', entry.id)
      if (entry.id === 'selectedFlight') requireTexts(overviewBefore, ['08:00', '12:30', 'PEK', 'NRT'], 'adopted flight snapshot', entry.id)
      await page.getByText('每日行程', { exact: true }).first().click()
      const dayTextsBefore = []
      const detailTextsBefore = []
      const dayButtons = page.locator('.ux-day-chip')
      assert.equal(await dayButtons.count(), 2, `${entry.id}: both days must actually render`)
      for (let index = 0; index < await dayButtons.count(); index += 1) {
        await dayButtons.nth(index).click()
        const dayText = await bodyText(page); dayTextsBefore.push(dayText)
        const day = guide.payload.days[index]
        assert.equal(await dayButtons.count(), guide.payload.days.length, `${titleFor(entry, guide)} expected two day selectors before-refresh`)
        requireTexts(dayText, (day?.items || []).flatMap(item => [...titleVariants(item.title), { morning: '上午', afternoon: '下午', evening: '晚上', flexible: '灵活安排' }[item.timeOfDay]]).filter(Boolean), `D${index + 1} before-refresh`, titleFor(entry, guide))
        const activities = page.locator('.ux-activity')
        assert.equal(await activities.count(), (day?.items || []).length, `${titleFor(entry, guide)} D${index + 1} activity count before-refresh`)
        for (let itemIndex = 0; itemIndex < (day?.items || []).length; itemIndex += 1) {
          await activities.nth(itemIndex).click(); const detail = await bodyText(page); detailTextsBefore.push(detail); requireTexts(detail, [day.items[itemIndex].description], `D${index + 1} detail before-refresh`, titleFor(entry, guide)); await page.locator('[aria-label="关闭详情"]').click()
        }
      }
      const screenshotBefore = path.join(output, `${titleFor(entry, guide)}-before-refresh.png`)
      await page.screenshot({ path: screenshotBefore, fullPage: true })
      const displayMs = performance.now() - entryStarted
      const refreshStarted = performance.now()
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(700)
      const performanceAfter = await page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(item => ({ duration: item.duration, domContentLoaded: item.domContentLoadedEventEnd, load: item.loadEventEnd })), now: performance.now() }))
      const overviewAfter = await bodyText(page)
      requireTexts(overviewAfter, overviewExpected, 'overview after-refresh', titleFor(entry, guide))
      await page.getByText('每日行程', { exact: true }).first().click()
      const dayTextsAfter = []
      const detailTextsAfter = []
      const dayButtonsAfter = page.locator('.ux-day-chip')
      assert.equal(await dayButtonsAfter.count(), 2, `${entry.id}: both days must restore`)
      for (let index = 0; index < await dayButtonsAfter.count(); index += 1) {
        await dayButtonsAfter.nth(index).click(); const dayText = await bodyText(page); dayTextsAfter.push(dayText)
        const day = guide.payload.days[index]
        assert.equal(await dayButtonsAfter.count(), guide.payload.days.length, `${titleFor(entry, guide)} expected two day selectors after-refresh`)
        requireTexts(dayText, (day?.items || []).flatMap(item => [...titleVariants(item.title), { morning: '上午', afternoon: '下午', evening: '晚上', flexible: '灵活安排' }[item.timeOfDay]]).filter(Boolean), `D${index + 1} after-refresh`, titleFor(entry, guide))
        const activities = page.locator('.ux-activity')
        assert.equal(await activities.count(), (day?.items || []).length, `${titleFor(entry, guide)} D${index + 1} activity count after-refresh`)
        for (let itemIndex = 0; itemIndex < (day?.items || []).length; itemIndex += 1) {
          await activities.nth(itemIndex).click(); const detail = await bodyText(page); detailTextsAfter.push(detail); requireTexts(detail, [day.items[itemIndex].description], `D${index + 1} detail after-refresh`, titleFor(entry, guide)); await page.locator('[aria-label="关闭详情"]').click()
        }
      }
      const screenshotAfter = path.join(output, `${titleFor(entry, guide)}-after-refresh.png`)
      await page.screenshot({ path: screenshotAfter, fullPage: true })
      assert.equal(errors.length, 0, `${titleFor(entry, guide)} browser errors: ${errors.join('; ')}`)
      assert.deepEqual(dayTextsAfter, dayTextsBefore, 'daily visible content must survive refresh')
      assert.deepEqual(detailTextsAfter, detailTextsBefore, 'detail visible content must survive refresh')
      assert.equal(overviewAfter, overviewBefore, 'overview must survive refresh')
      report.entries.push({ id: titleFor(entry, guide), routeArtifactId: route.id, guideArtifactId: guide.id, timingMs: { displayAndInspect: displayMs, refreshAndInspect: performance.now() - refreshStarted }, expected: expectedStrings(entry, guide), overviewBefore, overviewAfter, dayTextsBefore, dayTextsAfter, detailTextsBefore, detailTextsAfter, performanceBefore, performanceAfter, screenshots: [screenshotBefore, screenshotAfter], errors })
      await page.close()
    }
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(`G1 publication H5 fixture smoke passed: ${report.entries.length} entries; screenshots in ${output}`)
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      report.failedPageText = await bodyText(activePage)
      await activePage.screenshot({ path: path.join(output, `failure-${Date.now()}.png`), fullPage: true })
    }
    throw error
  } finally { await browser.close() }
})().catch(error => {
  console.error(error.stack || error)
  // A failed visual assertion is itself acceptance evidence. Preserve the
  // fixture path, network trace and failure for the report consumer.
  const failure = { ...activeReport, fixturePath, baseUrl, finishedAt: new Date().toISOString(), failure: error.stack || String(error) }
  fs.mkdirSync(output, { recursive: true })
  const failurePath = path.join(output, `report-failure-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(failurePath, `${JSON.stringify(failure, null, 2)}\n`)
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify({ ...failure, failureReport: failurePath }, null, 2)}\n`)
  process.exitCode = 1
})
