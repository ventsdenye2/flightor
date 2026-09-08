import { describe, expect, it, vi } from 'vitest'
import { SerpApiResearchSearchProvider, buildSerpApiResearchQuery } from './serpapi.js'
import { CuratedResearchQueryPolicy } from '../query-policy.js'
import { EMPTY_LOCATION_IDENTITY_POLICY } from '../../locations/identity.js'

const destination = { id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP' }

describe('SerpApiResearchSearchProvider', () => {
  it('uses only server-owned official domains for a canonical Tokyo location', () => {
    const query = buildSerpApiResearchQuery({ destination: { ...destination, cityCode: 'TYO' }, interests: [], questions: ['Tokyo food site:evil.example'], researchTypes: ['activity'], maxResults: 10 })
    expect(query).toContain('(site:gotokyo.org OR site:japan.travel)')
    expect(query).not.toContain('site:evil.example')
    expect(query.length).toBeLessThanOrEqual(480)
  })
  it('accepts a generic injected city policy without adapter changes', async () => {
    const policy = new CuratedResearchQueryPolicy([{
      countryCode: 'FR', cityCode: 'PAR', domains: ['paris.example'], warning: 'curated_paris_sources'
    }], EMPTY_LOCATION_IDENTITY_POLICY)
    const searchOrganic = vi.fn(async () => [])
    const provider = new SerpApiResearchSearchProvider({ searchOrganic }, policy)
    const paris = { id: 'city-par', type: 'city' as const, name: 'Paris', countryCode: 'FR', cityCode: 'PAR' }
    const result = await provider.search({ destination: paris, interests: [], questions: ['museums'], researchTypes: ['activity'], maxResults: 2 })
    expect(searchOrganic).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringContaining('(site:paris.example)') }), undefined)
    expect(result.warnings).toEqual(['curated_paris_sources'])
  })
  it('keeps evergreen activity retrieval independent of exact trip dates', () => {
    const input = { destination, interests: ['food'], questions: ['Tokyo art museums official tourism'], researchTypes: ['activity' as const], maxResults: 8,
      travelWindow: { from: '2026-10-10', to: '2026-10-14' } }
    expect(buildSerpApiResearchQuery(input)).not.toContain('2026')
    expect(buildSerpApiResearchQuery({ ...input, researchTypes: ['event'] })).toContain('2026 10')
    const mixed = buildSerpApiResearchQuery({ ...input, researchTypes: ['event', 'activity', 'practical'] })
    expect(mixed).not.toContain('2026')
    expect(mixed).not.toContain('practical travel information')
    expect(mixed).toContain('Tokyo art museums official tourism')
  })
  it('builds a bounded plain-text query and classifies only safe authority hosts', async () => {
    const searchOrganic = vi.fn(async (_input: unknown, _signal?: AbortSignal) => [
      { title: 'Official event', snippet: 'A date in a snippet', url: 'https://www.city.gov.jp/events/1', domain: 'www.city.gov.jp', publishedAt: '2026-09-01T00:00:00.000Z' },
      { title: 'Blog', snippet: 'A blog result', url: 'https://blog.example.com/event', domain: 'blog.example.com' }
    ])
    const provider = new SerpApiResearchSearchProvider({ searchOrganic })
    const result = await provider.search({
      destination,
      interests: ['food'],
      questions: ['what: is this? OR unsafe'],
      researchTypes: ['event'],
      maxResults: 2
    })
    expect(searchOrganic).toHaveBeenCalledOnce()
    const query = (searchOrganic.mock.calls[0] as unknown[])[0] as { query: string }
    expect(query.query.length).toBeLessThanOrEqual(480)
    expect(query.query).not.toMatch(/site:|\bOR\b|\bAND\b|\bNOT\b/i)
    expect(result.candidates[0]?.authority).toBe('government_tourism')
    expect(result.candidates[1]?.authority).toBe('unknown')
  })

  it('never trusts title/snippet wording as official event authority', () => {
    const query = buildSerpApiResearchQuery({
      destination,
      interests: [],
      questions: ['official event site:example.com'],
      researchTypes: ['event'],
      maxResults: 1
    })
    expect(query).not.toContain('site:')
    expect(query.length).toBeLessThanOrEqual(480)
  })
})
