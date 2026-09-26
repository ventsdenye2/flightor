const assert = require('node:assert/strict')
function assertPublicBudgetProse(guide, publicProseProblems, extraFields = []) {
  assert.equal(typeof publicProseProblems, 'function', 'Use the built backend public-prose policy')
  const publication = guide?.payload?.publication
  assert.equal(publication?.status, 'accepted', 'Budget prose check requires a current accepted publication')
  const fields = [publication.reply, publication.overview, ...extraFields].filter(value => typeof value === 'string')
  assert.ok(!publicProseProblems(fields, publication.locale || 'zh').includes('budget_guarantee'), 'Public reply/overview contains an unsupported budget guarantee')
  return { policy: 'backend publicProseProblems', fields: fields.length, unsupportedBudgetGuarantee: false, affordability: 'not_verified' }
}
const normalizePlannerReply = value => String(value || '').replace(/\*\*/g, '').replace(/\s+/g, '').trim()
function assertNewVersionLocalization(predecessor, current, english) {
  assert.equal(predecessor.mode, 'localize'); assert.equal(predecessor.result, 'observed'); assert.ok(predecessor.finishedAt)
  assert.ok(!predecessor.newVersionLocalization, 'New version must bind to the retained original localization attempt')
  assert.equal(predecessor.postCount, 0, 'Original localization started a main Agent turn')
  assert.equal(predecessor.localizationAssertions?.sameGuide, true); assert.equal(predecessor.chineseRestoreAssertions?.sameChineseOverviewAndActivities, true)
  const previous = acceptedGuide(predecessor.authoritativeAfter), guide = acceptedGuide(current)
  assert.equal(current.workspace.trip.id, predecessor.tripId); assert.equal(current.workspace.conversationId, predecessor.conversationId)
  assert.notEqual(guide.id, previous.id, 'Never localize the same artifact again through the new-version entry')
  assert.equal(english?.id, guide.id, 'English GET returned another artifact')
  assert.ok(!(english.payload?.publication?.status === 'accepted' && english.payload.publication.locale === 'en'), 'Current guide already has accepted English')
  assert.notEqual(guide.payload.publication.finalization?.variants?.en?.status, 'accepted', 'Current guide already stores accepted English')
  const posts = predecessor.events.filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method))
  assert.equal(posts.length, 1); assert.equal(posts[0].method, 'POST'); assert.equal(posts[0].path, `/v1/artifacts/${previous.id}/localization`)
  const responses = predecessor.events.filter(event => event.type === 'response' && event.method === 'POST' && event.path === posts[0].path)
  assert.equal(responses.length, 1); assert.ok(responses[0].status >= 200 && responses[0].status < 300)
  return { previousGuideId: previous.id, currentGuideId: guide.id, currentGuideContentHash: guide.payload.publication.guideContentHash }
}
function assertRestoredPlannerReply(snapshot, renderedReply) {
  const assistant = [...snapshot.workspace.messages].reverse().find(message => message.role === 'assistant')
  assert.ok(assistant?.id && assistant.content?.trim(), 'Restored workspace has no current assistant reply')
  const current = normalizePlannerReply(assistant.content), rendered = normalizePlannerReply(renderedReply)
  assert.ok(rendered, 'Restored planner reply is not readable')
  if (assistant.stopReason === 'completed' && assistant.delivery?.status === 'satisfied' && assistant.delivery.kind === 'trip_context_update') {
    assert.equal(rendered, current, 'Restored budget/context reply does not match current Conversation content')
    const publicationReply = normalizePlannerReply(snapshot.guide?.payload?.publication?.reply)
    if (publicationReply) {
      assert.notEqual(current, publicationReply, 'Current context-update Conversation was overwritten by old publication reply')
      assert.notEqual(rendered, publicationReply, 'Restored context reply was overwritten by old publication reply')
    }
    return { assistantId: assistant.id, deliveryKind: 'trip_context_update', currentContentMatched: true, oldPublicationNotDisplayed: true }
  }
  return { assistantId: assistant.id, deliveryKind: assistant.delivery?.kind, currentContextUpdate: false }
}
function assertEmptySeedRecovery(history, workspace, entry) {
  assert.equal(history?.version, 1, 'Unsupported saved history format')
  assert.deepEqual(history.sessions, [], 'Never reseed existing browser conversations')
  assert.equal(history.currentSessionId, `cloud-${entry.conversationId}`, 'Missing session is not this harness seed')
  assert.equal(workspace?.trip?.id, entry.tripId, 'Recovery workspace Trip differs')
  assert.equal(workspace.conversationId, entry.conversationId, 'Recovery workspace conversation differs')
  assert.deepEqual(workspace.messages, [], 'Never replace cloud conversation history with an empty seed')
  assert.deepEqual(workspace.artifactRefs, [], 'Never replace cloud artifacts with an empty seed')
  assert.ok(!workspace.routeGeneration, 'Never reseed a workspace with route generation')
}
function isBUnpublishedModelFailure(report) {
  const terminal = report.terminal, response = terminal?.response, delivery = response?.delivery
  return report.case === 'B' && report.mode === 'round-1' && report.result === 'failed'
    && terminal?.status === 'completed' && response?.stopReason === 'model_failure'
    && delivery?.status === 'partial' && delivery.kind === 'travel_guide'
    && JSON.stringify(delivery.missing) === JSON.stringify(['accepted_publication'])
    && report.authoritativeAfter?.guide?.payload?.publication?.status !== 'accepted'
}
function isBCommitIdempotencyFailure(report) {
  const terminal = report.terminal, response = terminal?.response, delivery = response?.delivery
  const before = report.authoritativeBefore, after = report.authoritativeAfter
  return report.case === 'B' && report.mode === 'round-1' && report.result === 'failed'
    && report.failure?.startsWith('AssertionError [ERR_ASSERTION]: Guide delivery is not satisfied')
    && terminal?.status === 'completed' && terminal.artifactRevision === 0 && response?.stopReason === 'responded'
    && response.reply === '本轮未能发布攻略，请确认当前条件后重试。'
    && delivery?.status === 'not_requested' && !delivery.kind
    && [terminal.artifactRefs, response.artifactRefs, response.warnings, delivery.artifactIds, delivery.missing, delivery.warnings, delivery.goals].every(value => JSON.stringify(value) === '[]')
    && !before?.guide && !after?.guide && Boolean(before?.flight && before.workspace?.trip?.selectedFlight)
    && ['trip', 'tripContextSummary', 'artifactRefs'].every(key => JSON.stringify(after?.workspace?.[key]) === JSON.stringify(before.workspace[key]))
    && JSON.stringify(after?.flight) === JSON.stringify(before.flight)
    && JSON.stringify(after?.route) === JSON.stringify(before.route)
}
function assertBCommitIdempotencyObserver(report, events) {
  assert.ok(isBCommitIdempotencyFailure(report), 'Not the diagnosed B commit idempotency failure')
  assert.ok(Array.isArray(events) && events.length > 2, 'Missing real DSH observer')
  const executionId = events[0].executionId
  assert.ok(executionId, 'Missing observer execution identity')
  for (const [index, event] of events.entries()) {
    assert.equal(event.executionId, executionId, 'Mixed observer executions')
    assert.equal(event.generationId, report.terminal.generationId, 'Observer generation differs')
    assert.equal(event.tripId, report.tripId); assert.equal(event.conversationId, report.conversationId)
    assert.equal(event.sequence, index + 1, 'Observer sequence incomplete')
    assert.ok(Date.parse(event.at) >= Date.parse(report.terminal.startedAt) && Date.parse(event.at) <= Date.parse(report.finishedAt), 'Observer outside completed turn')
  }
  assert.equal(events[0].type, 'execution_start')
  assert.equal(events.at(-1).type, 'execution_closed', 'Observer is not closed')
  const results = events.filter(event => event.type === 'execution_result')
  assert.equal(results.length, 1); assert.equal(results[0].reason, 'completed'); assert.equal(results[0].cancelled, false)
  const starts = events.filter(event => event.type === 'tool_start' && event.toolName === 'commit_travel_guide')
  const ends = events.filter(event => event.type === 'tool_end' && event.toolName === 'commit_travel_guide')
  // The retained real attempt contains the initial commit and one same-turn retry, both rejected before artifacts.
  assert.equal(starts.length, 2, 'Unexpected diagnosed commit count'); assert.equal(ends.length, 2)
  for (const [index, end] of ends.entries()) {
    assert.equal(end.toolCallId, starts[index].toolCallId); assert.ok(end.sequence > starts[index].sequence)
    assert.equal(end.ok, false); assert.equal(end.errorCode, 'GOAL_IDEMPOTENCY_CONFLICT')
    assert.ok(!end.status && !end.artifactId && !end.guideId, 'Commit observer contains an artifact result')
    assert.deepEqual(end.revisionReasons, [])
  }
  return { executionId, generationId: report.terminal.generationId, commitAttempts: 2, errorCode: 'GOAL_IDEMPOTENCY_CONFLICT', closedAt: events.at(-1).at }
}
function isBContextOnlyModelFailure(report) {
  const terminal = report.terminal, response = terminal?.response, delivery = response?.delivery
  const before = report.authoritativeBefore, after = report.authoritativeAfter
  return report.case === 'B' && report.mode === 'round-1' && report.result === 'failed'
    && typeof report.failure === 'string' && report.failure.includes('Current authoritative guide is not accepted')
    && terminal?.status === 'completed' && response?.stopReason === 'model_failure'
    && delivery?.status === 'satisfied' && delivery.kind === 'trip_context_update'
    && response.warnings?.includes('dsh_model_incomplete') && response.warnings.includes('dsh_reply_withheld')
    && JSON.stringify(delivery.artifactIds) === '[]' && JSON.stringify(terminal.artifactRefs) === '[]' && JSON.stringify(response.artifactRefs) === '[]'
    && after?.guide?.payload?.publication?.status !== 'accepted'
    && Boolean(before?.workspace?.trip?.selectedFlight && before.flight)
    && JSON.stringify(after?.workspace?.trip?.selectedFlight) === JSON.stringify(before.workspace.trip.selectedFlight)
    && JSON.stringify(after?.flight) === JSON.stringify(before.flight)
}
const acceptedGuide = snapshot => {
  const guide = snapshot.guide
  assert.equal(guide?.payload?.publication?.status, 'accepted', 'Current authoritative guide is not accepted')
  assert.equal(guide.payload.days.length, 2, 'Guide must retain two days')
  return guide
}
function sameScope(before, after) {
  assert.equal(after.workspace.trip.id, before.workspace.trip.id, 'Trip changed')
  assert.equal(after.workspace.conversationId, before.workspace.conversationId, 'Conversation changed')
}
function sameFlight(before, after) {
  assert.deepEqual(after.workspace.trip.selectedFlight, before.workspace.trip.selectedFlight, 'Adopted flight/revision changed')
  assert.deepEqual(after.flight?.payload, before.flight?.payload, 'Selected flight legs/times changed')
  assert.deepEqual(after.guide?.payload?.flightSelection, before.guide?.payload?.flightSelection, 'Guide flight snapshot changed')
  assert.deepEqual(after.guide?.payload?.layoverPlans, before.guide?.payload?.layoverPlans, 'Layover plans changed')
}
function assertAdoptedFlight(before, after) {
  sameScope(before, after)
  const selection = before.workspace.trip.selectedFlight
  assert.ok(selection?.artifactId && selection.offerId && Number.isInteger(selection.revision), 'B requires an explicitly adopted flight offer')
  assert.deepEqual(after.workspace.trip.selectedFlight, selection, 'Planner changed adopted flight or selection revision')
  assert.equal(before.flight?.id, selection.artifactId)
  assert.deepEqual(after.flight, before.flight, 'Planner changed the selected flight artifact or segments')
  const offer = before.flight.payload.offers?.find(item => item.id === selection.offerId)
  assert.ok(offer?.segments?.length, 'Adopted offer has no real fixture segments')
  const destination = before.flight.payload.query?.destination ?? offer.segments.at(-1).destination
  const arrivalSegment = destination ? offer.segments.find(segment => segment.destination === destination) : offer.segments.at(-1)
  const arrival = arrivalSegment?.arrivesAt
  assert.match(arrival, /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/, 'Fixture arrival must include local date and time')
  const guide = acceptedGuide(after), snapshot = guide.payload.flightSelection
  assert.equal(snapshot?.artifactId, selection.artifactId); assert.equal(snapshot.revision, selection.revision)
  assert.equal(snapshot.choiceId, selection.offerId, 'Guide refers to another adopted offer')
  assert.equal(snapshot.destinationArrivalAt, arrival, 'Guide arrival differs from adopted last segment')
  const start = before.workspace.tripContextSummary.departureWindow?.from
  assert.match(start, /^\d{4}-\d{2}-\d{2}$/)
  const arrivalDay = Math.floor((Date.parse(`${arrival.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
  const hour = Number(arrival.slice(11, 13))
  // Same coarse slot boundary as travel-guides/validation.ts; this is not a
  // claim that airport transfer times or exact activity start times are verified.
  const blockedSlots = hour >= 15 ? ['morning', 'afternoon'] : hour >= 10 ? ['morning'] : []
  for (const day of guide.payload.days) {
    if (day.day < arrivalDay) assert.ok(day.kind === 'travel' && day.items.length === 0, 'Destination activity scheduled before arrival date')
    if (day.day === arrivalDay) assert.ok(day.items.every(item => !blockedSlots.includes(item.timeOfDay)), 'Destination activity scheduled before arrival slot boundary')
  }
  return { unchangedSelectionAndRevision: true, unchangedFlightSegments: true, arrival, arrivalDay, blockedSlots,
    boundaryScope: 'Existing domain coarse slots; does not certify precise transfer duration or activity start time' }
}
function assertPatch(before, after) {
  sameScope(before, after); sameFlight(before, after)
  const previous = acceptedGuide(before), next = acceptedGuide(after)
  assert.notEqual(next.id, previous.id, 'Patch did not publish a new guide')
  assert.deepEqual(after.workspace.tripContextSummary, before.workspace.tripContextSummary, 'Local patch changed authoritative Trip context')
  assert.deepEqual(next.payload.budget, previous.payload.budget, 'Local patch changed budget')
  const oldDay1 = previous.payload.days.find(day => day.day === 1), newDay1 = next.payload.days.find(day => day.day === 1)
  assert.ok(oldDay1 && newDay1, 'Day one is missing')
  assert.deepEqual(newDay1, oldDay1, 'Patch changed day one content/identity/slots/evidence')
  const oldDay2 = previous.payload.days.find(day => day.day === 2), newDay2 = next.payload.days.find(day => day.day === 2)
  assert.ok(oldDay2 && newDay2, 'Day two is missing')
  const unchanged = day => day.items.filter(item => item.timeOfDay !== 'afternoon')
  assert.ok(oldDay2.items.some(item => item.timeOfDay === 'morning'), 'Baseline second-day morning is missing')
  assert.deepEqual(unchanged(newDay2), unchanged(oldDay2), 'Patch changed unaffected second-day slots/order/prose/evidence')
  const oldAfternoon = oldDay2.items.filter(item => item.timeOfDay === 'afternoon'), newAfternoon = newDay2.items.filter(item => item.timeOfDay === 'afternoon')
  assert.ok(oldAfternoon.length && newAfternoon.length, 'Afternoon replacement is missing')
  const identity = items => items.map(item => ({ id: item.id, title: item.title, sourceArtifactId: item.sourceArtifactId, sourceFindingId: item.sourceFindingId }))
  assert.notDeepEqual(identity(newAfternoon), identity(oldAfternoon), 'Afternoon was not replaced')
  assert.deepEqual(newDay2.city, oldDay2.city, 'Patch changed second-day city')
  assert.deepEqual(newDay2.kind, oldDay2.kind, 'Patch changed second-day kind')
  for (const field of ['cities', 'stopoverOnly', 'landTransfers']) assert.deepEqual(after.route?.payload?.[field], before.route?.payload?.[field], `Patch changed route ${field}`)
  return { unchangedDayOne: true, unchangedOtherSlots: true, unchangedFlight: true, afternoonChanged: true,
    semanticReviewRequired: 'Review real sources and visible prose to establish that the replacement is an indoor cultural venue.' }
}
function assertTotalBudget(before, after, notesEquivalent) {
  sameScope(before, after)
  const budget = after.workspace.tripContextSummary?.budget
  assert.equal(budget?.amount, 1200, 'Authoritative Trip budget is not 1200')
  assert.equal(budget.currency, 'CNY', 'Budget currency changed')
  assert.equal(budget.scope, 'trip', 'Budget is not the total Trip budget')
  assert.equal(after.workspace.tripContextSummary.travelDays, 2, 'Budget period is not the same two-day Trip')
  const withoutBudget = summary => { const { budget, version, notes, ...rest } = summary; return rest }
  assert.ok(after.workspace.trip.contextVersion > before.workspace.trip.contextVersion, 'Budget update did not advance authoritative context version')
  assert.deepEqual(withoutBudget(after.workspace.tripContextSummary), withoutBudget(before.workspace.tripContextSummary), 'Budget update changed unrelated Trip context')
  const oldNotes = before.workspace.tripContextSummary.notes || [], newNotes = after.workspace.tripContextSummary.notes || []
  if (notesEquivalent) assert.equal(notesEquivalent(oldNotes, newNotes), true, 'Budget update changed non-budget note constraints')
  else assert.deepEqual(newNotes, oldNotes, 'Budget update changed notes without an explicit domain policy')
  assert.deepEqual(after.workspace.trip.selectedFlight, before.workspace.trip.selectedFlight, 'Budget update changed adopted flight')
  if (after.guide?.payload?.publication?.status === 'accepted') {
    assert.equal(after.guide.tripContextVersion, after.workspace.trip.contextVersion, 'Stale guide remains accepted after budget update')
    assert.deepEqual(after.guide.payload.budget, { amount: 1200, currency: 'CNY', scope: 'trip', partyBasis: 'unspecified', period: 'trip_total' }, 'Accepted guide does not match total budget')
  }
  return { amount: budget.amount, currency: budget.currency, scope: budget.scope, travelDays: 2, affordability: 'not_verified' }
}
function assertBudgetRetryCandidate(predecessor, notesEquivalent, origin = predecessor) {
  const before = origin.authoritativeBefore, after = predecessor.authoritativeAfter
  assert.equal(predecessor.terminal?.status, 'completed')
  if (predecessor === origin) {
    assert.equal(predecessor.terminal.response?.delivery?.status, 'satisfied')
    assert.equal(predecessor.terminal.response.delivery.kind, 'trip_context_update')
  } else {
    assert.ok(predecessor.budgetRetry && predecessor.retryTerminal, 'Missing explicit budget retry lineage')
    assert.equal(predecessor.terminal.response?.delivery?.status, 'not_requested')
    assert.equal(predecessor.terminal.response?.stopReason, 'responded')
    assert.ok(predecessor.terminal.response?.warnings?.includes('dsh_reply_withheld'), 'Only the diagnosed withheld no-update retry may continue')
    for (const key of ['guide', 'route', 'flight']) assert.deepEqual(after[key], predecessor.authoritativeBefore[key], `Withheld budget retry changed ${key}`)
    for (const key of ['trip', 'tripContextSummary', 'artifactRefs']) assert.deepEqual(after.workspace[key], predecessor.authoritativeBefore.workspace[key], `Withheld budget retry changed ${key}`)
  }
  assertTotalBudget(before, after, notesEquivalent)
  acceptedGuide(before)
  assert.equal(after.guide?.id, before.guide.id, 'Budget retry must retain the original guide')
  assert.equal(after.guide?.payload?.publication?.status, 'blocked', 'Budget retry only repairs the observed blocked guide')
  assert.ok(after.guide.payload.publication.issues?.some(issue => issue.code === 'stale'), 'Budget retry requires explicit stale publication evidence')
  assert.deepEqual(after.workspace.artifactRefs, before.workspace.artifactRefs, 'Budget attempt created artifacts; inspect before retrying')
  assert.deepEqual(after.route, before.route, 'Budget attempt changed the route')
  assert.deepEqual(after.flight, before.flight, 'Budget attempt changed the selected flight')
  return { priorContextVersion: before.workspace.trip.contextVersion, currentContextVersion: after.workspace.trip.contextVersion, guideId: after.guide.id, target: '1200 CNY / trip', staleGuide: true }
}
function assertBudgetConfirmCandidate(predecessor, notesEquivalent, origin) {
  const delivery = predecessor.terminal?.response?.delivery
  assert.equal(predecessor.terminal?.status, 'completed')
  if (predecessor.budgetConfirm) {
    assert.equal(delivery?.status, 'not_requested')
    assert.equal(predecessor.terminal.response.stopReason, 'responded')
    assert.ok(predecessor.terminal.response.warnings?.includes('dsh_reply_withheld'), 'Only diagnosed withheld confirmation may be retried')
    for (const key of ['guide', 'route', 'flight']) assert.deepEqual(predecessor.authoritativeAfter[key], predecessor.authoritativeBefore[key], `Withheld confirmation changed ${key}`)
    for (const key of ['trip', 'tripContextSummary', 'artifactRefs']) assert.deepEqual(predecessor.authoritativeAfter.workspace[key], predecessor.authoritativeBefore.workspace[key], `Withheld confirmation changed ${key}`)
  } else {
    assert.equal(delivery?.status, 'partial'); assert.equal(delivery.kind, 'trip_context_update')
    assert.deepEqual(delivery.missing, ['trip_field:budget'])
    assert.equal(predecessor.terminal.response.stopReason, 'goal_partial')
  }
  assert.ok((predecessor.budgetRetry || predecessor.budgetConfirm) && predecessor.retryTerminal, 'Budget confirmation requires retained original budget lineage')
  const before = origin.authoritativeBefore, after = predecessor.authoritativeAfter
  assertTotalBudget(before, after, notesEquivalent)
  const original = acceptedGuide(before), current = acceptedGuide(after)
  const map = new Map()
  for (const day of original.payload.days) {
    const next = current.payload.days.find(item => item.day === day.day)
    assert.ok(next); assert.equal(next.items.length, day.items.length)
    for (let i = 0; i < day.items.length; i++) {
      const old = day.items[i], value = next.items[i]
      if (map.has(value.sourceArtifactId)) assert.equal(map.get(value.sourceArtifactId), old.sourceArtifactId)
      map.set(value.sourceArtifactId, old.sourceArtifactId)
    }
  }
  const restoredDays = current.payload.days.map(day => ({ ...day, items: day.items.map(item => ({ ...item, sourceArtifactId: map.get(item.sourceArtifactId) })) }))
  assert.deepEqual(restoredDays, original.payload.days, 'Budget derivative changed activity identity, content, order or slots')
  const routeStable = payload => { const { tripContextVersion, sourceArtifactIds, ...rest } = payload; return rest }
  assert.deepEqual(routeStable(after.route.payload), routeStable(before.route.payload), 'Budget derivative changed the route plan')
  assert.deepEqual(after.route.payload.sourceArtifactIds.map(id => map.get(id)), before.route.payload.sourceArtifactIds, 'Budget derivative changed route source bindings')
  assert.deepEqual(after.flight, before.flight, 'Budget derivative changed flight artifact')
  assert.deepEqual(current.payload.flightSelection, original.payload.flightSelection)
  const refs = current.payload.publication.references || {}
  const originalRefs = original.payload.publication.references || {}
  const restoredRefs = Object.fromEntries(Object.entries(refs).map(([key, value]) => { const [id, finding] = JSON.parse(key); return [JSON.stringify([map.get(id) || id, finding]), value] }))
  assert.deepEqual(restoredRefs, originalRefs, 'Budget derivative changed published evidence references')
  return { guideId: current.id, guideContentHash: current.payload.publication.guideContentHash, currentContextVersion: after.workspace.trip.contextVersion,
    originalContextVersion: before.workspace.trip.contextVersion, sourceMapping: Object.fromEntries(map), failureKind: predecessor.budgetConfirm ? 'withheld_no_op' : 'partial_budget_receipt' }
}
function assertBudgetConfirmationResult({ before, after, terminal, reply, searchesBefore, searchesAfter }) {
  assert.equal(terminal?.status, 'completed')
  const response = terminal.response, delivery = response?.delivery
  assert.ok(!response?.warnings?.includes('dsh_reply_withheld'), 'Budget confirmation reply is withheld')
  assert.equal(searchesAfter, searchesBefore, 'Budget confirmation performed unnecessary research')
  acceptedGuide(after)
  const budget = after.workspace.tripContextSummary.budget
  assert.deepEqual(budget, { amount: 1200, currency: 'CNY', scope: 'trip' })
  assert.equal(after.guide.tripContextVersion, after.workspace.trip.contextVersion, 'Budget confirmation guide is stale')
  if (delivery?.status === 'satisfied') {
    assert.equal(delivery.kind, 'trip_context_update')
    return { resultKind: 'setter_confirmed', deliveryStatus: 'satisfied', searchCalls: 0 }
  }
  assert.equal(delivery?.status, 'not_requested'); assert.equal(response.stopReason, 'responded')
  assert.deepEqual(delivery.goals || [], []); assert.deepEqual(delivery.artifactIds || [], [])
  assert.deepEqual(response.artifactRefs || [], []); assert.deepEqual(terminal.artifactRefs || [], [])
  for (const key of ['trip', 'tripContextSummary', 'artifactRefs']) assert.deepEqual(after.workspace[key], before.workspace[key], `No-op confirmation changed ${key}`)
  for (const key of ['guide', 'route', 'flight']) assert.deepEqual(after[key], before[key], `No-op confirmation changed ${key}`)
  const visible = reply.replace(/[,，]/g, '').trim()
  assert.ok(/1200/.test(visible) && /合计|总预算|总额|整个行程|全程|总计/.test(visible), 'Visible reply does not confirm the 1200 total budget')
  assert.notEqual(reply.trim(), before.guide.payload.publication.reply?.trim(), 'Budget confirmation repeated the previous saved-guide reply')
  return { resultKind: 'no_op_confirmed', deliveryStatus: 'not_requested', unchangedAcceptedGuide: true, searchCalls: 0 }
}
function assertStableBudgetConfirmationBase(expected, current) {
  sameScope(expected, current)
  for (const key of ['trip', 'tripContextSummary', 'artifactRefs', 'messages']) assert.deepEqual(current.workspace[key], expected.workspace[key], `Budget confirmation changed ${key}`)
  for (const key of ['route', 'flight']) assert.deepEqual(current[key], expected[key], `Budget confirmation changed ${key}`)
  const guideStable = guide => { const { updatedAt, payload, ...record } = guide; const { publication, ...content } = payload; return { ...record, payload: content } }
  assert.deepEqual(guideStable(acceptedGuide(current)), guideStable(acceptedGuide(expected)), 'Budget confirmation changed guide plan or sources')
  assert.equal(current.guide.payload.publication.guideContentHash, expected.guide.payload.publication.guideContentHash, 'Budget confirmation changed guide hash')
}
function assertAcceptedEnglish(original, english) {
  assert.equal(english?.id, original.id, 'English text belongs to another guide')
  assert.equal(english.payload?.publication?.status, 'accepted', 'English publication is not accepted')
  assert.equal(english.payload.publication.locale, 'en', 'Publication is not English')
  assert.equal(english.payload.publication.guideContentHash, original.payload.publication.guideContentHash, 'Localization changed content version')
  const identities = guide => guide.payload.days.map(day => ({ day: day.day, city: day.city, kind: day.kind,
    items: day.items.map(item => ({ id: item.id, timeOfDay: item.timeOfDay, city: item.city, sourceArtifactId: item.sourceArtifactId, sourceFindingId: item.sourceFindingId })) }))
  assert.deepEqual(identities(english), identities(original), 'English localization changed identities, order, slots or source bindings')
}
function assertLocalization(before, after, english, budgetBefore, budgetAfter, events) {
  sameScope(before, after); sameFlight(before, after)
  const original = acceptedGuide(before), current = acceptedGuide(after)
  assert.equal(current.id, original.id, 'Localization created a new guide')
  assert.deepEqual(after.workspace.trip, before.workspace.trip, 'Localization mutated Trip/version/flight')
  assert.deepEqual(after.workspace.artifactRefs, before.workspace.artifactRefs, 'Localization changed artifact references')
  assert.deepEqual(current.payload.days, original.payload.days, 'Localization changed the original itinerary/prose')
  assert.deepEqual(after.route, before.route, 'Localization replanned the route')
  assertAcceptedEnglish(original, english)
  assert.equal(budgetAfter.searchCalls, budgetBefore.searchCalls, 'Localization started search')
  const priorIds = new Set(budgetBefore.callEntries.map(item => item.id))
  const calls = budgetAfter.callEntries.filter(item => !priorIds.has(item.id))
  assert.ok(calls.length >= 1 && calls.length <= 2, 'Expected one localization call and at most one bounded repair')
  assert.ok(calls.every(item => item.kind === 'model' && item.id.startsWith('localize:')), 'Localization started a main Agent/search call')
  assert.deepEqual(budgetAfter.callEntries.filter(item => priorIds.has(item.id)), budgetBefore.callEntries, 'Localization rewrote prior accounting')
  const mutations = events.filter(event => event.type === 'request' && !['GET', 'HEAD', 'OPTIONS'].includes(event.method))
  assert.equal(mutations.length, 1, 'Localization made extra API mutations')
  assert.equal(mutations[0].method, 'POST')
  assert.equal(mutations[0].path, `/v1/artifacts/${original.id}/localization`, 'Localization started a planner or another write')
  return { sameGuide: true, samePlanAndSources: true, searchCalls: 0, mainAgentCalls: 0, localizationCalls: calls.length }
}
module.exports = { acceptedGuide, assertPatch, assertTotalBudget, assertLocalization, assertEmptySeedRecovery, assertAdoptedFlight, assertBudgetRetryCandidate, assertBudgetConfirmCandidate, assertStableBudgetConfirmationBase, assertBudgetConfirmationResult, isBUnpublishedModelFailure, isBContextOnlyModelFailure, isBCommitIdempotencyFailure, assertBCommitIdempotencyObserver, normalizePlannerReply, assertRestoredPlannerReply, assertNewVersionLocalization, assertAcceptedEnglish, assertPublicBudgetProse }
