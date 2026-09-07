import { describe, expect, it } from 'vitest'
import { UnavailableResearchAgent } from './unavailable.js'

describe('UnavailableResearchAgent', () => {
  it('throws a bounded, secret-free capability error', async () => {
    await expect(new UnavailableResearchAgent().research({ destinations: [], interests: [], questions: [], researchTypes: [] } as never, { requestId: 'r' })).rejects.toMatchObject({ code: 'RESEARCH_UNAVAILABLE', statusCode: 503 })
  })
})
