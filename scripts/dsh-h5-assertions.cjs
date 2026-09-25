const assert = require('node:assert/strict')
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
function assertTotalBudget(before, after) {
  sameScope(before, after)
  const budget = after.workspace.tripContextSummary?.budget
  assert.equal(budget?.amount, 1200, 'Authoritative Trip budget is not 1200')
  assert.equal(budget.currency, 'CNY', 'Budget currency changed')
  assert.equal(budget.scope, 'trip', 'Budget is not the total Trip budget')
  assert.equal(after.workspace.tripContextSummary.travelDays, 2, 'Budget period is not the same two-day Trip')
  const withoutBudget = summary => { const { budget, version, ...rest } = summary; return rest }
  assert.ok(after.workspace.trip.contextVersion > before.workspace.trip.contextVersion, 'Budget update did not advance authoritative context version')
  assert.deepEqual(withoutBudget(after.workspace.tripContextSummary), withoutBudget(before.workspace.tripContextSummary), 'Budget update changed unrelated Trip context')
  assert.deepEqual(after.workspace.trip.selectedFlight, before.workspace.trip.selectedFlight, 'Budget update changed adopted flight')
  if (after.guide?.payload?.publication?.status === 'accepted') {
    assert.equal(after.guide.tripContextVersion, after.workspace.trip.contextVersion, 'Stale guide remains accepted after budget update')
    assert.deepEqual(after.guide.payload.budget, { amount: 1200, currency: 'CNY', scope: 'trip', partyBasis: 'unspecified', period: 'trip_total' }, 'Accepted guide does not match total budget')
  }
  return { amount: budget.amount, currency: budget.currency, scope: budget.scope, travelDays: 2, affordability: 'not_verified' }
}
function assertLocalization(before, after, english, budgetBefore, budgetAfter, events) {
  sameScope(before, after); sameFlight(before, after)
  const original = acceptedGuide(before), current = acceptedGuide(after)
  assert.equal(current.id, original.id, 'Localization created a new guide')
  assert.deepEqual(after.workspace.trip, before.workspace.trip, 'Localization mutated Trip/version/flight')
  assert.deepEqual(after.workspace.artifactRefs, before.workspace.artifactRefs, 'Localization changed artifact references')
  assert.deepEqual(current.payload.days, original.payload.days, 'Localization changed the original itinerary/prose')
  assert.deepEqual(after.route, before.route, 'Localization replanned the route')
  assert.equal(english?.id, original.id, 'English text belongs to another guide')
  assert.equal(english.payload?.publication?.status, 'accepted', 'English publication is not accepted')
  assert.equal(english.payload.publication.locale, 'en', 'Publication is not English')
  assert.equal(english.payload.publication.guideContentHash, original.payload.publication.guideContentHash, 'Localization changed content version')
  const identities = guide => guide.payload.days.map(day => ({ day: day.day, city: day.city, kind: day.kind,
    items: day.items.map(item => ({ id: item.id, timeOfDay: item.timeOfDay, city: item.city, sourceArtifactId: item.sourceArtifactId, sourceFindingId: item.sourceFindingId })) }))
  assert.deepEqual(identities(english), identities(original), 'English localization changed identities, order, slots or source bindings')
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
module.exports = { acceptedGuide, assertPatch, assertTotalBudget, assertLocalization, assertEmptySeedRecovery }
