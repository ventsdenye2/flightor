import { describe, expect, it, vi } from 'vitest'
import { ProductionResearchAgent } from './production.js'
import type { ResearchBrief } from './types.js'
import type { ResearchSearchInput, ResearchSearchProvider, ResearchSynthesisInput } from './search-provider.js'
import type { ResearchQueryPlanInput, ResearchQueryPlanner } from './query-planner.js'
import { SerpApiResearchSearchProvider } from './providers/serpapi.js'
import { CuratedResearchQueryPolicy } from './query-policy.js'
import { EMPTY_LOCATION_IDENTITY_POLICY } from '../locations/identity.js'

const destination = { id: 'city-par', type: 'city' as const, name: 'Paris', countryCode: 'FR', cityCode: 'PAR' }
const brief: ResearchBrief = {
  destinations: [destination], interests: ['culture'],
  questions: ['哪些艺术博物馆适合旅行以及为什么值得参观？'], researchTypes: ['activity'], maxResults: 3
}
const emptySearch = { candidates: [], warnings: [], checkedAt: '2026-09-08T00:00:00.000Z' }

describe('ProductionResearchAgent query planning', () => {
  it('plans only eight existing tasks, preserves original questions and keeps search concurrency at two', async () => {
    let active = 0
    let peak = 0
    const provider: ResearchSearchProvider = { name: 'mock', search: vi.fn(async (input: ResearchSearchInput) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return { ...emptySearch, candidates: [{ title: 'Museum', snippet: 'A museum source',
        url: `https://example.com/${input.destination.id}/${input.searchTerms?.replaceAll(' ', '-')}`, domain: 'example.com', authority: 'unknown' as const }] }
    }) }
    const plan = vi.fn(async (input: ResearchQueryPlanInput) => input.tasks.map(task => ({
      ...task, searchTerms: `museum topic ${task.destinationIndex} ${task.questionIndex}`
    })).reverse())
    const synthesize = vi.fn(async (_input: ResearchSynthesisInput) => [])
    const requested = { ...brief, destinations: [destination, { ...destination, id: 'city-lyo', name: 'Lyon', cityCode: 'LYS' }],
      questions: [brief.questions[0]!, 'food markets', 'public parks', 'accessible transport', 'local crafts'] }
    const original = structuredClone(requested)
    const artifact = await new ProductionResearchAgent({ searchProvider: provider, queryPlanner: { plan }, synthesisModel: { synthesize } })
      .research(requested, { requestId: 'r' })
    expect(plan).toHaveBeenCalledOnce()
    expect(plan.mock.calls[0]?.[0].tasks).toHaveLength(8)
    expect(provider.search).toHaveBeenCalledTimes(8)
    expect(peak).toBe(2)
    expect(vi.mocked(provider.search).mock.calls.map(([input]) => input.searchTerms))
      .toEqual(['museum topic 0 0', 'museum topic 1 0', 'museum topic 0 1', 'museum topic 1 1', 'museum topic 0 2', 'museum topic 1 2', 'museum topic 0 3', 'museum topic 1 3'])
    expect(requested).toEqual(original)
    expect(synthesize.mock.calls[0]?.[0].brief).toEqual(original)
    expect(artifact.brief).toEqual(original)
    expect(artifact.queryCount).toBe(8)
    expect(artifact.warnings).toContain('research_questions_partially_sampled')
  })

  it('uses concise topics while leaving source restriction policy server-owned', async () => {
    const searchOrganic = vi.fn(async () => [])
    const policy = new CuratedResearchQueryPolicy([{ countryCode: 'FR', cityCode: 'PAR', domains: ['paris.example'], warning: 'curated_sources' }], EMPTY_LOCATION_IDENTITY_POLICY)
    const provider = new SerpApiResearchSearchProvider({ searchOrganic }, policy)
    const planner: ResearchQueryPlanner = { plan: async input => input.tasks.map(task => ({ ...task, searchTerms: 'art museums' })) }
    const artifact = await new ProductionResearchAgent({ searchProvider: provider, queryPlanner: planner }).research(brief, { requestId: 'r' })
    expect(searchOrganic).toHaveBeenCalledWith(expect.objectContaining({ query: 'Paris art museums (site:paris.example)' }), undefined)
    expect(artifact.warnings).toContain('curated_sources')
    expect(artifact.brief.questions).toEqual(brief.questions)
  })

  it.each(['failure', 'invalid-index', 'unsafe-query'])('falls back to the original sanitized query with a bounded warning: %s', async mode => {
    const searchOrganic = vi.fn(async () => [])
    const provider = new SerpApiResearchSearchProvider({ searchOrganic }, new CuratedResearchQueryPolicy([
      { countryCode: 'FR', cityCode: 'PAR', domains: ['paris.example'] }
    ], EMPTY_LOCATION_IDENTITY_POLICY))
    const planner: ResearchQueryPlanner = { plan: async input => {
      if (mode === 'failure') throw new Error('upstream secret response')
      return input.tasks.map(task => ({ ...task, questionIndex: mode === 'invalid-index' ? 99 : task.questionIndex,
        searchTerms: mode === 'unsafe-query' ? 'site:evil.example museums' : 'art museums' }))
    } }
    const original = { ...brief, questions: ['art museums site:evil.example'] }
    const artifact = await new ProductionResearchAgent({ searchProvider: provider, queryPlanner: planner }).research(original, { requestId: 'r' })
    expect(searchOrganic).toHaveBeenCalledOnce()
    expect(searchOrganic).toHaveBeenCalledWith(expect.objectContaining({ query: 'Paris art museums evil.example (site:paris.example)' }), undefined)
    expect(artifact.warnings).toContain('research_query_planning_unavailable_or_invalid')
    expect(JSON.stringify(artifact)).not.toContain('upstream secret response')
    expect(artifact.queryCount).toBe(1)
    expect(artifact.brief).toEqual(original)
  })

  it('propagates the research signal without fallback searches after cancellation', async () => {
    const controller = new AbortController()
    const provider: ResearchSearchProvider = { name: 'mock', search: vi.fn(async () => emptySearch) }
    const planner: ResearchQueryPlanner = { plan: vi.fn(async (input, options) => {
      expect(options?.signal).toBe(controller.signal)
      controller.abort(new Error('research deadline'))
      return input.tasks.map(task => ({ ...task, searchTerms: 'art museums' }))
    }) }
    await expect(new ProductionResearchAgent({ searchProvider: provider, queryPlanner: planner }).research(brief, { requestId: 'r', signal: controller.signal }))
      .rejects.toThrow('research deadline')
    expect(provider.search).not.toHaveBeenCalled()
  })
})
