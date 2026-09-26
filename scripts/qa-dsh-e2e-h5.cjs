// Real H5 + installed headed Chrome. No response interception, fixtures or automatic retries.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright')
const { acceptedGuide, assertPatch, assertTotalBudget, assertLocalization, assertEmptySeedRecovery, assertAdoptedFlight, assertBudgetRetryCandidate, assertBudgetConfirmCandidate, assertStableBudgetConfirmationBase, assertBudgetConfirmationResult, isBUnpublishedModelFailure, isBContextOnlyModelFailure, isBCommitIdempotencyFailure, assertBCommitIdempotencyObserver, normalizePlannerReply, assertRestoredPlannerReply, assertNewVersionLocalization, assertAcceptedEnglish, assertPublicBudgetProse } = require('./dsh-h5-assertions.cjs')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
const execute = args.includes('--execute'), restore = args.includes('--restore'), localize = args.includes('--localize')
const media = args.includes('--media')
const hydrateExisting = args.includes('--hydrate-existing'), retryBeforeTurn = value('--retry-before-turn')
const retryBudgetUpdate = value('--retry-budget-update')
const retryBudgetConfirm = value('--retry-budget-confirm'), budgetRecovery = retryBudgetUpdate || retryBudgetConfirm
const retryTerminal = value('--retry-terminal') || budgetRecovery
const restartEvidence = value('--restart-evidence')
const localizeNewVersionAfter = value('--localize-new-version-after')
const restoreLanguages = args.includes('--restore-languages')
const reopenTrip = args.includes('--reopen-trip'), renderAfter = value('--render-after')
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
  console.log('Bootstrap recovery only: --hydrate-existing --execute --case A --round 1 --retry-before-turn <closed-failed-report.json>. Requires zero prior Agent POST and exactly one real read-only setup turn; no automatic retry.')
  console.log('Explicit terminal recovery: --execute --case A|B --round 1 --retry-terminal <closed-failed-report.json>. Rechecks the real terminal turn and absence of accepted guides; preserves prior attempts and warm history.')
  console.log('Read-only UI recovery: --restore --case A|B --reopen-trip --render-after <failed-ui-report.json>. Opens the existing Trip through My trips, never resends a message, and records repair-inclusive elapsed time from the original click.')
  console.log('Explicit budget recovery: --execute --case A --round 4 --retry-budget-update <failed-round-4-report.json> [--restart-evidence proof.json]. Only the diagnosed 1200-total-budget update with unchanged artifacts and blocked/stale guide is eligible.')
  console.log('Explicit receipt confirmation: --execute --case A --round 4 --retry-budget-confirm <partial-budget-report.json>. Requires existing accepted 1200 guide and exactly trip_field:budget missing; preserves the original budget-change lineage.')
  console.log('Different guide version only: --execute --localize --case A|B --localize-new-version-after <original-successful-localize-report.json>. Preserves the original attempt, requires a different current accepted guide without accepted English and uses a guide-bound exclusive attempt.')
  console.log('Existing accepted languages only: --restore --case A|B --reopen-trip --restore-languages. Clicks English then Chinese, never generates a locale, and requires zero API mutations or paid calls.')
  console.log('Single explicit media diagnosis: --execute --media --case A|B --reopen-trip. Clicks the existing media button once, records real response/image decoding, and requires zero Agent turns or budget changes.')
  process.exit(0)
}
assert.ok(['A', 'B'].includes(caseId), 'Invalid case')
assert.ok(Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 420000, 'Invalid timeout')
assert.ok(!restore || !execute && !localize, '--restore is read only')
assert.ok(!restoreLanguages || restore && reopenTrip, '--restore-languages requires --restore --reopen-trip')
assert.ok(!localize || execute, '--localize requires --execute')
assert.ok(!media || execute && !restore && !localize && !round && reopenTrip && !retryTerminal && !retryBeforeTurn, '--media requires an isolated explicit existing-trip media action')
assert.ok(!localizeNewVersionAfter || localize && execute, '--localize-new-version-after requires explicit localization')
assert.ok(!args.includes('--prepare') || !execute && !restore && !localize, '--prepare cannot be combined with actions')
assert.ok(!hydrateExisting || execute && round === 1 && !localize && !!retryBeforeTurn, '--hydrate-existing requires explicit round-one retry-before-turn report')
assert.ok(!retryBeforeTurn || hydrateExisting, '--retry-before-turn requires --hydrate-existing')
assert.ok(!retryTerminal || execute && ([1, 2, 3].includes(round) || budgetRecovery && round === 4 && caseId === 'A') && !localize && !hydrateExisting && !retryBeforeTurn, 'Unsupported explicit retry scope')
assert.ok(!budgetRecovery || !value('--retry-terminal'), 'Budget retry is a separate explicit recovery action')
assert.ok(!retryBudgetConfirm || !retryBudgetUpdate, 'Budget confirmation and stale recovery are separate actions')
assert.ok(!restartEvidence || retryTerminal, '--restart-evidence requires --retry-terminal')
assert.ok(!reopenTrip || restore || !localize && (!execute || round === 1 || media), '--reopen-trip supports restore, prepare, media or first-round entry')
assert.ok(!renderAfter || restore && reopenTrip, '--render-after requires --restore --reopen-trip')
if (execute) assert.ok(value('--case') && (localize || media || Number.isInteger(round) && specifications[caseId][round - 1]), 'Explicit case and supported round required')
const transport = JSON.parse(fs.readFileSync(transportPath, 'utf8'))
const entry = transport.entries?.find(item => item.id === caseId)
assert.ok(entry?.tripId && entry?.conversationId && entry?.token && entry?.user?.publicId, 'Real case transport is incomplete')
const privateValues = [entry.token, entry.localStorage?.access_token, entry.localStorage?.refresh_token].filter(item => typeof item === 'string' && item.length)
const sanitize = text => privateValues.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text)
const json = value => sanitize(JSON.stringify(value, (key, item) => /^(?:access_?token|refresh_?token|authorization|token|api_?key|secret|password)$/i.test(key) ? '[REDACTED]' : item, 2)) + '\n'
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const mode = media ? 'media' : localize ? 'localize' : execute ? `round-${round}` : restore ? 'restore' : 'prepare'
const runId = `${caseId}-${mode}-${timestamp}`
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(directory, { recursive: true })
const statePath = path.join(directory, `browser-${caseId}.private.json`)
const reportPath = path.join(output, `${runId}.json`)
const report = { case: caseId, mode, startedAt: new Date().toISOString(), h5: baseUrl, api: transport.baseUrl,
  tripId: entry.tripId, conversationId: entry.conversationId, browser: 'installed Chrome, headed, isolated context',
  timingEvidence: 'Node monotonic response observations and polled visible DOM; not browser paint timestamps. Readable-guide timing includes opening the result after terminal API/authoritative checks and is an observed upper bound, not the earliest possible guide paint.',
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
  let accepted, terminal, postCount = 0, workspaceSeen = false, localizationResponse, chineseRestoreBoundary, retryTerminalPredecessor, budgetNotesEquivalent, budgetRetryOrigin, publicProseProblems
  try {
    if (execute) ({ publicProseProblems } = await import(pathToFileURL(path.join(root, 'backend/dist/travel-guides/finalization.js')).href))
    report.budgetBefore = budgetSnapshot()
    if (round === 4) {
      const policy = await import(pathToFileURL(path.join(root, 'backend/dist/agent/dsh/budget-guide.js')).href)
      assert.equal(typeof policy.budgetNotesEquivalent, 'function', 'Build the shared domain budget-note policy before round four')
      budgetNotesEquivalent = policy.budgetNotesEquivalent
    }
    if (renderAfter) {
      const predecessorPath = path.resolve(renderAfter)
      assert.equal(path.dirname(predecessorPath), output, 'Render predecessor must be a retained batch report')
      const predecessorRaw = fs.readFileSync(predecessorPath), predecessor = JSON.parse(predecessorRaw)
      assert.equal(predecessor.result, 'failed'); assert.ok(predecessor.finishedAt)
      assert.equal(predecessor.case, caseId); assert.equal(predecessor.tripId, entry.tripId); assert.equal(predecessor.conversationId, entry.conversationId)
      assert.equal(predecessor.postCount, 1); assert.equal(predecessor.terminal?.status, 'completed')
      assert.equal(predecessor.terminal.response?.delivery?.status, 'satisfied')
      const guide = acceptedGuide(predecessor.authoritativeAfter)
      assert.ok(Number.isFinite(predecessor.timings?.clickedMs) && Number.isFinite(Date.parse(predecessor.startedAt)))
      report.renderRecovery = { predecessorPath, predecessorSha256: createHash('sha256').update(predecessorRaw).digest('hex'), turnId: predecessor.terminal.turnId,
        guideId: guide.id, guideContentHash: guide.payload.publication.guideContentHash,
        originalClickEpochMs: Date.parse(predecessor.startedAt) + predecessor.timings.clickedMs,
        clockEvidence: 'Prior run UTC start plus its monotonic click offset; cross-run wall-clock estimate includes repair, restart and idle intervals, not uninterrupted response latency.' }
    }
    if (retryBeforeTurn) {
      const predecessorPath = path.resolve(retryBeforeTurn)
      assert.equal(path.dirname(predecessorPath), output, 'Predecessor must be a retained report in this batch output')
      const predecessorRaw = fs.readFileSync(predecessorPath), predecessor = JSON.parse(predecessorRaw)
      assert.equal(predecessor.result, 'failed', 'Only a completed failed report may be retried')
      assert.ok(predecessor.finishedAt, 'Predecessor is still running; do not overlap attempts')
      assert.equal(predecessor.case, caseId); assert.equal(predecessor.mode, `round-${round}`)
      assert.equal(predecessor.tripId, entry.tripId); assert.equal(predecessor.conversationId, entry.conversationId)
      assert.equal(predecessor.message, specifications[caseId][0], 'Predecessor used another message')
      assert.equal(predecessor.postCount, 0, 'Prior attempt submitted an Agent turn; never blindly resend')
      assert.ok(Array.isArray(predecessor.events) && predecessor.events.length, 'Missing predecessor network evidence')
      assert.ok(!predecessor.events.some(event => event.path === '/v1/agent/turns' && event.method === 'POST' || event.body?.turnId), 'Prior turn may exist; retry forbidden')
      const predecessorRunId = path.basename(predecessorPath, '.json')
      const originalAttempt = JSON.parse(fs.readFileSync(path.join(directory, `h5-${caseId}-round-1.attempt.private.json`), 'utf8'))
      assert.equal(originalAttempt.runId, predecessorRunId, 'Predecessor is not the original retained attempt')
      assert.equal(originalAttempt.tripId, entry.tripId)
      report.retryBeforeTurn = { predecessorPath, predecessorRunId, predecessorSha256: createHash('sha256').update(predecessorRaw).digest('hex'), reason: 'Verified zero Agent POST before bootstrap failure' }
    }
    if (retryTerminal) {
      const predecessorPath = path.resolve(retryTerminal)
      assert.equal(path.dirname(predecessorPath), output, 'Predecessor must be in this batch output')
      const predecessorRaw = fs.readFileSync(predecessorPath), predecessor = JSON.parse(predecessorRaw)
      retryTerminalPredecessor = predecessor
      assert.equal(predecessor.result, 'failed', 'Only a failed acceptance report may be retried')
      assert.ok(predecessor.finishedAt, 'Predecessor report is still running')
      assert.equal(predecessor.case, caseId); assert.equal(predecessor.mode, `round-${round}`)
      assert.equal(predecessor.tripId, entry.tripId); assert.equal(predecessor.conversationId, entry.conversationId)
      assert.equal(predecessor.message, specifications[caseId][round - 1]); assert.equal(predecessor.postCount, 1)
      const priorTurn = predecessor.terminal
      assert.ok(priorTurn?.turnId && ['completed', 'failed', 'cancelled'].includes(priorTurn.status), 'Missing known final turn; never retry an ambiguous request')
      let commitConflictProof
      if (isBCommitIdempotencyFailure(predecessor)) {
        const observerDirectory = path.join(directory, 'executions')
        const matches = fs.readdirSync(observerDirectory).filter(name => name.endsWith('.jsonl')).map(name => {
          const observerPath = path.join(observerDirectory, name), raw = fs.readFileSync(observerPath)
          const events = raw.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
          return { observerPath, raw, events }
        }).filter(item => item.events.some(event => event.generationId === priorTurn.generationId))
        assert.equal(matches.length, 1, 'Commit failure requires one retained real observer for this generation')
        const match = matches[0]
        commitConflictProof = { ...assertBCommitIdempotencyObserver(predecessor, match.events), observerPath: match.observerPath,
          observerSha256: createHash('sha256').update(match.raw).digest('hex') }
      }
      if (budgetRecovery) {
        const chain = [{ value: predecessor, path: predecessorPath, sha256: createHash('sha256').update(predecessorRaw).digest('hex') }]
        while (chain.at(-1).value.budgetRetry || chain.at(-1).value.budgetConfirm) {
          assert.ok(chain.length < 16, 'Budget retry lineage exceeds bounded audit depth')
          const link = chain.at(-1).value.retryTerminal
          assert.ok(link?.predecessorPath && link.predecessorSha256, 'Budget retry lineage is incomplete')
          const linkedPath = path.resolve(link.predecessorPath)
          assert.equal(path.dirname(linkedPath), output)
          const raw = fs.readFileSync(linkedPath), sha256 = createHash('sha256').update(raw).digest('hex')
          assert.equal(sha256, link.predecessorSha256, 'Budget retry predecessor report changed')
          assert.ok(!chain.some(item => item.sha256 === sha256), 'Cyclic budget retry lineage')
          const value = JSON.parse(raw)
          assert.equal(value.result, 'failed'); assert.ok(value.finishedAt)
          assert.equal(value.case, caseId); assert.equal(value.mode, 'round-4')
          assert.equal(value.tripId, entry.tripId); assert.equal(value.conversationId, entry.conversationId)
          assert.equal(value.message, specifications[caseId][3]); assert.equal(value.postCount, 1)
          chain.push({ value, path: linkedPath, sha256 })
        }
        budgetRetryOrigin = chain.at(-1).value
        for (const [index, item] of chain.entries()) {
          if (retryBudgetConfirm && (index === 0 || item.value.budgetConfirm || item.value.terminal?.response?.delivery?.status === 'partial' && item.value.authoritativeAfter?.guide?.payload?.publication?.status === 'accepted')) assertBudgetConfirmCandidate(item.value, budgetNotesEquivalent, budgetRetryOrigin)
          else assertBudgetRetryCandidate(item.value, budgetNotesEquivalent, budgetRetryOrigin)
        }
        const evidence = { ...(retryBudgetConfirm ? assertBudgetConfirmCandidate(predecessor, budgetNotesEquivalent, budgetRetryOrigin) : assertBudgetRetryCandidate(predecessor, budgetNotesEquivalent, budgetRetryOrigin)),
          originReportPath: chain.at(-1).path, originReportSha256: chain.at(-1).sha256, retainedAttempts: chain.length }
        if (retryBudgetConfirm) report.budgetConfirm = evidence
        else report.budgetRetry = evidence
      }
      else if (!isBContextOnlyModelFailure(predecessor)) assert.notEqual(priorTurn.response?.delivery?.status, 'satisfied', 'Previous turn already satisfied delivery')
      if (round === 1) assert.notEqual(predecessor.authoritativeAfter?.guide?.payload?.publication?.status, 'accepted', 'Previous attempt already had an accepted guide')
      else if (!budgetRecovery) {
        acceptedGuide(predecessor.authoritativeBefore)
        assert.deepEqual(predecessor.authoritativeAfter.guide, predecessor.authoritativeBefore.guide, 'Failed follow-up changed the accepted base; do not replay')
        assert.deepEqual(predecessor.authoritativeAfter.workspace.trip, predecessor.authoritativeBefore.workspace.trip, 'Failed follow-up changed Trip')
      }
      const predecessorRunId = path.basename(predecessorPath, '.json')
      const oldSuffix = predecessor.retryTerminal ? `.retry-terminal-${predecessor.retryTerminal.predecessorSha256.slice(0, 16)}`
        : predecessor.retryBeforeTurn ? `.retry-before-turn-${predecessor.retryBeforeTurn.predecessorSha256.slice(0, 16)}` : ''
      const predecessorAttemptPath = path.join(directory, `h5-${caseId}-round-${round}${oldSuffix}.attempt.private.json`)
      const priorAttempt = JSON.parse(fs.readFileSync(predecessorAttemptPath, 'utf8'))
      assert.equal(priorAttempt.runId, predecessorRunId, 'Predecessor attempt lineage mismatch')
      assert.equal(priorAttempt.tripId, entry.tripId); assert.equal(priorAttempt.message, specifications[caseId][round - 1])
      const endpoint = `/v1/agent/turns/${encodeURIComponent(priorTurn.turnId)}`
      const response = await fetch(`${transport.baseUrl}${endpoint}`, { headers: { Authorization: `Bearer ${entry.token}` }, signal: AbortSignal.timeout(15000) })
      let currentTurn, restartProof
      if (response.status === 404 && restartEvidence) {
        const proof = JSON.parse(fs.readFileSync(path.resolve(restartEvidence), 'utf8'))
        assert.equal(proof.predecessorReportSha256, createHash('sha256').update(predecessorRaw).digest('hex'))
        assert.equal(proof.turnId, priorTurn.turnId)
        assert.equal(proof.previousProcessConfirmedExited, true); assert.equal(proof.previousLockConfirmedAbsent, true)
        assert.ok(Number.isInteger(proof.previousPid) && proof.previousPid > 0 && proof.previousPid !== process.pid)
        let exited = false
        try { process.kill(proof.previousPid, 0) } catch (error) { if (error.code === 'ESRCH') exited = true; else throw error }
        assert.ok(exited, 'Previous backend process is still alive; retry forbidden')
        assert.ok(Date.parse(proof.checkedAt) >= Date.parse(predecessor.finishedAt) && Date.parse(proof.checkedAt) <= Date.parse(report.startedAt), 'Restart proof is stale or future-dated')
        assert.equal(priorTurn.status, 'completed')
        const incompleteResult = `${priorTurn.response?.delivery?.status}/${priorTurn.response?.stopReason}`
        assert.ok(['not_requested/model_failure', 'partial/goal_partial', ...(round > 1 ? ['not_requested/responded'] : []), ...(retryBudgetUpdate ? ['satisfied/completed'] : [])].includes(incompleteResult)
          || isBUnpublishedModelFailure(predecessor) || isBContextOnlyModelFailure(predecessor) || Boolean(commitConflictProof), 'Restart recovery requires the diagnosed terminal result')
        assert.ok(predecessor.authoritativeAfter?.workspace, 'Missing prior durable completion snapshot')
        restartProof = { path: path.resolve(restartEvidence), ...proof, oldTurnGetStatus: 404 }
      } else {
        assert.equal(response.status, 200, 'Prior turn cannot be verified through formal GET; do not resubmit')
        currentTurn = await response.json()
        assert.equal(currentTurn.turnId, priorTurn.turnId); assert.equal(currentTurn.tripId, entry.tripId); assert.equal(currentTurn.conversationId, entry.conversationId)
        assert.equal(currentTurn.generationId, priorTurn.generationId); assert.equal(currentTurn.status, priorTurn.status, 'Prior turn status changed')
        assert.ok(['completed', 'failed', 'cancelled'].includes(currentTurn.status), 'Prior request remains active')
        if (budgetRecovery) {
          assert.deepEqual(currentTurn.response?.delivery, priorTurn.response?.delivery)
          assert.equal(currentTurn.response?.stopReason, priorTurn.response?.stopReason)
          assert.deepEqual(currentTurn.response?.warnings, priorTurn.response?.warnings)
          assert.deepEqual(currentTurn.artifactRefs, priorTurn.artifactRefs, 'Prior budget turn gained artifacts')
        } else if (commitConflictProof) {
          assert.ok(isBCommitIdempotencyFailure({ ...predecessor, terminal: currentTurn }), 'Prior B turn is no longer the same commit conflict')
          assert.deepEqual(currentTurn.response, priorTurn.response, 'Prior commit conflict response changed')
        } else if (isBContextOnlyModelFailure(predecessor)) {
          assert.ok(isBContextOnlyModelFailure({ ...predecessor, terminal: currentTurn }), 'Prior B turn is no longer the same context-only failure')
          assert.deepEqual(currentTurn.response.delivery, priorTurn.response.delivery, 'Prior B context delivery changed')
        } else assert.notEqual(currentTurn.response?.delivery?.status, 'satisfied', 'Prior turn satisfied delivery after the failed report')
      }
      report.retryTerminal = { predecessorPath, predecessorRunId, predecessorAttemptPath, predecessorSha256: createHash('sha256').update(predecessorRaw).digest('hex'),
        ...(commitConflictProof ? { commitConflictProof } : {}),
        verifiedBy: restartProof ? 'confirmed backend restart plus pending durable completion check' : 'real formal turn GET', path: endpoint, checkedAt: new Date().toISOString(),
        ...(currentTurn ? { turn: currentTurn } : { restartProof }) }
    }
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
    if (hydrateExisting) {
      assert.equal(history?.version, 1, 'Unsupported saved history')
      assert.ok(Array.isArray(history.sessions), 'Saved history is incomplete')
      assert.ok(history.sessions.every(item => item.ownerId === entry.user.publicId && item.tripId === entry.tripId && item.conversationId === entry.conversationId), 'Never replace unrelated local conversations')
      const endpoint = `/v1/trips/${encodeURIComponent(entry.tripId)}/workspace?conversationId=${encodeURIComponent(entry.conversationId)}&locale=zh`
      const response = await fetch(`${transport.baseUrl}${endpoint}`, { headers: { Authorization: `Bearer ${entry.token}` }, signal: AbortSignal.timeout(15000) })
      assert.equal(response.status, 200, 'Existing setup workspace GET failed')
      const workspace = await response.json()
      assert.equal(workspace.trip?.id, entry.tripId); assert.equal(workspace.conversationId, entry.conversationId)
      assert.deepEqual(workspace.artifactRefs, [], 'Bootstrap recovery must not contain artifacts')
      assert.ok(!workspace.routeGeneration, 'Bootstrap recovery must not contain route generation')
      assert.equal(workspace.messages?.length, 2, 'Only the single real setup turn may be hydrated')
      const [user, assistant] = workspace.messages
      assert.equal(user.role, 'user'); assert.equal(assistant.role, 'assistant')
      assert.equal(user.content, '请用一句中文告诉我当前行程的目的地和出行日期。只读取现有设置，不修改、不搜索、不保存攻略。', 'Workspace contains another user request; do not replay planning')
      assert.ok(user.id && assistant.id && assistant.content?.trim(), 'Setup turn is not completed')
      assert.deepEqual(assistant.artifactRefs || [], [], 'Setup must not save artifacts')
      const backup = `${statePath}.before-real-setup-hydrate-${timestamp}`
      fs.copyFileSync(statePath, backup, fs.constants.COPYFILE_EXCL)
      // Mirror ChatStore.openCloudWorkspace's real-message projection. No
      // generated guide, assistant text, delivery or cloud state is fabricated.
      const seedHistory = JSON.parse(initialState().origins[0].localStorage.find(item => item.name === historyKey).value).data
      currentSession = seedHistory.sessions[0]
      currentSession.messages = workspace.messages.map(message => ({ role: message.role, content: message.content }))
      currentSession.timeline = [{ id: user.id, user: currentSession.messages[0], assistant: currentSession.messages[1], recommendations: [], suggestedActions: [], routes: [],
        warnings: assistant.warnings || [], artifactRefs: assistant.artifactRefs || [], ...(assistant.delivery ? { delivery: assistant.delivery } : {}), ...(assistant.stopReason ? { stopReason: assistant.stopReason } : {}) }]
      currentSession.tripContextSummary = workspace.tripContextSummary
      savedOrigin.localStorage = savedOrigin.localStorage.filter(item => item.name !== historyKey)
      savedOrigin.localStorage.push({ name: historyKey, value: JSON.stringify({ data: seedHistory }) })
      report.realSetupHydration = { originalStateBackup: backup, path: endpoint, source: 'real formal workspace GET', setupUserMessageId: user.id, setupAssistantMessageId: assistant.id, cloudMessages: 2, cloudArtifacts: 0 }
    }
    if (!currentSession && !reopenTrip && !restore && !localize && (!execute || round === 1)) {
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
    if (currentSession || !reopenTrip) {
      assert.equal(currentSession?.tripId, entry.tripId, 'Saved browser current Trip differs')
      assert.equal(currentSession?.conversationId, entry.conversationId, 'Saved browser current conversation differs')
    }
    savedOrigin.localStorage = savedOrigin.localStorage.filter(item => item.name !== 'access_token')
    savedOrigin.localStorage.push({ name: 'access_token', value: JSON.stringify({ data: entry.token }) })
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, storageState })
    page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.browserErrors.push(sanitize(error.message)))
    if (media) {
      report.mediaImageNetwork = []
      page.on('requestfailed', request => { if (request.resourceType() === 'image') report.mediaImageNetwork.push({ atMs: now(),
        type: 'failed', url: request.url().split('?')[0], error: request.failure()?.errorText }) })
      page.on('response', response => { if (response.request().resourceType() === 'image') report.mediaImageNetwork.push({ atMs: now(),
        type: 'response', url: response.url().split('?')[0], status: response.status() }) })
    }
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
    const enterThroughTrips = reopenTrip && !restore
    await page.goto(`${baseUrl}/#/pages/${enterThroughTrips ? 'trips' : 'plan'}/index`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.locator('.production-main-page').waitFor()
    if (enterThroughTrips) {
      // Fetch existing scope only to identify its real rendered card. The click
      // invokes production openCloudWorkspace; do not inject chat history.
      const response = await fetch(`${transport.baseUrl}/v1/trips/${encodeURIComponent(entry.tripId)}/workspace?conversationId=${encodeURIComponent(entry.conversationId)}&locale=zh`,
        { headers: { Authorization: `Bearer ${entry.token}` }, signal: AbortSignal.timeout(15000) })
      assert.equal(response.status, 200)
      const workspace = await response.json()
      assert.equal(workspace.trip?.id, entry.tripId); assert.equal(workspace.conversationId, entry.conversationId)
      const title = workspace.trip.title
      assert.ok(title?.trim(), 'Existing Trip needs an unambiguous title')
      await page.locator('.trips-production .lb-cloud-trip').first().waitFor()
      const cards = page.locator('.lb-cloud-trip'), card = cards.filter({ has: page.getByText(title, { exact: true }) })
      report.reopenTrip = { title, observedTitles: await cards.locator('.lb-cloud-open .ui-display').allInnerTexts(), path: '/pages/trips/index', mode: 'existing Trip entry' }
      assert.equal(await card.count(), 1, 'Existing Trip card is missing or ambiguous')
      const shot = path.join(output, `${runId}-existing-trip-entry.png`)
      await page.screenshot({ path: shot, fullPage: true }); report.screenshots.push(shot)
      await card.getByText('继续安排', { exact: true }).click()
      await page.waitForURL(/#\/pages\/plan\/index/)
    }
    for (let i = 0; !workspaceSeen && i < 60; i++) await page.waitForTimeout(250)
    assert.ok(workspaceSeen, 'No successful real workspace GET observed from H5')
    if (enterThroughTrips) {
      assert.equal(report.workspaceBefore?.trip?.id, entry.tripId); assert.equal(report.workspaceBefore?.conversationId, entry.conversationId)
      assert.equal(report.events.filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method)).length, 0, 'Existing Trip entry created a new conversation or another mutation')
    }
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
      // Public workspace references use chronological order, matching the
      // unchanged production UI's last-wins guide selection.
      const ref = [...workspace.artifactRefs].reverse().find(item => item.type === 'travel_guide')
      const guide = ref ? (await readApi(`/v1/artifacts/${encodeURIComponent(ref.id)}?locale=zh`)).artifact : undefined
      const route = guide?.payload?.routeArtifactId ? (await readApi(`/v1/artifacts/${encodeURIComponent(guide.payload.routeArtifactId)}?locale=zh`)).artifact : undefined
      const flight = workspace.trip.selectedFlight ? (await readApi(`/v1/artifacts/${encodeURIComponent(workspace.trip.selectedFlight.artifactId)}?locale=zh`)).artifact : undefined
      return { workspace, ...(guide ? { guide } : {}), ...(route ? { route } : {}), ...(flight ? { flight } : {}) }
    }
    report.authoritativeBefore = await authoritative()
    if (localizeNewVersionAfter) {
      const predecessorPath = path.resolve(localizeNewVersionAfter)
      assert.equal(path.dirname(predecessorPath), output, 'Localization predecessor must remain in this batch')
      const raw = fs.readFileSync(predecessorPath), predecessor = JSON.parse(raw)
      assert.equal(predecessor.case, caseId)
      const predecessorAttemptPath = path.join(directory, `h5-${caseId}-localize.attempt.private.json`)
      const originalAttempt = JSON.parse(fs.readFileSync(predecessorAttemptPath, 'utf8'))
      assert.equal(originalAttempt.runId, path.basename(predecessorPath, '.json'), 'Original localization attempt differs')
      assert.equal(originalAttempt.tripId, entry.tripId)
      const english = (await readApi(`/v1/artifacts/${encodeURIComponent(report.authoritativeBefore.guide?.id)}?locale=en`)).artifact
      report.newVersionLocalization = { ...assertNewVersionLocalization(predecessor, report.authoritativeBefore, english),
        predecessorPath, predecessorSha256: createHash('sha256').update(raw).digest('hex'), predecessorAttemptPath }
    }
    if (report.renderRecovery) {
      const guide = acceptedGuide(report.authoritativeBefore)
      assert.equal(guide.id, report.renderRecovery.guideId, 'UI recovery selected a different accepted guide')
      assert.equal(guide.payload.publication.guideContentHash, report.renderRecovery.guideContentHash, 'UI recovery changed the accepted content')
    }
    if (retryTerminal) {
      if (report.retryTerminal.restartProof) {
        const previousWorkspace = retryTerminalPredecessor.authoritativeAfter.workspace, currentWorkspace = report.authoritativeBefore.workspace
        if (round === 1 || budgetRecovery) assert.deepEqual(currentWorkspace.messages, previousWorkspace.messages, 'Cloud messages changed since the failed terminal report')
        else {
          assert.deepEqual(currentWorkspace.messages.slice(0, previousWorkspace.messages.length), previousWorkspace.messages, 'Follow-up recovery rewrote prior history')
          const appended = currentWorkspace.messages.slice(previousWorkspace.messages.length)
          assert.equal(appended.length % 2, 0, 'Incomplete intervening turn')
          for (let i = 0; i < appended.length; i += 2) {
            assert.equal(appended[i].role, 'user')
            const answer = appended[i + 1]
            assert.equal(answer.role, 'assistant')
            assert.equal(answer.stopReason, 'responded')
            assert.equal(answer.delivery?.status, 'not_requested')
            assert.deepEqual(answer.artifactRefs, [])
          }
        }
        assert.deepEqual(currentWorkspace.artifactRefs, previousWorkspace.artifactRefs, 'Cloud artifacts changed since the failed terminal report')
        assert.deepEqual(currentWorkspace.trip, previousWorkspace.trip, 'Cloud Trip changed since the failed terminal report')
        const pair = (round > 1 ? previousWorkspace : currentWorkspace).messages.slice(-2)
        assert.equal(pair[0]?.role, 'user'); assert.equal(pair[0]?.content, specifications[caseId][round - 1])
        const previousAssistant = previousWorkspace.messages.at(-1)
        assert.equal(pair[1]?.role, 'assistant'); assert.equal(previousAssistant?.role, 'assistant')
        // Conversation persistence and the public final response can use
        // different safe projections for an incomplete delivery. Restore the
        // exact persisted message rather than treating response.reply as it.
        assert.equal(pair[1]?.id, previousAssistant.id); assert.equal(pair[1]?.content, previousAssistant.content)
        assert.ok(pair.every(message => message.id), 'Durable completion messages lack identities')
        report.retryTerminal.verifiedBy = 'formal GET404 after confirmed exited backend; unchanged persisted completion from fresh workspace GET'
      }
      const guideRefs = report.authoritativeBefore.workspace.artifactRefs.filter(item => item.type === 'travel_guide')
      for (const ref of guideRefs) {
        const guide = (await readApi(`/v1/artifacts/${encodeURIComponent(ref.id)}?locale=zh`)).artifact
        if (round === 1) assert.notEqual(guide?.payload?.publication?.status, 'accepted', 'An accepted guide already exists; terminal retry forbidden')
      }
      if (round > 1) {
        if (retryBudgetConfirm) assertStableBudgetConfirmationBase(retryTerminalPredecessor.authoritativeAfter, report.authoritativeBefore)
        else assert.deepEqual(report.authoritativeBefore.guide, retryTerminalPredecessor.authoritativeAfter.guide, 'Retry base guide changed')
        assert.deepEqual(report.authoritativeBefore.workspace.trip, retryTerminalPredecessor.authoritativeAfter.workspace.trip, 'Retry Trip changed')
      }
      report.retryTerminal.workspaceCheckedAt = new Date().toISOString()
      report.retryTerminal.guideIdsChecked = guideRefs.map(ref => ref.id)
      if (caseId === 'B' && round === 1) {
        for (const key of ['trip', 'tripContextSummary', 'messages', 'artifactRefs']) assert.deepEqual(report.authoritativeBefore.workspace[key], retryTerminalPredecessor.authoritativeAfter.workspace[key], `Adopted-flight retry changed ${key}`)
        assert.deepEqual(report.authoritativeBefore.flight, retryTerminalPredecessor.authoritativeAfter.flight, 'Adopted-flight retry changed flight segments')
      }
    }
    if (retryBudgetUpdate) {
      assert.deepEqual(report.authoritativeBefore, retryTerminalPredecessor.authoritativeAfter, 'Budget recovery base changed since the failed report')
      assertBudgetRetryCandidate(retryTerminalPredecessor, budgetNotesEquivalent, budgetRetryOrigin)
    }
    if (execute && (localize || media || round > 1 && !retryBudgetUpdate) || restore) acceptedGuide(report.authoritativeBefore)
    report.timings.readyMs = now()
    const screenshot = async label => { const file = path.join(output, `${runId}-${label}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file) }
    const inspectRestoredPlanner = async () => {
      if (report.authoritativeBefore.guide) await page.locator('.pl-result').first().waitFor({ state: 'visible', timeout: 30000 })
      const assistant = [...report.authoritativeBefore.workspace.messages].reverse().find(message => message.role === 'assistant')
      if (!assistant) return
      const reply = page.locator('.pl-reply-copy')
      await reply.waitFor({ state: 'visible', timeout: 30000 })
      if (assistant.stopReason === 'completed' && assistant.delivery?.status === 'satisfied' && assistant.delivery.kind === 'trip_context_update') {
        for (const deadline = performance.now() + 15000; normalizePlannerReply(await reply.innerText()) !== normalizePlannerReply(assistant.content) && performance.now() < deadline;) await page.waitForTimeout(200)
      }
      report.restoredPlannerReply = await reply.innerText()
      report.restoredPlannerReplyAssertions = assertRestoredPlannerReply(report.authoritativeBefore, report.restoredPlannerReply)
      report.timings.restoredPlannerReplyVisibleMs = now()
      await screenshot('restored-planner-reply')
    }
    const inspectGuide = async label => {
      await page.locator('.ux-publication-state--accepted').waitFor()
      await page.locator('.ux-trip-overview').waitFor()
      report.timings.guideVisibleMs ??= now()
      report.timings.guideVisibleEpochMs ??= Date.now()
      const content = { overview: await page.locator('.ux-published').innerText(),
        summary: await page.locator('.ux-trip-overview').innerText(), days: [], details: [], activities: [] }
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
    if (enterThroughTrips && !execute) await inspectRestoredPlanner()
    await screenshot('before')

    if (restore || localize || media) {
      if (reopenTrip && !enterThroughTrips) {
        await page.goto(`${baseUrl}/#/pages/trips/index`, { waitUntil: 'domcontentloaded' })
        await page.locator('.trips-production .lb-cloud-trip').first().waitFor()
        const title = report.authoritativeBefore.workspace.trip.title
        assert.ok(title?.trim(), 'Trip needs an unambiguous title for the real UI selector')
        const cards = page.locator('.lb-cloud-trip'), card = cards.filter({ has: page.getByText(title, { exact: true }) })
        report.reopenTrip = { title, observedTitles: await cards.locator('.lb-cloud-open .ui-display').allInnerTexts(), path: '/pages/trips/index' }
        assert.equal(await card.count(), 1, 'Trip title is ambiguous in the rendered My trips list')
        await screenshot('my-trips-before-reopen')
        const priorEventCount = report.events.length
        await card.getByText('继续安排', { exact: true }).click()
        await page.waitForURL(/#\/pages\/plan\/index/)
        for (let i = 0; i < 60 && !report.events.slice(priorEventCount).some(event => event.type === 'response' && event.path === `/v1/trips/${entry.tripId}/workspace` && event.status === 200); i++) await page.waitForTimeout(250)
        const reopened = report.events.slice(priorEventCount).find(event => event.type === 'response' && event.path === `/v1/trips/${entry.tripId}/workspace` && event.status === 200)
        assert.ok(reopened, 'My trips did not reopen the original Trip through formal API')
        assert.equal(reopened.body?.conversationId, entry.conversationId, 'My trips opened another conversation')
        assert.deepEqual(reopened.body.messages, report.authoritativeBefore.workspace.messages, 'Reopened Conversation changed since authoritative GET')
        report.reopenTrip.verifiedAtMs = now()
      }
      if (restore || media) await inspectRestoredPlanner()
      await page.locator('.pl-result').first().click()
      await page.locator('.ux-published').waitFor()
      report.beforeRefreshText = await page.locator('body').innerText()
      if (media) {
        const guideId = report.authoritativeBefore.guide.id, endpoint = `/v1/artifacts/${guideId}/media`
        report.mediaBefore = await readApi(endpoint)
        const imageState = () => page.locator('.ux-photo img, img.ux-photo').evaluateAll(images => images.map(image => ({ src: image.currentSrc || image.src,
          complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })))
        report.imagesBefore = await imageState()
        await page.locator('.ux-prepare-media').waitFor({ state: 'visible' })
        await screenshot('media-before')
        report.timings.mediaClickedMs = now()
        const mediaResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint, { timeout: 40000 })
        await page.locator('.ux-prepare-media').click()
        const response = await mediaResponse
        report.mediaResponse = { status: response.status(), body: await response.json() }
        report.timings.mediaResponseMs = now()
        await page.waitForFunction(() => { const button = document.querySelector('.ux-prepare-media'); return !!button && !button.textContent?.includes('加载') }, { timeout: 10000 })
        await page.waitForTimeout(1000)
        report.mediaAfter = await readApi(endpoint)
        report.imagesAfter = await imageState()
        report.mediaVisibleText = await page.locator('.ux-media-actions').innerText()
        report.authoritativeAfter = await authoritative()
        assert.deepEqual(report.authoritativeAfter, report.authoritativeBefore, 'Media action changed Trip/guide/route/flight')
        const mutations = report.events.filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method))
        assert.equal(mutations.length, 1, 'Media diagnosis made extra mutations')
        assert.equal(mutations[0].method, 'POST'); assert.equal(mutations[0].path, endpoint)
        assert.equal(postCount, 0); assert.deepEqual(budgetSnapshot(), report.budgetBefore, 'Media diagnosis started a paid model/search call')
        report.mediaDiagnosis = { outcome: response.ok() ? 'response_success_image_results_recorded' : 'endpoint_rejected', mutations: 1, agentTurns: 0, modelCalls: 0, searchCalls: 0 }
        await screenshot('media-after')
      } else if (localize) {
        const openedArtifactId = new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '').get('artifactId')
        assert.equal(openedArtifactId, report.authoritativeBefore.guide.id, 'Localization UI opened a different guide artifact')
        report.chineseGuideBeforeLocalization = await inspectGuide('chinese-before-localization')
        await page.locator('.ux-locale-toggle').filter({ hasText: 'English' }).click()
        await page.locator('.ux-prepare-locale').waitFor()
        const versionSuffix = report.newVersionLocalization ? `.guide-${createHash('sha256').update(report.authoritativeBefore.guide.id).digest('hex').slice(0, 24)}` : ''
        attemptPath = path.join(directory, `h5-${caseId}-localize${versionSuffix}.attempt.private.json`)
        fs.writeFileSync(attemptPath, JSON.stringify({ runId, startedAt: report.startedAt, tripId: entry.tripId, guideId: report.authoritativeBefore.guide.id,
          ...(report.newVersionLocalization ? { predecessor: report.newVersionLocalization } : {}) }), { flag: 'wx', mode: 0o600 })
        report.attemptPath = attemptPath
        report.timings.clickedMs = now(); await page.locator('.ux-prepare-locale').click()
        for (const deadline = performance.now() + timeoutMs; !localizationResponse && performance.now() < deadline;) await page.waitForTimeout(250)
        assert.ok(localizationResponse, 'Localization response not observed; no retry made')
        assert.ok(localizationResponse.status < 400, 'Localization request failed; retained without retry')
        await page.locator('.ux-publication-state--accepted').waitFor({ timeout: 15000 })
        report.localizedGuide = await inspectGuide('english')
        report.authoritativeAfter = await authoritative()
        const english = (await readApi(`/v1/artifacts/${encodeURIComponent(report.authoritativeBefore.guide.id)}?locale=en`)).artifact
        report.publicBudgetProseAssertions = assertPublicBudgetProse(english, publicProseProblems, [report.localizedGuide.summary])
        report.localizationAssertions = assertLocalization(report.authoritativeBefore, report.authoritativeAfter, english,
          report.budgetBefore, budgetSnapshot(), report.events)
        // The existing locale toggle must restore the accepted Chinese variant
        // without another localization POST, main turn or paid request.
        chineseRestoreBoundary = { eventIndex: report.events.length, budget: budgetSnapshot() }
        report.timings.chineseRestoreClickedMs = now()
        await page.locator('.ux-locale-toggle').filter({ hasText: '中文' }).click()
        await page.locator('.ux-locale-toggle').filter({ hasText: 'English' }).waitFor()
        report.chineseGuideRestored = await inspectGuide('chinese-restored')
        report.timings.chineseRestoredMs = now()
        assert.equal(report.chineseGuideRestored.summary, report.chineseGuideBeforeLocalization.summary, 'Chinese restoration changed the original overview')
        assert.deepEqual(report.chineseGuideRestored.activities, report.chineseGuideBeforeLocalization.activities, 'Chinese restoration changed activity identities/order/times/names')
        assert.deepEqual(report.chineseGuideRestored.details.map(item => item.prose), report.chineseGuideBeforeLocalization.details.map(item => item.prose), 'Chinese restoration changed introductions/recommendation reasons')
        report.authoritativeAfterChineseRestore = await authoritative()
        assert.deepEqual(report.authoritativeAfterChineseRestore, report.authoritativeAfter, 'Chinese restoration changed the accepted guide/Trip/route/flight')
        assert.equal(acceptedGuide(report.authoritativeAfterChineseRestore).payload.publication.locale, 'zh', 'Restored accepted publication is not Chinese')
        report.chineseRestoreAssertions = { sameGuide: true, sameChineseOverviewAndActivities: true, mutations: 0, modelCalls: 0, searchCalls: 0 }
      } else {
        report.guideBeforeRefresh = await inspectGuide('before-refresh')
        if (report.renderRecovery) report.timings.originalClickToRecoveredGuideMs = report.timings.guideVisibleEpochMs - report.renderRecovery.originalClickEpochMs
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('.ux-published').waitFor()
        report.afterRefreshText = await page.locator('body').innerText()
        report.guideAfterRefresh = await inspectGuide('after-refresh')
        assert.deepEqual(report.guideAfterRefresh.activities, report.guideBeforeRefresh.activities, 'Refresh changed activity identities/order/times')
        assert.deepEqual(report.guideAfterRefresh.details.map(item => item.prose), report.guideBeforeRefresh.details.map(item => item.prose), 'Refresh changed published prose')
        report.authoritativeAfter = await authoritative()
        assert.deepEqual(report.authoritativeAfter, report.authoritativeBefore, 'Restore changed authoritative Trip/guide/route/flight')
        if (restoreLanguages) {
          const guide = acceptedGuide(report.authoritativeBefore)
          const english = (await readApi(`/v1/artifacts/${encodeURIComponent(guide.id)}?locale=en`)).artifact
          assertAcceptedEnglish(guide, english)
          report.existingEnglishPublication = { guideId: english.id, locale: english.payload.publication.locale,
            status: english.payload.publication.status, guideContentHash: english.payload.publication.guideContentHash }
          report.timings.existingEnglishClickedMs = now()
          await page.locator('.ux-locale-toggle').filter({ hasText: 'English' }).click()
          await page.locator('.ux-locale-toggle').filter({ hasText: '中文' }).waitFor()
          await page.locator('.ux-publication-state--accepted').waitFor({ timeout: 15000 })
          assert.equal(await page.locator('.ux-prepare-locale').count(), 0, 'Existing English requested generation; never click generate in restore mode')
          report.existingEnglishGuide = await inspectGuide('existing-english')
          const identities = view => view.activities.map(({ day, activityId }) => ({ day, activityId }))
          assert.deepEqual(identities(report.existingEnglishGuide), identities(report.guideAfterRefresh), 'English display changed activity identity/order')
          assert.notEqual(report.existingEnglishGuide.summary, report.guideAfterRefresh.summary, 'English toggle retained Chinese overview')
          report.timings.chineseRestoreClickedMs = now()
          await page.locator('.ux-locale-toggle').filter({ hasText: '中文' }).click()
          await page.locator('.ux-locale-toggle').filter({ hasText: 'English' }).waitFor()
          report.chineseGuideRestored = await inspectGuide('existing-chinese-restored')
          assert.equal(report.chineseGuideRestored.summary, report.guideAfterRefresh.summary, 'Chinese restoration changed overview')
          assert.deepEqual(report.chineseGuideRestored.activities, report.guideAfterRefresh.activities, 'Chinese restoration changed activity identity/order/time/name')
          assert.deepEqual(report.chineseGuideRestored.details.map(item => item.prose), report.guideAfterRefresh.details.map(item => item.prose), 'Chinese restoration changed introduction/recommendation')
          report.authoritativeAfterChineseRestore = await authoritative()
          assert.deepEqual(report.authoritativeAfterChineseRestore, report.authoritativeBefore, 'Stored language restoration changed Trip/guide/route/flight')
          report.timings.chineseRestoredMs = now()
          report.storedLanguageRestoreAssertions = { sameGuide: true, acceptedEnglish: true, sameChineseOverviewAndActivities: true, mutations: 0, modelCalls: 0, searchCalls: 0 }
        }
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
        const predecessor = report.retryTerminal || report.retryBeforeTurn
        const retrySuffix = predecessor ? `.retry-${report.retryTerminal ? 'terminal' : 'before-turn'}-${predecessor.predecessorSha256.slice(0, 16)}` : ''
        attemptPath = path.join(directory, `h5-${caseId}-round-${round}${retrySuffix}.attempt.private.json`)
        fs.writeFileSync(attemptPath, JSON.stringify({ runId, startedAt: report.startedAt, tripId: entry.tripId, message: report.message, ...(predecessor ? { predecessor } : {}) }), { flag: 'wx', mode: 0o600 })
        report.attemptPath = attemptPath
        report.timings.clickedMs = now(); write()
        await page.locator('.pl-submit').click()
        for (const deadline = performance.now() + timeoutMs; performance.now() < deadline;) {
          if (report.timings.firstVisibleProgressMs === undefined && await page.locator('.pl-generating').isVisible()) report.timings.firstVisibleProgressMs = now()
          if (report.timings.firstVisibleResultCardMs === undefined && await page.locator('.pl-result').first().isVisible()) report.timings.firstVisibleResultCardMs = now()
          if (accepted?.status >= 400) throw Error(`TURN_POST_HTTP_${accepted.status}`)
          const bootstrapFailure = report.events.find(event => event.type === 'response' && event.method === 'POST' && event.path === '/v1/trips' && event.status >= 400)
          if (bootstrapFailure) throw Error(`SESSION_BOOTSTRAP_HTTP_${bootstrapFailure.status}`)
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
          if (caseId === 'B') report.flightAssertions = assertAdoptedFlight(report.authoritativeBefore, report.authoritativeAfter)
          if (round === 3) report.patchAssertions = assertPatch(report.authoritativeBefore, report.authoritativeAfter)
          await page.locator('.pl-result').first().click()
          report.guide = await inspectGuide('accepted-guide')
          report.publicBudgetProseAssertions = assertPublicBudgetProse(report.authoritativeAfter.guide, publicProseProblems,
            [terminal.body.response?.reply, report.guide.summary])
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
          report.budgetAssertions = assertTotalBudget(budgetRecovery ? budgetRetryOrigin.authoritativeBefore : report.authoritativeBefore, report.authoritativeAfter, budgetNotesEquivalent)
          acceptedGuide(report.authoritativeAfter)
          assert.ok(['satisfied', 'not_requested'].includes(terminal.body.response?.delivery?.status), 'Budget confirmation remains incomplete')
          report.budgetReply = await page.locator('.pl-reply-copy').innerText()
          report.publicBudgetProseAssertions = assertPublicBudgetProse(report.authoritativeAfter.guide, publicProseProblems, [report.budgetReply])
          report.budgetConfirmation = assertBudgetConfirmationResult({ before: report.authoritativeBefore, after: report.authoritativeAfter,
            terminal: terminal.body, reply: report.budgetReply, searchesBefore: report.budgetBefore.searchCalls, searchesAfter: budgetSnapshot().searchCalls })
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
      if (report.result === 'observed' && media) {
        assert.deepEqual(report.budgetAfter, report.budgetBefore, 'Late media activity changed model/search accounting')
        const mutations = report.events.filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method))
        assert.equal(mutations.length, 1); assert.equal(mutations[0].path, `/v1/artifacts/${report.authoritativeBefore.guide.id}/media`)
        assert.equal(postCount, 0, 'Media diagnosis started an Agent turn')
      }
      if (report.result === 'observed' && chineseRestoreBoundary) {
        assert.deepEqual(report.budgetAfter, chineseRestoreBoundary.budget, 'Chinese restoration started paid model/search activity')
        assert.equal(report.events.slice(chineseRestoreBoundary.eventIndex).filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method)).length, 0, 'Chinese restoration made an API mutation')
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
