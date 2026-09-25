// Real H5 + installed headed Chrome. No response interception, fixtures or automatic retries.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { chromium } = require('playwright')
const { acceptedGuide, assertPatch, assertTotalBudget, assertLocalization, assertEmptySeedRecovery } = require('./dsh-h5-assertions.cjs')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
const execute = args.includes('--execute'), restore = args.includes('--restore'), localize = args.includes('--localize')
const caseId = value('--case') || 'A', round = Number(value('--round') || 0)
const baseUrl = process.env.FLIGHTOR_H5_URL || 'http://127.0.0.1:10086'
const directory = path.join(root, 'backend/.demo/dsh-e2e-20260924')
const transportPath = path.resolve(value('--transport') || path.join(directory, 'transport.private.json'))
const output = path.join(root, 'output/playwright/dsh-e2e-20260924')
const timeoutMs = Number(value('--timeout-ms') || 360000)
const specifications = {
  A: [
    '机票我已经准备好了，不用查航班。\n帮我安排东京两天旅行，喜欢文化和小吃，节奏轻松。\n两天游玩预算目标1500元人民币。\n请研究合适的地方并保存攻略。',
    '为什么第二天上午推荐这个地方？只解释，不要改行程。',
    '第一天完全不要改，只把第二天下午换成一个室内文化场所。',
    '预算目标改成两天合计1200元，不是每天。\n不要承诺未知费用一定够。',
  ],
  B: [
    '请根据我已明确采用航班的所有航段与抵达时刻，安排并保存东京两天行程，文化和小吃、轻松一点；全程合计4000元。不重新查票或更换航班，抵达前不要安排活动。',
    '为什么第二天上午推荐这个地方？只解释，不改行程，也不要重查或更换航班。',
    '第一天不动，只把第二天下午换成室内文化场所；已采用航班和其他日程保持不变。',
  ],
}
if (args.includes('--help')) {
  console.log('node scripts/qa-dsh-e2e-h5.cjs --prepare [--case A|B]\nnode scripts/qa-dsh-e2e-h5.cjs --execute --case A|B --round N\nnode scripts/qa-dsh-e2e-h5.cjs --restore --case A|B\nnode scripts/qa-dsh-e2e-h5.cjs --execute --localize --case A|B\nPaid operations require an explicitly opened server gate. Each case/round can be attempted only once; failed/ambiguous attempts are retained.')
  process.exit(0)
}
assert.ok(['A', 'B'].includes(caseId), 'Invalid case')
assert.ok(Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 420000, 'Invalid timeout')
assert.ok(!restore || !execute && !localize, '--restore is read only')
assert.ok(!localize || execute, '--localize requires --execute')
assert.ok(!args.includes('--prepare') || !execute && !restore && !localize, '--prepare cannot be combined with actions')
if (execute) assert.ok(value('--case') && (localize || Number.isInteger(round) && specifications[caseId][round - 1]), 'Explicit case and supported round required')
const transport = JSON.parse(fs.readFileSync(transportPath, 'utf8'))
const entry = transport.entries?.find(item => item.id === caseId)
assert.ok(entry?.tripId && entry?.conversationId && entry?.token && entry?.user?.publicId, 'Real case transport is incomplete')
const privateValues = [entry.token, entry.localStorage?.access_token, entry.localStorage?.refresh_token].filter(item => typeof item === 'string' && item.length)
const sanitize = text => privateValues.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text)
const json = value => sanitize(JSON.stringify(value, (key, item) => /^(?:access_?token|refresh_?token|authorization|token|api_?key|secret|password)$/i.test(key) ? '[REDACTED]' : item, 2)) + '\n'
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const mode = localize ? 'localize' : execute ? `round-${round}` : restore ? 'restore' : 'prepare'
const runId = `${caseId}-${mode}-${timestamp}`
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(directory, { recursive: true })
const statePath = path.join(directory, `browser-${caseId}.private.json`)
const reportPath = path.join(output, `${runId}.json`)
const report = { case: caseId, mode, startedAt: new Date().toISOString(), h5: baseUrl, api: transport.baseUrl,
  tripId: entry.tripId, conversationId: entry.conversationId, browser: 'installed Chrome, headed, isolated context',
  timingEvidence: 'Node monotonic response observations and polled visible DOM; not browser paint timestamps',
  timings: {}, events: [], screenshots: [], browserErrors: [], result: 'running' }
