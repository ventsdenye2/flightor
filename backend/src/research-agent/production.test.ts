import { describe, expect, it, vi } from 'vitest'
import { ProductionResearchAgent } from './production.js'
import { researchArtifactSchema, type ResearchBrief } from './types.js'
import type { ResearchSearchProvider, ResearchSearchResult } from './search-provider.js'

const destination = { id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP' }
const brief: ResearchBrief = {
  destinations: [destination],
  interests: ['food'],
  questions: ['What is worth doing?'],
  researchTypes: ['activity'],
  maxResults: 2
}

function result(url: string, title = 'Result'): ResearchSearchResult {
  return {
    candidates: [{ title, snippet: 'Exact provider snippet', url, domain: new URL(url).hostname, authority: 'unknown' }],
    checkedAt: '2026-09-07T00:00:00.000Z',
    warnings: []
  }
}

describe('ProductionResearchAgent', () => {
  it('collects an evidence pool for one result and respects an explicit empty synthesis', async () => {
    const provider: ResearchSearchProvider = { name: 'mock', search: vi.fn(async () => result('https://example.com/unrelated')) }
    const agent = new ProductionResearchAgent({ searchProvider: provider, synthesisModel: { synthesize: async () => [] } })
    const artifact = await agent.research({ ...brief, maxResults: 1 }, { requestId: 'r' })
    expect(provider.search).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 10 }), {})
    expect(artifact.findings).toEqual([])
    expect(artifact.warnings).not.toContain('research_synthesis_unavailable_or_invalid')
  })
  it('uses deterministic source fallback without a synthesis model and enforces v2 bounds', async () => {
    const provider: ResearchSearchProvider = { name: 'mock', search: vi.fn(async () => result('https://example.com/a')) }
    const agent = new ProductionResearchAgent({ searchProvider: provider, now: () => new Date('2026-09-07T00:00:00.000Z') })
    const artifact = await agent.research(brief, { requestId: 'r' })
    expect(researchArtifactSchema.parse(artifact)).toEqual(artifact)
    expect(artifact.schemaVersion).toBe(2)
    expect(artifact.queryCount).toBe(1)
    expect(artifact.findings[0]).toMatchObject({ title: 'Result', summary: 'Exact provider snippet' })
  })

  it('continues after partial provider failures and never invents all-failure findings', async () => {
    const provider: ResearchSearchProvider = {
      name: 'mock',
      search: vi.fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce(result('https://example.com/b'))
    }
    const twoDestinations = { ...brief, destinations: [destination, { id: 'city-osa', type: 'city' as const, name: 'Osaka', countryCode: 'JP' }] }
    const agent = new ProductionResearchAgent({ searchProvider: provider, now: () => new Date('2026-09-07T00:00:00.000Z') })
    const artifact = await agent.research(twoDestinations, { requestId: 'r' })
    expect(artifact.queryCount).toBe(2)
    expect(artifact.warnings.some(warning => warning.includes('provider_failed'))).toBe(true)
    expect(artifact.findings).toHaveLength(1)

    const allFail = new ProductionResearchAgent({ searchProvider: { name: 'down', search: vi.fn(async () => { throw new Error('down') }) } })
    const empty = await allFail.research(brief, { requestId: 'r' })
    expect(empty.findings).toEqual([])
  })

  it('discloses destination coverage truncated by the bounded search-call policy', async () => {
    const provider: ResearchSearchProvider = { name: 'mock', search: vi.fn(async () => result('https://example.com/a')) }
    const destinations = [
      destination,
      { id: 'city-osa', type: 'city' as const, name: 'Osaka', countryCode: 'JP' },
      { id: 'city-kyo', type: 'city' as const, name: 'Kyoto', countryCode: 'JP' }
    ]
    const agent = new ProductionResearchAgent({
      searchProvider: provider,
      maxSearchCalls: 2,
      now: () => new Date('2026-09-07T00:00:00.000Z')
    })
    const artifact = await agent.research({ ...brief, destinations }, { requestId: 'r' })
    expect(provider.search).toHaveBeenCalledTimes(2)
    expect(artifact.queryCount).toBe(2)
    expect(artifact.warnings).toContain('research_destinations_skipped:1')
  })

  it('falls back when synthesis references an invalid source and propagates cancellation', async () => {
    const provider: ResearchSearchProvider = { name: 'mock', search: vi.fn(async () => result('https://example.com/a')) }
    const synthesis = { synthesize: vi.fn(async () => [{ category: 'activity' as const, destinationIndex: 0, title: 'bad', summary: 'bad', sourceIndexes: [99] }]) }
    const agent = new ProductionResearchAgent({ searchProvider: provider, synthesisModel: synthesis, now: () => new Date('2026-09-07T00:00:00.000Z') })
    const artifact = await agent.research(brief, { requestId: 'r' })
    expect(artifact.warnings).toContain('research_synthesis_unavailable_or_invalid')
    expect(artifact.findings[0]?.summary).toBe('Exact provider snippet')

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(agent.research(brief, { requestId: 'r', signal: controller.signal })).rejects.toThrow('cancelled')
  })
})
