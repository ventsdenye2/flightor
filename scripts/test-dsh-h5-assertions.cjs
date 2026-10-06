const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { assertPatch, assertTotalBudget, assertLocalization, assertEmptySeedRecovery, assertAdoptedFlight, assertBudgetRetryCandidate, assertBudgetConfirmCandidate, assertStableBudgetConfirmationBase, assertBudgetConfirmationResult, isBUnpublishedModelFailure, isBContextOnlyModelFailure, isBCommitIdempotencyFailure, assertBCommitIdempotencyObserver, assertRestoredPlannerReply, assertNewVersionLocalization, assertAcceptedEnglish, assertPublicBudgetProse, assertGuideTurnTransition, guideTurnTransitionRequirement, assertStopCancellation } = require('./dsh-h5-assertions.cjs')
test('stop requires accepted cancel request, cancellation terminal, and visible stopped UI', () => {
  const input = { cancelRequestCount: 1, cancelResponse: { status: 200, body: { status: 'failed', error: { code: 'AGENT_TURN_CANCELLED' } } },
    terminalReadbacks: [], stoppedUiVisible: true, busyUiVisible: false }
  assert.deepEqual(assertStopCancellation(input), { apiStatus: 'failed', errorCode: 'AGENT_TURN_CANCELLED', cancellationConfirmed: true, terminalSource: 'cancel-response' })
  assert.equal(assertStopCancellation({ ...input, terminalReadbacks: [{ status: 'failed', error: { code: 'AGENT_TURN_CANCELLED' } }] }).terminalSource, 'ui-poll-readback')
  for (const mutate of [
    next => { next.cancelRequestCount = 0 },
    next => { next.cancelResponse.status = 500 },
    next => { next.cancelResponse.body.status = 'completed' },
    next => { next.cancelResponse.body.error.code = 'OTHER_FAILURE' },
    next => { next.terminalReadbacks = [{ status: 'completed' }] },
    next => { next.stoppedUiVisible = false },
    next => { next.busyUiVisible = true },
  ]) { const invalid = structuredClone(input); mutate(invalid); assert.throws(() => assertStopCancellation(invalid)) }
})
test('empty harness seed recovery rejects real or mismatched browser/cloud conversations', () => {
  const entry = { tripId: 'trip', conversationId: 'conversation' }
  const history = { version: 1, currentSessionId: 'cloud-conversation', sessions: [] }
  const workspace = { trip: { id: 'trip' }, conversationId: 'conversation', messages: [], artifactRefs: [] }
  assert.doesNotThrow(() => assertEmptySeedRecovery(history, workspace, entry))
  assert.throws(() => assertEmptySeedRecovery({ ...history, sessions: [{ id: 'user-session' }] }, workspace, entry))
  assert.throws(() => assertEmptySeedRecovery({ ...history, currentSessionId: 'other' }, workspace, entry))
  assert.throws(() => assertEmptySeedRecovery(history, { ...workspace, messages: [{ role: 'user', content: 'Existing question' }] }, entry))
  assert.throws(() => assertEmptySeedRecovery(history, { ...workspace, artifactRefs: [{ id: 'guide' }] }, entry))
  assert.throws(() => assertEmptySeedRecovery(history, { ...workspace, trip: { id: 'other' } }, entry))
})
test('B restart exception only admits the exact unpublished model-failure result', () => {
  const report = { case: 'B', mode: 'round-1', result: 'failed', authoritativeAfter: {},
    terminal: { status: 'completed', response: { stopReason: 'model_failure', delivery: { status: 'partial', kind: 'travel_guide', missing: ['accepted_publication'] } } } }
  assert.equal(isBUnpublishedModelFailure(report), true)
  for (const mutate of [
    next => { next.case = 'A' }, next => { next.mode = 'round-3' },
    next => { next.terminal.status = 'running' }, next => { next.terminal.response.delivery.status = 'satisfied' },
    next => { next.terminal.response.delivery.missing.push('other') },
    next => { next.terminal.response.delivery.kind = 'trip_context_update' },
    next => { next.authoritativeAfter.guide = { payload: { publication: { status: 'accepted' } } } },
  ]) { const invalid = structuredClone(report); mutate(invalid); assert.equal(isBUnpublishedModelFailure(invalid), false) }
})
test('B context-only satisfied subgoal does not certify guide delivery or permit unrelated retry', () => {
  const before = { workspace: { trip: { selectedFlight: { artifactId: 'flight', revision: 1 } } }, flight: { id: 'flight', payload: { segments: ['fixture'] } } }
  const report = { case: 'B', mode: 'round-1', result: 'failed', failure: 'Current authoritative guide is not accepted', authoritativeBefore: before, authoritativeAfter: structuredClone(before),
    terminal: { status: 'completed', artifactRefs: [], response: { stopReason: 'model_failure', artifactRefs: [], warnings: ['dsh_model_incomplete', 'dsh_reply_withheld'], delivery: { status: 'satisfied', kind: 'trip_context_update', artifactIds: [] } } } }
  assert.equal(isBContextOnlyModelFailure(report), true)
  for (const mutate of [
    next => { next.case = 'A' }, next => { next.mode = 'round-2' }, next => { next.failure = 'Unrelated timeout' },
    next => { next.terminal.response.delivery.kind = 'travel_guide' },
    next => { next.terminal.response.stopReason = 'completed' },
    next => { next.terminal.response.warnings = [] },
    next => { next.authoritativeAfter.guide = { payload: { publication: { status: 'accepted' } } } },
    next => { next.authoritativeAfter.workspace.trip.selectedFlight.revision++ },
    next => { next.authoritativeAfter.flight.payload.segments = ['changed'] },
    next => { next.terminal.artifactRefs = [{ id: 'new' }] },
  ]) { const invalid = structuredClone(report); mutate(invalid); assert.equal(isBContextOnlyModelFailure(invalid), false) }
})
test('B commit conflict retry requires exact unpublished failure and closed matching real observer shape', () => {
  const before = { workspace: { trip: { selectedFlight: { artifactId: 'flight', revision: 1 } }, tripContextSummary: { version: 1 }, artifactRefs: [{ id: 'flight' }] }, flight: { id: 'flight', payload: { segments: ['fixture'] } } }
  const report = { case: 'B', mode: 'round-1', result: 'failed', tripId: 'trip', conversationId: 'conversation', finishedAt: '2026-09-26T09:06:04Z',
    failure: 'AssertionError [ERR_ASSERTION]: Guide delivery is not satisfied', authoritativeBefore: before, authoritativeAfter: structuredClone(before),
    terminal: { status: 'completed', artifactRevision: 0, artifactRefs: [], generationId: 'generation', startedAt: '2026-09-26T09:05:37Z',
      response: { stopReason: 'responded', reply: '本轮未能发布攻略，请确认当前条件后重试。', artifactRefs: [], warnings: [],
        delivery: { status: 'not_requested', artifactIds: [], missing: [], warnings: [], goals: [] } } } }
  const rows = [{ type: 'execution_start' },
    { type: 'tool_start', toolName: 'commit_travel_guide', toolCallId: 'one' },
    { type: 'tool_end', toolName: 'commit_travel_guide', toolCallId: 'one', ok: false, errorCode: 'GOAL_IDEMPOTENCY_CONFLICT', revisionReasons: [] },
    { type: 'tool_start', toolName: 'commit_travel_guide', toolCallId: 'two' },
    { type: 'tool_end', toolName: 'commit_travel_guide', toolCallId: 'two', ok: false, errorCode: 'GOAL_IDEMPOTENCY_CONFLICT', revisionReasons: [] },
    { type: 'execution_result', reason: 'completed', cancelled: false }, { type: 'execution_closed' }]
    .map((event, index) => ({ executionId: 'execution', generationId: 'generation', tripId: 'trip', conversationId: 'conversation', sequence: index + 1, at: '2026-09-26T09:06:00Z', ...event }))
  assert.equal(isBCommitIdempotencyFailure(report), true)
  assert.equal(assertBCommitIdempotencyObserver(report, rows).commitAttempts, 2)
  for (const mutate of [
    next => { next.case = 'A' }, next => { next.mode = 'round-3' }, next => { next.terminal.status = 'running' },
    next => { next.failure = 'Other failure' }, next => { next.terminal.response.reply = 'Try again' },
    next => { next.terminal.response.delivery.status = 'satisfied' }, next => { next.terminal.response.delivery.goals.push({ id: 'goal' }) },
    next => { next.terminal.response.stopReason = 'model_failure' }, next => { next.terminal.artifactRevision = 1 },
    next => { next.terminal.artifactRefs.push({ id: 'new' }) }, next => { next.terminal.response.warnings.push('other') },
    next => { next.authoritativeAfter.guide = { payload: { publication: { status: 'accepted' } } } },
    next => { next.authoritativeAfter.workspace.trip.selectedFlight.revision++ }, next => { next.authoritativeAfter.workspace.tripContextSummary.version++ },
    next => { next.authoritativeAfter.flight.payload.segments.push('changed') }, next => { next.authoritativeAfter.workspace.artifactRefs.push({ id: 'new' }) },
  ]) { const invalid = structuredClone(report); mutate(invalid); assert.equal(isBCommitIdempotencyFailure(invalid), false); assert.throws(() => assertBCommitIdempotencyObserver(invalid, rows)) }
  for (const mutate of [
    next => { next.pop() }, next => { next[1].generationId = 'other' }, next => { next[1].executionId = 'other' },
    next => { next[1].tripId = 'other' }, next => { next[1].sequence++ }, next => { next[1].at = '2026-09-25T09:06:00Z' },
    next => { next[2].ok = true }, next => { next[2].errorCode = 'OTHER_ERROR' }, next => { next[2].toolCallId = 'other' },
    next => { next[2].artifactId = 'guide' }, next => { next[2].status = 'accepted' }, next => { next[2].revisionReasons.push('other') },
    next => { next[5].cancelled = true }, next => { next[5].reason = 'model_failure' },
    next => { next[3].toolName = 'read_artifact'; next[4].toolName = 'read_artifact' },
  ]) { const invalid = structuredClone(rows); mutate(invalid); assert.throws(() => assertBCommitIdempotencyObserver(report, invalid)) }
})
function snapshot() {
  const item = (id, timeOfDay) => ({ id, timeOfDay, title: id, description: 'Original introduction', recommendationReason: 'Culture',
    city: { code: 'TYO' }, sourceArtifactId: 'research-1', sourceFindingId: id })
  return { workspace: { trip: { id: 'trip', contextVersion: 3, selectedFlight: { artifactId: 'flight', offerId: 'one', revision: 1 } }, conversationId: 'conversation',
    artifactRefs: [{ id: 'guide', type: 'travel_guide' }], tripContextSummary: { version: 3, travelDays: 2, budget: { amount: 1500, currency: 'CNY', scope: 'trip' }, interests: ['culture'] } },
  guide: { id: 'guide', tripContextVersion: 3, payload: { routeArtifactId: 'route', budget: { amount: 1500, currency: 'CNY', scope: 'trip' },
    publication: { status: 'accepted', locale: 'zh', guideContentHash: 'hash' }, flightSelection: { revision: 1 },
    days: [{ day: 1, city: { code: 'TYO' }, items: [item('one', 'morning')] },
      { day: 2, city: { code: 'TYO' }, items: [item('two', 'morning'), item('three', 'afternoon'), item('four', 'evening')] }] } },
  route: { id: 'route', payload: { cities: ['TYO'], stopoverOnly: [], landTransfers: [] } },
  flight: { id: 'flight', payload: { legs: [{ arrival: '2026-10-25T12:00:00+09:00' }] } } }
}
test('restored context update must show current Conversation prose without old publication override', () => {
  const current = snapshot()
  current.workspace.messages = [{ id: 'reply', role: 'assistant', content: '预算已更新为两天合计 **1200 元**。', stopReason: 'completed', delivery: { status: 'satisfied', kind: 'trip_context_update' } }]
  current.guide.payload.publication.reply = '已只改第二天下午。'
  assert.equal(assertRestoredPlannerReply(current, '预算已更新为两天合计 1200 元。\n').currentContentMatched, true)
  assert.throws(() => assertRestoredPlannerReply(current, '已只改第二天下午。'))
  assert.throws(() => assertRestoredPlannerReply(current, '预算已更新为每天1200元。'))
  assert.throws(() => assertRestoredPlannerReply(current, ''))
  current.workspace.messages[0].content = current.guide.payload.publication.reply
  assert.throws(() => assertRestoredPlannerReply(current, current.guide.payload.publication.reply))
})
test('stored English restoration requires accepted same artifact, hash, slots and source identities', () => {
  const original = snapshot().guide, english = structuredClone(original)
  english.payload.publication.locale = 'en'
  english.payload.days[0].items[0].title = 'Translated title'
  assert.doesNotThrow(() => assertAcceptedEnglish(original, english))
  for (const mutate of [
    next => { next.id = 'other' }, next => { next.payload.publication.status = 'needs_localization' },
    next => { next.payload.publication.locale = 'zh' }, next => { next.payload.publication.guideContentHash = 'other' },
    next => { next.payload.days[0].items[0].timeOfDay = 'evening' }, next => { next.payload.days[0].items[0].sourceFindingId = 'other' },
    next => { next.payload.days[0].items[0].id = 'other' },
  ]) { const invalid = structuredClone(english); mutate(invalid); assert.throws(() => assertAcceptedEnglish(original, invalid)) }
})
test('public reply and overview reject real unsupported budget guarantees using the backend policy', async () => {
  const { publicProseProblems } = await import(pathToFileURL(path.resolve(__dirname, '../backend/dist/travel-guides/finalization.js')).href)
  const guide = snapshot().guide
  for (const text of ['整体预算仍在既定总额内。', '总费用已控制在预算范围内。', '两天开销不会超出预算上限。',
    '花费完全符合预算目标。', '这样的安排满足你的预算要求。', '这笔预算肯定足够。',
    'The cost stays within the allocated total.', 'All expenses are below your total budget.']) {
    for (const field of ['reply', 'overview']) {
      const invalid = structuredClone(guide); invalid.payload.publication[field] = text
      assert.throws(() => assertPublicBudgetProse(invalid, publicProseProblems), /unsupported budget guarantee/, `${field}: ${text}`)
    }
    assert.throws(() => assertPublicBudgetProse(guide, publicProseProblems, [text]), /unsupported budget guarantee/)
  }
  for (const text of ['预算只是目标，实际费用仍待核实，不承诺未知费用一定够。', '已保留总预算目标，费用是否足够仍需核实。', '两天合计预算目标1200元，不是每天。']) {
    const safe = structuredClone(guide); safe.payload.publication.reply = text; safe.payload.publication.overview = text
    assert.equal(assertPublicBudgetProse(safe, publicProseProblems).affordability, 'not_verified')
  }
  const narrowed = structuredClone(guide)
  narrowed.payload.budget = { amount: 1200, currency: 'CNY', scope: 'trip' }
  narrowed.payload.publication.reply = '全程预算1200元，但不含机票、住宿等未提供开销。'
  assert.throws(() => assertPublicBudgetProse(narrowed, publicProseProblems), /narrows the authoritative Trip budget scope/)
  const old = snapshot(), replacement = patch(old)
  old.guide.payload.publication.reply = '整体预算仍在既定总额内。'
  assert.doesNotThrow(() => assertPatch(old, replacement), 'An unsafe old reply must not prevent a clean new slot replacement')
  assert.doesNotThrow(() => assertPublicBudgetProse(replacement.guide, publicProseProblems))
})
test('guide send requires a satisfied new publication, while explanation keeps the accepted guide without artifacts', () => {
  const guide = id => ({ id, type: 'travel_guide' })
  const accepted = { status: 'completed', artifactRevision: 1, artifactRefs: [guide('guide-2')], response: {
    stopReason: 'completed', artifactRefs: [guide('guide-2')], delivery: { status: 'satisfied', kind: 'travel_guide', artifactIds: ['guide-2'] } } }
  assert.deepEqual(assertGuideTurnTransition(accepted, 'guide-1'), { outcome: 'guide-published', previousGuideId: 'guide-1', guideId: 'guide-2' })

  const explanation = { status: 'completed', artifactRevision: 0, artifactRefs: [], response: {
    stopReason: 'responded', artifactRefs: [], delivery: { status: 'not_requested' } } }
  assert.deepEqual(assertGuideTurnTransition(explanation, 'guide-1'), { outcome: 'no-guide-publication', currentGuideId: 'guide-1' })
  const readPreviousGuide = structuredClone(explanation)
  readPreviousGuide.response.reply = 'This explains the saved guide.'
  readPreviousGuide.response.artifactRefs = [guide('guide-1')]
  assert.deepEqual(assertGuideTurnTransition(readPreviousGuide, 'guide-1', { requireNoGuide: true }), {
    outcome: 'no-guide-publication', currentGuideId: 'guide-1' })
  for (const mutate of [
    next => { next.artifactRefs = [guide('guide-1')] },
    next => { next.response.artifactRefs = [guide('guide-2')] },
    next => { next.response.artifactRefs = [{ id: 'route-1', type: 'route' }] },
    next => { next.response.delivery.artifactIds = ['guide-1'] },
  ]) {
    const invalid = structuredClone(readPreviousGuide)
    mutate(invalid)
    assert.throws(() => assertGuideTurnTransition(invalid, 'guide-1', { requireNoGuide: true }))
  }
  assert.throws(() => assertGuideTurnTransition(explanation, 'guide-1', { requireGuide: true }), /not satisfied/)
  assert.throws(() => assertGuideTurnTransition(accepted, 'guide-1', { requireNoGuide: true }), /must not request or publish/)
  assert.throws(() => assertGuideTurnTransition(explanation, null, { requireNoGuide: true }), /previously accepted guide/)
  assert.throws(() => assertGuideTurnTransition({ ...accepted, response: { ...accepted.response,
    delivery: { status: 'satisfied', kind: 'travel_guide', artifactIds: ['other'] } } }, 'guide-1'), /must bind its new Artifact ID/)
  assert.throws(() => assertGuideTurnTransition({ ...accepted, response: { ...accepted.response,
    delivery: { status: 'satisfied', kind: 'travel_guide' } } }, 'guide-1'), /must bind its new Artifact ID/)

  const partialEdit = { status: 'completed', artifactRevision: 0, artifactRefs: [], response: {
    stopReason: 'goal_partial', artifactRefs: [], delivery: { status: 'partial', kind: 'travel_guide', missing: ['accepted_publication'] } } }
  assert.throws(() => assertGuideTurnTransition(partialEdit, 'guide-1'), /not satisfied/)
  assert.throws(() => assertGuideTurnTransition({ ...accepted, artifactRefs: [guide('guide-1')], response: { ...accepted.response, artifactRefs: [guide('guide-1')] } }, 'guide-1'), /new travel_guide Artifact/)
  assert.throws(() => assertGuideTurnTransition({ ...explanation, artifactRevision: 1 }, 'guide-1'), /changed Artifact revision/)
  assert.throws(() => assertGuideTurnTransition({ ...explanation, response: { ...explanation.response, artifactRefs: [guide('guide-2')] } }, 'guide-1'), /only its exact previously accepted guide/)
})
test('guide transition binds the unique new guide and explanation requires a real, non-withheld reply', () => {
  const guide = id => ({ id, type: 'travel_guide' })
  const validEdit = { status: 'completed', artifactRevision: 1, artifactRefs: [guide('guide-old'), guide('guide-new')], response: {
    stopReason: 'completed', artifactRefs: [guide('guide-old'), guide('guide-new')],
    delivery: { status: 'satisfied', kind: 'travel_guide', artifactIds: ['guide-new'] } } }
  assert.deepEqual(assertGuideTurnTransition(validEdit, 'guide-old'), {
    outcome: 'guide-published', previousGuideId: 'guide-old', guideId: 'guide-new' })

  const twoNewGuides = structuredClone(validEdit)
  twoNewGuides.artifactRefs.push(guide('guide-another-new'))
  assert.throws(() => assertGuideTurnTransition(twoNewGuides, 'guide-old'), /exactly one new travel_guide Artifact/)
  const bindsOldGuide = structuredClone(validEdit)
  bindsOldGuide.response.delivery.artifactIds = ['guide-old', 'guide-new']
  assert.throws(() => assertGuideTurnTransition(bindsOldGuide, 'guide-old'), /must bind its new Artifact ID/)
  const partialWithOldAndNew = structuredClone(validEdit)
  partialWithOldAndNew.response.delivery.status = 'partial'
  assert.throws(() => assertGuideTurnTransition(partialWithOldAndNew, 'guide-old'), /not satisfied/)

  const explanation = { status: 'completed', artifactRevision: 0, artifactRefs: [], response: {
    stopReason: 'responded', reply: '这是基于当前行程的说明。', artifactRefs: [],
    delivery: { status: 'not_requested' } } }
  assert.deepEqual(assertGuideTurnTransition(explanation, 'guide-old', { requireNoGuide: true }), {
    outcome: 'no-guide-publication', currentGuideId: 'guide-old' })
  for (const mutate of [
    next => { next.response.warnings = ['dsh_reply_withheld'] },
    next => { next.response.warnings = ['dsh_model_incomplete'] },
    next => { next.response.reply = '   ' },
    next => { next.response.reply = undefined },
  ]) {
    const invalid = structuredClone(explanation)
    mutate(invalid)
    assert.throws(() => assertGuideTurnTransition(invalid, 'guide-old', { requireNoGuide: true }))
  }
})
test('frozen journey/action mapping drives guide-turn requirements independently of delivery kind', () => {
  assert.equal(guideTurnTransitionRequirement('B01', 3, 'guide'), 'no-guide')
  assert.equal(guideTurnTransitionRequirement('B02', 3, 'guide'), 'no-guide')
  assert.equal(guideTurnTransitionRequirement('B01', 4, null), 'guide')
  assert.equal(guideTurnTransitionRequirement('B02', 4, null), 'guide')
  assert.equal(guideTurnTransitionRequirement('B05', 3, null), 'guide')
  assert.equal(guideTurnTransitionRequirement('B06', 2, 'guide'), 'guide')
  assert.equal(guideTurnTransitionRequirement('B06', 2, null), null)
  assert.equal(guideTurnTransitionRequirement('B01', 0, null), null)
})
test('runner carries the unique new guide through refs that list the old guide first', () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const runner = fs.readFileSync(path.join(__dirname, 'qa-dsh-d6-h5.cjs'), 'utf8')
  const start = runner.indexOf('const recordTurnArtifacts =')
  const end = runner.indexOf('\nconst visibleControls =', start)
  assert.ok(start >= 0 && end > start, 'Could not isolate the runner artifact-recording behavior')
  const setup = () => vm.runInNewContext(`
    let acceptedGuideRef = { id: 'guide-old', type: 'travel_guide' }
    let acceptedArtifactRefs = []
    ${runner.slice(start, end)}
    ({ recordTurnArtifacts, getState: () => ({ acceptedGuideRef, acceptedArtifactRefs }) })
  `, { assert, assertGuideTurnTransition })
  const guide = id => ({ id, type: 'travel_guide' })
  const route = { id: 'route-new', type: 'route' }
  const accepted = { status: 'completed', artifactRevision: 1,
    artifactRefs: [guide('guide-old'), route, guide('guide-new')], response: {
      stopReason: 'completed', artifactRefs: [guide('guide-old'), guide('guide-new')],
      delivery: { status: 'satisfied', kind: 'travel_guide', artifactIds: ['guide-new'] } } }
  const harness = setup()
  const record = { terminal: accepted }
  assert.deepEqual(harness.recordTurnArtifacts(record, { assert: { artifactTypes: ['travel_guide'] } }), [])
  const state = harness.getState()
  assert.equal(state.acceptedGuideRef.id, 'guide-new')
  const readableGuideIds = [...new Set(Array.from(state.acceptedArtifactRefs)
    .filter(ref => ref.type === 'travel_guide').map(ref => ref.id))]
  assert.deepEqual(readableGuideIds, ['guide-new'])
  assert.ok(state.acceptedArtifactRefs.some(ref => ref.id === 'route-new'), 'Keep current non-guide artifact references')
  assert.ok(state.acceptedArtifactRefs.some(ref => ref.id === record.guideTurnTransition.guideId),
    'The latest readable-result contract must allow the newly accepted guide ID')

  const explanation = setup()
  const readOnlyTurn = { terminal: { status: 'completed', artifactRevision: 0, artifactRefs: [], response: {
    stopReason: 'responded', reply: 'This explains the saved guide.', artifactRefs: [guide('guide-old')],
    delivery: { status: 'not_requested', artifactIds: [] } } } }
  explanation.recordTurnArtifacts(readOnlyTurn, {})
  assert.deepEqual(assertGuideTurnTransition(readOnlyTurn.terminal, explanation.getState().acceptedGuideRef.id,
    { requireNoGuide: true }), { outcome: 'no-guide-publication', currentGuideId: 'guide-old' })
  assert.deepEqual(Array.from(explanation.getState().acceptedArtifactRefs, ref => ref.id), ['guide-old'])

  const partial = setup()
  const partialTerminal = structuredClone(accepted)
  partialTerminal.response.delivery.status = 'partial'
  assert.throws(() => partial.recordTurnArtifacts({ terminal: partialTerminal }, {}), /not satisfied/)

  const twoNew = setup()
  const twoNewTerminal = structuredClone(accepted)
  twoNewTerminal.artifactRefs.push(guide('guide-another-new'))
  assert.throws(() => twoNew.recordTurnArtifacts({ terminal: twoNewTerminal }, {}), /exactly one new travel_guide Artifact/)
})
test('actual runner budget inspection reads the scoped workspace contract and handles absent budgets', async () => {
  const fs = require('node:fs')
  const runner = fs.readFileSync(path.join(__dirname, 'qa-dsh-d6-h5.cjs'), 'utf8')
  const start = runner.indexOf('const inspectPersistedGuideBudgetProse =')
  const end = runner.indexOf('const inspectLatestAcceptedResult =', start)
  assert.ok(start > 0 && end > start)
  const load = journeyId => new Function('apiUrl', 'assert', 'path', 'pathToFileURL', '__dirname',
    'assertPublicBudgetProse', 'journeyId', runner.slice(start, end) + '\nreturn inspectPersistedGuideBudgetProse;')(
      'http://127.0.0.1:1', assert, path, pathToFileURL, __dirname, assertPublicBudgetProse, journeyId)
  const guide = { ...snapshot().guide, tripId: 'trip' }
  const workspace = { trip: { id: 'trip' }, conversationId: 'conversation', tripContextSummary: {} }
  const urls = []
  const page = { evaluate: async () => 'fixture-test-token', request: { get: async (url, options) => {
    assert.equal(options.headers.authorization, 'Bearer fixture-test-token')
    urls.push(url)
    return { status: () => 200, json: async () => url.includes('/workspace?') ? workspace : { artifact: guide } }
  } } }
  assert.equal((await load('B05')(page, 'guide', 'trip', 'conversation')).affordability, 'not_verified')
  assert.deepEqual(urls, ['http://127.0.0.1:1/v1/artifacts/guide', 'http://127.0.0.1:1/v1/trips/trip/workspace?conversationId=conversation'])
  await assert.rejects(load('B01')(page, 'guide', 'trip', 'conversation'), /no authoritative Trip budget/)
  workspace.tripContextSummary.budget = { amount: 1200, currency: 'CNY', scope: 'trip' }
  guide.payload.publication.reply = '全程预算目标1200元，不含机票和住宿。'
  await assert.rejects(load('B01')(page, 'guide', 'trip', 'conversation'), /narrows the authoritative Trip budget scope/)
  workspace.conversationId = 'other'
  await assert.rejects(load('B01')(page, 'guide', 'trip', 'conversation'), /another conversation/)
})
test('explicit new-version localization binds original success and rejects same or already-English guide', () => {
  const previous = snapshot(), current = snapshot()
  current.guide.id = 'new-guide'
  const predecessor = { case: 'A', mode: 'localize', result: 'observed', finishedAt: '2026-09-26T08:24:29Z', postCount: 0, tripId: 'trip', conversationId: 'conversation',
    authoritativeAfter: previous, localizationAssertions: { sameGuide: true }, chineseRestoreAssertions: { sameChineseOverviewAndActivities: true },
    events: [{ type: 'request', method: 'POST', path: '/v1/artifacts/guide/localization' }, { type: 'response', method: 'POST', path: '/v1/artifacts/guide/localization', status: 200 }] }
  const english = { id: 'new-guide', payload: { publication: { locale: 'en', status: 'needs_localization' } } }
  assert.equal(assertNewVersionLocalization(predecessor, current, english).currentGuideId, 'new-guide')
  for (const mutate of [
    next => { next.result = 'failed' }, next => { delete next.finishedAt }, next => { next.mode = 'round-1' },
    next => { next.newVersionLocalization = {} }, next => { next.postCount = 1 }, next => { next.tripId = 'other' },
    next => { next.chineseRestoreAssertions.sameChineseOverviewAndActivities = false }, next => { next.events[0].path = '/v1/agent/turns' },
    next => { next.events[1].status = 500 }, next => { next.events.push({ type: 'request', method: 'POST', path: '/v1/agent/turns' }) },
  ]) { const invalid = structuredClone(predecessor); mutate(invalid); assert.throws(() => assertNewVersionLocalization(invalid, current, english)) }
  assert.throws(() => assertNewVersionLocalization(predecessor, previous, { ...english, id: 'guide' }))
  assert.throws(() => assertNewVersionLocalization(predecessor, current, { ...english, id: 'other' }))
  assert.throws(() => assertNewVersionLocalization(predecessor, current, { ...english, payload: { publication: { locale: 'en', status: 'accepted' } } }))
  current.guide.payload.publication.finalization = { variants: { en: { status: 'accepted' } } }
  assert.throws(() => assertNewVersionLocalization(predecessor, current, english))
})
function patch(before) {
  const after = structuredClone(before); after.guide.id = 'patched'
  Object.assign(after.guide.payload.days[1].items[1], { id: 'replacement', title: 'Museum', sourceFindingId: 'replacement' })
  return after
}
test('adopted fixture flight preserves every segment and rejects activities before arrival slots', () => {
  const before = snapshot()
  before.workspace.tripContextSummary.departureWindow = { from: '2026-10-24' }
  before.flight.payload = { offers: [{ id: 'one', segments: [{ departsAt: '2026-10-24 08:00', arrivesAt: '2026-10-24 12:30' }] }] }
  const after = structuredClone(before)
  after.guide.payload.flightSelection = { artifactId: 'flight', choiceId: 'one', revision: 1, destinationArrivalAt: '2026-10-24 12:30' }
  after.guide.payload.days[0].items[0].timeOfDay = 'afternoon'
  assert.deepEqual(assertAdoptedFlight(before, after).blockedSlots, ['morning'])
  for (const mutate of [
    next => { next.workspace.trip.selectedFlight.revision++ },
    next => { next.flight.payload.offers[0].segments[0].arrivesAt = '2026-10-24 09:00' },
    next => { next.guide.payload.flightSelection.destinationArrivalAt = '2026-10-24 09:00' },
    next => { next.guide.payload.days[0].items[0].timeOfDay = 'morning' },
  ]) { const invalid = structuredClone(after); mutate(invalid); assert.throws(() => assertAdoptedFlight(before, invalid)) }
  const nextDay = structuredClone(before), nextDayAfter = structuredClone(after)
  nextDay.flight.payload.offers[0].segments[0].arrivesAt = '2026-10-25 12:30'
  nextDayAfter.flight = structuredClone(nextDay.flight)
  nextDayAfter.guide.payload.flightSelection.destinationArrivalAt = '2026-10-25 12:30'
  assert.throws(() => assertAdoptedFlight(nextDay, nextDayAfter), /before arrival date/)
})
test('localized patch permits only the targeted afternoon replacement', () => {
  const before = snapshot(), after = patch(before)
  assert.equal(assertPatch(before, after).unchangedDayOne, true)
  for (const mutate of [
    next => { next.guide.payload.days[0].items[0].description = 'Rewritten' },
    next => { next.guide.payload.days[1].items[0].timeOfDay = 'flexible' },
    next => { next.guide.payload.days[1].items.reverse() },
    next => { next.workspace.trip.selectedFlight.revision = 2 },
    next => { next.flight.payload.legs[0].arrival = '2026-10-25T18:00:00+09:00' },
    next => { next.guide.payload.days[1].items[1] = structuredClone(before.guide.payload.days[1].items[1]) },
  ]) { const invalid = structuredClone(after); mutate(invalid); assert.throws(() => assertPatch(before, invalid)) }
})
test('budget requires authoritative CNY 1200 trip scope, two days and advanced context', () => {
  const before = snapshot(), after = structuredClone(before)
  after.workspace.trip.contextVersion = 4; after.workspace.tripContextSummary.version = 4
  after.workspace.tripContextSummary.budget.amount = 1200
  after.guide.payload.publication.status = 'stale'
  assert.equal(assertTotalBudget(before, after).scope, 'trip')
  for (const mutate of [
    next => { next.workspace.tripContextSummary.budget.scope = 'airfare' },
    next => { next.workspace.tripContextSummary.budget.currency = 'USD' },
    next => { next.workspace.tripContextSummary.travelDays = 1 },
    next => { next.workspace.tripContextSummary.budget.amount = 2400 },
    next => { next.guide.payload.publication.status = 'accepted' },
  ]) { const invalid = structuredClone(after); mutate(invalid); assert.throws(() => assertTotalBudget(before, invalid)) }
})
test('English localization allows only bounded localization calls with identical plan and sources', () => {
  const before = snapshot(), after = structuredClone(before), english = structuredClone(before.guide)
  english.payload.publication.locale = 'en'
  english.payload.days[0].items[0].title = 'Translated name'
  const budgetBefore = { searchCalls: 2, callEntries: [{ id: 'worker:1', kind: 'model', provider: 'deepseek' }] }
  const budgetAfter = { searchCalls: 2, callEntries: [...budgetBefore.callEntries, { id: 'localize:1', kind: 'model', provider: 'deepseek' }] }
  const events = [{ type: 'request', method: 'POST', path: '/v1/artifacts/guide/localization' }]
  assert.equal(assertLocalization(before, after, english, budgetBefore, budgetAfter, events).mainAgentCalls, 0)
  const badSource = structuredClone(english); badSource.payload.days[0].items[0].sourceFindingId = 'invented'
  assert.throws(() => assertLocalization(before, after, badSource, budgetBefore, budgetAfter, events))
  assert.throws(() => assertLocalization(before, after, english, budgetBefore, { ...budgetAfter, searchCalls: 3 }, events))
  assert.throws(() => assertLocalization(before, after, english, budgetBefore, { ...budgetAfter, callEntries: [...budgetBefore.callEntries, { id: 'worker:2', kind: 'model' }] }, events))
  assert.throws(() => assertLocalization(before, after, english, budgetBefore, budgetAfter, [...events, { type: 'request', method: 'POST', path: '/v1/agent/turns' }]))
})
test('budget retry requires the diagnosed completed context update and unchanged artifacts with a stale blocked guide', () => {
  const before = snapshot(), after = structuredClone(before)
  after.workspace.trip.contextVersion++; after.workspace.tripContextSummary.version++
  after.workspace.tripContextSummary.budget.amount = 1200
  before.workspace.tripContextSummary.notes = ['Original constraint']
  after.workspace.tripContextSummary.notes = ['Original constraint', 'Budget clarification']
  after.guide.payload.publication = { status: 'blocked', issues: [{ code: 'stale' }] }
  const predecessor = { authoritativeBefore: before, authoritativeAfter: after,
    terminal: { status: 'completed', response: { delivery: { status: 'satisfied', kind: 'trip_context_update' } } } }
  const allowNotes = (oldNotes, newNotes) => oldNotes[0] === newNotes[0]
  assert.equal(assertBudgetRetryCandidate(predecessor, allowNotes).staleGuide, true)
  const withheld = { authoritativeBefore: structuredClone(after), authoritativeAfter: structuredClone(after),
    budgetRetry: { staleGuide: true }, retryTerminal: { predecessorSha256: 'audited-by-runner' },
    terminal: { status: 'completed', response: { delivery: { status: 'not_requested' }, stopReason: 'responded', warnings: ['dsh_reply_withheld'] } } }
  assert.equal(assertBudgetRetryCandidate(withheld, allowNotes, predecessor).priorContextVersion, before.workspace.trip.contextVersion)
  for (const mutate of [
    next => { next.terminal.response.warnings = [] },
    next => { next.authoritativeAfter.workspace.trip.contextVersion++ },
    next => { next.authoritativeAfter.guide.id = 'other' },
    next => { delete next.retryTerminal },
  ]) { const invalid = structuredClone(withheld); mutate(invalid); assert.throws(() => assertBudgetRetryCandidate(invalid, allowNotes, predecessor)) }
  assert.throws(() => assertBudgetRetryCandidate(predecessor, () => false), /non-budget note constraints/)
  for (const mutate of [
    next => { next.terminal.response.delivery.kind = 'travel_guide' },
    next => { next.authoritativeAfter.guide.payload.publication.status = 'accepted' },
    next => { next.authoritativeAfter.guide.payload.publication.issues = [] },
    next => { next.authoritativeAfter.workspace.artifactRefs.push({ id: 'new', type: 'travel_guide' }) },
    next => { next.authoritativeAfter.workspace.tripContextSummary.interests = ['shopping'] },
  ]) { const invalid = structuredClone(predecessor); mutate(invalid); assert.throws(() => assertBudgetRetryCandidate(invalid, allowNotes)) }
})
test('budget confirmation requires exact partial receipt and inherited accepted plan; locale metadata alone may change', () => {
  const before = snapshot(), after = structuredClone(before)
  before.route.payload.sourceArtifactIds = ['research-1']
  after.route.payload.sourceArtifactIds = ['copied-research']
  after.workspace.trip.contextVersion++; after.workspace.tripContextSummary.version++
  after.workspace.tripContextSummary.budget.amount = 1200
  after.guide.id = 'budget-guide'; after.guide.tripContextVersion++
  after.guide.payload.budget = { amount: 1200, currency: 'CNY', scope: 'trip', partyBasis: 'unspecified', period: 'trip_total' }
  for (const day of after.guide.payload.days) for (const item of day.items) item.sourceArtifactId = 'copied-research'
  const origin = { authoritativeBefore: before }, report = { authoritativeAfter: after, budgetRetry: {}, retryTerminal: {},
    terminal: { status: 'completed', response: { stopReason: 'goal_partial', delivery: { status: 'partial', kind: 'trip_context_update', missing: ['trip_field:budget'] } } } }
  assert.equal(assertBudgetConfirmCandidate(report, undefined, origin).guideId, 'budget-guide')
  const withheld = { ...report, budgetConfirm: {}, authoritativeBefore: structuredClone(after),
    terminal: { status: 'completed', response: { stopReason: 'responded', warnings: ['dsh_reply_withheld'], delivery: { status: 'not_requested' } } } }
  assert.equal(assertBudgetConfirmCandidate(withheld, undefined, origin).failureKind, 'withheld_no_op')
  const changed = structuredClone(withheld); changed.authoritativeAfter.workspace.trip.contextVersion++
  assert.throws(() => assertBudgetConfirmCandidate(changed, undefined, origin))
  const localized = structuredClone(after)
  localized.guide.updatedAt = '2026-09-26T09:00:00Z'; localized.guide.payload.publication.revision = 2
  assert.doesNotThrow(() => assertStableBudgetConfirmationBase(after, localized))
  for (const mutate of [
    next => { next.terminal.response.delivery.missing.push('trip_field:dates') },
    next => { next.authoritativeAfter.guide.payload.days[0].items[0].timeOfDay = 'afternoon' },
    next => { next.authoritativeAfter.route.payload.cities = ['OSA'] },
    next => { next.authoritativeAfter.guide.payload.days[1].items[0].sourceFindingId = 'different' },
  ]) { const invalid = structuredClone(report); mutate(invalid); assert.throws(() => assertBudgetConfirmCandidate(invalid, undefined, origin)) }
  localized.guide.payload.publication.guideContentHash = 'different'
  assert.throws(() => assertStableBudgetConfirmationBase(after, localized))
})
test('budget confirmation distinguishes a real setter from a no-op answer and rejects invented success', () => {
  const before = snapshot(); before.workspace.tripContextSummary.budget.amount = 1200
  before.guide.payload.budget.amount = 1200; before.guide.payload.publication.reply = '攻略已保存。'
  const input = { before, after: structuredClone(before), searchesBefore: 2, searchesAfter: 2, reply: '预算目标是两天合计1200元，不是每天，不保证未知费用够用。',
    terminal: { status: 'completed', artifactRefs: [], response: { stopReason: 'responded', warnings: [], artifactRefs: [], delivery: { status: 'not_requested', goals: [], artifactIds: [] } } } }
  assert.equal(assertBudgetConfirmationResult(input).resultKind, 'no_op_confirmed')
  const setter = structuredClone(input)
  setter.terminal.response.delivery = { status: 'satisfied', kind: 'trip_context_update' }
  assert.equal(assertBudgetConfirmationResult(setter).resultKind, 'setter_confirmed')
  for (const mutate of [
    next => { next.terminal.response.warnings = ['dsh_reply_withheld'] },
    next => { next.terminal.response.delivery.status = 'partial' },
    next => { next.after.workspace.trip.contextVersion++ },
    next => { next.after.guide.payload.days[0].items[0].title = 'Different' },
    next => { next.searchesAfter++ },
    next => { next.reply = '攻略已保存。' },
    next => { next.reply = '每天1200元。' },
  ]) { const invalid = structuredClone(input); mutate(invalid); assert.throws(() => assertBudgetConfirmationResult(invalid)) }
})