const started = performance.now(), now = () => Math.round((performance.now() - started) * 1000) / 1000
const write = () => fs.writeFileSync(reportPath, json(report))
const savePrivate = (file, value) => { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temporary, file) }
function budgetSnapshot() {
  assert.ok(transport.budgetPath, 'Real transport must declare the shared budgetPath')
  const raw = fs.readFileSync(transport.budgetPath), ledger = JSON.parse(raw)
  assert.ok(Array.isArray(ledger.entries), 'Budget ledger cannot be read')
  return { sha256: createHash('sha256').update(raw).digest('hex'), entries: ledger.entries.length,
    modelCalls: ledger.entries.filter(item => item.kind === 'model' || item.provider === 'deepseek-official').length,
    searchCalls: ledger.entries.filter(item => item.kind === 'search').length,
    callEntries: ledger.entries.map(item => ({ id: item.id, kind: item.kind, provider: item.provider })) }
}
function initialState() {
  const owner = entry.user.publicId, sessionId = `cloud-${entry.conversationId}`, at = Date.now()
  const state = { origin: null, window_from: null, window_to: null, travel_days: null, budget_max: null,
    interests: [], regions: [], required_iatas: [], excluded_iatas: [], destination_mode: 'explicit', pace: 'balanced', priorities: [] }
  const session = { id: sessionId, ownerId: owner, tripId: entry.tripId, conversationId: entry.conversationId,
    createdAt: at, updatedAt: at, title: `DSH ${caseId}`, summary: '', messages: [], timeline: [], state, phase: 'clarify',
    recommendations: [], suggestedActions: [], routes: [], warnings: [], artifactRefs: [] }
  const values = { 'flightor:profile': entry.localStorage?.profile || { uid: owner, nickname: entry.user.nickname, loginMethod: 'local' },
    access_token: entry.token, refresh_token: entry.localStorage?.refresh_token || '', 'flightor:locale': 'zh',
    [`flightor:chat-history-cloud-v1:${owner.trim().slice(0, 160).replace(/[^a-zA-Z0-9_.:@-]/g, '_')}`]: { version: 1, currentSessionId: sessionId, sessions: [session] } }
  return { cookies: [], origins: [{ origin: new URL(baseUrl).origin,
    localStorage: Object.entries(values).map(([name, data]) => ({ name, value: JSON.stringify({ data }) })) }] }
}

