import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultPlaceLookup } from './place-lookup.mjs'
import { validPoint } from './geo-index.mjs'

export const placeBudgetMs = (placeCount = 0) => {
  const configured = Number(process.env.FLIGHTOR_PLACE_BUDGET_MS)
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 120000) : placeCount * 2000 + 5000
}
export const usableMedia = media => {
  try {
    const url = new URL(media?.src), source = new URL(media?.source?.url)
    return url.protocol === 'https:' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && !url.username && !url.password && !url.port
      && source.protocol === 'https:' && source.hostname === 'commons.wikimedia.org' && !source.username && !source.password && !source.port
      && typeof media.author === 'string' && !!media.author.trim() && /^(CC BY(?:-SA)? [\d.]+(?: [a-z]{2}(?:-[a-z]{2})?)?|CC0(?: [\d.]+)?|Public domain|PD)$/i.test(media.license)
      && (/^(Public domain|PD)$/i.test(media.license) || /^https:\/\/(?:creativecommons\.org|commons\.wikimedia\.org)\//.test(media.licenseUrl || ''))
  } catch { return false }
}
const fields = ['image', 'location']
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id)
const bounded = (value, max) => typeof value === 'string' && value.trim() && value.length <= max
const abortable = (task, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason || Error('Place lookup cancelled'))
  if (signal.aborted) { abort(); return }
  signal.addEventListener('abort', abort, { once: true })
  Promise.resolve(task).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
})

