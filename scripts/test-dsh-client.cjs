const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/features/ui-experience/backendClient.ts'), 'utf8')
const moduleValue = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: moduleValue.exports, module: moduleValue, Set, Error, Promise, setTimeout })
const { createConversationClient, createGenerator, createPlaceMediaLoader, createPlaceLocationLoader, PlanCancellation, restoreTrip } = moduleValue.exports
async function main() {
  const methods = []
  let finish
  let published = false
  const cancellation = new PlanCancellation()
  const generate = createGenerator(async method => {
    methods.push(method)
    if (method === 'POST') return { id: 'cancelled-run' }
    if (method === 'GET') return new Promise(resolve => { finish = resolve })
    return { stage: 'cancelled' }
  }, () => { published = true })
  const pending = generate('test', () => {}, cancellation.signal)
  await new Promise(resolve => setTimeout(resolve, 0))
  cancellation.abort()
  finish({ stage: 'completed', trip: { id: 'late-result' } })
  await assert.rejects(pending, /已取消/)
  assert.ok(methods.includes('DELETE'))
  assert.equal(published, false)
  const restored = await restoreTrip(async () => ({ stage: 'completed', trip: { id: 'saved', provenance: 'dsh' } }), 'saved-id')
  assert.equal(restored.id, 'saved')
  assert.equal(await restoreTrip(async () => ({ stage: 'completed', trip: { id: 'sample' } }), 'sample-id'), null)
  let saved = null, completed = null
  const sent = []
  const chat = createConversationClient(async (method, route, body) => {
    if (method === 'POST') { sent.push(body); return { id: 'chat-turn' } }
    if (route.includes('/conversations/')) return { id: saved, messages: [] }
    return { stage: 'completed', conversation: { id: 'context-1', messages: sent.at(-1).action === 'plan' ? [{ id: 'plan-reply', role: 'assistant', trip: { id: 'live-chat-turn' } }] : [] }, ...(sent.at(-1).action === 'plan' ? { trip: { id: 'live-chat-turn' } } : {}) }
  }, { get: () => saved, set: id => { saved = id }, clear: () => { saved = null } }, id => { completed = id })
  await chat.send('先聊聊', () => {}, new PlanCancellation().signal)
  assert.equal(sent[0].action, 'chat'); assert.equal(completed, null)
  await chat.send('现在生成', () => {}, new PlanCancellation().signal, 'plan')
  assert.equal(sent[1].conversationId, 'context-1'); assert.equal(completed, 'chat-turn')
  assert.equal((await chat.load()).id, 'context-1'); chat.reset(); assert.equal(await chat.load(), null)
  const flightCalls = []
  let flightConversation = 'current-conversation'
  const flightClient = createConversationClient(async (method, route, body) => {
    flightCalls.push({ method, route, body })
    if (route === '/api/flights/search') return { id: 'manual-search' }
    if (route === '/api/runs/manual-search') return { stage: 'completed', conversation: { id: 'current-conversation', messages: [], flightOptions: { searchId: 'native-round-trip', options: [] } } }
    return { id: 'current-conversation', messages: [] }
  }, { get: () => flightConversation, set: id => { flightConversation = id }, clear: () => {} }, () => assert.fail('flight search must not publish a trip'))
  const manualQuery = { origin: 'BJS', destination: 'LIS', departureDate: '2026-10-31', tripType: 'round_trip', returnDate: '2026-11-03', adults: 1, cabin: 'economy', currency: 'CNY' }
  const found = await flightClient.searchFlights(manualQuery, () => {}, new PlanCancellation().signal)
  assert.equal(found.flightOptions.searchId, 'native-round-trip')
  assert.equal(flightCalls[0].body.query.returnDate, '2026-11-03')
  assert.equal(flightCalls[0].body.conversationId, 'current-conversation')
  assert.ok(flightCalls.every(call => call.route !== '/api/conversations/turns' && call.route !== '/api/runs'))
  console.log('PASS manual search polls the tool job, retains the conversation and never creates a planning request')
  const detailCalls = []
  const detailClient = createConversationClient(async (method, route, body) => {
    detailCalls.push({ method, route, body })
    if (method === 'POST') return { id: 'detail-job' }
    return { stage: 'completed', conversation: { id: 'current-conversation', messages: [], selectedFlight: { searchId: 'search', candidateId: 'candidate' } } }
  }, { get: () => 'current-conversation', set: () => {}, clear: () => {} })
  const selection = { searchId: 'search', candidateId: 'candidate' }
  await detailClient.loadFlightDetails(selection, new PlanCancellation().signal)
  await detailClient.selectFlight(selection)
  assert.equal(detailCalls[0].route, '/api/flights/details'); assert.equal(detailCalls[0].body.select, false)
  assert.equal(detailCalls[2].body.select, true)
  assert.ok(detailCalls.every(call => call.route !== '/api/conversations/turns' && !call.route.endsWith('/flight-selection')))
  const detailAbort = new PlanCancellation(); let completeDetail, detailCancelled = false
  const cancellingDetails = createConversationClient(async (method) => {
    if (method === 'POST') return { id: 'cancel-detail' }
    if (method === 'DELETE') { detailCancelled = true; return {} }
    return new Promise(resolve => { completeDetail = resolve })
  }, { get: () => 'current-conversation', set: () => {}, clear: () => {} })
  const pendingSelection = cancellingDetails.selectFlight(selection, detailAbort.signal)
  await new Promise(resolve => setTimeout(resolve, 0)); detailAbort.abort()
  await assert.rejects(pendingSelection, /已取消/); assert.equal(detailCancelled, true)
  completeDetail({ stage: 'completed', conversation: { id: 'late' } })
  console.log('PASS deferred details and selection use cancellable async price-check tasks without planning')
  const cancelledChat = new PlanCancellation()
  let resolveTurn, posted
  const lateChat = createConversationClient(async (method) => {
    if (method === 'POST') return { id: 'late-chat' }
    if (method === 'GET') { posted = true; return new Promise(resolve => { resolveTurn = resolve }) }
    return {}
  }, { get: () => null, set: () => assert.fail('late history must not persist'), clear: () => {} })
  const late = lateChat.send('消息', () => assert.fail('late progress must not publish'), cancelledChat.signal)
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(posted, true); cancelledChat.abort()
  await assert.rejects(late, /已取消/)
  resolveTurn({ stage: 'completed', conversation: { id: 'late', messages: [] } })
  let submit, deleted = false
  const earlyCancellation = new PlanCancellation()
  const earlyChat = createConversationClient(async method => {
    if (method === 'POST') return new Promise(resolve => { submit = resolve })
    if (method === 'DELETE') { deleted = true; return {} }
    assert.fail('cancelled submission must not poll')
  }, { get: () => null, set: () => assert.fail('cancelled submission must not save'), clear: () => {} })
  const early = earlyChat.send('消息', () => assert.fail('cancelled progress'), earlyCancellation.signal)
  earlyCancellation.abort()
  await assert.rejects(early, /已取消/)
  submit({ id: 'late-post' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(deleted, true)
  const updates = []
  let poll = 0
  const progressChat = createConversationClient(async method => {
    if (method === 'POST') return { id: 'progress' }
    poll++
    return { stage: poll === 1 ? 'chatting' : 'completed', progress: { text: poll === 1 ? '正在调用工具查询资料' : '回复已保存' }, ...(poll === 2 ? { conversation: { id: 'done', messages: [] } } : {}) }
  }, { get: () => null, set: () => {}, clear: () => {} })
  await progressChat.send('消息', text => updates.push(text), new PlanCancellation().signal)
  assert.deepEqual(updates, ['正在调用工具查询资料', '回复已保存'])
  let mediaCalls = 0
  const loadMedia = createPlaceMediaLoader(async (method, route, body) => {
    mediaCalls++; assert.equal(route, '/api/place-media'); assert.equal(body.query, 'Charles Bridge')
    return { status: 'ready', media: { src: 'https://thumb.wikimedia.org/test.jpg' } }
  })
  const place = { name: '查理大桥', imageQuery: 'Charles Bridge', area: 'Prague' }
  const images = await Promise.all([loadMedia(place, '布拉格'), loadMedia(place, '布拉格')])
  assert.equal(mediaCalls, 1); assert.equal(images[0].src, images[1].src)
  assert.equal(await loadMedia({ ...place, imageQuery: null }, '布拉格'), null)
  assert.equal(mediaCalls, 1)
  console.log('PASS place media deduplicates requests and skips non-landmark activities')
  let locationCalls = 0
  const loadLocation = createPlaceLocationLoader(async (method, route, body) => { locationCalls++; assert.equal(route, '/api/place-locations'); assert.equal(body.city, 'Prague'); return { status: 'resolved', location: { latitude: 50.08, longitude: 14.41 } } })
  const located = await Promise.all([loadLocation(place), loadLocation(place)])
  assert.equal(locationCalls, 1); assert.equal(located[0].latitude, 50.08)
  assert.equal(await loadLocation({ ...place, imageQuery: null }), null)
  assert.equal(await loadLocation({ ...place, area: '' }), null)
  assert.equal(locationCalls, 1)
  console.log('PASS landmark coordinates deduplicate and skip ambiguous cityless or generic activities')
  console.log('PASS cancellation signals backend and ignores late result; saved real result restores; sample result is not restored as live')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
