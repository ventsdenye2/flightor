import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { observeSpan, recordHttpStatus } from '../lib/planner-observation.js'

const MAX_BODY_BYTES = 256 * 1024
const MAX_TEXT_CHARS = 12_000
const TIMEOUT_MS = 8_000

export interface ResearchSourceReader {
  read(url: string, options?: { signal?: AbortSignal }): Promise<{
    text: string
    retrievedAt: string
    contentHash: string
  }>
}

export interface SourceReaderResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array>
}

export type SourceResolver = (hostname: string) => Promise<string[]>
export type SourceRequest = (options: {
  hostname: string
  servername: string
  path: string
  signal: AbortSignal
}) => Promise<SourceReaderResponse>

export interface PublicResearchSourceReaderOptions {
  resolve?: SourceResolver
  request?: SourceRequest
  now?: () => Date
  timeoutMs?: number
}

const resolvePublicIpv4: SourceResolver = async hostname => {
  const records = await dns.lookup(hostname, { all: true, family: 4, verbatim: true })
  return records.map(record => record.address)
}

function fail(message: string, code: string): Error {
  const error = new Error(message)
  error.name = code
  return error
}

function ipv4IsPublic(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false
  const [a, b] = parts.map(Number) as [number, number]
  return a !== 0 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 0 || b === 2 || b === 88 || b === 168)) &&
    !(a === 198 && (b === 18 || b === 19 || b === 51)) && a !== 203 && a < 224
}

function isIpv4Literal(hostname: string): boolean { return /^\d+(?:\.\d+){3}$/.test(hostname) }

function headerValue(headers: SourceReaderResponse['headers'], name: string): string | undefined {
  const value = headers[name] ?? headers[Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase()) ?? '']
  return Array.isArray(value) ? value[0] : value
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' }
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x'
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole
    }
    return named[entity.toLowerCase()] ?? whole
  })
}

function extractText(input: string, contentType: string): string {
  const source = contentType.includes('html')
    ? input.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    : input
  return decodeEntities(source).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)
}

async function defaultRequest(options: Parameters<SourceRequest>[0]): Promise<SourceReaderResponse> {
  return await new Promise((resolve, reject) => {
    const request = httpsRequest({ hostname: options.hostname, servername: options.servername, port: 443,
      path: options.path, agent: false, headers: { host: options.servername, accept: 'text/html, text/plain', 'accept-encoding': 'identity' }, signal: options.signal }, response => {
      const headers: SourceReaderResponse['headers'] = response.headers
      resolve({ statusCode: response.statusCode ?? 0, headers, body: response as AsyncIterable<Uint8Array> })
    })
    request.once('error', reject)
    request.end()
  })
}

export class PublicResearchSourceReader implements ResearchSourceReader {
  private readonly resolve: SourceResolver
  private readonly request: SourceRequest
  private readonly now: () => Date
  private readonly timeoutMs: number

  constructor(options: PublicResearchSourceReaderOptions = {}) {
    this.resolve = options.resolve ?? resolvePublicIpv4
    this.request = options.request ?? defaultRequest
    this.now = options.now ?? (() => new Date())
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  }

  async read(url: string, options: { signal?: AbortSignal } = {}) {
    return observeSpan('http', 'research-source-read', async () => {
      let parsed: URL
      try { parsed = new URL(url) } catch { throw fail('Source URL is invalid', 'SOURCE_URL_INVALID') }
      if (parsed.protocol !== 'https:' || parsed.port && parsed.port !== '443' || parsed.username || parsed.password) {
        throw fail('Source URL must be HTTPS on port 443 without credentials', 'SOURCE_URL_REJECTED')
      }
      const hostname = parsed.hostname.toLowerCase()
      if (!hostname || isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 || isIpv4Literal(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
        throw fail('Source hostname is not allowed', 'SOURCE_HOST_REJECTED')
      }
      const caller = options.signal
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
      const abort = () => controller.abort(caller?.reason)
      if (caller?.aborted) abort()
      else caller?.addEventListener('abort', abort, { once: true })
      const interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(fail('Source request interrupted', 'SOURCE_INTERRUPTED')), { once: true }))
      try {
        if (controller.signal.aborted) throw fail('Source request cancelled', 'SOURCE_CANCELLED')
        const addresses = await Promise.race([this.resolve(hostname), interrupted])
        if (!addresses.length || addresses.some(address => !ipv4IsPublic(address))) throw fail('Source DNS resolution is not public IPv4', 'SOURCE_DNS_REJECTED')
        const pinned = addresses[0]!
        const response = await Promise.race([this.request({ hostname: pinned, servername: hostname, path: `${parsed.pathname}${parsed.search}`, signal: controller.signal }), interrupted])
        recordHttpStatus(response.statusCode)
        if (response.statusCode >= 300 && response.statusCode < 400) throw fail('Source redirects are not followed', 'SOURCE_REDIRECT_REJECTED')
        if (response.statusCode < 200 || response.statusCode >= 300) throw fail(`Source returned HTTP ${response.statusCode}`, 'SOURCE_HTTP_REJECTED')
        const contentEncoding = headerValue(response.headers, 'content-encoding')?.toLowerCase()
        if (contentEncoding && contentEncoding !== 'identity') throw fail('Compressed source responses are not accepted', 'SOURCE_ENCODING_REJECTED')
        const contentType = headerValue(response.headers, 'content-type')?.toLowerCase() ?? ''
        if (!contentType.startsWith('text/html') && !contentType.startsWith('text/plain')) throw fail('Source content type is not text', 'SOURCE_CONTENT_TYPE_REJECTED')
        const collectBody = async () => {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk)
            size += buffer.length
            if (size > MAX_BODY_BYTES) throw fail('Source response exceeds 256 KiB', 'SOURCE_BODY_LIMIT')
            chunks.push(buffer)
          }
          return Buffer.concat(chunks)
        }
        const body = await Promise.race([collectBody(), interrupted])
        const text = extractText(body.toString('utf8'), contentType)
        return { text, retrievedAt: this.now().toISOString(), contentHash: createHash('sha256').update(text, 'utf8').digest('hex') }
      } catch (error) {
        if (caller?.aborted) throw fail('Source request cancelled', 'SOURCE_CANCELLED')
        if (timedOut) throw fail('Source request timed out', 'SOURCE_TIMEOUT')
        throw error
      } finally {
        clearTimeout(timer)
        controller.abort()
        caller?.removeEventListener('abort', abort)
      }
    })
  }
}
