import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PlaceBatch, placeBudgetMs } from '../src/place-batch.mjs'
import { dataRoot } from '../src/paths.mjs'
import { toPresentation } from '../src/contract.mjs'

const media = { src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/City.jpg', author: 'Photographer', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', source: { label: 'Commons', url: 'https://commons.wikimedia.org/wiki/File:City.jpg' } }
const location = { latitude: 48.86, longitude: 2.34, source: { url: 'https://www.wikidata.org/wiki/Q90' } }
const place = (id = 'd1-a1', query = 'Louvre') => ({ id, name: '卢浮宫', city: 'Paris', query })
async function fixture(t, lookup, options = {}) {
  const root = await fs.mkdtemp(path.join(dataRoot, 'place-batch-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return new PlaceBatch({ file: path.join(root, 'ledger.json'), lookup: { lookup }, budgetMs: 5000, ...options })
}
test('default budget scales with the first batch count and survives subset refinement and restore', async t => {
  const previous = process.env.FLIGHTOR_PLACE_BUDGET_MS
  delete process.env.FLIGHTOR_PLACE_BUDGET_MS
  t.after(() => { if (previous === undefined) delete process.env.FLIGHTOR_PLACE_BUDGET_MS; else process.env.FLIGHTOR_PLACE_BUDGET_MS = previous })
  for (const [count, expected] of [[0, 5000], [1, 7000], [6, 17000], [16, 37000], [36, 77000], [60, 125000]]) assert.equal(placeBudgetMs(count), expected)
  let now = Date.now()
  const lookup = async (_input, { fields }) => Object.fromEntries(fields.map(field => [field, { status: 'not-found' }]))
  const batch = await fixture(t, lookup, { budgetMs: undefined, now: () => now })
  await batch.run({ places: Array.from({ length: 16 }, (_, i) => place(`d1-a${i + 1}`)) })
  const state = await batch.read(), deadline = state.deadline
  assert.equal(deadline - state.startedAt, 37000)
  now += 10000
  const restored = new PlaceBatch({ file: batch.file, lookup: { lookup }, now: () => now })
  const refined = await restored.run({ places: [{ ...place('d1-a1', 'Louvre Paris'), fields: ['location'] }] })
  assert.equal(refined.remainingMs, 27000)
  assert.equal((await restored.read()).deadline, deadline)
  process.env.FLIGHTOR_PLACE_BUDGET_MS = '12000'
  assert.equal(placeBudgetMs(16), 12000)
  process.env.FLIGHTOR_PLACE_BUDGET_MS = 'invalid'
  assert.equal(placeBudgetMs(16), 37000)
})
test('successful fields lock; only missing field is queried once with corrected keywords', async t => {
  const calls = []
  const batch = await fixture(t, async (input, { fields }) => {
    calls.push({ input, fields })
    return Object.fromEntries(fields.map(field => [field, field === 'image' ? { status: 'found', value: media }
      : input.query === 'Louvre' ? { status: 'not-found', value: null } : { status: 'found', value: location }]))
  })
  const one = await batch.run({ places: [place()] })
  assert.equal(one.results[0].image, 'found'); assert.deepEqual(one.results[0].refinable, ['location'])
  assert.equal(JSON.stringify(one).includes('upload.wikimedia.org'), false)
  await batch.run({ places: [{ ...place('d1-a1', 'Louvre Museum Paris'), fields: ['image', 'location'] }] })
  assert.deepEqual(calls[1].fields, ['location'])
  await batch.run({ places: [place('d1-a1', 'third attempt')] })
  assert.equal(calls.length, 2)
  const restored = new PlaceBatch({ file: batch.file, lookup: { lookup: () => assert.fail('must not re-query') } })
  assert.equal((await restored.run({ places: [place()] })).results[0].location, 'found')
  assert.equal((await restored.read()).rows['d1-a1'].fields.image.value.src, media.src)
})
test('one refinement round is enforced for the whole batch, including still-missing fields', async t => {
  let calls = 0
  const batch = await fixture(t, async (_input, { fields }) => { calls++; return Object.fromEntries(fields.map(field => [field, { status: 'not-found' }])) })
  await batch.run({ places: [place()] })
  const second = await batch.run({ places: [{ ...place('d1-a1', 'second'), fields: ['location'] }] })
  assert.deepEqual(second.results[0].refinable, [])
  await batch.run({ places: [{ ...place('d1-a1', 'third'), fields: ['image'] }] })
  assert.equal(calls, 2)
})
test('network failure and timeout never request semantic refinement', async t => {
  let calls = 0
  const batch = await fixture(t, async (_input, { fields }) => { calls++; return Object.fromEntries(fields.map(field => [field, { status: 'unavailable' }])) })
  const result = await batch.run({ places: [place()] })
  assert.deepEqual(result.results[0].refinable, [])
  assert.equal(result.results[0].location, 'unavailable')
  await batch.run({ places: [place('d1-a1', 'new keywords')] })
  assert.equal(calls, 1)
})
test('shared deadline retains completed image and returns without waiting for a hung coordinate provider', async t => {
  let late
  const batch = await fixture(t, async (_input, { onField }) => {
    await onField('image', { status: 'found', value: media })
    late = () => onField('location', { status: 'found', value: location })
    return new Promise(() => {})
  }, { budgetMs: 500 })
  const start = Date.now(), result = await batch.run({ places: [place()] })
  assert.ok(Date.now() - start < 2500)
  assert.equal(result.results[0].image, 'found'); assert.equal(result.results[0].location, 'timed-out')
  await late()
  assert.equal((await batch.read()).rows['d1-a1'].fields.location.value, null)
  const before = (await batch.read()).deadline
  const restored = new PlaceBatch({ file: batch.file, lookup: { lookup: () => assert.fail('deadline cannot reset') } })
  const second = await restored.run({ places: [place('d1-a2', 'new place')] })
  assert.equal(second.results[0].image, 'timed-out'); assert.equal((await restored.read()).deadline, before)
})
test('cancellation aborts the batch instead of publishing late fields', async t => {
  const controller = new AbortController()
  const batch = await fixture(t, async () => { controller.abort(Error('user cancelled')); return new Promise(() => {}) })
  await assert.rejects(batch.run({ places: [place()] }, { signal: controller.signal }), /user cancelled/)
})
test('results merge by activity ID despite reordered output and ignore model media and duplicate IDs', async t => {
  const batch = await fixture(t, async (input, { fields }) => Object.fromEntries(fields.map(field => [field, { status: 'found', value: field === 'image' ? { ...media, description: input.name } : { ...location, latitude: input.query === 'A' ? 10 : 20 } }])))
  await batch.run({ places: [place('d1-a1', 'A'), place('d1-a2', 'B')] })
  const trip = toPresentation({ days: [{ activities: [{ id: 'd1-a2', name: 'B', media: { src: 'https://fake.example/' } }, { id: 'd1-a1', name: 'A' }, { name: 'omitted id', latitude: 99 }] }] }, 'run')
  await batch.merge(trip)
  assert.deepEqual(trip.days[0].activities.map(a => a.latitude), [20, 10, null])
  assert.equal(trip.days[0].activities[0].media.src, media.src)
  assert.equal(trip.placesResolved, true); assert.equal('lookupId' in trip.days[0].activities[0], false)
  const duplicate = toPresentation({ days: [{ activities: [{ id: 'd1-a1' }, { id: 'd1-a1' }] }] }, 'run')
  await batch.merge(duplicate)
  assert.ok(duplicate.days[0].activities.every(a => a.latitude === null && a.media === null))
})
test('batch validates IDs and rejects invalid coordinates or unlicensed media without semantic guessing', async t => {
  const batch = await fixture(t, async () => ({ image: { status: 'found', value: { ...media, license: 'All rights reserved' } }, location: { status: 'found', value: { latitude: 100, longitude: 0 } } }))
  await assert.rejects(batch.run({ places: [place(), place()] }), /unique stable/)
  await assert.rejects(batch.run({ places: [place('../escape')] }), /unique stable/)
  const value = await batch.run({ places: [place()] })
  assert.equal(value.results[0].location, 'unavailable'); assert.equal(value.results[0].image, 'unavailable')
})
