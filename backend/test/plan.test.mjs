import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { runPlan } from '../src/plan.mjs'
import { parseReview, toPresentation } from '../src/contract.mjs'

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
  assert.ok(value.trip.description.includes('资料不足')); assert.equal(value.trip.days[0].activities[0].latitude, null)
})
test('non-JSON output is preserved as readable text rather than blocked', () => {
  assert.equal(toPresentation(parseReview('资料不足，建议先沿河散步。'), 'id').description, '资料不足，建议先沿河散步。')
  assert.doesNotThrow(() => toPresentation(parseReview('{}'), 'id'))
})
test('longer trips and busy days are not truncated', () => {
  const value = candidate(); value.days = Array.from({ length: 9 }, () => ({ activities: Array.from({ length: 9 }, () => ({ name: '游览' })) }))
  const trip = toPresentation(value, 'id'); assert.equal(trip.days.length, 9); assert.equal(trip.days[0].activities.length, 9)
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
test('displayed flight facts come directly from CLI, and missing snapshots do not block the trip', () => {
  const value = candidate(); value.flightSelection = { searchId: 'search-1', candidateId: 'flight-1', price: 1 }
  const record = { searchId: 'search-1', query: { departureDate: '2026-11-06' }, observedAt: '2026-10-19T00:00:00Z', sourceUrl: 'https://www.trip.com/', candidates: [{ id: 'flight-1', airlines: ['航司'], price: { amount: 4123, currency: 'CNY' }, details: { segments: [{ origin: 'BJS', destination: 'TYO', departureLocal: '2026-11-06T10:00', arrivalLocal: '2026-11-06T14:00' }] } }] }
  const trip = toPresentation(value, 'id', record)
  assert.equal(trip.flights[0].price.amount, 4123); assert.equal(trip.flights[0].legs[0].depart, '2026-11-06T10:00')
  assert.equal(toPresentation(value, 'id').flights.length, 0)
})
