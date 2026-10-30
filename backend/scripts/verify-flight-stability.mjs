// Opt-in real Trip.com acceptance. Never included in npm test; no model/booking calls.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { repo, dataRoot } from '../src/paths.mjs'

const api = process.env.FLIGHT_STABILITY_API || 'http://127.0.0.1:3000'
const ui = process.env.FLIGHT_STABILITY_UI || 'http://127.0.0.1:4178'
assert.match(api, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/)
assert.match(ui, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/)
const rounds = Number(process.argv.find(a => a.startsWith('--rounds='))?.split('=')[1] || 2)
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',')
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 3)
const output = path.join(repo, 'output', 'flight-stability-20261026')
await fs.mkdir(output, { recursive: true })
const reportFile = path.join(output, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
const base = { origin: 'PVG', destination: 'LIS', departureDate: '2026-11-04', adults: 1, currency: 'CNY', cabin: 'economy', tripType: 'one_way' }
const q = patch => ({ ...base, ...patch })
export const cases = [
  ['T01', '具体机场到机场，国际单程', q({})],
  ['T02', '城市到城市，2成人', q({ origin: '北京', destination: '东京', departureDate: '2026-11-12', adults: 2 })],
  ['T03', '城市到机场，3成人', q({ origin: 'BJS', destination: 'HND', departureDate: '2026-11-13', adults: 3 })],
  ['T04', '机场到城市，4成人', q({ origin: 'PEK', destination: 'Tokyo', departureDate: '2026-11-14', adults: 4 })],
  ['T05', '国内城市，5成人', q({ origin: '北京', destination: '上海', departureDate: '2026-11-09', adults: 5 })],
  ['T06', '国内具体机场，9成人', q({ origin: 'PEK', destination: 'Shanghai Hongqiao International Airport', departureDate: '2026-11-08', adults: 9 })],
  ['T07', '城市机场往返，2成人', q({ origin: '上海', destination: 'HND', departureDate: '2026-11-12', returnDate: '2026-11-15', adults: 2, tripType: 'round_trip' })],
  ['T08', '机场城市往返，7成人', q({ origin: 'PEK', destination: 'Tokyo', departureDate: '2026-11-19', returnDate: '2026-11-22', adults: 7, tripType: 'round_trip' })],
  ['T09', '城市城市往返，6成人', q({ origin: '北京', destination: '东京', departureDate: '2026-11-07', returnDate: '2026-11-10', adults: 6, tripType: 'round_trip' })],
  ['T10', '跨年往返，8成人，SGD', q({ origin: 'PVG', destination: 'HND', departureDate: '2026-12-31', returnDate: '2027-01-03', adults: 8, currency: 'SGD', tripType: 'round_trip' })],
  ['T11', '香港到东京，HKD', q({ origin: 'HKG', destination: 'TYO', departureDate: '2026-11-05', currency: 'HKD' })],
  ['T12', '伦敦到巴黎，GBP', q({ origin: 'LHR', destination: 'CDG', departureDate: '2026-11-20', currency: 'GBP' })],
  ['T13', '纽约到伦敦，USD及时区切换', q({ origin: 'JFK', destination: 'LHR', departureDate: '2026-12-05', currency: 'USD' })],
  ['T14', '欧洲城市往返，EUR', q({ origin: 'London', destination: 'Paris', departureDate: '2026-11-10', returnDate: '2026-11-15', adults: 2, currency: 'EUR', tripType: 'round_trip' })],
  ['T15', '同条件新查询不复用旧快照', q({})],
  ['T16', '非法往返日期拒绝'], ['T17', '人数及币种边界拒绝'],
  ['T18', '运行中拒绝并发，取消且无迟到结果'],
  ['T19', '取消后立即完整查询恢复', q({})],
  ['T20', 'H5详情选票及三宽度刷新恢复']
].map(([id, name, query]) => ({ id, name, query }))
if (only) assert.ok(only.length > 0 && only.every(id => cases.some(item => item.id === id)), 'Unknown or empty case selection')
const records = [], summaries = new Map()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'))
async function request(method, route, body) {
  const response = await fetch(api + route, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
  return { status: response.status, value: await response.json() }
}
async function task(route, body, record, phase) {
  const start = Date.now(), accepted = await request('POST', route, body)
  assert.equal(accepted.status, 202, JSON.stringify(accepted.value))
  const id = accepted.value.id
  record.runs ??= []; record.runs.push(id)
  let run = accepted.value
  try {
    while (!['completed', 'failed', 'cancelled'].includes(run.stage)) {
      if (Date.now() - start > 230000) throw Error('Acceptance task timed out')
      await sleep(350)
      const status = await request('GET', '/api/runs/' + id)
      assert.equal(status.status, 200); run = status.value
    }
    record[phase + 'Ms'] = Date.now() - start
    assert.equal(run.stage, 'completed', `${run.errorCode || ''}: ${run.error || run.stage}`)
    assert.ok(!run.trip && run.planningRequested !== true, 'Flight task unexpectedly planned')
    return run
  } catch (error) {
    if (!['completed', 'failed', 'cancelled'].includes(run.stage)) await request('DELETE', '/api/runs/' + id)
    throw error
  }
}
function money(candidate, query) {
  assert.ok(candidate.price.amount > 0)
  assert.equal(candidate.price.currency, query.currency)
  assert.equal(candidate.price.basis, 'per_adult')
  assert.equal(candidate.price.checkoutVerified, false)
  if (query.adults > 1) assert.ok(candidate.price.totalAmount > 0, 'Missing explicitly read group total')
}
async function fullCase(item, record) {
  const query = item.query
  if (item.id === 'T15' && !summaries.has(record.round)) {
    const first = await task('/api/flights/search', { query }, record, 'repeatBaseline')
    const id = first.conversation.flightOptions.searchId
    summaries.set(record.round, await read(path.join(dataRoot, 'flight-results', id + '.json')))
    record.repeatBaselineSearchId = id
  }
  const run = await task('/api/flights/search', { query }, record, 'summary')
  const conversation = run.conversation, options = conversation.flightOptions
  record.conversationId = conversation.id; record.searchId = options.searchId
  const raw = await read(path.join(dataRoot, 'flight-results', options.searchId + '.json'))
  assert.equal(raw.status, 'complete'); assert.equal(raw.resultLevel, 'summary')
  assert.equal(raw.lowestPriceVerified, false)
  for (const [key, value] of Object.entries(query)) assert.equal(raw.query[key], value, key)
  assert.equal(raw.candidates.length, 3); assert.equal(options.options.length, 3)
  for (const candidate of raw.candidates) {
    money(candidate, query)
    assert.equal(candidate.detailsState, 'deferred'); assert.equal(candidate.details, null)
    const journeys = candidate.journeys || [candidate]
    assert.equal(journeys.length, query.tripType === 'round_trip' ? 2 : 1)
    for (const [index, journey] of journeys.entries()) {
      const from = index === 0 ? raw.resolved.origin : raw.resolved.destination
      const to = index === 0 ? raw.resolved.destination : raw.resolved.origin
      assert.ok(from.airports.includes(journey.departureAirport), 'Wrong departure airport')
      assert.ok(to.airports.includes(journey.arrivalAirport), 'Wrong arrival airport')
      assert.equal(journey.departureLocal.slice(0, 10), index === 0 ? query.departureDate : query.returnDate)
    }
  }
  if (item.id === 'T15') {
    const first = summaries.get(record.round)
    assert.notEqual(raw.searchId, first.searchId)
    assert.ok(raw.observedAt > first.observedAt)
  }
  if (item.id === 'T01') summaries.set(record.round, raw)
  const candidate = raw.candidates[2], selection = { searchId: raw.searchId, candidateId: candidate.id }
  const detail = await task('/api/flights/details', { conversationId: conversation.id, selection, select: false }, record, 'details')
  assert.ok(!detail.conversation.selectedFlight)
  const ready = detail.conversation.flightOptions.options[2]
  assert.equal(ready.detailsState, 'ready'); assert.ok(ready.segments.length > 0)
  assert.equal(ready.amount, candidate.price.amount)
  const selected = await task('/api/flights/details', { conversationId: conversation.id, selection, select: true }, record, 'selection')
  assert.deepEqual(selected.conversation.selectedFlight, selection)
  const restored = await request('GET', '/api/conversations/' + conversation.id)
  assert.equal(restored.status, 200)
  assert.deepEqual(restored.value.selectedFlight, selection)
  assert.ok(restored.value.messages.some(message => message.flightOptions?.searchId === raw.searchId))
  const evidence = await read(path.join(dataRoot, 'conversation-evidence', conversation.id + '.json'))
  assert.equal(evidence.length, 3)
  for (const result of evidence.slice(1)) {
    assert.equal(result.detailAccess, 'live_page'); assert.equal(result.candidate.id, candidate.id)
    money(result.candidate, query); assert.equal(result.candidate.price.amount, candidate.price.amount)
    assert.ok(result.candidate.details.segments.length > 0)
  }
  const diagnostic = await read(path.join(repo, 'trip-flight-tool', 'artifacts', raw.searchId, `attempt-${raw.attempts}-diagnostic.json`))
  assert.equal(diagnostic.phase, 'completed'); assert.equal(diagnostic.retained, true)
  Object.assign(record, { attempts: raw.attempts, searchEntry: diagnostic.searchEntry, reusedContext: diagnostic.reusedContext, segments: ready.segments.length, detailAccess: evidence.slice(1).map(value => value.detailAccess) })
}
async function invalidCase(item, record) {
  const queries = item.id === 'T16' ? [q({ tripType: 'round_trip' }), q({ tripType: 'round_trip', returnDate: '2026-11-03' }), q({ returnDate: '2026-11-05' })]
    : [q({ adults: 0 }), q({ adults: 10 }), q({ adults: 1.5 }), q({ currency: 'JPY' })]
  for (const query of queries) {
    const result = await request('POST', '/api/flights/search', { query })
    assert.equal(result.status, 400); assert.ok(!result.value.id)
  }
  record.rejectedInputs = queries.length
}
async function cancelCase(record) {
  const accepted = await request('POST', '/api/flights/search', { query: base })
  assert.equal(accepted.status, 202); record.runs = [accepted.value.id]
  await sleep(1500)
  const busy = await request('POST', '/api/flights/search', { query: base })
  assert.equal(busy.status, 409)
  const start = Date.now(), cancelled = await request('DELETE', '/api/runs/' + accepted.value.id)
  record.cleanupMs = Date.now() - start
  assert.equal(cancelled.status, 200); assert.equal(cancelled.value.stage, 'cancelled')
  assert.ok(!cancelled.value.conversation)
  await sleep(500)
  const late = await request('GET', '/api/runs/' + accepted.value.id)
  assert.equal(late.value.stage, 'cancelled'); assert.ok(!late.value.conversation)
}
async function uiCase(record) {
  const { chromium } = await import('../../trip-flight-tool/node_modules/playwright/index.mjs')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [], posts = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/flights/details')) posts.push(req.postDataJSON()) })
    await page.goto(ui)
    await page.locator('.pl-flight-link').click()
    await page.getByRole('button', { name: /选择出发地/ }).click()
    await page.getByRole('textbox', { name: '选择出发地，输入中文、英文或机场代码' }).fill('PVG')
    await page.locator('.fl-location-option').filter({ has: page.locator('.fl-location-code', { hasText: 'PVG' }) }).first().click()
    await page.getByRole('button', { name: /选择去程日期/ }).click()
    await page.getByRole('button', { name: '下个月', exact: true }).click()
    await page.getByRole('button', { name: base.departureDate, exact: true }).click()
    await page.getByRole('button', { name: '确定日期', exact: true }).click()
    const start = Date.now()
    await page.getByRole('button', { name: '搜索航班', exact: true }).click()
    const appeared = await page.waitForFunction(() => document.querySelector('.fl-live-results .fc-ticket') ? 'cards' : document.querySelector('.fl-form-error')?.textContent?.trim() ? 'error' : false, undefined, { timeout: 230000 })
    assert.equal(await appeared.jsonValue(), 'cards', (await page.locator('.fl-form-error').allTextContents()).join(''))
    record.summaryMs = Date.now() - start
    const results = page.locator('.fl-live-results')
    assert.equal(await results.locator('.fc-ticket').count(), 3); assert.equal(posts.length, 0)
    let phase = Date.now()
    await results.locator('.fc-detail').nth(2).click()
    await results.locator('.fc-leg').first().waitFor({ timeout: 230000 })
    record.detailsMs = Date.now() - phase
    phase = Date.now()
    await page.getByRole('button', { name: '选择这班航班', exact: true }).click()
    await results.locator('.fc-ticket.is-selected').waitFor({ timeout: 230000 })
    record.selectionMs = Date.now() - phase
    assert.equal(posts.length, 2); assert.equal(posts[0].select, false); assert.equal(posts[1].select, true)
    record.searchId = posts[0].selection.searchId; record.conversationId = posts[0].conversationId
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: path.join(output, `round-${record.round}-${width}.png`) })
    }
    await page.reload()
    await page.locator('.fc-ticket.is-selected').first().waitFor({ timeout: 20000 })
    const restored = await request('GET', '/api/conversations/' + record.conversationId)
    assert.deepEqual(restored.value.selectedFlight, posts[0].selection)
    assert.deepEqual(errors, []); record.widths = [320, 390, 1440]; record.pageErrors = errors
  } finally { await browser.close() }
}
assert.equal((await request('GET', '/api/health')).status, 200)
console.log(JSON.stringify({ event: 'started', reportFile, rounds, cases: cases.filter(item => !only || only.includes(item.id)).map(item => ({ id: item.id, name: item.name, query: item.query })) }))
let failed = false
outer: for (let round = 1; round <= rounds; round++) {
  for (const item of cases.filter(item => !only || only.includes(item.id))) {
    const start = Date.now(), record = { round, id: item.id, name: item.name, query: item.query, startedAt: new Date().toISOString() }
    console.log(JSON.stringify({ event: 'case_start', round, id: item.id }))
    try {
      if (item.query) await fullCase(item, record)
      else if (['T16', 'T17'].includes(item.id)) await invalidCase(item, record)
      else if (item.id === 'T18') await cancelCase(record)
      else await uiCase(record)
      record.status = 'passed'
    } catch (error) {
      record.status = 'failed'; record.error = error.message; failed = true
    }
    record.totalMs = Date.now() - start
    records.push(record)
    await fs.writeFile(reportFile, JSON.stringify({ api, ui, rounds, records }, null, 2))
    console.log(JSON.stringify(record))
    if (failed) break outer
  }
}
console.log(JSON.stringify({ event: 'finished', reportFile, passed: records.filter(item => item.status === 'passed').length, failed: records.filter(item => item.status === 'failed').length }))
process.exitCode = failed ? 1 : 0
