import { describe, expect, it } from 'vitest'
import { MockResearchAgent } from './mock.js'
import { researchArtifactSchema, researchBriefSchema, type ResearchBrief } from './types.js'

const location = { id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP' }
const brief: ResearchBrief = {
  destinations: [location],
  interests: ['food'],
  questions: ['What is worth doing?'],
  researchTypes: ['activity'],
  maxResults: 1
}

describe('MockResearchAgent contract', () => {
  it('accepts the brief schema and returns a bounded, valid artifact', async () => {
    const agent = new MockResearchAgent([
      { title: 'one', summary: 'first', sourceUrls: ['https://example.com/1'], verifiedAt: '2026-09-06T00:00:00.000Z', confidence: 'confirmed' },
      { title: 'two', summary: 'second', sourceUrls: ['https://example.com/2'], verifiedAt: '2026-09-06T00:00:00.000Z', confidence: 'partial' }
    ])
    const result = await agent.research(brief, { requestId: 'request-1' })
    expect(researchBriefSchema.parse(result.brief)).toEqual(brief)
    expect(researchArtifactSchema.parse(result)).toEqual(result)
    expect(result.findings).toHaveLength(1)
    expect(result.type).toBe('research')
    expect(result.schemaVersion).toBe(1)
  })

  it('rejects malformed briefs before producing state and honors cancellation', async () => {
    const agent = new MockResearchAgent()
    await expect(agent.research({ ...brief, questions: [] }, { requestId: 'request-2' })).rejects.toThrow()
    const controller = new AbortController()
    controller.abort(new Error('cancelled by caller'))
    await expect(agent.research(brief, { requestId: 'request-3', signal: controller.signal })).rejects.toThrow('cancelled by caller')
  })

  it('has no memory, trip, or tool dependencies and is deterministic for a brief', async () => {
    const agent = new MockResearchAgent()
    const first = await agent.research(brief, { requestId: 'a' })
    const second = await agent.research(brief, { requestId: 'b' })
    expect(first.id).toBe(second.id)
    expect(first.brief).toEqual(second.brief)
    expect(first.findings).toEqual([])
  })
})
