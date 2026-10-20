import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { runPlan } from '../src/plan.mjs'
import { parseReview, toPresentation } from '../src/contract.mjs'
import { PlaceBatch } from '../src/place-batch.mjs'

const candidate = () => ({ title: '东京两日', destination: '东京', overview: '历史与散步', travelers: 1, days: [1, 2].map(day => ({ day, theme: '轻松游览', activities: [{ name: day === 1 ? '浅草寺' : '上野', description: '建议慢慢游览', sources: [] }] })), issues: [] })
function fakeAgents(review) {
  const calls = []
  class Agent {
    constructor(options) { Object.assign(this, options) }
    async start() {}
    async run(input) {
      calls.push({ role: this.role, sessionId: this.sessionId, input })
      if (this.role === 'planner') { this.onEvent(this.role, { type: 'tool/result', data: { text: '实际工具证据' } }); return { text: '第一天浅草寺，第二天上野。' } }
      return { text: typeof review === 'string' ? review : JSON.stringify(review) }
    }
    async close() {}
  }
  return { Agent, calls }
}
const run = () => ({ id: 'test-' + crypto.randomUUID(), prompt: '东京两天，必去浅草寺' })

test('two independent sessions exchange original demand and actual tool evidence', async () => {
  const { Agent, calls } = fakeAgents(candidate()); const value = run()
  await runPlan(value, { Agent })
  assert.equal(value.stage, 'completed'); assert.equal(value.trip.days.length, 2)
  assert.notEqual(calls[0].sessionId, calls[1].sessionId)
  assert.ok(calls[1].input.includes(value.prompt)); assert.ok(calls[1].input.includes('实际工具证据'))
})
test('incomplete information and reviewer objections publish without repair or veto', async () => {
  const draft = candidate(); draft.issues = [{ severity: 'error', detail: '资料不足' }]; draft.days = [{ activities: [{}] }]
  const { Agent, calls } = fakeAgents(draft); const value = run()
  await runPlan(value, { Agent })
  assert.equal(value.stage, 'completed'); assert.equal(calls.length, 2)
  assert.ok(value.trip.travelNotes.includes('资料不足')); assert.equal(value.trip.days[0].activities[0].latitude, null)
})
test('non-JSON output is preserved as readable text rather than blocked', () => {
  assert.equal(toPresentation(parseReview('资料不足，建议先沿河散步。'), 'id').description, '资料不足，建议先沿河散步。')
  assert.doesNotThrow(() => toPresentation(parseReview('{}'), 'id'))
})
test('longer trips and busy days are not truncated', () => {
  const value = candidate(); value.days = Array.from({ length: 9 }, () => ({ activities: Array.from({ length: 9 }, () => ({ name: '游览' })) }))
  const trip = toPresentation(value, 'id'); assert.equal(trip.days.length, 9); assert.equal(trip.days[0].activities.length, 9)
})
test('editorial sections stay separate and model image URLs are not trusted', () => {
  const trip = toPresentation({ overview: '沿河慢行，感受两座城市的历史。', highlights: [{ title: '城堡与河岸', description: '在步行路线里串联建筑与风景。' }, {}], issues: [{ detail: '出发前确认预约。' }], days: [{ activities: [{ name: '查理大桥', description: '清晨步行过桥。', introduction: '横跨伏尔塔瓦河的历史桥梁。', recommendationReason: '你喜欢建筑，桥上的雕塑值得慢看。', visitNotes: '注意保管随身物品。', imageQuery: 'Charles Bridge', city: 'Prague', media: { src: 'https://fake.example/photo.jpg' } }, { name: '自由活动', imageQuery: null }] }] }, 'editorial')
  assert.equal(trip.description, '沿河慢行，感受两座城市的历史。')
  assert.deepEqual(trip.travelNotes, ['出发前确认预约。'])
  assert.equal(trip.highlights.length, 1)
  const activity = trip.days[0].activities[0]
  assert.match(activity.introduction, /伏尔塔瓦/); assert.match(activity.recommendationReason, /你喜欢建筑/)
  assert.equal(activity.summary, '清晨步行过桥。'); assert.equal(activity.imageQuery, 'Charles Bridge'); assert.equal(activity.area, 'Prague')
  assert.equal(activity.media, null); assert.equal(trip.days[0].activities[1].imageQuery, null)
})
test('cancellation does not publish a late trip', async () => {
  const controller = new AbortController(); const { Agent } = fakeAgents(candidate()); const value = run()
  await assert.rejects(runPlan(value, { Agent, signal: controller.signal, onChange: async r => { if (r.stage === 'planning') controller.abort() } }))
  assert.equal(value.trip, undefined); assert.equal(value.stage, 'cancelled')
})
test('failed persistence does not report a saved result', async () => {
  const { Agent } = fakeAgents(candidate()); const value = run()
  await assert.rejects(runPlan(value, { Agent, onChange: async update => { if (update.stage === 'completed') throw Error('disk unavailable') } }), /disk unavailable/)
  assert.equal(value.trip, undefined); assert.equal(value.stage, 'failed')
})
test('conversation save runs before a completed plan is published', async () => {
  const { Agent } = fakeAgents(candidate()); const value = run()
  let saved = false
  await runPlan(value, { Agent, beforeComplete: async completed => { assert.equal(completed.trip.provenance, 'dsh'); saved = true }, onChange: async update => { if (update.stage === 'completed') assert.equal(saved, true) } })
  assert.equal(value.stage, 'completed')
})
test('displayed flight facts come directly from CLI, and missing snapshots do not block the trip', () => {
  const value = candidate(); value.flightSelection = { searchId: 'search-1', candidateId: 'flight-1', price: 1 }
  const record = { searchId: 'search-1', query: { departureDate: '2026-11-06' }, observedAt: '2026-10-19T00:00:00Z', sourceUrl: 'https://www.trip.com/', candidates: [{ id: 'flight-1', airlines: ['航司'], price: { amount: 4123, currency: 'CNY' }, details: { segments: [{ origin: 'BJS', destination: 'TYO', departureLocal: '2026-11-06T10:00', arrivalLocal: '2026-11-06T14:00' }] } }] }
  const trip = toPresentation(value, 'id', record)
  assert.equal(trip.flights[0].price.amount, 4123); assert.equal(trip.flights[0].legs[0].depart, '2026-11-06T10:00')
  assert.equal(toPresentation(value, 'id').flights.length, 0)
})

