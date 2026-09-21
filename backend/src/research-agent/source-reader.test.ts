import { describe, expect, it, vi } from 'vitest'
import { PublicResearchSourceReader } from './source-reader.js'

const response = (body: string, headers: Record<string, string> = { 'content-type': 'text/plain' }) => ({ statusCode: 200, headers, body: (async function* () { yield Buffer.from(body) })() })
const reader = (body: string, headers?: Record<string, string>) => new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request: async options => response(body, headers), now: () => new Date('2026-09-21T00:00:00.000Z') })

describe('PublicResearchSourceReader', () => {
  it('extracts bounded text and hashes the extracted text', async () => {
    const result = await reader('<html><!-- x --><style>x</style><script>bad()</script><h1>A &amp; B</h1><p>&#x4E2D;</p></html>', { 'content-type': 'text/html; charset=utf-8' }).read('https://example.com/a?q=1')
    expect(result.text).toBe('A & B 中')
    expect(result.retrievedAt).toBe('2026-09-21T00:00:00.000Z')
    expect(result.contentHash).toHaveLength(64)
  })

  it.each(['http://example.com', 'https://example.com:444/', 'https://user:pass@example.com', 'https://127.0.0.1'])('rejects unsafe URL %s', async url => {
    await expect(reader('x').read(url)).rejects.toHaveProperty('name', expect.stringMatching(/^SOURCE_/))
  })

  it('rejects private, mixed, and rebinding-prone DNS answers before request', async () => {
    const request = vi.fn(async () => response('ok'))
    await expect(new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34', '10.0.0.1'], request }).read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_DNS_REJECTED')
    expect(request).not.toHaveBeenCalled()
    await expect(new PublicResearchSourceReader({ resolve: async () => ['192.0.2.1'], request }).read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_DNS_REJECTED')
    await expect(new PublicResearchSourceReader({ resolve: async () => ['224.0.0.1'], request }).read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_DNS_REJECTED')
  })

  it('rejects redirects, compressed/non-text content, and oversized bodies', async () => {
    const redirect = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request: async () => ({ statusCode: 302, headers: { location: 'https://evil.example' }, body: (async function* () {})() }) })
    await expect(redirect.read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_REDIRECT_REJECTED')
    await expect(reader('x', { 'content-type': 'application/json' }).read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_CONTENT_TYPE_REJECTED')
    await expect(reader('x', { 'content-type': 'text/plain', 'content-encoding': 'gzip' }).read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_ENCODING_REJECTED')
    await expect(new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request: async () => ({ statusCode: 200, headers: { 'content-type': 'text/plain' }, body: (async function* () { yield Buffer.alloc(256 * 1024 + 1) })() }) }).read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_BODY_LIMIT')
  })

  it('propagates cancellation and total timeout', async () => {
    const controller = new AbortController()
    const cancelled = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request: async ({ signal }) => { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); throw new Error('aborted') } })
    const pending = cancelled.read('https://example.com', { signal: controller.signal }); controller.abort()
    await expect(pending).rejects.toHaveProperty('name', 'SOURCE_CANCELLED')
    const timed = new PublicResearchSourceReader({ timeoutMs: 5, resolve: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return ['93.184.216.34'] }, request: async () => response('x') })
    await expect(timed.read('https://example.com')).rejects.toHaveProperty('name', 'SOURCE_TIMEOUT')
  })
})
