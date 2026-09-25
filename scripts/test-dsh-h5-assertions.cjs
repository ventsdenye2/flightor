const { test } = require('node:test')
const assert = require('node:assert/strict')
const { assertPatch, assertTotalBudget, assertLocalization, assertEmptySeedRecovery } = require('./dsh-h5-assertions.cjs')
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
function patch(before) {
  const after = structuredClone(before); after.guide.id = 'patched'
  Object.assign(after.guide.payload.days[1].items[1], { id: 'replacement', title: 'Museum', sourceFindingId: 'replacement' })
  return after
}
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
