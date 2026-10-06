// Parameterized real-H5 runner. Journey setup and every user action stay in the browser.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const readline = require('node:readline/promises')
const { chromium } = require('playwright')
const { assertStopCancellation } = require('./dsh-h5-assertions.cjs')

const args = process.argv.slice(2)
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
if (args.includes('--help')) {
  console.log('node scripts/qa-dsh-d6-h5.cjs --transport <private.json> --journeys <json> --journey <id> --output-dir <dir> [--h5-url URL] [--timeout-ms N] [--interactive]')
  process.exit(0)
}

const transportPath = value('--transport'), journeysPath = value('--journeys'), journeyId = value('--journey'), outputDir = value('--output-dir')
assert.ok(transportPath && journeysPath && journeyId && outputDir, 'Explicit transport, journeys, journey id, and output directory are required')
const transport = JSON.parse(fs.readFileSync(path.resolve(transportPath), 'utf8'))
const journeyDoc = JSON.parse(fs.readFileSync(path.resolve(journeysPath), 'utf8'))
assert.equal(journeyDoc.version, 1, 'Unsupported journey document version')
const journey = journeyDoc.journeys?.find(item => item.id === journeyId)
assert.ok(journey && Array.isArray(journey.actions) && journey.actions.length, 'Journey must contain actions')
assert.ok(transport.runId && transport.localLoginKey && transport.user?.nickname, 'Private D6 transport is incomplete')
const h5Url = value('--h5-url') || transport.h5Url
const apiUrl = transport.baseUrl
assert.ok(h5Url && apiUrl, 'Explicit H5 and API URLs are required')
for (const candidate of [h5Url, apiUrl]) assert.ok(new URL(candidate).hostname === '127.0.0.1' || new URL(candidate).hostname === 'localhost', 'D6 browser runner accepts loopback endpoints only')
const timeoutMs = Number(value('--timeout-ms') || 360000)
assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 420000, 'Invalid timeout')
const interactive = args.includes('--interactive')
const out = path.resolve(outputDir)
fs.mkdirSync(out, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const reportPath = path.join(out, `${journeyId}-${stamp}.json`)
const report = { version: 1, journeyId, startedAt: new Date().toISOString(), h5Url, apiUrl,
  runId: transport.runId, actions: [], events: [], browserErrors: [], resourceErrors: [], screenshots: [], result: 'running' }
const privateValues = [transport.localLoginKey].filter(v => typeof v === 'string' && v.length)
const sanitize = input => privateValues.reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(input))
const safeJson = value => sanitize(JSON.stringify(value, (key, item) => /^(?:access_?token|refresh_?token|authorization|token|api_?key|secret|password)$/i.test(key) ? '[REDACTED]' : item, 2)) + '\n'
const write = () => fs.writeFileSync(reportPath, safeJson(report))
const started = performance.now(), elapsed = () => Math.round(performance.now() - started)
let browser, activeTurnId, acceptedArtifactRefs = []
const terminalStates = ['completed', 'failed', 'cancelled']
const input = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : undefined

const visibleText = async page => (await page.locator('body').innerText()).trim()
const visibleResultTexts = page => page.locator('.pl-result').evaluateAll(elements => elements
  .filter(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  })
  .map(element => (element.innerText || '').trim()).filter(text => text.length >= 20))
const openVisibleLatestResult = async (page, action, record) => {
  const results = page.locator('.pl-result:visible')
  const count = await results.count()
  assert.ok(count > 0, 'No visible Planner result card is available to open')
  const result = results.last()
  const text = (await result.innerText()).trim()
  assert.ok(text.length >= 20, 'The selected visible Planner result card has no readable content')
  record.openedResultText = text
  await result.click({ timeout: action.timeoutMs || 10000 })
  await waitForReadablePage(page, action)
  const routeQuery = page.url().split('?').slice(1).join('?')
  record.openedArtifactId = new URLSearchParams(routeQuery).get('artifactId') || null
  if (acceptedArtifactRefs.some(ref => ref.type === 'travel_guide')) {
    assert.ok(record.openedArtifactId && acceptedArtifactRefs.some(ref => ref.type === 'travel_guide' && ref.id === record.openedArtifactId),
      'Visible Planner result opened a route artifact that differs from the accepted travel_guide Artifact ID')
  }
}
const recordTurnArtifacts = (record, action) => {
  const progressRefs = Array.isArray(record.terminal?.artifactRefs) ? record.terminal.artifactRefs : []
  const responseRefs = Array.isArray(record.terminal?.response?.artifactRefs) ? record.terminal.response.artifactRefs : []
  const valid = refs => refs.filter(ref => typeof ref?.id === 'string' && typeof ref?.type === 'string')
  const observed = [
    ...valid(progressRefs).map(ref => ({ ...ref, source: 'turn-progress' })),
    ...valid(responseRefs).map(ref => ({ ...ref, source: 'final-response' })),
  ]
  acceptedArtifactRefs = observed
  record.acceptedArtifactRefs = observed.map(ref => ({ id: ref.id, type: ref.type, source: ref.source, revision: ref.revision ?? null }))
  record.artifactRefsBySource = {
    turnProgress: valid(progressRefs).map(ref => ({ id: ref.id, type: ref.type })),
    finalResponse: valid(responseRefs).map(ref => ({ id: ref.id, type: ref.type })),
  }
  const missingTypes = (action.assert?.artifactTypes || []).filter(type => !observed.some(ref => ref.type === type))
  for (const [source, types] of Object.entries(action.assert?.artifactTypesBySource || {})) {
    const sourceRefs = source === 'turn-progress' ? valid(progressRefs) : source === 'final-response' ? valid(responseRefs) : []
    assert.ok(source === 'turn-progress' || source === 'final-response', `Unsupported Artifact source: ${source}`)
    for (const type of types) if (!sourceRefs.some(ref => ref.type === type)) missingTypes.push(`${type}@${source}`)
  }
  return missingTypes
}
const visibleControls = page => page.locator('button:visible, a:visible, [role="button"]:visible, [role="option"]:visible').evaluateAll(elements =>
  elements.map((element, locatorIndex) => ({ locatorIndex, tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
    label: (element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent || '').trim().slice(0, 160),
    className: typeof element.className === 'string' ? element.className.slice(0, 160) : '' }))
    .filter(item => item.label).slice(0, 40).map((item, index) => ({ index, ...item })))
const visibleChoiceCandidates = async (page, selector) => {
  const candidates = page.locator(selector)
  const values = []
  for (let index = 0; index < await candidates.count(); index++) {
    const candidate = candidates.nth(index)
    if (!await candidate.isVisible().catch(() => false)) continue
    values.push(await candidate.evaluate((element, visibleIndex) => {
      const label = (element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent || '').trim().slice(0, 300)
      let ancestor = element.parentElement, contextText = ''
      for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
        const className = typeof ancestor.className === 'string' ? ancestor.className : ''
        const text = (ancestor.innerText || '').trim()
        if (/(card|offer|flight|route|result)/i.test(className) && text.length > label.length) { contextText = text.slice(0, 1200); break }
      }
      return { index: visibleIndex, label, contextText }
    }, values.length))
  }
  return values
}
const cssString = value => `"${[...value].map(character => {
  const code = character.codePointAt(0)
  if (character === '"' || character === '\\') return `\\${character}`
  if (code === 0) return '\\fffd '
  if (code <= 0x1f || code === 0x7f) return `\\${code.toString(16)} `
  return character
}).join('')}"`
const withExactAriaLabels = (page, candidates, labels) => candidates.filter({ visible: true }).and(page.locator(
  labels.map(label => `[aria-label=${cssString(label)}]`).join(', ')))
