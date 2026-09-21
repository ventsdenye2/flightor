import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ProductionResearchAgent } from './production.js'
import type { ResearchSourceReader } from './source-reader.js'
import type { ResearchBrief } from './types.js'
import type { ResearchSearchProvider, ResearchSearchResult } from './search-provider.js'

const destination = { id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP' }
const brief: ResearchBrief = { destinations: [destination], interests: ['food'], questions: ['What is worth doing?'], researchTypes: ['practical'], maxResults: 2 }
const pageFor = (url: string, text = `Observed text for ${url}.`) => ({ text, retrievedAt: '2026-09-21T00:00:00.000Z', contentHash: createHash('sha256').update(text).digest('hex') })
const candidate = (url: string, index: number, page?: unknown) => ({ title: `Source ${index}`, snippet: `Snippet ${index}`, url, domain: 'example.com', authority: 'unknown' as const, ...(page ? { page } : {}) })
const result = (count: number, pages?: readonly unknown[]): ResearchSearchResult => ({
  candidates: Array.from({ length: count }, (_, index) => candidate(`https://example.com/source-${index}`, index, pages?.[index])),
  checkedAt: '2026-09-21T00:00:00.000Z', warnings: []
})
const provider = (response: ResearchSearchResult): ResearchSearchProvider => ({ name: 'fixture', search: vi.fn(async () => response) })

describe('ProductionResearchAgent source enrichment', () => {
  it('reads at most four sources with two workers before synthesis', async () => {
    let active = 0
    let peak = 0
    const order: string[] = []
    const reader: ResearchSourceReader = { read: vi.fn(async url => {
      active += 1
      peak = Math.max(peak, active)
      order.push(`read:${url}`)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1
      return pageFor(url)
    }) }
    const synthesis = { synthesize: vi.fn(async ({ sources }: { sources: Array<{ url: string; page?: unknown }> }) => {
      order.push('synthesize')
      expect(sources.slice(0, 4).every(source => source.page)).toBe(true)
      return []
    }) }
    const artifact = await new ProductionResearchAgent({ searchProvider: provider(result(5)), sourceReader: reader, synthesisModel: synthesis }).research(brief, { requestId: 'enrichment' })
    expect(reader.read).toHaveBeenCalledTimes(4)
    expect(peak).toBeLessThanOrEqual(2)
    expect(order.at(-1)).toBe('synthesize')
    expect(artifact.warnings).toContain('research_source_read_limit')
  })

  it('propagates cancellation while reading sources', async () => {
    const controller = new AbortController()
    const reader: ResearchSourceReader = { read: vi.fn(async (_url, options) => {
      await new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => resolve(), { once: true }))
      throw controller.signal.reason
    }) }
    const run = new ProductionResearchAgent({ searchProvider: provider(result(1)), sourceReader: reader, synthesisModel: { synthesize: async () => [] } }).research(brief, { requestId: 'cancel', signal: controller.signal })
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalled())
    controller.abort(new Error('cancelled'))
    await expect(run).rejects.toThrow('cancelled')
  })

  it('warns on a read failure and retains the source as unknown', async () => {
    const reader: ResearchSourceReader = { read: vi.fn(async url => {
      if (url.endsWith('source-0')) throw new Error('unavailable')
      return pageFor(url, 'The adult ticket costs 900 yen.')
    }) }
    const synthesis = { synthesize: vi.fn(async () => [{ category: 'practical' as const, destinationIndex: 0, title: 'Tickets', summary: 'Tickets', sourceIndexes: [0], claimEvidence: [{ kind: 'price' as const, subject: 'adult ticket', value: '900 yen', quote: 'The adult ticket costs 900 yen.', sourceIndex: 0 }] }]) }
    const artifact = await new ProductionResearchAgent({ searchProvider: provider(result(1)), sourceReader: reader, synthesisModel: synthesis }).research(brief, { requestId: 'read-failure' })
    expect(artifact.warnings).toContain('research_source_read_failed')
    expect(artifact.findings[0]?.sources[0]?.page).toBeUndefined()
    expect(artifact.findings[0]?.claimEvidence).toBeUndefined()
    expect(artifact.findings[0]?.warnings).toContain('claim_evidence_rejected')
  })

  it('strips provider pages and trusts only the injected reader page', async () => {
    const providerPage = pageFor('https://example.com/source-0', 'Provider invented page: tickets cost 1 yen.')
    const trustedPage = pageFor('https://example.com/source-0', 'The adult ticket costs 900 yen.')
    const reader: ResearchSourceReader = { read: vi.fn(async () => trustedPage) }
    let synthesisSources: Array<{ page?: unknown }> = []
    const synthesis = { synthesize: vi.fn(async ({ sources }: { sources: Array<{ page?: unknown }> }) => {
      synthesisSources = sources
      return [{ category: 'practical' as const, destinationIndex: 0, title: 'Tickets', summary: 'Tickets', sourceIndexes: [0], claimEvidence: [{ kind: 'price' as const, subject: 'adult ticket', value: '900 yen', quote: 'The adult ticket costs 900 yen.', sourceIndex: 0 }, { kind: 'price' as const, subject: 'adult ticket', value: '1 yen', quote: 'Provider invented page: tickets cost 1 yen.', sourceIndex: 0 }] }]
    }) }
    const artifact = await new ProductionResearchAgent({ searchProvider: provider(result(1, [providerPage])), sourceReader: reader, synthesisModel: synthesis }).research(brief, { requestId: 'trusted-page' })
    expect(synthesisSources[0]?.page).toEqual(trustedPage)
    expect(artifact.findings[0]?.claimEvidence).toEqual([expect.objectContaining({ value: '900 yen' })])
    expect(artifact.findings[0]?.warnings).toContain('claim_evidence_rejected')
  })

  it('keeps admitted claims after source serialization and reports conflicts', async () => {
    const reader: ResearchSourceReader = { read: vi.fn(async url => pageFor(url, 'Adult ticket costs 900 yen. Adult ticket costs 1,000 yen.')) }
    const synthesis = { synthesize: vi.fn(async () => [{ category: 'practical' as const, destinationIndex: 0, title: 'Tickets', summary: 'Tickets', sourceIndexes: [0], claimEvidence: [
      { kind: 'price' as const, subject: 'adult ticket', value: '900 yen', quote: 'Adult ticket costs 900 yen.', sourceIndex: 0 },
      { kind: 'price' as const, subject: 'adult ticket', value: '1,000 yen', quote: 'Adult ticket costs 1,000 yen.', sourceIndex: 0 }
    ] }]) }
    const artifact = await new ProductionResearchAgent({ searchProvider: provider(result(1)), sourceReader: reader, synthesisModel: synthesis }).research(brief, { requestId: 'claims' })
    expect(artifact.findings[0]?.claimEvidence).toHaveLength(2)
    expect(artifact.findings[0]?.warnings).toContain('claim_evidence_conflict')
    expect(artifact.findings[0]?.sources[0]?.page?.contentHash).toBe(pageFor('https://example.com/source-0', 'Adult ticket costs 900 yen. Adult ticket costs 1,000 yen.').contentHash)
  })
})