;(async () => {
  let browser, context, page, attemptPath
  const pendingResponses = new Set()
  let accepted, terminal, postCount = 0, workspaceSeen = false, localizationResponse
  try {
    report.budgetBefore = budgetSnapshot()
    browser = await chromium.launch({ channel: 'chrome', headless: false })
    const storageState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : initialState()
    // Refresh only the current transport's token; preserve actual prior conversation storage.
    const savedOrigin = storageState.origins.find(origin => origin.origin === new URL(baseUrl).origin)
    assert.ok(savedOrigin, 'Saved browser origin differs; do not reuse this batch')
    const savedProfile = JSON.parse(savedOrigin.localStorage.find(item => item.name === 'flightor:profile')?.value || '{}').data
    assert.equal(savedProfile?.uid, entry.user.publicId, 'Saved browser owner differs; do not reuse this batch')
    const historyKey = `flightor:chat-history-cloud-v1:${entry.user.publicId.trim().slice(0, 160).replace(/[^a-zA-Z0-9_.:@-]/g, '_')}`
    const history = JSON.parse(savedOrigin.localStorage.find(item => item.name === historyKey)?.value || '{}').data
    let currentSession = history?.sessions?.find(item => item.id === history.currentSessionId)
    if (!currentSession && !restore && !localize && (!execute || round === 1)) {
      // Production intentionally omits completely empty sessions when saving.
      // Recover only our exact empty seed, and only after a real read confirms
      // there is no cloud history to replace. Never reset a populated session.
      const endpoint = `/v1/trips/${encodeURIComponent(entry.tripId)}/workspace?conversationId=${encodeURIComponent(entry.conversationId)}&locale=zh`
      const response = await fetch(`${transport.baseUrl}${endpoint}`, { headers: { Authorization: `Bearer ${entry.token}` }, signal: AbortSignal.timeout(15000) })
      assert.equal(response.status, 200, 'Empty-seed recovery workspace GET failed')
      const workspace = await response.json()
      assertEmptySeedRecovery(history, workspace, entry)
      const backup = `${statePath}.before-empty-reseed-${timestamp}`
      fs.copyFileSync(statePath, backup, fs.constants.COPYFILE_EXCL)
      const seedHistory = initialState().origins[0].localStorage.find(item => item.name === historyKey)
      savedOrigin.localStorage = savedOrigin.localStorage.map(item => item.name === historyKey ? seedHistory : item)
      currentSession = JSON.parse(seedHistory.value).data.sessions[0]
      report.emptySeedRecovery = { reason: 'Production sessionHasContent omits empty sessions', originalStateBackup: backup,
        verifiedBy: 'real read-only preflight GET', path: endpoint, cloudMessages: 0, cloudArtifacts: 0 }
    }
    assert.equal(currentSession?.tripId, entry.tripId, 'Saved browser current Trip differs')
    assert.equal(currentSession?.conversationId, entry.conversationId, 'Saved browser current conversation differs')
    savedOrigin.localStorage = savedOrigin.localStorage.filter(item => item.name !== 'access_token')
    savedOrigin.localStorage.push({ name: 'access_token', value: JSON.stringify({ data: entry.token }) })
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, storageState })
    page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.browserErrors.push(sanitize(error.message)))
    page.on('request', request => {
      const url = new URL(request.url())
      if (!url.pathname.startsWith('/v1/')) return
      const event = { type: 'request', atMs: now(), method: request.method(), path: url.pathname }
      if (request.method() === 'POST' && url.pathname === '/v1/agent/turns') {
        postCount++; event.body = request.postDataJSON(); report.timings.postObservedMs ??= event.atMs
      }
      report.events.push(event); write()
    })
    page.on('response', response => {
      const task = (async () => {
        const request = response.request(), url = new URL(response.url())
        if (!url.pathname.startsWith('/v1/')) return
        const event = { type: 'response', atMs: now(), method: request.method(), path: url.pathname, status: response.status() }
        try { event.body = await response.json() } catch { event.bodyUnavailable = true }
        report.events.push(event)
        if (url.origin !== new URL(transport.baseUrl).origin) report.unexpectedApiOrigin = url.origin
        if (url.pathname === `/v1/trips/${entry.tripId}/workspace` && response.ok()) {
          workspaceSeen = true
          report.workspaceBefore ??= event.body
        }
        if (request.method() === 'POST' && url.pathname === '/v1/agent/turns') {
          accepted = event; report.timings.apiPostResponseMs = event.atMs
          if (response.ok() && event.body?.status === 'running' && event.body?.turnId) report.timings.apiAcceptedMs = event.atMs
        }
        if (request.method() === 'GET' && accepted?.body?.turnId && url.pathname === `/v1/agent/turns/${accepted.body.turnId}`) {
          if (event.body?.status === 'running') report.timings.firstProgressApiMs ??= event.atMs
          if (['completed', 'failed', 'cancelled'].includes(event.body?.status)) { terminal = event; report.timings.terminalApiMs ??= event.atMs }
        }
        if (request.method() === 'POST' && url.pathname.endsWith('/localization')) localizationResponse = event
        write()
      })().catch(error => { report.browserErrors.push(sanitize(String(error))); write() })
      pendingResponses.add(task); void task.finally(() => pendingResponses.delete(task))
    })
    await page.goto(`${baseUrl}/#/pages/plan/index`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.locator('.production-main-page').waitFor()
    for (let i = 0; !workspaceSeen && i < 60; i++) await page.waitForTimeout(250)
    assert.ok(workspaceSeen, 'No successful real workspace GET observed from H5')
    assert.equal(report.unexpectedApiOrigin, undefined, 'H5 build is targeting a different API')
    // Additional real browser GETs establish authoritative before/after assertions.
    // They never invoke the main Agent or replace the production UI transport.
    const readApi = async endpoint => {
      const response = await page.evaluate(async ({ base, endpoint }) => {
        const token = JSON.parse(localStorage.getItem('access_token') || '{}').data
        const result = await fetch(`${base}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } })
        return { status: result.status, body: await result.json() }
      }, { base: transport.baseUrl, endpoint })
      assert.ok(response.status >= 200 && response.status < 300, `Authoritative GET failed: ${endpoint}`)
      return response.body
    }
    const authoritative = async () => {
      const workspace = await readApi(`/v1/trips/${encodeURIComponent(entry.tripId)}/workspace?conversationId=${encodeURIComponent(entry.conversationId)}&locale=zh`)
      assert.equal(workspace.trip?.id, entry.tripId, 'Authoritative Trip mismatch')
      assert.equal(workspace.conversationId, entry.conversationId, 'Authoritative conversation mismatch')
      const ref = [...workspace.artifactRefs].reverse().find(item => item.type === 'travel_guide')
      const guide = ref ? (await readApi(`/v1/artifacts/${encodeURIComponent(ref.id)}?locale=zh`)).artifact : undefined
      const route = guide?.payload?.routeArtifactId ? (await readApi(`/v1/artifacts/${encodeURIComponent(guide.payload.routeArtifactId)}?locale=zh`)).artifact : undefined
      const flight = workspace.trip.selectedFlight ? (await readApi(`/v1/artifacts/${encodeURIComponent(workspace.trip.selectedFlight.artifactId)}?locale=zh`)).artifact : undefined
      return { workspace, ...(guide ? { guide } : {}), ...(route ? { route } : {}), ...(flight ? { flight } : {}) }
    }
    report.authoritativeBefore = await authoritative()
    if (execute && (localize || round > 1) || restore) acceptedGuide(report.authoritativeBefore)
    report.timings.readyMs = now()
    const screenshot = async label => { const file = path.join(output, `${runId}-${label}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file) }
    const inspectGuide = async label => {
      await page.locator('.ux-publication-state--accepted').waitFor()
      report.timings.guideVisibleMs ??= now()
      const content = { overview: await page.locator('.ux-published').innerText(), days: [], details: [], activities: [] }
      await screenshot(`${label}-overview`)
      await page.locator('.ux-tabs .ux-tab').nth(1).click()
      const count = await page.locator('.ux-day-chip').count()
      assert.equal(count, 2, 'Expected both real guide days to be readable')
      for (let index = 0; index < count; index++) {
        await page.locator('.ux-day-chip').nth(index).click()
        content.days.push(await page.locator('.ux-published').innerText())
        await screenshot(`${label}-day-${index + 1}`)
        const activities = page.locator('.ux-activity'), activityCount = await activities.count()
        assert.ok(activityCount > 0, 'Published day has no readable activities')
        for (let activity = 0; activity < activityCount; activity++) {
          const activityId = await activities.nth(activity).getAttribute('data-activity-id')
          content.activities.push({ day: index + 1, activityId, name: await activities.nth(activity).locator('.ux-activity-name').innerText(),
            time: await activities.nth(activity).locator('.ux-timeline-time').innerText() })
          await activities.nth(activity).click()
          await page.locator('[aria-label="关闭详情"], [aria-label="Close details"]').waitFor()
          const prose = await page.locator('.ux-sheet .ux-detail-copy').allInnerTexts()
          assert.equal(prose.length, 2, 'Readable introduction and recommendation reason are required')
          assert.ok(prose.every(text => text.trim()), 'Published activity has empty detail prose')
          content.details.push({ day: index + 1, activity: activity + 1, activityId, prose, text: await page.locator('body').innerText() })
          await screenshot(`${label}-day-${index + 1}-activity-${activity + 1}`)
          await page.locator('[aria-label="关闭详情"], [aria-label="Close details"]').click()
        }
      }
      await page.locator('.ux-tabs .ux-tab').nth(0).click()
      return content
    }
    await screenshot('before')

    if (restore || localize) {
      await page.locator('.pl-result').first().click()
      await page.locator('.ux-published').waitFor()
      report.beforeRefreshText = await page.locator('body').innerText()
      if (localize) {
        await page.locator('.ux-locale-toggle').filter({ hasText: 'English' }).click()
        await page.locator('.ux-prepare-locale').waitFor()
        attemptPath = path.join(directory, `h5-${caseId}-localize.attempt.private.json`)
        fs.writeFileSync(attemptPath, JSON.stringify({ runId, startedAt: report.startedAt, tripId: entry.tripId }), { flag: 'wx', mode: 0o600 })
        report.timings.clickedMs = now(); await page.locator('.ux-prepare-locale').click()
        for (const deadline = performance.now() + timeoutMs; !localizationResponse && performance.now() < deadline;) await page.waitForTimeout(250)
        assert.ok(localizationResponse, 'Localization response not observed; no retry made')
        assert.ok(localizationResponse.status < 400, 'Localization request failed; retained without retry')
        await page.locator('.ux-publication-state--accepted').waitFor({ timeout: 15000 })
        report.localizedGuide = await inspectGuide('english')
        report.authoritativeAfter = await authoritative()
        const english = (await readApi(`/v1/artifacts/${encodeURIComponent(report.authoritativeBefore.guide.id)}?locale=en`)).artifact
        report.localizationAssertions = assertLocalization(report.authoritativeBefore, report.authoritativeAfter, english,
          report.budgetBefore, budgetSnapshot(), report.events)
      } else {
        report.guideBeforeRefresh = await inspectGuide('before-refresh')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('.ux-published').waitFor()
        report.afterRefreshText = await page.locator('body').innerText()
        report.guideAfterRefresh = await inspectGuide('after-refresh')
        assert.deepEqual(report.guideAfterRefresh.activities, report.guideBeforeRefresh.activities, 'Refresh changed activity identities/order/times')
        assert.deepEqual(report.guideAfterRefresh.details.map(item => item.prose), report.guideBeforeRefresh.details.map(item => item.prose), 'Refresh changed published prose')
        report.authoritativeAfter = await authoritative()
        assert.deepEqual(report.authoritativeAfter, report.authoritativeBefore, 'Restore changed authoritative Trip/guide/route/flight')
      }
    } else {
      if (!await page.locator('textarea').isVisible()) await page.getByText('重新输入', { exact: true }).click()
      await page.locator('textarea').waitFor()
      report.textareaReady = true
      if (execute) {
        report.message = specifications[caseId][round - 1]
        report.resultCardAlreadyVisibleBeforeSend = await page.locator('.pl-result').first().isVisible()
        await page.locator('textarea').fill(report.message)
        assert.equal(await page.locator('textarea').inputValue(), report.message)
        attemptPath = path.join(directory, `h5-${caseId}-round-${round}.attempt.private.json`)
        fs.writeFileSync(attemptPath, JSON.stringify({ runId, startedAt: report.startedAt, tripId: entry.tripId, message: report.message }), { flag: 'wx', mode: 0o600 })
        report.timings.clickedMs = now(); write()
        await page.locator('.pl-submit').click()
        for (const deadline = performance.now() + timeoutMs; performance.now() < deadline;) {
          if (report.timings.firstVisibleProgressMs === undefined && await page.locator('.pl-generating').isVisible()) report.timings.firstVisibleProgressMs = now()
          if (report.timings.firstVisibleResultCardMs === undefined && await page.locator('.pl-result').first().isVisible()) report.timings.firstVisibleResultCardMs = now()
          if (accepted?.status >= 400) throw Error(`TURN_POST_HTTP_${accepted.status}`)
          if (terminal && !await page.locator('.pl-generating').isVisible()) { report.timings.finalUiObservedMs = now(); break }
          await page.waitForTimeout(250)
        }
        assert.ok(terminal, 'No terminal response observed; request may remain active, do not resubmit')
        assert.equal(postCount, 1, 'Expected exactly one real planner POST')
        assert.equal(accepted.body.tripId, entry.tripId, 'Browser used wrong Trip')
        assert.equal(accepted.body.conversationId, entry.conversationId, 'Browser used wrong conversation')
        report.timings.clickToAckMs = report.timings.apiAcceptedMs - report.timings.clickedMs
        report.terminalStatus = terminal.body.status
        report.terminal = terminal.body
        if (terminal.body.status !== 'completed') throw Error(`TURN_${terminal.body.status.toUpperCase()}`)
        assert.ok(report.timings.finalUiObservedMs !== undefined, 'Server completed but final UI was not observed')
        report.timings.clickToFinalUiMs = report.timings.finalUiObservedMs - report.timings.clickedMs
        const turnPost = report.events.find(event => event.type === 'request' && event.path === '/v1/agent/turns' && event.method === 'POST')
        assert.deepEqual(turnPost.body, { locale: 'zh', tripId: entry.tripId, conversationId: entry.conversationId, message: report.message }, 'Submitted request differs from frozen same-session message')
        report.authoritativeAfter = await authoritative()
        report.plannerVisibleText = await page.locator('body').innerText()
        await screenshot('planner-final')
        if ([1, 3].includes(round)) {
          assert.equal(terminal.body.response?.delivery?.status, 'satisfied', 'Guide delivery is not satisfied')
          acceptedGuide(report.authoritativeAfter)
          if (round === 3) report.patchAssertions = assertPatch(report.authoritativeBefore, report.authoritativeAfter)
          await page.locator('.pl-result').first().click()
          report.guide = await inspectGuide('accepted-guide')
          report.timings.clickToReadableGuideMs = report.timings.guideVisibleMs - report.timings.clickedMs
        } else if (round === 2) {
          const original = new Set((report.workspaceBefore?.artifactRefs || []).map(item => item.id))
          const refs = terminal.body.artifactRefs || terminal.body.response?.artifactRefs || []
          report.explanationAddedArtifactIds = refs.map(item => item.id).filter(id => !original.has(id))
          assert.deepEqual(report.explanationAddedArtifactIds, [], 'Explanation created a new artifact')
          assert.deepEqual(report.authoritativeAfter.guide, report.authoritativeBefore.guide, 'Explanation rewrote the existing guide')
          assert.deepEqual(report.authoritativeAfter.route, report.authoritativeBefore.route, 'Explanation rewrote the route')
          assert.deepEqual(report.authoritativeAfter.workspace.trip, report.authoritativeBefore.workspace.trip, 'Explanation changed Trip/flight/version')
          report.explanationReply = await page.locator('.pl-reply-copy').innerText()
          assert.ok(report.explanationReply.trim() && !/^(?:攻略已保存|行程已保存)[。.!！]?$/.test(report.explanationReply.trim()), 'Explanation did not answer the question')
          assert.notEqual(report.explanationReply.trim(), report.authoritativeBefore.guide.payload.publication.reply?.trim(), 'Explanation repeated previous publication reply')
        } else if (round === 4) {
          report.budgetAssertions = assertTotalBudget(report.authoritativeBefore, report.authoritativeAfter)
          report.budgetReply = await page.locator('.pl-reply-copy').innerText()
          report.budgetProseReviewRequired = 'Review the complete reply for unverified affordability guarantees; authoritative total-budget checks do not certify prose semantics.'
        }
      }
    }
    report.budgetAfter = budgetSnapshot()
    if (!execute) {
      assert.equal(postCount, 0, 'Read-only mode must not start a planner turn')
      assert.equal(report.events.filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method)).length, 0, 'Read-only mode made an API mutation')
      assert.deepEqual(report.budgetAfter, report.budgetBefore, 'Read-only UI changed model/search accounting')
    }
    report.visibleText = await page.locator('body').innerText()
    report.result = 'observed'; report.timings.finishedMs = now()
    await screenshot('after')
  } catch (error) {
    report.result = 'failed'; report.failure = sanitize(error.stack || String(error)); process.exitCode = 1
    if (page && !page.isClosed()) {
      report.visibleText = await page.locator('body').innerText().catch(() => '')
      const failurePath = path.join(output, `${runId}-failure.png`)
      await page.screenshot({ path: failurePath, fullPage: true }).then(() => report.screenshots.push(failurePath)).catch(() => {})
    }
  } finally {
    await Promise.allSettled([...pendingResponses])
    try {
      report.budgetAfter = budgetSnapshot()
      if (report.result === 'observed' && !execute) {
        assert.deepEqual(report.budgetAfter, report.budgetBefore, 'Late read-only activity changed budget accounting')
        assert.equal(report.events.filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method)).length, 0, 'Late read-only API mutation observed')
      }
    } catch (error) {
      if (report.result === 'observed') { report.result = 'failed'; report.failure = sanitize(error.stack || String(error)); process.exitCode = 1 }
    }
    if (context) await context.storageState().then(value => savePrivate(statePath, value)).catch(() => {})
    report.finishedAt = new Date().toISOString(); report.postCount = postCount; write()
    await browser?.close()
    console.log(JSON.stringify({ result: report.result, case: caseId, mode, report: reportPath, postCount, failure: report.failure?.split('\n')[0] }))
  }
})()
