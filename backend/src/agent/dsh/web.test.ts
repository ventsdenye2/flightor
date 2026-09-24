import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PublicResearchSourceReader } from '../../research-agent/source-reader.js'
import { DshEvidenceStore, type DshEvidenceReferenceList } from './evidence.js'
import { FileDshEvidenceRepository } from './evidence-file.js'
import { DshSessionManager } from './session-manager.js'
import { DSH_WEB_TOOLS, executeDshWeb } from './web.js'

describe('DSH web tools through the official worker and evidence repository', () => {
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
