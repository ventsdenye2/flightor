import { describe, expect, it, vi } from 'vitest'
import { PublicResearchSourceReader } from '../../research-agent/source-reader.js'
import { DshEvidenceStore, type DshEvidenceReferenceList } from './evidence.js'
import { executeDshWeb } from './web.js'

const scope = { ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation', tripContextVersion: 1 }
const sourceUrl = 'https://example.com/culture'
const sourceBody = 'The riverside museum has a local craft collection.'
const signal = () => new AbortController().signal
const fixture = (statuses: number[] = [200]) => {
  const request = vi.fn(async () => ({ statusCode: statuses[Math.min(request.mock.calls.length - 1, statuses.length - 1)]!,
    headers: { 'content-type': 'text/plain' }, body: (async function* () { yield Buffer.from(sourceBody) })() }))
  const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request })
  return { request, deps: { provider: 'deepseek-official' as const, serpapi: { searchOrganic: vi.fn() }, reader } }
}

describe('DSH successful fetched-body reuse within one prepared attempt', () => {
  it('single-flights concurrent exact-URL reads before either result has been recorded', async () => {
    let releaseResponse!: () => void
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
    const request = vi.fn(async () => {
      await responseGate
      return { statusCode: 200, headers: { 'content-type': 'text/plain' },
        body: (async function* () { yield Buffer.from(sourceBody) })() }
    })
    let releaseResolve!: () => void
    const resolveGate = new Promise<void>(resolve => { releaseResolve = resolve })
    const resolver = vi.fn(async () => { await resolveGate; return ['93.184.216.34'] })
    const reader = new PublicResearchSourceReader({ resolve: resolver, request })
    const deps = { provider: 'deepseek-official' as const, serpapi: { searchOrganic: vi.fn() }, reader }
    let now = new Date('2026-10-06T09:00:00Z')
    const store = new DshEvidenceStore(scope, { now: () => now })
    const fetch = (id: string) => executeDshWeb('__web_fetch', { url: sourceUrl }, id, signal(), deps, store)
    const firstFetch = fetch('first')
    const secondFetch = fetch('second')
    await vi.waitFor(() => expect(resolver).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseResolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseResponse()
    const [firstValue, secondValue] = await Promise.all([firstFetch, secondFetch])
    expect(firstValue).not.toHaveProperty('sharedFetch')
    expect(secondValue).toMatchObject({ sharedFetch: true })
    const record = (id: string, value: unknown) => executeDshWeb('__record_web', {
      tool: 'web_fetch', args: { url: sourceUrl }, value
    }, `${id}-record`, signal(), deps, store) as Promise<DshEvidenceReferenceList>
    const [firstRefs, secondRefs] = await Promise.all([record('first', firstValue), record('second', secondValue)])

    expect(request).toHaveBeenCalledTimes(1)
    expect(firstRefs.evidenceRefs).toEqual(secondRefs.evidenceRefs)
    expect(await store.get(firstRefs.evidenceRefs[0]!)).toMatchObject({
      ...scope, retrievedAt: '2026-10-06T09:00:00.000Z', toolCallId: 'first-record',
      contentHash: expect.any(String), body: sourceBody
    })
    now = new Date('2026-10-06T09:02:00Z')
    const replayValue = await fetch('replay')
    expect(replayValue).toMatchObject({ cacheHit: true, body: { content: sourceBody } })
    const replayRefs = await record('replay', replayValue)
    expect(replayRefs.evidenceRefs).toEqual(firstRefs.evidenceRefs)
    expect(await store.get(replayRefs.evidenceRefs[0]!)).toMatchObject({ retrievedAt: '2026-10-06T09:00:00.000Z',
      toolCallId: 'first-record', contentHash: (await store.get(firstRefs.evidenceRefs[0]!))!.contentHash })
  })

  it('does not let a cancelled shared waiter record evidence or cancel the active reader', async () => {
    let releaseResponse!: () => void
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
    const request = vi.fn(async () => {
      await responseGate
      return { statusCode: 200, headers: { 'content-type': 'text/plain' },
        body: (async function* () { yield Buffer.from(sourceBody) })() }
    })
    const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request })
    const deps = { provider: 'deepseek-official' as const, serpapi: { searchOrganic: vi.fn() }, reader }
    const store = new DshEvidenceStore(scope)
    const cancelled = new AbortController()
    const ownerFetch = executeDshWeb('__web_fetch', { url: sourceUrl }, 'owner', signal(), deps, store)
    const cancelledFetch = executeDshWeb('__web_fetch', { url: sourceUrl }, 'cancelled', cancelled.signal, deps, store)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    cancelled.abort(new Error('Caller cancelled'))
    await expect(cancelledFetch).rejects.toThrow('Caller cancelled')
    releaseResponse()
    const value = await ownerFetch
    const refs = await executeDshWeb('__record_web', { tool: 'web_fetch', args: { url: sourceUrl }, value }, 'owner-record', signal(), deps, store) as DshEvidenceReferenceList
    expect(request).toHaveBeenCalledTimes(1)
    expect(refs.evidenceRefs).toHaveLength(1)
    expect(await store.get(refs.evidenceRefs[0]!)).toMatchObject({ toolCallId: 'owner-record', body: sourceBody })
  })

  it('aborts the shared reader when its initiating caller cancels and allows a later retry', async () => {
    const request = vi.fn(async ({ signal: requestSignal }: { signal: AbortSignal }) => {
      if (request.mock.calls.length === 1) return await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(requestSignal.reason ?? new Error('reader aborted'))
        if (requestSignal.aborted) abort()
        else requestSignal.addEventListener('abort', abort, { once: true })
      })
      return { statusCode: 200, headers: { 'content-type': 'text/plain' },
        body: (async function* () { yield Buffer.from(sourceBody) })() }
    })
    const reader = new PublicResearchSourceReader({ resolve: async () => ['93.184.216.34'], request })
    const deps = { provider: 'deepseek-official' as const, serpapi: { searchOrganic: vi.fn() }, reader }
    const store = new DshEvidenceStore(scope)
    const owner = new AbortController()
    const ownerFetch = executeDshWeb('__web_fetch', { url: sourceUrl }, 'owner', owner.signal, deps, store)
    const waiterFetch = executeDshWeb('__web_fetch', { url: sourceUrl }, 'waiter', signal(), deps, store)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    owner.abort(new Error('Owner cancelled'))
    await expect(ownerFetch).rejects.toThrow('Owner cancelled')
    await expect(waiterFetch).rejects.toThrow('Owner cancelled')
    const retryValue = await executeDshWeb('__web_fetch', { url: sourceUrl }, 'retry', signal(), deps, store)
    const refs = await executeDshWeb('__record_web', { tool: 'web_fetch', args: { url: sourceUrl }, value: retryValue },
      'retry-record', signal(), deps, store) as DshEvidenceReferenceList
    expect(request).toHaveBeenCalledTimes(2)
    expect(refs.evidenceRefs).toHaveLength(1)
    expect(await store.get(refs.evidenceRefs[0]!)).toMatchObject({ toolCallId: 'retry-record', body: sourceBody })
  })

  it('uses one safe-reader request and the original scoped receipt, content hash and retrieval time for an exact repeated URL', async () => {
    const { request, deps } = fixture()
    let now = new Date('2026-10-06T09:00:00Z')
    const store = new DshEvidenceStore(scope, { now: () => now })
    const fetchAndRecord = async (id: string) => {
      const args = { url: sourceUrl }
      const value = await executeDshWeb('__web_fetch', args, id, signal(), deps, store)
      const refs = await executeDshWeb('__record_web', { tool: 'web_fetch', args, value }, `${id}-record`, signal(), deps, store) as DshEvidenceReferenceList
      return { value, refs, record: await store.get(refs.evidenceRefs[0]!) }
    }
    const first = await fetchAndRecord('first')
    now = new Date('2026-10-06T09:02:00Z')
    const repeated = await fetchAndRecord('repeated')
    expect(request).toHaveBeenCalledTimes(1)
    expect(repeated.value).toMatchObject({ body: { content: sourceBody }, cacheHit: true })
    expect(repeated.refs.evidenceRefs).toEqual(first.refs.evidenceRefs)
    expect(repeated.record).toEqual(first.record)
    expect(repeated.record).toMatchObject({ ...scope, retrievedAt: '2026-10-06T09:00:00.000Z', toolCallId: 'first-record', untrusted: true })
    expect(await store.get(repeated.refs.sourceRefs[0]!)).toEqual(first.record)
    expect(await store.get(first.refs.sourceRefs[0]!)).toEqual(first.record)
    const cancelled = new AbortController(); cancelled.abort(new Error('Caller cancelled'))
    await expect(executeDshWeb('__web_fetch', { url: sourceUrl }, 'cancelled', cancelled.signal, deps, store)).rejects.toThrow('Caller cancelled')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('never reuses failures, another requested URL, another turn or a changed Trip version', async () => {
    const { request, deps } = fixture([403, 200])
    const store = new DshEvidenceStore(scope)
    const fetchAndRecord = async (url: string, evidence: DshEvidenceStore, id: string) => {
      const value = await executeDshWeb('__web_fetch', { url }, id, signal(), deps, evidence)
      return await executeDshWeb('__record_web', { tool: 'web_fetch', args: { url }, value }, `${id}-record`, signal(), deps, evidence) as DshEvidenceReferenceList
    }
    expect((await fetchAndRecord(sourceUrl, store, 'denied')).evidenceRefs).toEqual([])
    expect((await fetchAndRecord(sourceUrl, store, 'retry')).evidenceRefs).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(2)
    await fetchAndRecord(`${sourceUrl}?other=1`, store, 'other-url')
    await fetchAndRecord(sourceUrl, new DshEvidenceStore({ ...scope, generationId: 'another-turn' }), 'other-turn')
    await fetchAndRecord(sourceUrl, new DshEvidenceStore({ ...scope, tripContextVersion: 2 }), 'other-version')
    expect(request).toHaveBeenCalledTimes(5)
  })
})