const clickPublishedHeaderBack = async (page, destinationSelector, timeoutMs) => {
  const back = withExactAriaLabels(page, page.locator('.ux-published .ux-header .ux-icon-button'), ['返回', 'Back'])
  await back.click({ timeout: timeoutMs })
  if (!destinationSelector.startsWith('.ux-published')) {
    await page.locator('.ux-published:visible').waitFor({ state: 'hidden', timeout: timeoutMs })
  }
  await page.locator(destinationSelector).waitFor({ state: 'visible', timeout: timeoutMs })
}
const chooseVisibleOption = async (page, action, record) => {
  assert.ok(interactive, 'operatorChoice requires --interactive so a human can select a visible option')
  const choices = await visibleChoiceCandidates(page, action.selector)
  assert.ok(choices.length > 0, `No visible choices match ${action.selector}`)
  record.operatorChoiceOptions = choices
  console.log(`\nChoose the visible option to open for ${record.label}:`)
  console.log(JSON.stringify(choices))
  const command = (await input.question('Type choose <number> after reviewing the visible options, or stop: ')).trim()
  if (command === 'stop') throw Error('Operator stopped before choosing a visible option')
  assert.match(command, /^choose\s+\d+$/, 'Choose an option with: choose <number>')
  const index = Number(command.slice('choose '.length))
  assert.ok(index >= 0 && index < choices.length, 'Choose one of the listed visible option numbers')
  const fresh = await visibleChoiceCandidates(page, action.selector)
  assert.deepEqual(fresh, choices, 'Visible options changed while waiting; inspect the refreshed page before choosing')
  record.operatorChoice = { ...choices[index], selectedAtMs: elapsed() }
  report.interactiveAssisted = true
  return index
}
const waitInteractiveTurn = async (page, eventCursor, message, maxWaitMs = timeoutMs) => {
  const requestDeadline = performance.now() + maxWaitMs
  let terminalDeadline
  let turnId
  while (performance.now() < (terminalDeadline || requestDeadline)) {
    const events = report.events.slice(eventCursor)
    const posts = events.filter(event => event.kind === 'request' && event.method === 'POST' && event.path === '/v1/agent/turns')
    assert.ok(posts.length <= 1, 'Interactive UI action submitted more than one Planner turn')
    if (posts.length === 1) {
      terminalDeadline ||= performance.now() + timeoutMs
      if (message !== undefined) assert.equal(posts[0].body?.message, message, 'Interactive reply did not match the text entered in the visible composer')
      const accepted = events.find(event => event.kind === 'response' && event.method === 'POST'
        && event.path === '/v1/agent/turns' && event.status >= 200 && event.status < 300)
      turnId = accepted?.body?.turnId
      if (turnId) activeTurnId = turnId
      const terminal = turnId && events.find(event => event.kind === 'response' && event.path.endsWith(`/v1/agent/turns/${turnId}`)
        && terminalStates.includes(event.body?.status))
      if (terminal && !await page.locator('.pl-generating').isVisible().catch(() => false)) {
        return { turnId, tripId: posts[0].body?.tripId || null, conversationId: posts[0].body?.conversationId || null,
          terminal: terminal.body, events: events.slice(), submitAtMs: posts[0].atMs }
      }
    }
    await page.waitForTimeout(200)
  }
  if (!terminalDeadline && maxWaitMs < timeoutMs) return undefined
  throw Error('Interactive action did not produce one observed terminal Planner turn')
}
const pauseForInteractiveClarification = async (page, record, missingTypes) => {
  record.expectedArtifactTypesMissing = [...missingTypes]
  assert.ok(interactive, `Terminal turn did not return accepted ${missingTypes.join(', ')} Artifact; rerun with --interactive to inspect a clarification in the same browser session`)
  assert.equal(record.terminal?.status, 'completed', 'Interactive clarification is available only after a completed response; failed/cancelled turns remain failures')
  assert.ok(!record.terminal.error && record.terminal.response?.stopReason === 'responded'
    && record.terminal.response.delivery?.status === 'not_requested'
    && typeof record.terminal.response.reply === 'string' && record.terminal.response.reply.trim(),
  'Interactive mode pauses only for a completed, non-error natural response with no delivery attempt; content/commit failures remain failures')
  report.interactiveAssisted = true
  const checkpoint = { actionIndex: record.index, expectedArtifactTypes: missingTypes, initialTurnId: record.turnId,
    actions: [], status: 'waiting' }
  report.interactiveCheckpoints ||= []; report.interactiveCheckpoints.push(checkpoint)
  const snapshot = async () => ({ atMs: elapsed(), visibleText: await visibleText(page), controls: await visibleControls(page), url: page.url() })
  checkpoint.snapshot = await snapshot(); write()
  console.log(`\nExpected accepted Artifact missing: ${missingTypes.join(', ')}. Same browser session is paused.`)
  console.log(JSON.stringify({ visibleText: checkpoint.snapshot.visibleText, controls: checkpoint.snapshot.controls }))
  const saveCheckpointScreenshot = async suffix => {
    const screenshot = path.join(out, `${journeyId}-${stamp}-interactive-${checkpoint.actions.length}-${suffix}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    report.screenshots.push(screenshot)
    return screenshot
  }
  checkpoint.snapshot.screenshot = await saveCheckpointScreenshot('pause')
  write()
  while (true) {
    const eventCursor = report.events.length
    const command = (await input.question('Type reply <natural text>, click <visible-control-number>, continue after a visible browser choice, or stop: ')).trim()
    if (command === 'stop') {
      checkpoint.actions.push({ type: 'operator-stop', atMs: elapsed() })
      checkpoint.status = 'stopped-unresolved'; write()
      throw Error('Interactive clarification stopped before the expected Artifact appeared')
    }
    if (command.startsWith('reply ')) {
      const message = command.slice('reply '.length).trim()
      assert.ok(message.length > 0, 'Interactive reply requires natural-language text')
      const interaction = { type: 'visible-composer-reply', message, startedAtMs: elapsed() }
      checkpoint.actions.push(interaction); write()
      const composer = page.locator('.pl-composer textarea')
      await composer.fill(message)
      assert.equal(await composer.inputValue(), message)
      await page.locator('.pl-submit').click()
      const turn = await waitInteractiveTurn(page, eventCursor, message)
      Object.assign(interaction, { ...turn, finishedAtMs: elapsed() })
      interaction.acceptedArtifactRefs = [
        ...(turn.terminal?.artifactRefs || []).map(ref => ({ ...ref, source: 'turn-progress' })),
        ...(turn.terminal?.response?.artifactRefs || []).map(ref => ({ ...ref, source: 'final-response' })),
      ].filter(ref => typeof ref?.id === 'string' && typeof ref?.type === 'string')
        .map(ref => ({ id: ref.id, type: ref.type, source: ref.source, revision: ref.revision ?? null }))
    } else if (command.startsWith('click ')) {
      const index = Number(command.slice('click '.length))
      assert.ok(Number.isInteger(index) && index >= 0 && index < checkpoint.snapshot.controls.length, 'Choose a listed visible-control number')
      const control = checkpoint.snapshot.controls[index]
      const interaction = { type: 'visible-control-click', control, startedAtMs: elapsed() }
      checkpoint.actions.push(interaction); write()
      const currentControls = await visibleControls(page)
      assert.deepEqual(currentControls[index], control, 'Visible controls changed while paused; inspect the updated list before choosing')
      const controls = page.locator('button:visible, a:visible, [role="button"]:visible, [role="option"]:visible')
      await controls.nth(control.locatorIndex).click()
      const turn = await waitInteractiveTurn(page, eventCursor, undefined, 3000)
      if (turn) {
        Object.assign(interaction, { ...turn, finishedAtMs: elapsed() })
        interaction.acceptedArtifactRefs = [
          ...(turn.terminal?.artifactRefs || []).map(ref => ({ ...ref, source: 'turn-progress' })),
          ...(turn.terminal?.response?.artifactRefs || []).map(ref => ({ ...ref, source: 'final-response' })),
        ].filter(ref => typeof ref?.id === 'string' && typeof ref?.type === 'string')
          .map(ref => ({ id: ref.id, type: ref.type, source: ref.source, revision: ref.revision ?? null }))
      } else Object.assign(interaction, { finishedAtMs: elapsed(), visibleText: await visibleText(page), events: report.events.slice(eventCursor) })
    } else if (command === 'continue') {
      const interaction = { type: 'operator-visible-browser-choice', startedAtMs: elapsed() }
      checkpoint.actions.push(interaction); write()
      const turn = await waitInteractiveTurn(page, eventCursor, undefined, 3000)
      if (turn) Object.assign(interaction, { ...turn, finishedAtMs: elapsed() })
      else Object.assign(interaction, { finishedAtMs: elapsed(), visibleText: await visibleText(page), events: report.events.slice(eventCursor) })
    } else {
      console.log('Unrecognized command. Use reply <natural text>, click <number>, continue, or stop.')
      continue
    }
    checkpoint.snapshot = await snapshot()
    checkpoint.snapshot.screenshot = await saveCheckpointScreenshot('after-action')
    const followupRefs = checkpoint.actions.flatMap(item => item.acceptedArtifactRefs || [])
    for (const requirement of missingTypes) {
      const [type, source] = requirement.split('@')
      if (!followupRefs.some(ref => ref.type === type && (!source || ref.source === source))) continue
      acceptedArtifactRefs = followupRefs
      checkpoint.status = 'artifact-observed-after-interactive-assistance'
      record.interactiveResolution = { expectedArtifactTypes: missingTypes, acceptedArtifactRefs: followupRefs.filter(ref => ref.type === type && (!source || ref.source === source)) }
      record.status = 'interactive-assisted'
      write()
      return
    }
    write()
    console.log(JSON.stringify({ visibleText: checkpoint.snapshot.visibleText, controls: checkpoint.snapshot.controls }))
  }
}
const readEveryActivityDetail = async (page, record, timeoutMs) => {
  assert.equal(await page.locator('.ux-published:visible').count(), 1, 'read-each-detail requires one visible published trip')
  const daysTab = page.locator('.ux-published .ux-tab').nth(1)
  await daysTab.click({ timeout: timeoutMs })
  const dayChips = page.locator('.ux-published .ux-day-selector .ux-day-chip:visible')
  const dayCount = await dayChips.count()
  assert.ok(dayCount > 0, 'Published trip has no visible day selector')
  const details = []
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const dayChip = dayChips.nth(dayIndex)
    const dayLabel = (await dayChip.innerText()).trim()
    if (await dayChip.getAttribute('aria-pressed') !== 'true') await dayChip.click({ timeout: timeoutMs })
    const activities = page.locator('.ux-published .ux-activity:visible')
    const activityCount = await activities.count()
    for (let activityIndex = 0; activityIndex < activityCount; activityIndex++) {
      const activity = activities.nth(activityIndex)
      const activityLabel = (await activity.innerText()).trim()
      await activity.click({ timeout: timeoutMs })
      const sheet = page.locator('.ux-published .ux-modal:visible .ux-sheet[role="dialog"]')
      await sheet.waitFor({ state: 'visible', timeout: timeoutMs })
      const detailText = (await sheet.innerText()).trim()
      assert.ok(detailText.length >= 20, `Activity detail was not readable for ${dayLabel}`)
      details.push({ day: dayLabel, activity: activityLabel, text: detailText })
      await page.locator('.ux-published .ux-modal:visible .ux-sheet-close').click({ timeout: timeoutMs })
      await sheet.waitFor({ state: 'hidden', timeout: timeoutMs })
    }
  }
  assert.ok(details.length > 0, 'Published trip contains no activity detail sheets to inspect')
  record.detailCoverage = { dayCount, activityCount: details.length, activities: details }
}
const recordAcceptedGuideReadability = async (page, record) => {
  await page.locator('.ux-published .ux-publication-state--accepted').waitFor({ state: 'visible', timeout: 30000 })
  const currentArtifactId = new URLSearchParams(page.url().split('?').slice(1).join('?')).get('artifactId')
  const openedArtifactId = record.openedArtifactId || [...report.actions].reverse().find(item => item.openedArtifactId)?.openedArtifactId
  assert.ok(currentArtifactId && openedArtifactId, 'Readable guide timing requires the current published Artifact route')
  assert.equal(currentArtifactId, openedArtifactId, 'Readable guide timing route changed before activity details were read')
  assert.ok(record.detailCoverage?.activityCount > 0, 'Readable guide timing requires every activity detail to be read')
  const sourceActions = [
    ...report.actions,
    ...(report.interactiveCheckpoints || []).flatMap(checkpoint => checkpoint.actions || [])
  ]
  const source = sourceActions.reverse().find(item => item.acceptedArtifactRefs?.some(ref => ref.type === 'travel_guide' && ref.id === currentArtifactId))
  record.acceptedGuideArtifactId = currentArtifactId
  record.acceptedGuideReadableAtMs = elapsed()
  record.acceptedGuideReadableObservation = 'accepted publication visible, current route matched the opened Artifact, and every activity detail sheet was read'
  record.acceptedGuideTripId = source?.tripId || null
  record.acceptedGuideTurnId = source?.turnId || null
  record.acceptedGuideReferenceObserved = Boolean(source)
  record.submitToAcceptedGuideReadableMs = source && Number.isFinite(source.submitAtMs)
    ? record.acceptedGuideReadableAtMs - source.submitAtMs : null
  record.acceptedGuideReadableTiming = source && Number.isFinite(source.submitAtMs) ? 'measured-from-matching-accepted-guide-turn' : 'unknown-source-turn'
}
const inspectLatestAcceptedResult = async (page, action, record) => {
  await openVisibleLatestResult(page, action, record)
  await page.locator('.ux-published .ux-publication-state--accepted').waitFor({ state: 'visible', timeout: action.timeoutMs || 30000 })
  await readEveryActivityDetail(page, record, action.timeoutMs || 15000)
  await recordAcceptedGuideReadability(page, record)
  await clickPublishedHeaderBack(page, '.ux-published .ux-overview', action.timeoutMs || 15000)
  record.overviewText = (await page.locator('.ux-published .ux-overview').innerText()).trim()
  await clickPublishedHeaderBack(page, '.pl-result:visible', action.timeoutMs || 15000)
  record.returnedToPlanner = true
}
const waitForReadablePage = async (page, action) => {
  const timeout = action.timeoutMs || 30000
  const selectorsVisible = action.waitFor?.selectorsVisible || []
  const selectorsHidden = action.waitFor?.selectorsHidden || []
  const textIncludes = action.waitFor?.textIncludes || []
  for (const selector of selectorsHidden) await page.locator(selector).first().waitFor({ state: 'hidden', timeout })
  for (const selector of selectorsVisible) await page.locator(selector).first().waitFor({ state: 'visible', timeout })
  if (textIncludes.length) {
    await page.waitForFunction(needles => {
      const text = document.body?.innerText || ''
      return needles.every(needle => text.includes(needle))
    }, textIncludes, { timeout })
  }
  if (!selectorsVisible.length && !selectorsHidden.length && !textIncludes.length) {
    await page.waitForFunction(() => {
      const text = (document.body?.innerText || '').trim()
      const detail = Array.from(document.querySelectorAll('.ux-published, .route-workspace, .pl-result'))
        .find(element => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 })
      return text.length >= 40 && Boolean(detail)
    }, null, { timeout })
  }
}
const routeState = async page => page.evaluate(() => {
  const value = location.href
  const artifactId = new URLSearchParams(value.split('?').slice(1).join('?')).get('artifactId')
  return { href: value, hash: location.hash, artifactId }
})
const waitForRestoredRoute = async (page, action) => {
  if (action.waitFor?.selectorsVisible?.length || action.waitFor?.textIncludes?.length) {
    await waitForReadablePage(page, action)
    return
  }
  const currentRoute = await routeState(page)
  if (currentRoute.artifactId) {
    await page.locator('.ux-published .ux-publication-state--accepted').waitFor({ state: 'visible', timeout: action.timeoutMs || 30000 })
  } else if (currentRoute.hash.includes('/pages/plan/')) {
    await page.locator('.pl-composer textarea').waitFor({ state: 'visible', timeout: action.timeoutMs || 30000 })
  }
  await waitForReadablePage(page, action)
}
const allowedReadbackPaths = (artifactId, tripId) => new Set([
  ...(artifactId ? [`/v1/artifacts/${artifactId}`] : []),
  ...(tripId ? [`/v1/trips/${tripId}`, `/v1/trips/${tripId}/workspace`] : []),
])
const waitForInitialPlannerReady = async (page, timeout = 30000) => {
  await page.waitForFunction(() => {
    const plan = document.querySelector('.taro_page[id*="pages/plan/index"]')
    const composer = document.querySelector('.pl-composer textarea')
    if (!plan || !composer || plan.classList.contains('taro_page_shade')) return false
    const planRect = plan.getBoundingClientRect(), composerRect = composer.getBoundingClientRect()
    const planStyle = getComputedStyle(plan), composerStyle = getComputedStyle(composer)
    return planStyle.display !== 'none' && planStyle.visibility !== 'hidden'
      && planRect.width > 0 && planRect.height > 0
      && composerStyle.display !== 'none' && composerStyle.visibility !== 'hidden'
      && composerRect.width > 0 && composerRect.height > 0
  }, null, { timeout })
  return page.evaluate(() => {
    const plan = document.querySelector('.taro_page[id*="pages/plan/index"]')
    const composer = document.querySelector('.pl-composer textarea')
    const rect = element => {
      const value = element.getBoundingClientRect()
      return { width: Math.round(value.width), height: Math.round(value.height) }
    }
    return { planId: plan?.id, planClass: plan?.className, planRect: plan && rect(plan), composerRect: composer && rect(composer) }
  })
}
const openTripWorkspaceArtifact = async (page, record, action) => {
  const source = [...report.actions].reverse().find(item => item.tripId && item.acceptedArtifactRefs?.some(ref => ref.type === action.artifactType))
  assert.ok(source, `No prior action captured a Trip ID and accepted ${action.artifactType} Artifact`)
  const accepted = source.acceptedArtifactRefs.find(ref => ref.type === action.artifactType)
  const tripId = source.tripId
  const listEvent = [...report.events].reverse().find(event => event.kind === 'response' && event.method === 'GET'
    && event.path === '/v1/trips' && event.status === 200 && Array.isArray(event.body?.trips))
  assert.ok(listEvent, 'My Trips did not return a successful readable trip list')
  const ordinal = listEvent.body.trips.findIndex(trip => trip.id === tripId)
  assert.ok(ordinal >= 0, `Trip ${tripId} from the Planner turn is absent from the live My Trips response`)
  const trip = listEvent.body.trips[ordinal]
  const cards = page.locator('.trips-production .lb-cloud-trip')
  await cards.nth(ordinal).waitFor({ state: 'visible', timeout: action.timeoutMs || 15000 })
  assert.equal(await cards.count(), listEvent.body.trips.length, 'Visible My Trips cards differ from the returned trip-list length')
  const card = cards.nth(ordinal)
  const title = (await card.locator('.lb-cloud-open .ui-display').innerText()).trim()
  assert.equal(title, trip.title, 'Visible trip card title/order differs from the matching GET /v1/trips record')
  record.tripSelection = { id: trip.id, title: trip.title, apiOrdinal: ordinal + 1, visibleCardOrdinal: ordinal + 1,
    listResponseAtMs: listEvent.atMs, acceptedArtifactId: accepted.id, acceptedArtifactType: accepted.type }

  const detailButton = card.locator('.lb-trip-footer .ux-text-button').filter({ hasText: /^\s*对话与结果\s*$/ })
  assert.equal(await detailButton.count(), 1, 'Matching My Trips card must contain one exact conversations/results control')
  const eventCursor = report.events.length
  await detailButton.click({ timeout: action.timeoutMs || 10000 })
  const workspacePath = `/v1/trips/${tripId}/workspace`
  const workspaceDeadline = performance.now() + (action.timeoutMs || 30000)
  let workspaceEvent
  while (performance.now() < workspaceDeadline) {
    workspaceEvent = report.events.slice(eventCursor).find(event => event.kind === 'response' && event.method === 'GET'
      && event.path === workspacePath && event.status === 200 && event.body?.trip?.id === tripId)
    if (workspaceEvent) break
    await page.waitForTimeout(150)
  }
  assert.ok(workspaceEvent, `Visible details action did not return HTTP 200 for ${workspacePath}`)
  const workspace = workspaceEvent.body
  const artifactIndex = workspace.artifactRefs.findIndex(ref => ref.id === accepted.id && ref.type === action.artifactType)
  assert.ok(artifactIndex >= 0, `Matching Trip workspace does not expose accepted ${action.artifactType} Artifact ${accepted.id}`)
  record.workspaceReadback = { path: workspacePath, status: workspaceEvent.status, tripId: workspace.trip.id,
    artifactRefs: workspace.artifactRefs, acceptedArtifactIndex: artifactIndex, responseAtMs: workspaceEvent.atMs }

  await page.locator('.ux-sheet .lb-cloud-detail-row').first().waitFor({ state: 'visible', timeout: action.timeoutMs || 15000 })
  const rows = page.locator('.ux-sheet .lb-cloud-detail-row')
  const rowIndex = workspace.conversations.length + artifactIndex
  assert.ok(rowIndex < await rows.count(), 'Visible workspace rows do not correspond to the returned conversations and Artifacts')
  const row = rows.nth(rowIndex)
  const label = (await row.innerText()).trim()
  const expectedLabel = action.artifactType === 'travel_guide' ? '每日攻略' : action.artifactType
  assert.ok(label.includes(expectedLabel), `Workspace row ${rowIndex + 1} does not label the matching ${action.artifactType} Artifact`)
  await row.click({ timeout: action.timeoutMs || 10000 })
  await page.locator('.ux-published .ux-publication-state--accepted').waitFor({ state: 'visible', timeout: action.timeoutMs || 30000 })
  record.openedArtifactId = new URLSearchParams(page.url().split('?').slice(1).join('?')).get('artifactId')
  assert.equal(record.openedArtifactId, accepted.id, 'My Trips opened a different Artifact than the accepted Planner guide')
}
const checkPageContract = async (page, contract, label) => {
  if (!contract) return
  const text = await visibleText(page)
  for (const expected of contract.textIncludes || []) assert.ok(text.includes(expected), `${label}: visible page text must include ${JSON.stringify(expected)}`)
  for (const unexpected of contract.textExcludes || []) assert.ok(!text.includes(unexpected), `${label}: visible page text must exclude ${JSON.stringify(unexpected)}`)
  for (const selector of contract.selectorsVisible || []) assert.ok(await page.locator(selector).first().isVisible().catch(() => false), `${label}: expected visible selector ${selector}`)
  for (const selector of contract.selectorsHidden || []) assert.equal(await page.locator(selector).first().isVisible().catch(() => false), false, `${label}: expected hidden selector ${selector}`)
}

async function run() {
  browser = await chromium.launch({ channel: 'chrome', headless: false })
  const browserContextOptions = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: false, hasTouch: false }
  const context = await browser.newContext(browserContextOptions)
  const page = await context.newPage()
  report.browserEnvironment = {
    name: 'Chrome', version: browser.version(),
    ...(await page.evaluate(() => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height },
      deviceScaleFactor: window.devicePixelRatio,
      userAgent: navigator.userAgent,
    }))),
    mobile: browserContextOptions.isMobile, touch: browserContextOptions.hasTouch,
    emulation: 'phone-sized viewport; default Chrome user agent; mobile and touch emulation disabled',
  }
  write()
  const plannerComposer = page.locator('.pl-composer textarea')
  page.on('pageerror', error => report.browserErrors.push(sanitize(error.message)))
  page.on('console', message => { if (message.type() === 'error') report.browserErrors.push(sanitize(message.text())) })
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      report.resourceErrors.push({ kind: 'request-failed', method: request.method(), origin: url.origin, path: url.pathname })
    }
  })
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== new URL(apiUrl).origin) return
    let body
    try { body = request.postDataJSON() } catch {}
    report.events.push({ atMs: elapsed(), kind: 'request', method: request.method(), path: url.pathname, ...(body ? { body } : {}) })
  })
  page.on('response', async response => {
    const url = new URL(response.url())
    if (response.status() >= 400 && (url.protocol === 'http:' || url.protocol === 'https:')) {
      report.resourceErrors.push({ kind: 'http-error', method: response.request().method(), status: response.status(), origin: url.origin, path: url.pathname })
    }
    if (url.origin !== new URL(apiUrl).origin) return
    let body
    if (url.pathname.includes('/v1/agent/turns')) {
      try { body = await response.json() } catch {}
    } else if (response.request().method() === 'GET' && url.pathname === '/v1/trips') {
      try {
        const value = await response.json()
        body = { trips: Array.isArray(value?.trips) ? value.trips.map(trip => ({ id: trip.id, title: trip.title })) : [] }
      } catch {}
    } else if (response.request().method() === 'GET' && /^\/v1\/trips\/[^/]+\/workspace$/.test(url.pathname)) {
      try {
        const value = await response.json()
        body = { trip: { id: value?.trip?.id, title: value?.trip?.title }, conversations: Array.isArray(value?.conversations) ? value.conversations.map(item => ({ id: item.id })) : [],
          artifactRefs: Array.isArray(value?.artifactRefs) ? value.artifactRefs.map(ref => ({ id: ref.id, type: ref.type })) : [] }
      } catch {}
    }
    report.events.push({ atMs: elapsed(), kind: 'response', method: response.request().method(), path: url.pathname, status: response.status(), ...(body ? { body } : {}) })
  })
  try {
    await page.goto(h5Url, { waitUntil: 'domcontentloaded' })
    report.initialPlannerReadiness = { status: 'waiting', timeoutMs: 30000,
      condition: 'unshaded visible Taro Planner page and visible non-zero-size Planner composer' }
    report.initialPlannerReadiness.snapshot = await waitForInitialPlannerReady(page)
    report.initialPlannerReadiness.status = 'ready-before-login-or-navigation'
    const accessToken = await page.evaluate(() => JSON.parse(localStorage.getItem('access_token') || '{}').data || '')
    if (!accessToken) {
      await page.getByText('我的', { exact: true }).first().click()
      await page.getByText('登录与同步', { exact: true }).first().click()
      await page.locator('.login-sheet__local-button').click({ timeout: 15000 })
      await page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem('access_token') || '{}').data), null, { timeout: 15000 })
      await page.locator('.login-sheet').waitFor({ state: 'hidden', timeout: 15000 })
      await page.locator('.profile-production .ux-screen').waitFor({ state: 'visible', timeout: 15000 })
      report.localLogin = 'completed-through-visible-profile-and-login-sheet'
    } else report.localLogin = 'existing-browser-session'
    const plannerTab = page.getByText('规划', { exact: true }).filter({ visible: true }).last()
    await plannerTab.waitFor({ timeout: 10000 })
    await plannerTab.click()
    await plannerComposer.waitFor({ state: 'visible', timeout: 30000 })
    report.loadedAtMs = elapsed()
    report.plannerNavigation = { url: page.url(), hash: await page.evaluate(() => location.hash) }
    write()
    for (let index = 0; index < journey.actions.length; index++) {
      const action = journey.actions[index]
      const record = { index, type: action.type, label: action.label || `action-${index + 1}`, startedAtMs: elapsed(), status: 'running' }
      report.actions.push(record); write()
      await checkPageContract(page, action.precondition, `precondition for ${record.label}`)
      if (action.type === 'send') {
        assert.equal(typeof action.message, 'string')
        const previousResults = await visibleResultTexts(page)
        const previousResultSet = new Set(previousResults)
        await plannerComposer.fill(action.message)
        assert.equal(await plannerComposer.inputValue(), action.message, 'Visible composer text differs from journey input')
        activeTurnId = undefined
        const eventCursor = report.events.length
        record.submitAtMs = elapsed()
        await page.locator('.pl-submit').click()
        record.firstReadableResultObservation = 'new or changed .pl-result text, first observed by 250ms polling; latency is an upper bound'
        let postSeen = false, terminal = false
        const deadline = performance.now() + timeoutMs
        while (performance.now() < deadline) {
          const currentEvents = report.events.slice(eventCursor)
          const posts = currentEvents.filter(event => event.kind === 'request' && event.method === 'POST' && event.path === '/v1/agent/turns')
          const turns = currentEvents.filter(event => event.kind === 'response' && event.path.startsWith('/v1/agent/turns/') && event.body?.status)
          const submitResponse = currentEvents.find(event => event.kind === 'response' && event.method === 'POST'
            && event.path === '/v1/agent/turns' && event.atMs >= record.submitAtMs && event.status >= 200 && event.status < 300)
          if (submitResponse && record.acceptedAtMs === undefined) {
            record.acceptedAtMs = submitResponse.atMs
            record.submitToAcceptedMs = submitResponse.atMs - record.submitAtMs
            record.acceptanceObservation = 'first successful HTTP response to the single visible submit POST'
          }
          postSeen = posts.length === 1
          const submitted = submitResponse?.body?.turnId
          if (submitted) activeTurnId = submitted
          const terminalResponse = activeTurnId && turns.find(event => event.path.endsWith(`/v1/agent/turns/${activeTurnId}`)
            && event.atMs >= record.submitAtMs && ['completed', 'failed', 'cancelled'].includes(event.body.status))
          terminal = Boolean(terminalResponse)
          if (terminalResponse && record.terminalAtMs === undefined) {
            record.terminalAtMs = terminalResponse.atMs
            record.submitToTerminalMs = terminalResponse.atMs - record.submitAtMs
            record.terminalObservation = 'first observed terminal turn-status response'
          }
          if (record.firstReadableResultAtMs === undefined) {
            const currentResults = await visibleResultTexts(page)
            const changed = currentResults.find(text => !previousResultSet.has(text))
            if (changed) {
              record.firstReadableResultAtMs = elapsed()
              record.submitToFirstReadableResultMs = record.firstReadableResultAtMs - record.submitAtMs
              record.firstReadableResultText = changed
            }
          }
          if (action.awaitTerminal === false && postSeen && activeTurnId && await page.locator('.pl-generating').isVisible().catch(() => false)) break
          if (terminal && !await page.locator('.pl-generating').isVisible().catch(() => false)) break
          await page.waitForTimeout(250)
        }
        const currentEvents = report.events.slice(eventCursor)
        const posts = currentEvents.filter(event => event.kind === 'request' && event.method === 'POST' && event.path === '/v1/agent/turns')
        assert.equal(posts.length, 1, 'Expected exactly one UI-submitted planner turn after this action began')
        assert.equal(posts[0].body?.message, action.message)
        record.tripId = posts[0].body?.tripId || null
        record.conversationId = posts[0].body?.conversationId || null
        record.turnId = activeTurnId
        assert.ok(postSeen, 'Planner turn POST was not observed; do not resubmit')
        if (action.awaitTerminal !== false) assert.ok(terminal, 'Planner turn did not reach an observed terminal response; do not resubmit')
        if (terminal) record.terminal = report.events.filter(event => event.kind === 'response' && event.path.endsWith(`/v1/agent/turns/${activeTurnId}`) && event.body?.status).at(-1)?.body
      const missingArtifactTypes = recordTurnArtifacts(record, action)
      if (missingArtifactTypes.length) await pauseForInteractiveClarification(page, record, missingArtifactTypes)
      } else if (action.type === 'stop') {
        assert.ok(activeTurnId, 'stop requires a prior send with awaitTerminal:false')
        const cancelPath = `/v1/agent/turns/${activeTurnId}/cancel`
        const eventCursor = report.events.length
        await page.locator('.pl-stop').click({ timeout: action.timeoutMs || 10000 })
        const deadline = performance.now() + (action.timeoutMs || 30000)
        let cancelRequest, cancelResponse
        while (performance.now() < deadline) {
          const events = report.events.slice(eventCursor)
          const cancelRequests = events.filter(event => event.kind === 'request' && event.method === 'POST' && event.path === cancelPath)
          cancelRequest = cancelRequests[0]
          cancelResponse = cancelRequest && events.find(event => event.kind === 'response' && event.method === 'POST'
            && event.path === cancelPath && event.atMs >= cancelRequest.atMs)
          const stoppedUiVisible = await page.locator('.pl-cancelled:visible').count() > 0
          const busyUiVisible = await page.locator('.pl-generating:visible').count() > 0
          if (cancelRequests.length === 1 && cancelResponse && stoppedUiVisible && !busyUiVisible) break
          await page.waitForTimeout(200)
        }
        const events = report.events.slice(eventCursor)
        const cancelRequests = events.filter(event => event.kind === 'request' && event.method === 'POST' && event.path === cancelPath)
        const stoppedUiVisible = await page.locator('.pl-cancelled:visible').count() > 0
        const busyUiVisible = await page.locator('.pl-generating:visible').count() > 0
        const terminalReadbacks = events.filter(event => event.kind === 'response' && event.method === 'GET'
          && event.path === `/v1/agent/turns/${activeTurnId}` && event.atMs >= (cancelResponse?.atMs ?? Infinity))
          .map(event => event.body)
        record.cancelRequestCount = cancelRequests.length
        record.cancelResponseStatus = cancelResponse?.status ?? null
        record.cancelApiSnapshot = cancelResponse?.body ?? null
        record.terminal = cancelResponse?.body ?? null
        record.terminalSource = 'cancel-response'
        record.turnId = activeTurnId
        record.stopUiVisibleText = await visibleText(page)
        record.stopCancellation = assertStopCancellation({ cancelRequestCount: cancelRequests.length,
          cancelResponse: cancelResponse && { status: cancelResponse.status, body: cancelResponse.body },
          terminalReadbacks, stoppedUiVisible, busyUiVisible })
        record.terminalSource = record.stopCancellation.terminalSource
      } else if (action.type === 'read-page' || action.type === 'read-artifact') {
        if (action.type === 'read-artifact' && action.openLatest) {
          await openVisibleLatestResult(page, action, record)
        }
        record.pageUrl = page.url()
      } else if (action.type === 'open-latest-result') {
        if (action.optional && await page.locator('.pl-result:visible').count() === 0) {
          record.status = 'not-applicable'
          record.reason = 'No visible Planner result card was available; visible response retained for manual assessment.'
          record.visibleText = await visibleText(page)
          record.finishedAtMs = elapsed()
          const screenshot = path.join(out, `${journeyId}-${stamp}-action-${index + 1}.png`)
          await page.screenshot({ path: screenshot, fullPage: true }); report.screenshots.push(screenshot); write()
          continue
        } else {
          await openVisibleLatestResult(page, action, record)
          record.pageUrl = page.url()
        }
      } else if (action.type === 'inspect-latest-result') {
        await inspectLatestAcceptedResult(page, action, record)
        record.pageUrl = page.url()
      } else if (action.type === 'open-trip-workspace-artifact') {
        await openTripWorkspaceArtifact(page, record, action)
        record.pageUrl = page.url()
      } else if (action.type === 'click') {
        assert.ok(typeof action.selector === 'string' && action.selector.length < 256, 'click action requires a bounded CSS selector')
        let target = page.locator(action.selector)
        let operatorChoiceIndex
        if (action.operatorChoice) operatorChoiceIndex = await chooseVisibleOption(page, action, record)
        else {
        if (action.textExact) {
          assert.ok(typeof action.textExact === 'string' && action.textExact.length < 160, 'textExact must be bounded')
          const escaped = action.textExact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          target = target.filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
        }
        if (action.ariaLabel) {
          assert.ok(typeof action.ariaLabel === 'string' && action.ariaLabel.length < 160, 'ariaLabel must be bounded')
          target = withExactAriaLabels(page, target, [action.ariaLabel])
        }
        if (action.ariaLabels) {
          assert.ok(Array.isArray(action.ariaLabels) && action.ariaLabels.length > 0
            && action.ariaLabels.every(label => typeof label === 'string' && label.length > 0 && label.length < 160), 'ariaLabels must be a bounded non-empty string list')
          target = withExactAriaLabels(page, target, action.ariaLabels)
        }
        }
        const awaitTerminal = action.awaitTerminal === true
        const previousResults = await visibleResultTexts(page)
        const previousResultSet = new Set(previousResults)
        if (awaitTerminal) activeTurnId = undefined
        const eventCursor = report.events.length
        if (awaitTerminal) record.submitAtMs = elapsed()
        let awaitHttpBefore = 0
        if (action.awaitHttp) {
          assert.ok(['GET', 'POST', 'PATCH', 'DELETE'].includes(action.awaitHttp.method), 'awaitHttp requires an explicit HTTP method')
          assert.ok(typeof action.awaitHttp.pathSuffix === 'string' && action.awaitHttp.pathSuffix.startsWith('/'), 'awaitHttp requires a bounded pathSuffix')
          awaitHttpBefore = report.events.filter(event => event.kind === 'request' && event.method === action.awaitHttp.method
            && event.path.endsWith(action.awaitHttp.pathSuffix)).length
          if (action.awaitHttp.firstOnly) assert.equal(awaitHttpBefore, 0, 'Expected this to be the first matching request in the browser run')
          record.awaitHttpStartedAtMs = elapsed()
        }
        if (action.operatorChoice) target = page.locator(action.selector).filter({ visible: true }).nth(operatorChoiceIndex)
        await target.click({ timeout: action.timeoutMs || 10000 })
        if (awaitTerminal) {
          record.firstReadableResultObservation = 'new or changed .pl-result text, first observed by 250ms polling; latency is an upper bound'
          const deadline = performance.now() + (action.timeoutMs || timeoutMs)
          let accepted = false, terminalResponse
          while (performance.now() < deadline) {
            const currentEvents = report.events.slice(eventCursor)
            const submitResponse = currentEvents.find(event => event.kind === 'response' && event.method === 'POST'
              && event.path === '/v1/agent/turns' && event.atMs >= record.submitAtMs && event.status >= 200 && event.status < 300)
            if (submitResponse && !accepted) {
              accepted = true
              activeTurnId = submitResponse.body?.turnId
              record.acceptedAtMs = submitResponse.atMs
              record.submitToAcceptedMs = submitResponse.atMs - record.submitAtMs
              record.acceptanceObservation = 'first successful HTTP response to the single clicked UI action'
              record.tripId = submitResponse.body?.tripId || null
              record.conversationId = submitResponse.body?.conversationId || null
              record.turnId = activeTurnId
            }
            if (activeTurnId) terminalResponse = currentEvents.find(event => event.kind === 'response' && event.atMs >= record.submitAtMs
              && event.path.endsWith(`/v1/agent/turns/${activeTurnId}`)
              && ['completed', 'failed', 'cancelled'].includes(event.body?.status))
            if (terminalResponse) {
              record.terminalAtMs = terminalResponse.atMs
              record.submitToTerminalMs = terminalResponse.atMs - record.submitAtMs
              record.terminalObservation = 'first observed terminal turn-status response'
              record.terminal = terminalResponse.body
            }
            if (record.firstReadableResultAtMs === undefined) {
              const currentResults = await visibleResultTexts(page)
              const changed = currentResults.find(text => !previousResultSet.has(text))
              if (changed) {
                record.firstReadableResultAtMs = elapsed()
                record.submitToFirstReadableResultMs = record.firstReadableResultAtMs - record.submitAtMs
                record.firstReadableResultText = changed
              }
            }
            if (terminalResponse) break
            await page.waitForTimeout(250)
          }
          const currentEvents = report.events.slice(eventCursor)
          const posts = currentEvents.filter(event => event.kind === 'request' && event.method === 'POST' && event.path === '/v1/agent/turns')
          assert.equal(posts.length, 1, 'awaitTerminal click must submit exactly one Planner turn after this action began')
          assert.ok(accepted, 'Clicked Planner turn was not accepted; do not repeat the click')
          assert.ok(terminalResponse, 'Clicked Planner turn did not reach an observed terminal response; do not repeat the click')
          const missingArtifactTypes = recordTurnArtifacts(record, action)
          if (missingArtifactTypes.length) await pauseForInteractiveClarification(page, record, missingArtifactTypes)
        }
        if (action.awaitHttp) {
          const deadline = performance.now() + (action.timeoutMs || timeoutMs)
          let request, response
          while (performance.now() < deadline) {
            const currentEvents = report.events.slice(eventCursor)
            const matchingRequests = currentEvents.filter(event => event.kind === 'request' && event.method === action.awaitHttp.method
              && event.path.endsWith(action.awaitHttp.pathSuffix))
            request = matchingRequests[0]
            response = request && currentEvents.find(event => event.kind === 'response' && event.method === action.awaitHttp.method
              && event.path === request.path && event.atMs >= request.atMs)
            if (response) {
              assert.equal(matchingRequests.length, 1, `Expected one request for ${request.path} from this click`)
              break
            }
            await page.waitForTimeout(200)
          }
          assert.ok(request, `Clicked action did not issue ${action.awaitHttp.method} ${action.awaitHttp.pathSuffix}`)
          assert.ok(response, `Clicked action did not receive a response for ${request.path}`)
          const expectedStatus = action.awaitHttp.status || 200
          assert.equal(response.status, expectedStatus, `Unexpected response status for ${request.path}`)
          record.awaitHttp = { method: request.method, path: request.path, status: response.status,
            elapsedMs: response.atMs - record.awaitHttpStartedAtMs, matchingRequestsBefore: awaitHttpBefore }
          await waitForReadablePage(page, action)
        }
        else if (action.waitFor?.selectorsVisible?.length || action.waitFor?.selectorsHidden?.length || action.waitFor?.textIncludes?.length) {
          await waitForReadablePage(page, action)
        }
      } else if (action.type === 'read-each-detail') {
        if (action.optional && await page.locator('.ux-published:visible').count() === 0) {
          record.status = 'not-applicable'
          record.reason = 'No accepted published detail route was open; visible response retained for manual assessment.'
          record.visibleText = await visibleText(page)
          record.finishedAtMs = elapsed()
          const screenshot = path.join(out, `${journeyId}-${stamp}-action-${index + 1}.png`)
          await page.screenshot({ path: screenshot, fullPage: true }); report.screenshots.push(screenshot); write()
          continue
        }
        await readEveryActivityDetail(page, record, action.timeoutMs || 15000)
        await recordAcceptedGuideReadability(page, record)
      } else if (action.type === 'new-trip') {
        const labels = action.textExact ? [action.textExact] : ['新旅行', 'New trip']
        let newTripControl
        for (const label of labels) {
          const candidate = page.getByText(label, { exact: true }).filter({ visible: true })
          if (await candidate.count()) { newTripControl = candidate.last(); break }
        }
        assert.ok(newTripControl, 'No visible localized New trip control was found')
        await newTripControl.click({ timeout: action.timeoutMs || 10000 })
        await plannerComposer.waitFor({ state: 'visible', timeout: 15000 })
        record.tripReset = 'visible Planner New trip control clicked; no Trip/conversation state injected'
      } else if (action.type === 'reload') {
        const routeBeforeReload = await routeState(page)
        record.routeBeforeReload = routeBeforeReload
        await page.reload({ waitUntil: 'domcontentloaded' })
        await waitForRestoredRoute(page, action)
        record.routeAfterReload = await routeState(page)
        assert.equal(record.routeAfterReload.hash, routeBeforeReload.hash, 'Reload did not restore the same page route')
        if (routeBeforeReload.artifactId) assert.equal(record.routeAfterReload.artifactId, routeBeforeReload.artifactId,
          'Reload restored a different published Artifact route')
      } else if (action.type === 'wait') {
        assert.ok(Number.isInteger(action.ms) && action.ms >= 0 && action.ms <= 30000, 'wait must be between 0 and 30000 ms')
        await page.waitForTimeout(action.ms)
      } else if (action.type === 'cold-restart') {
        const routeBeforeRestart = await routeState(page)
        record.routeBeforeRestart = routeBeforeRestart
        const restartTimeoutMs = Number(action.timeoutMs || 180000)
        assert.ok(Number.isInteger(restartTimeoutMs) && restartTimeoutMs >= 10000 && restartTimeoutMs <= 300000, 'cold-restart timeout must be 10-300 seconds')
        const health = async () => { try { await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(1500) }); return true } catch { return false } }
        const deadline = performance.now() + restartTimeoutMs
        let observedDown = false, recovered = false
        while (performance.now() < deadline) {
          const up = await health()
          if (!up) observedDown = true
          if (observedDown && up) { recovered = true; break }
          await page.waitForTimeout(500)
        }
        assert.ok(observedDown && recovered, 'Cold restart requires externally stopping and resuming the same D6 server run while this action waits')
        const reloadStartedAtMs = elapsed()
        const eventCursor = report.events.length
        await page.reload({ waitUntil: 'domcontentloaded' })
        await waitForRestoredRoute(page, action)
        record.routeAfterRestart = await routeState(page)
        assert.equal(record.routeAfterRestart.hash, routeBeforeRestart.hash, 'Cold restart did not restore the same page route')
        if (routeBeforeRestart.artifactId) assert.equal(record.routeAfterRestart.artifactId, routeBeforeRestart.artifactId,
          'Cold restart restored a different published Artifact route')
        const tripId = [...report.actions].reverse().find(item => item.tripId)?.tripId
          || [...report.events].reverse().find(event => event.kind === 'request' && event.method === 'POST'
            && event.path === '/v1/agent/turns' && event.body?.tripId)?.body.tripId
        const acceptedReadPaths = allowedReadbackPaths(routeBeforeRestart.artifactId, tripId)
        if (!acceptedReadPaths.size) acceptedReadPaths.add('/v1/memory')
        const authReadDeadline = performance.now() + 30000
        let authReadback
        while (performance.now() < authReadDeadline) {
          authReadback = report.events.slice(eventCursor).find(event => event.kind === 'response' && event.method === 'GET' && event.status === 200
            && event.atMs >= reloadStartedAtMs && acceptedReadPaths.has(event.path))
          if (authReadback) break
          await page.waitForTimeout(200)
        }
        assert.ok(authReadback, 'After cold restart, current route did not complete a scoped authenticated read-only GET for its current Artifact or Trip')
        record.authenticatedReadback = { path: authReadback.path, status: authReadback.status, atMs: authReadback.atMs }
        record.coldRestart = 'API outage and recovery observed; browser reloaded and completed an authenticated read-only GET'
      } else {
        throw new Error(`Unsupported journey action: ${action.type}`)
      }
      await checkPageContract(page, action.assert, `assertion for ${record.label}`)
      record.status = record.interactiveResolution ? 'interactive-assisted' : 'observed'; record.finishedAtMs = elapsed(); record.visibleText = await visibleText(page)
      const screenshot = path.join(out, `${journeyId}-${stamp}-action-${index + 1}.png`)
      await page.screenshot({ path: screenshot, fullPage: true }); report.screenshots.push(screenshot)
      write()
    }
    report.result = report.interactiveAssisted ? 'interactive-assisted' : 'observed'
  } catch (error) {
    report.result = 'failed'; report.failure = sanitize(error.stack || error.message); process.exitCode = 1
    const failedAction = report.actions.findLast(action => action.status === 'running')
    if (failedAction) { failedAction.status = 'failed'; failedAction.failure = sanitize(error.message); failedAction.finishedAtMs = elapsed() }
    const nextIndex = failedAction ? failedAction.index + 1 : report.actions.length
    for (let index = nextIndex; index < journey.actions.length; index++) {
      const action = journey.actions[index]
      report.actions.push({ index, type: action.type, label: action.label || `action-${index + 1}`, status: 'blocked', blockedBy: failedAction?.label || 'journey setup/action failure', reason: 'Prior action did not satisfy its precondition or assertion; dependent UI action was not attempted.' })
    }
    if (!page.isClosed()) {
      report.failureVisibleText = await page.locator('body').innerText().catch(() => '')
      report.failureUiDiagnostics = await page.evaluate(() => ({
        url: location.href,
        hash: location.hash,
        selectors: ['.production-nav', '.production-nav__item', 'taro-tabbar', '.taro-tabbar__tabbar-item', '.ux-screen', '.pl-composer', '.pl-composer textarea'].map(selector => ({
          selector,
          elements: Array.from(document.querySelectorAll(selector), element => {
            const style = getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            const ancestors = []
            for (let parent = element.parentElement, depth = 0; parent && depth < 7; parent = parent.parentElement, depth++) {
              const parentStyle = getComputedStyle(parent), parentRect = parent.getBoundingClientRect()
              ancestors.push({ tag: parent.tagName, id: parent.id, className: typeof parent.className === 'string' ? parent.className : '',
                display: parentStyle.display, visibility: parentStyle.visibility, position: parentStyle.position,
                transform: parentStyle.transform, width: Math.round(parentRect.width), height: Math.round(parentRect.height) })
            }
            return { visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
              display: style.display, visibility: style.visibility, opacity: style.opacity, position: style.position, transform: style.transform,
              width: Math.round(rect.width), height: Math.round(rect.height), text: (element.innerText || '').slice(0, 300), ancestors }
          }).slice(0, 12)
        })),
        pageShells: Array.from(document.querySelectorAll('#app, .taro-tabbar__container, .taro-tabbar__panel, .taro_page, taro-tabbar'), element => {
          const style = getComputedStyle(element), rect = element.getBoundingClientRect()
          return { tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className : '',
            display: style.display, visibility: style.visibility, position: style.position, transform: style.transform,
            width: Math.round(rect.width), height: Math.round(rect.height) }
        }).slice(0, 40),
        visibleTabLabels: Array.from(document.querySelectorAll('button,a,[role="tab"],taro-tabbar-item'), element => {
          const style = getComputedStyle(element), rect = element.getBoundingClientRect()
          return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '',
            text: (element.innerText || element.textContent || '').trim().slice(0, 100),
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 }
        }).filter(item => item.visible).slice(-20)
      })).catch(() => undefined)
      const screenshot = path.join(out, `${journeyId}-${stamp}-failure.png`)
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {})
      report.screenshots.push(screenshot)
    }
  } finally {
    report.finishedAt = new Date().toISOString(); report.durationMs = elapsed(); write()
    input?.close()
    await browser?.close()
    console.log(JSON.stringify({ journeyId, result: report.result, reportPath, durationMs: report.durationMs }))
  }
}

run().catch(error => { console.error(sanitize(error.stack || error.message)); process.exitCode = 1 })
