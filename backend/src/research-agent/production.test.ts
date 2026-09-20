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
  it.each([true, false])('admits event dates only from a retrieved excerpt (supported=%s)', async supported => {
    const source = result('https://example.com/festival')
    source.candidates[0]!.snippet = supported ? 'Festival runs 2026-10-26 to 2026-11-04.' : 'Festival takes place in late October.'
    const agent = new ProductionResearchAgent({ searchProvider: { name: 'fixture', search: async () => source },
      synthesisModel: { synthesize: async () => [{ category: 'event', destinationIndex: 0, title: 'Festival',
        summary: 'Festival', sourceIndexes: [0], temporalEvidence: { sourceIndex: 0,
          from: '2026-10-26', to: '2026-11-04', quote: 'Festival runs 2026-10-26 to 2026-11-04.' } }] } })
    const artifact = await agent.research({ ...brief, researchTypes: ['event'],
      travelWindow: { from: '2026-10-20', to: '2026-10-21' } }, { requestId: 'event-provenance' })
    expect(artifact.findings).toHaveLength(1)
    if (supported) expect(artifact.findings[0]!.temporalEvidence).toMatchObject({ from: '2026-10-26', to: '2026-11-04', sourceUrl: 'https://example.com/festival' })
    else expect(artifact.findings[0]!.temporalEvidence).toBeUndefined()
  })

  it('starts the next query when either worker is free and preserves source ordering', async () => {
    const pending: Array<(value: ResearchSearchResult) => void> = []
    const provider: ResearchSearchProvider = { name: 'rolling', search: vi.fn(() => new Promise(resolve => { pending.push(resolve) })) }
    const run = new ProductionResearchAgent({ searchProvider: provider }).research({ ...brief, questions: ['a', 'b', 'c'], maxResults: 3 }, { requestId: 'rolling' })
    expect(pending).toHaveLength(2)
    pending[1]!(result('https://example.com/b'))
    await Promise.resolve()
    expect(pending).toHaveLength(3)
    pending[2]!(result('https://example.com/c'))
    pending[0]!(result('https://example.com/a'))
    const artifact = await run
    expect(artifact.findings.map(finding => finding.sources[0]?.url)).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
  })
  it('covers later questions within the same bounded search budget and concurrency', async () => {
    let active = 0
    let peak = 0
    const questions: string[] = []
    const provider: ResearchSearchProvider = { name: 'mock', search: async input => {
      active += 1
      peak = Math.max(peak, active)
      questions.push(input.questions[0]!)
      await Promise.resolve()
      active -= 1
      return result(`https://example.com/${input.questions[0]}`)
    } }
    const agent = new ProductionResearchAgent({ searchProvider: provider })
    const artifact = await agent.research({ ...brief, questions: ['museums', 'food', 'parks', 'accessibility'] }, { requestId: 'r' })
    expect(questions).toEqual(['museums', 'food', 'parks', 'accessibility'])
    expect(peak).toBe(2)
    expect(artifact.queryCount).toBe(4)
    expect(artifact.warnings).not.toContain('research_questions_partially_sampled')
  })

  it('separates topic questions while preserving a bounded deterministic evidence pool', async () => {
    const provider: ResearchSearchProvider = { name: 'mock', search: vi.fn(async input => result(`https://example.com/${input.questions[0]}`)) }
    const agent = new ProductionResearchAgent({ searchProvider: provider, maxSearchCalls: 2 })
    const artifact = await agent.research({ ...brief, questions: ['museums', 'food', 'parks'] }, { requestId: 'r' })
    expect(provider.search).toHaveBeenCalledTimes(2)
    expect((provider.search as any).mock.calls.map((call: any[]) => call[0].questions)).toEqual([['museums'], ['food']])
    expect(artifact.queryCount).toBe(2)
    expect(artifact.warnings).toContain('research_questions_partially_sampled')
    expect(artifact.findings.map(finding => finding.sources[0]?.url)).toEqual(['https://example.com/museums', 'https://example.com/food'])
  })
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

  it('does not promote an official raw snippet into an eligible itinerary finding', async () => {
    const response = result('https://www.gotokyo.org/old-exhibition', '2024 exhibition')
    response.candidates[0]!.authority = 'government_tourism'
    const agent = new ProductionResearchAgent({ searchProvider: { name: 'mock', search: async () => response } })
    const artifact = await agent.research(brief, { requestId: 'r' })
    expect(artifact.findings[0]?.verification.status).toBe('unverified')
    expect(artifact.findings[0]?.warnings).toContain('raw_source_requires_synthesis')
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