/** One reviewer session owns one ledger. Tool calls are serial; fields and places run concurrently. */
export class PlaceBatch {
  constructor({ file, lookup = defaultPlaceLookup(), budgetMs, concurrency = 6, now = Date.now } = {}) {
    Object.assign(this, { file, lookup, budgetMs, concurrency, now })
    this.writes = Promise.resolve()
    this.tail = Promise.resolve()
  }
  async read() {
    if (this.state) return this.state
    try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.state = { version: 1, startedAt: null, deadline: null, rows: {} } }
    if (this.state.version !== 1) throw Error('Unsupported place ledger')
    return this.state
  }
  save() {
    const snapshot = JSON.stringify(this.state, null, 2)
    this.writes = this.writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const temporary = this.file + '.' + crypto.randomUUID() + '.tmp'
      await fs.writeFile(temporary, snapshot)
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temporary, this.file); break }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 3) throw error
          await delay(20 * (attempt + 1))
        }
      }
    })
    return this.writes
  }
  run(input, options = {}) {
    const task = this.tail.catch(() => {}).then(() => this.execute(input, options))
    this.tail = task.catch(() => {})
    return task
  }
  async execute({ places }, { signal } = {}) {
    if (!Array.isArray(places)) throw Error('places must be an array')
    const ids = new Set()
    for (const place of places) {
      if (!validId(place?.id) || ids.has(place.id) || !bounded(place.name, 180) || typeof place.city !== 'string' || place.city.length > 120) throw Error('Each place needs a unique stable id, name and city')
      ids.add(place.id)
      if (place.fields != null && (!Array.isArray(place.fields) || !place.fields.length || place.fields.some(field => !fields.includes(field)))) throw Error('fields must contain image and/or location')
      for (const key of ['query', 'imageQuery', 'locationQuery']) if (place[key] != null && !bounded(place[key], 160)) throw Error('Invalid search keywords')
    }
    signal?.throwIfAborted()
    const state = await this.read()
    state.startedAt ??= this.now(); state.deadline ??= state.startedAt + (this.budgetMs ?? placeBudgetMs(ids.size))
    const remaining = Math.max(0, state.deadline - this.now())
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(Error('Place lookup budget exhausted')), remaining)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    let closed = false
    const mayRefine = !state.refinementUsed
    let refining = false
    const jobs = []
    for (const place of places) {
      if (!Object.hasOwn(state.rows, place.id)) state.rows[place.id] = { id: place.id, name: place.name.trim(), city: place.city.trim(), fields: {} }
      const row = state.rows[place.id]
      for (const field of new Set(place.fields || fields)) {
        const previous = row.fields[field]
        const query = (place[field + 'Query'] || place.query || place.name).trim()
        // Found values are immutable. Only a semantic miss permits one changed-keyword attempt.
        if (previous && (previous.status !== 'not-found' || previous.attempts >= 2 || query === previous.query)) continue
        if (previous && !mayRefine) continue
        if (previous) refining = true
        const entry = row.fields[field] = { status: 'pending', query, attempts: (previous?.attempts || 0) + 1, value: null }
        if (remaining <= 0) { entry.status = 'timed-out'; continue }
        jobs.push({ row, field, entry })
      }
    }
    if (refining) state.refinementUsed = true
    await this.save()
    // Same-place fields share identity lookup, while each field commits independently.
    const groups = [...new Set(jobs.map(job => job.row.id + '\n' + job.entry.query))].map(key => jobs.filter(job => job.row.id + '\n' + job.entry.query === key))
    let cursor = 0
    const worker = async () => {
      while (!combined.aborted && cursor < groups.length) {
        const group = groups[cursor++], { row, entry } = group[0]
        const accept = async (field, found) => {
          if (closed || combined.aborted) return
          const job = group.find(job => job.field === field)
          if (!job || job.entry.status !== 'pending') return
          const valid = field === 'image' ? usableMedia(found?.value) : validPoint(found?.value)
          Object.assign(job.entry, { status: valid ? 'found' : found?.status === 'not-found' ? 'not-found' : found?.status === 'timed-out' ? 'timed-out' : 'unavailable', value: valid ? found.value : null,
            via: found?.via || null, elapsedMs: found?.elapsedMs || null })
          await this.save()
        }
        try {
          const input = { name: row.name, city: row.city, query: entry.query }
          const outcome = await abortable(this.lookup.lookup(input, { fields: group.map(job => job.field), signal: combined, onField: accept }), combined)
          for (const job of group) await accept(job.field, outcome[job.field])
        } catch { if (!closed) for (const job of group) if (job.entry.status === 'pending') job.entry.status = combined.aborted ? 'timed-out' : 'unavailable' }
      }
    }
    try { await Promise.all(Array.from({ length: Math.min(this.concurrency, groups.length) }, worker)) }
    finally {
      closed = true; clearTimeout(timer)
      for (const { entry } of jobs) if (entry.status === 'pending') entry.status = 'timed-out'
      await this.save()
    }
    signal?.throwIfAborted()
    return this.status(places.map(place => place.id))
  }
  async status(ids) {
    const state = await this.read(), remainingMs = Math.max(0, (state.deadline || this.now()) - this.now())
    return { results: (ids || Object.keys(state.rows)).map(id => {
      const row = state.rows[id]
      return { id, name: row.name, image: row.fields.image?.status || 'not-requested', location: row.fields.location?.status || 'not-requested',
        refinable: fields.filter(field => !state.refinementUsed && remainingMs > 0 && row.fields[field]?.status === 'not-found' && row.fields[field].attempts < 2) }
    }), remainingMs, budgetExhausted: remainingMs <= 0 }
  }
  async merge(trip) {
    const state = await this.read()
    const activities = trip.days.flatMap(day => day.activities)
    const counts = new Map()
    for (const a of activities) counts.set(a.lookupId, (counts.get(a.lookupId) || 0) + 1)
    for (const activity of activities) {
      const row = Object.hasOwn(state.rows, activity.lookupId) && counts.get(activity.lookupId) === 1 ? state.rows[activity.lookupId] : null
      const location = row?.fields.location?.value, media = row?.fields.image?.value
      activity.latitude = validPoint(location) ? location.latitude : null
      activity.longitude = validPoint(location) ? location.longitude : null
      activity.media = usableMedia(media) ? media : null
      if (validPoint(location)) activity.place = { status: 'resolved', kind: 'coordinate', source: location.source }
      delete activity.lookupId
    }
    trip.placesResolved = true
    return trip
  }
}
