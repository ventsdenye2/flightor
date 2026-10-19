import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fetch, EnvHttpProxyAgent } from 'undici'
import { dataRoot } from './paths.mjs'

const allowed = host => ['www.wikidata.org', 'commons.wikimedia.org', 'api.enterprise.wikimedia.com', 'auth.enterprise.wikimedia.com'].includes(host) || /^(?:en|zh)\.wikipedia\.org$/.test(host)
export class WikimediaHttp {
  constructor({ request = fetch, root = path.join(dataRoot, 'wikimedia-http-v1'), intervalMs = 1000, timeoutMs = 8000, retries = 2, now = Date.now } = {}) {
    Object.assign(this, { request, root, intervalMs, timeoutMs, retries, now })
    this.hosts = new Map()
    this.pending = new Map()
    this.metrics = { network: 0, cache: 0, retries: 0, failures: 0, events: [] }
  }
  async json(input, { signal, method = 'GET', body, headers = {}, ttlMs = 7 * 86400000, cache = true } = {}) {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed(url.hostname)) throw Error('Unsupported Wikimedia endpoint')
    const key = crypto.createHash('sha256').update(JSON.stringify([method, url.href, body || null])).digest('hex')
    const file = this.root && path.join(this.root, key + '.json')
    if (cache && file) {
      try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'))
        if (saved.expiresAt > this.now()) { this.metrics.cache++; return saved.value }
      } catch {}
    }
    // Each caller retains its own cancellation budget; only calls without caller signals coalesce here.
    if (!signal && this.pending.has(key)) return this.pending.get(key)
    const task = this.#request(url, { signal, method, body, headers }).then(async value => {
      if (cache && file) {
        try {
          await fs.mkdir(this.root, { recursive: true })
          const temporary = file + '.' + crypto.randomUUID() + '.tmp'
          await fs.writeFile(temporary, JSON.stringify({ expiresAt: this.now() + ttlMs, value }))
          await fs.rename(temporary, file)
        } catch { /* A read-only cache must not discard valid network data. */ }
      }
      return value
    })
    if (!signal) this.pending.set(key, task)
    try { return await task } finally { if (!signal) this.pending.delete(key) }
  }
  async #request(url, options) {
    const host = this.hosts.get(url.hostname) || { tail: Promise.resolve(), next: 0 }
    this.hosts.set(url.hostname, host)
    const budget = AbortSignal.timeout(18000)
    const signal = options.signal ? AbortSignal.any([options.signal, budget]) : budget
    const run = async () => {
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        signal.throwIfAborted()
        const wait = host.next - this.now()
        if (wait > 5000) { this.metrics.failures++; throw Error('Wikimedia rate limit cooldown: ' + url.hostname) }
        if (wait > 0) await delay(wait, undefined, { signal })
        let retry = false
        try {
          this.dispatcher ??= new EnvHttpProxyAgent()
          this.metrics.network++
          const response = await this.request(url, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
            dispatcher: this.dispatcher, redirect: 'error', headers: {
              'User-Agent': process.env.FLIGHTOR_WIKIMEDIA_USER_AGENT || 'FlightOR/0.1 (local travel planner; landmark data)',
              accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers
            } })
          host.next = this.now() + this.intervalMs
          if (!response.ok) {
            this.metrics.events.push({ host: url.hostname, status: response.status, retryAfter: response.headers?.get('retry-after') })
            retry = [429, 500, 502, 503, 504].includes(response.status)
            if (response.status === 429 || response.status === 503) {
              const raw = response.headers?.get('retry-after')
              const seconds = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw || '') - this.now()
              host.next = this.now() + Math.max(this.intervalMs, Number.isFinite(seconds) ? seconds : 60000)
            }
            await response.body?.cancel?.()
            throw Error('Wikimedia HTTP ' + response.status)
          }
          const value = await response.json()
          if (value.error) {
            this.metrics.events.push({ host: url.hostname, code: value.error.code, lag: value.error.lag })
            retry = ['maxlag', 'ratelimited', 'readonly'].includes(value.error.code)
            if (retry) host.next = this.now() + Math.max(1000, Number(value.error.lag || 1) * 1000)
            throw Error('Wikimedia API ' + (value.error.code || 'error'))
          }
          return value
        } catch (error) {
          const transient = retry || error.name === 'TypeError' || error.name === 'TimeoutError' || error.code === 'ECONNRESET'
          if (signal.aborted || !transient || attempt === this.retries) { this.metrics.failures++; throw Error(signal.aborted ? 'Wikimedia request timed out or cancelled' : 'Wikimedia request failed', { cause: error }) }
          this.metrics.retries++
          host.next = Math.max(host.next, this.now() + 300 * 2 ** attempt)
        }
      }
    }
    const task = host.tail.catch(() => {}).then(run)
    host.tail = task.catch(() => {})
    // Waiting behind other users is bounded as well as the actual HTTP transfer.
    return new Promise((resolve, reject) => {
      const abort = () => reject(Error('Wikimedia request timed out or cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
}

export const wikimediaHttp = new WikimediaHttp()
export function actionUrl(host, parameters) {
  const url = new URL(`https://${host}/w/api.php`)
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...parameters }).toString()
  return url
}
