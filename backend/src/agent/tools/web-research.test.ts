import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { locationRefKey } from '../../aviation/types.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { MockResearchAgent } from '../../research-agent/mock.js'
import { researchDestinationTool, webResearchTool } from './research.js'
import { recordResolvedLocations } from './resolved-locations.js'

const destination = { id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
const brief = {
  destinations: [destination], interests: ['food'], questions: ['What is worth doing?'],
  researchTypes: ['activity' as const], maxResults: 1
}
const finding = {
  id: 'finding-1', category: 'activity' as const, destinations: [destination],
  title: 'A', summary: 'B',
  sources: [{ title: 'A source', url: 'https://example.com/', domain: 'example.com', snippet: 'B', authority: 'unknown' as const }],
  verification: {
    status: 'partially_verified' as const, checkedAt: '2026-09-06T00:00:00.000Z', confidence: 0.5,
    sources: [{ provider: 'serpapi', reference: 'https://example.com/' }]
  },
  warnings: []
}

function context(research: { research: MockResearchAgent['research'] }) {
  const trip = { ...emptyTripContext('t'), interests: ['food'], departureWindow: { from: '2026-10-01', to: '2026-10-07', precision: 'approximate' as const } }
  return {
    requestId: 'r', conversationId: 'c', tripId: 't',
    trips: new InMemoryTripContextRepository([trip]),
    artifacts: new InMemoryArtifactRepository('u', new Set(['t'])), research,
    resolvedLocationKeys: new Set([locationRefKey(destination)]), isGenerationCurrent: () => true
  } as never
}

describe('research Agent tools', () => {
  it('uses provider facts for a resolved ID and rejects unknown identities before search', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    recordResolvedLocations(executionContext, [destination])
    const input = { destination: destination.id, questions: ['Tokyo museums'], researchTypes: ['activity' as const], maxResults: 5 }
    await researchDestinationTool.execute(input, executionContext, new AbortController().signal)
    expect(research.mock.calls[0]?.[0].destinations).toEqual([destination])
    await researchDestinationTool.execute({ ...input, destination: { ...destination, name: 'Changed by model', countryCode: 'US' } }, executionContext, new AbortController().signal)
    expect(research.mock.calls[1]?.[0].destinations).toEqual([destination])
    await expect(researchDestinationTool.execute({ ...input, destination: 'unknown-id' }, executionContext, new AbortController().signal)).rejects.toMatchObject({ code: 'LOCATION_NOT_RESOLVED' })
    expect(research).toHaveBeenCalledTimes(2)
  })
  it('persists a v2 artifact and returns only a compact result', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    const result = await webResearchTool.execute(brief, executionContext, new AbortController().signal)
    expect(result.summary).toMatchObject({ findingCount: 1, statusCounts: { partially_verified: 1 } })
    expect(JSON.stringify(result)).not.toContain('https://example.com')
    const stored = await executionContext.artifacts.get(result.artifact.id)
    expect(stored.schemaVersion).toBe(2)
    expect(stored.payload.findings).toHaveLength(1)
    expect(research).toHaveBeenCalledOnce()
    expect(Object.keys(research.mock.calls[0]![1] as object).sort()).toEqual(['requestId', 'signal'])
  })

  it('derives research_destination window and interests from the active Trip', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    await researchDestinationTool.execute({
      destination, questions: ['What is open?'], researchTypes: ['practical'], maxResults: 5
    }, context({ research }), new AbortController().signal)
    expect(research.mock.calls[0]?.[0]).toMatchObject({
      destinations: [destination], interests: ['food'],
      travelWindow: { from: '2026-10-01', to: '2026-10-07' }
    })
  })

  it('covers all travel days when the trip only specifies an outbound date', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    executionContext.trips = new InMemoryTripContextRepository([{ ...emptyTripContext('t'), travelDays: 5,
      departureWindow: { from: '2026-10-30', to: '2026-10-30', precision: 'exact' } }])
    await researchDestinationTool.execute({ destination, questions: ['What is open?'], researchTypes: ['practical'], maxResults: 5 }, executionContext, new AbortController().signal)
    expect(research.mock.calls[0]?.[0].travelWindow).toEqual({ from: '2026-10-30', to: '2026-11-03' })
  })

  it('rejects mismatched output, untrusted destinations, and stale generations', async () => {
    const mismatch = {
      research: vi.fn(async () => ({
        id: 'x', type: 'research' as const, schemaVersion: 2 as const,
        brief: { ...brief, questions: ['other'] }, findings: [], queryCount: 0,
        warnings: [], createdAt: '2026-09-06T00:00:00.000Z'
      }))
    }
    await expect(webResearchTool.execute(brief, context(mismatch as any), new AbortController().signal)).rejects.toThrow('mismatched')
    const untrusted = { ...(context(new MockResearchAgent()) as any), resolvedLocationKeys: new Set() }
    await expect(webResearchTool.execute(brief, untrusted, new AbortController().signal)).rejects.toThrow('authoritative')
    const stale = { ...(context(new MockResearchAgent()) as any), isGenerationCurrent: () => false }
    await expect(webResearchTool.execute(brief, stale, new AbortController().signal)).rejects.toThrow('cancelled')
  })
})
