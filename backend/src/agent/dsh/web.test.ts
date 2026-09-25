import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PublicResearchSourceReader } from '../../research-agent/source-reader.js'
import { DshEvidenceStore, type DshEvidenceReferenceList } from './evidence.js'
import { FileDshEvidenceRepository } from './evidence-file.js'
import { DshSessionManager } from './session-manager.js'
import { DSH_WEB_TOOLS, executeDshWeb } from './web.js'

describe('DSH web tools through the official worker and evidence repository', () => {
  it.each([
    ['incapsula', '<html><body>Request unsuccessful. Incapsula incident ID: 12345-67890</body></html>'],
    ['incapsula_iframe', '<html><body><iframe src="/_Incapsula_Resource?token=fixture"></iframe></body></html>'],
    ['cloudflare', '<html><title>Just a moment...</title><body><script>window._cf_chl_opt={};</script><script src="/cdn-cgi/challenge-platform/fixture.js"></script></body></html>'],
    ['recaptcha', '<html><title>Verify you are human</title><body><form id="challenge-form"><div class="g-recaptcha" data-sitekey="fixture"></div></form></body></html>'],
    ['hcaptcha', '<html><title>Security check</title><body><form id="challenge-form"><div class="h-captcha" data-sitekey="fixture"></div></form></body></html>'],
  ])('rejects an HTTP200 %s challenge through the real reader and records zero usable evidence', async (_name, body) => {
    const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'],
      request: async () => ({ statusCode: 200, headers: { 'content-type': 'text/html' }, body: (async function* () { yield Buffer.from(body!) })() }) })
    const evidence = new DshEvidenceStore({ ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation', tripContextVersion: 0 })
    const deps = { provider: 'serpapi-raw' as const, serpapi: { searchOrganic: vi.fn() }, reader }
    const args = { url: 'https://example.com/protected' }
    const value = await executeDshWeb('__web_fetch', args, 'fetch', new AbortController().signal, deps, evidence)
    expect(value).toEqual({ error: { code: 'SOURCE_CHALLENGE_REJECTED', hint: expect.stringContaining('supplies no evidence') } })
    expect(JSON.stringify(value)).not.toContain('12345-67890')
    expect(await executeDshWeb('__record_web', { tool: 'web_fetch', args, value }, 'record', new AbortController().signal, deps, evidence))
      .toEqual({ evidenceRefs: [], urls: [] })
  })

  it('keeps ordinary content mentioning CAPTCHA and leaves legacy reader behavior unchanged', async () => {
    const body = '<html><title>Museum technology exhibit</title><body>The museum presents the history of CAPTCHA and web security.</body></html>'
    const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request: async () => ({ statusCode: 200,
      headers: { 'content-type': 'text/html' }, body: (async function* () { yield Buffer.from(body) })() }) })
    const evidence = new DshEvidenceStore({ ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation', tripContextVersion: 0 })
    const deps = { provider: 'serpapi-raw' as const, serpapi: { searchOrganic: vi.fn() }, reader }
    const args = { url: 'https://example.com/museum' }
    const value = await executeDshWeb('__web_fetch', args, 'fetch', new AbortController().signal, deps, evidence)
    expect(value).toMatchObject({ statusCode: 200, body: { content: expect.stringContaining('history of CAPTCHA') } })
    expect(await executeDshWeb('__record_web', { tool: 'web_fetch', args, value }, 'record', new AbortController().signal, deps, evidence))
      .toMatchObject({ evidenceRefs: [expect.any(String)] })
    const legacy = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request: async () => ({ statusCode: 200,
      headers: { 'content-type': 'text/plain' }, body: (async function* () { yield Buffer.from('Request unsuccessful. Incapsula incident ID: 12345-67890') })() }) })
    expect((await legacy.read(args.url)).text).toContain('Incapsula incident ID')
  })

  it.each(['SOURCE_TIMEOUT', 'UNEXPECTED_PROVIDER_ERROR'])('reports %s through the official fetch tool without masking or arbitrary error leakage', async errorName => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-web-error-'))
    const manager = new DshSessionManager({ root, route: { provider: 'fixture', model: 'fixture' }, web: { provider: 'serpapi-raw' }, fixture: [
      { tool: 'web_fetch', args: { url: 'https://example.com/unavailable' } }, { text: 'This source is unavailable.' }
    ] })
    const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'],
      request: async () => { throw Object.assign(new Error('SECRET_PROVIDER_DETAIL'), { name: errorName }) } })
    const evidence = new DshEvidenceStore({ ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation', tripContextVersion: 0 })
    const execute = vi.fn((name: string, args: unknown, callId: string, signal: AbortSignal) =>
      executeDshWeb(name, args, callId, signal, { provider: 'serpapi-raw', serpapi: { searchOrganic: vi.fn() }, reader }, evidence))
    try {
      const result = await manager.run({ ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation',
        memoryEpoch: 'enabled', message: 'Read this source.', snapshot: 'Tokyo', persona: 'Travel source reader', tools: DSH_WEB_TOOLS, execute })
      expect(result).toMatchObject({ reason: 'completed', reply: 'This source is unavailable.', calls: 2 })
      expect(execute.mock.calls.map(call => call[0])).toEqual(['__web_fetch'])
      await manager.close()
      const file = (await readdir(root, { recursive: true })).find(file => file.endsWith('session.v4.jsonl'))!
      const results = (await readFile(join(root, file), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
        .filter(event => event.type === 'tool/result')
      expect(results).toHaveLength(1)
      expect(results[0].data.error).toMatchObject({ name: 'WebError', code: errorName === 'SOURCE_TIMEOUT' ? 'SOURCE_TIMEOUT' : 'SOURCE_FETCH_FAILED' })
      expect(results[0].data.message.isError).toBe(true)
      const text = JSON.stringify(results)
      expect(text).toContain('supplies no evidence')
      expect(text).not.toContain('SECRET_PROVIDER_DETAIL')
      expect(text).not.toContain("reading 'kind'")
    } finally { await manager.close(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  it('retains HTTP failures as empty canonical results and does not turn cancellation into a retryable fetch failure', async () => {
    const evidence = new DshEvidenceStore({ ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation', tripContextVersion: 0 })
    const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'],
      request: async () => ({ statusCode: 403, headers: {}, body: (async function* () {})() }) })
    const deps = { provider: 'serpapi-raw' as const, serpapi: { searchOrganic: vi.fn() }, reader }
    const value = await executeDshWeb('__web_fetch', { url: 'https://example.com/denied' }, 'fetch', new AbortController().signal, deps, evidence)
    expect(value).toMatchObject({ statusCode: 403, body: { kind: 'text', content: '' } })
    expect(await executeDshWeb('__record_web', { tool: 'web_fetch', args: { url: 'https://example.com/denied' }, value }, 'receipt', new AbortController().signal, deps, evidence))
      .toEqual({ evidenceRefs: [], urls: [] })
    const cancelled = new AbortController(); cancelled.abort(new Error('Caller cancelled'))
    await expect(executeDshWeb('__web_fetch', { url: 'https://example.com/denied' }, 'cancel', cancelled.signal, deps, evidence)).rejects.toThrow('Caller cancelled')
  })

  it('keeps canonical receipt arguments, withholds snippet-free search refs and persists fetched-body refs across instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flightor-dsh-web-'))
    const evidenceRoot = join(root, 'evidence')
    const scope = { ownerId: 'web-owner', tripId: 'web-trip', conversationId: 'web-conversation', generationId: 'web-generation', tripContextVersion: 3 }
    const sourceUrl = 'https://example.com/museum'
    const sourceBody = 'The museum presents exhibits about traditional local culture.'
    const searchArgs = { queries: ['Tokyo cultural museum'] }
    const fetchArgs = { url: sourceUrl }
    const manager = new DshSessionManager({ root: join(root, 'sessions'), route: { provider: 'fixture', model: 'fixture' },
      web: { provider: 'serpapi-raw' }, fixture: [
        { tool: 'web_search', args: searchArgs }, { tool: 'web_fetch', args: fetchArgs }, { text: 'The source page is available.' }
      ] })
    const searchOrganic = vi.fn(async () => [{ url: sourceUrl, title: 'Museum', domain: 'example.com' }])
    // Exercise the real safe reader with injected DNS and transport; no external HTTP or provider keys.
    const request = vi.fn(async () => ({ statusCode: 200, headers: { 'content-type': 'text/plain' },
      body: (async function* () { yield Buffer.from(sourceBody) })() }))
    const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request })
    const store = new DshEvidenceStore(scope, { repository: new FileDshEvidenceRepository(evidenceRoot) })
    const receipts: Array<{ args: unknown; callId: string; result: DshEvidenceReferenceList }> = []
    const execute = vi.fn(async (name: string, args: unknown, callId: string, signal: AbortSignal) => {
      const result = await executeDshWeb(name, args, callId, signal, { provider: 'serpapi-raw', serpapi: { searchOrganic }, reader }, store)
      if (name === '__record_web') receipts.push({ args, callId, result: result as DshEvidenceReferenceList })
      return result
    })
    try {
      const result = await manager.run({ ...scope, memoryEpoch: 'enabled:1', message: 'Find a museum and read its source page.',
        snapshot: 'Tokyo cultural itinerary', persona: 'Use source evidence without treating it as verified.', tools: DSH_WEB_TOOLS, execute })
      expect(result).toMatchObject({ reply: 'The source page is available.', reason: 'completed', calls: 3, cancelled: false })
      expect(execute.mock.calls.map(call => call[0])).toEqual(['__web_search', '__record_web', '__web_fetch', '__record_web'])
      expect(searchOrganic).toHaveBeenCalledTimes(1)
      expect(searchOrganic).toHaveBeenCalledWith({ query: searchArgs.queries[0], limit: 6 }, expect.any(AbortSignal))
      expect(request).toHaveBeenCalledTimes(1)
      expect(receipts).toHaveLength(2)
      // Public ToolExecutionContext.arguments must survive post-execute and IPC unchanged.
      expect(receipts[0]!.args).toMatchObject({ tool: 'web_search', args: searchArgs,
        value: { sources: [{ url: sourceUrl, title: 'Museum' }] } })
      expect(receipts[0]!.result).toEqual({ evidenceRefs: [], urls: [] })
      expect(receipts[1]!.args).toMatchObject({ tool: 'web_fetch', args: fetchArgs,
        value: { url: sourceUrl, statusCode: 200, body: { kind: 'text', content: sourceBody } } })
      expect(receipts[1]!.result.evidenceRefs).toHaveLength(1)
      expect(receipts[1]!.result.urls).toEqual([sourceUrl])
      expect(new Set(receipts.map(receipt => receipt.callId)).size).toBe(2)

      const reopened = new FileDshEvidenceRepository(evidenceRoot)
      const reopenedStore = new DshEvidenceStore(scope, { repository: reopened })
      const fetchedRef = receipts[1]!.result.evidenceRefs[0]!
      const record = await reopenedStore.get(fetchedRef)
      expect(record).toMatchObject({ ...scope, evidenceRef: fetchedRef, provider: 'flightor-safe-fetch',
        toolCallId: receipts[1]!.callId, url: sourceUrl, body: sourceBody,
        status: 'available', depth: 'fetched_body', untrusted: true })
      expect(record!.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(await store.get(fetchedRef)).toEqual(record)
      // A missing snippet is retained only as a diagnostic record, never made usable evidence.
      const records = await Promise.all((await readdir(evidenceRoot)).filter(file => file.endsWith('.json'))
        .map(file => reopened.get(file.slice(0, -5))))
      expect(records).toHaveLength(2)
      expect(records.find(value => value!.depth === 'none')).toMatchObject({ provider: 'serpapi-raw',
        toolCallId: receipts[0]!.callId, url: sourceUrl, status: 'no_body', untrusted: true })
    } finally { await manager.close(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)
})