test('round-trip presentation separates directions and charges the combined fare once', () => {
  const record = { searchId: 'search', query: { departureDate: '2026-10-28' }, observedAt: '2026-10-20T00:00:00Z', sourceUrl: 'https://www.trip.com/', candidates: [{
    id: 'pair', airlines: ['航空公司'], price: { amount: 5600, currency: 'CNY' }, journeys: [
      { direction: 'outbound', airlines: ['去程航司'], departureAirport: 'PEK', arrivalAirport: 'PRG', departureLocal: '2026-10-28T10:00:00', arrivalLocal: '2026-10-28T19:00:00', durationMinutes: 900, details: null },
      { direction: 'return', airlines: ['返程航司'], departureAirport: 'PRG', arrivalAirport: 'PEK', departureLocal: '2026-11-03T12:00:00', arrivalLocal: '2026-11-04T07:00:00', durationMinutes: 850, details: null }
    ]
  }] }
  const trip = toPresentation({ flightSelection: { searchId: 'search', candidateId: 'pair' } }, 'rt', record)
  assert.equal(trip.flights.length, 2)
  assert.equal(trip.flights[1].dateLabel, '2026-11-03')
  assert.equal(trip.flights[1].legs[0].from, 'PRG')
  assert.equal(trip.flights[1].legs[0].depart, '2026-11-03T12:00:00')
  assert.equal(trip.flights[0].price.amount, 5600)
  assert.equal(trip.flights[1].price.amount, null)
  assert.equal(trip.flights[1].priceIncluded, true)
})

test('reviewer uses one session/turn for batch lookup and refinement; backend merges reordered IDs', async () => {
  const calls = [], tools = []
  const image = { src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Paris.jpg', author: 'Photographer', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', source: { url: 'https://commons.wikimedia.org/wiki/File:Paris.jpg' } }
  const lookup = { lookup: async (input, { fields }) => {
    tools.push({ query: input.query, fields })
    return Object.fromEntries(fields.map(field => [field, field === 'image' ? { status: 'found', value: image } : input.query === 'unclear' ? { status: 'not-found' } : { status: 'found', value: { latitude: input.name === 'A' ? 10 : 20, longitude: 2 } }]))
  } }
  class Agent {
    constructor(options) { Object.assign(this, options) }
    async start() {}
    async close() {}
    async run() {
      calls.push({ role: this.role, sessionId: this.sessionId })
      if (this.role === 'planner') return { text: 'A and B' }
      const batch = new PlaceBatch({ file: this.placeLedgerFile, lookup })
      await batch.run({ places: [{ id: 'a', name: 'A', city: 'Paris', query: 'unclear' }, { id: 'b', name: 'B', city: 'Paris', query: 'B' }] })
      await batch.run({ places: [{ id: 'a', name: 'A', city: 'Paris', query: 'A Paris', fields: ['location'] }] })
      return { text: JSON.stringify({ days: [{ activities: [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }] }] }) }
    }
  }
  const value = run()
  await runPlan(value, { Agent, placeLookup: lookup })
  assert.deepEqual(calls.map(call => call.role), ['planner', 'reviewer'])
  assert.deepEqual(tools[2].fields, ['location'])
  assert.deepEqual(value.trip.days[0].activities.map(a => a.latitude), [20, 10])
  assert.ok(value.trip.days[0].activities.every(a => a.media.src === image.src))
  assert.equal(value.trip.placesResolved, true)
})
test('optional metadata timeout publishes partial results without another model turn', async () => {
  const review = { days: [{ activities: [{ id: 'a', name: 'Place', city: 'Paris', imageQuery: 'Place' }] }] }
  const { Agent, calls } = fakeAgents(review), value = run()
  const image = { src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Paris.jpg', author: 'Photographer', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', source: { url: 'https://commons.wikimedia.org/wiki/File:Paris.jpg' } }
  await runPlan(value, { Agent, placeBudgetMs: 500, placeLookup: { lookup: async (_input, { onField }) => {
    await onField('image', { status: 'found', value: image })
    return new Promise(() => {})
  } } })
  assert.equal(value.stage, 'completed'); assert.equal(calls.length, 2)
  assert.equal(value.trip.days[0].activities[0].media.src, image.src)
  assert.equal(value.trip.days[0].activities[0].latitude, null)
})
