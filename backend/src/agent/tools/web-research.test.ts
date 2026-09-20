import { describe, expect, it, vi } from 'vitest'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { locationRefKey } from '../../aviation/types.js'
import { InMemoryTripContextRepository } from '../../trips/repository.js'
import { emptyTripContext } from '../../trips/types.js'
import { MockResearchAgent } from '../../research-agent/mock.js'
import { executeResearchBrief, researchDestinationTool, webResearchTool } from './research.js'
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
  it('rejects conflicting saved Trip dates before paid research, even with an explicit research window', async () => {
    const research = vi.fn()
    const executionContext = context({ research }) as unknown as Parameters<typeof executeResearchBrief>[1]
    executionContext.trips = new InMemoryTripContextRepository([{
      ...emptyTripContext('t'), travelDays: 2,
      departureWindow: { from: '2026-10-12', to: '2026-10-13', precision: 'exact' },
      returnWindow: { from: '2026-10-14', to: '2026-10-14', precision: 'exact' }
    }])
    await expect(executeResearchBrief({ ...brief, travelWindow: { from: '2026-10-12', to: '2026-10-14' } },
      executionContext, new AbortController().signal)).rejects.toMatchObject({ code: 'TRIP_DATES_INCONSISTENT' })
    expect(research).not.toHaveBeenCalled()
    expect(await executionContext.artifacts.listForTrip('t')).toEqual([])
  })

  it('uses the same trusted lookup for numeric destination selectors', async () => {
    const numericDestination = { ...destination, id: '8' }
    const delegate = new MockResearchAgent([{ ...finding, destinations: [numericDestination] }])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    recordResolvedLocations(executionContext, [numericDestination])
    const input = { destination: 8, questions: ['Museums'], researchTypes: ['activity' as const], maxResults: 5 }
    await researchDestinationTool.execute(input, executionContext, new AbortController().signal)
    expect(research.mock.calls[0]?.[0].destinations).toEqual([numericDestination])
    await expect(researchDestinationTool.execute({ ...input, destination: 999 }, executionContext, new AbortController().signal)).rejects.toMatchObject({ code: 'LOCATION_NOT_RESOLVED' })
    expect(research).toHaveBeenCalledOnce()
  })

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

  it('reuses a canonical location already saved on the active Trip', async () => {
    const numericDestination = { ...destination, id: '8' }
    const delegate = new MockResearchAgent([{ ...finding, destinations: [numericDestination] }])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    executionContext.trips = new InMemoryTripContextRepository([{
      ...emptyTripContext('t'),
      destinationIntent: { mode: 'explicit', required: [numericDestination], preferred: [], excluded: [] }
    }])

    await researchDestinationTool.execute({
      destination: '8', questions: ['Tokyo museums'], researchTypes: ['activity'], maxResults: 5
    }, executionContext, new AbortController().signal)

    expect(research).toHaveBeenCalledOnce()
    expect(research.mock.calls[0]?.[0].destinations).toEqual([numericDestination])
  })

  it('persists a v2 artifact and returns only a compact result', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    const result = await webResearchTool.execute(brief, executionContext, new AbortController().signal)
    expect(result.summary).toMatchObject({ findingCount: 1, statusCounts: { partially_verified: 1 } })
    expect(result.findings).toEqual([expect.objectContaining({ id: 'finding-1', title: 'A', summary: 'B', verificationStatus: 'partially_verified' })])
    expect(JSON.stringify(result)).not.toContain('https://example.com')
    const stored = await executionContext.artifacts.get(result.artifact.id)
    expect(stored.schemaVersion).toBe(2)
    expect(stored.payload.findings).toHaveLength(1)
    expect(research).toHaveBeenCalledOnce()
    expect(research.mock.calls[0]![1]).toEqual({
      requestId: 'r', signal: expect.any(AbortSignal), conversationId: 'c', tripId: 't', tripContextVersion: 0
    })
  })

  it('derives research_destination window and interests from the active Trip', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    await researchDestinationTool.execute({
      destination, questions: ['What is open?'], researchTypes: ['practical'], maxResults: 5
    }, context({ research }), new AbortController().signal)
    expect(research.mock.calls[0]?.[0]).toMatchObject({
      destinations: [destination], interests: ['food'],
      travelWindow: { from: '2026-10-01' }
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

  it.each(['web-first', 'destination-first'])('uses the same snapshot window across research tools (%s)', async order => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    executionContext.trips = new InMemoryTripContextRepository([{ ...emptyTripContext('t'), interests: brief.interests, travelDays: 5,
      departureWindow: { from: '2026-10-30', to: '2026-10-30', precision: 'exact' } }])
    const web = () => webResearchTool.execute(brief, executionContext, new AbortController().signal)
    const destinationResearch = () => researchDestinationTool.execute({
      destination, questions: brief.questions, researchTypes: brief.researchTypes, maxResults: brief.maxResults
    }, executionContext, new AbortController().signal)
    const first = await (order === 'web-first' ? web() : destinationResearch())
    const second = await (order === 'web-first' ? destinationResearch() : web())
    expect(research.mock.calls[0]?.[0]).toEqual(research.mock.calls[1]?.[0])
    expect(research.mock.calls[0]?.[0].travelWindow).toEqual({ from: '2026-10-30', to: '2026-11-03' })
    for (const result of [first, second]) {
      const stored = await executionContext.artifacts.get(result.artifact.id)
      expect(stored.tripContextVersion).toBe(0)
      expect(stored.payload.brief.travelWindow).toEqual({ from: '2026-10-30', to: '2026-11-03' })
    }
  })

  it.each([
    { from: '2026-12-01', to: '2026-12-02' },
    { from: '2026-12-01' },
    {}
  ])('preserves an explicitly supplied research window without widening it: %j', async travelWindow => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    const result = await webResearchTool.execute({ ...brief, travelWindow }, executionContext, new AbortController().signal)
    expect(research.mock.calls[0]?.[0].travelWindow).toEqual(travelWindow)
    const stored = await executionContext.artifacts.get(result.artifact.id)
    expect(stored.payload.brief.travelWindow).toEqual(travelWindow)
  })

  it('keeps the window absent when the accepted Trip has no dates', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    executionContext.trips = new InMemoryTripContextRepository([emptyTripContext('t')])
    const result = await webResearchTool.execute(brief, executionContext, new AbortController().signal)
    expect(research.mock.calls[0]?.[0].travelWindow).toBeUndefined()
    expect((await executionContext.artifacts.get(result.artifact.id)).payload.brief.travelWindow).toBeUndefined()
  })

  it('rejects a stale accepted snapshot before research instead of deriving from a newer Trip', async () => {
    const delegate = new MockResearchAgent([finding])
    const research = vi.fn(delegate.research.bind(delegate))
    const executionContext = context({ research }) as any
    const snapshot = await executionContext.trips.get('t')
    await executionContext.trips.update('t', { travelDays: 10 }, snapshot.version)
    await expect(executeResearchBrief(brief, executionContext, new AbortController().signal, snapshot))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(research).not.toHaveBeenCalled()
    expect(await executionContext.artifacts.listForTrip('t')).toEqual([])
  })

  it('creates new window-bound evidence without relabeling a prior Artifact', async () => {
    const executionContext = context(new MockResearchAgent([finding])) as any
    const first = await webResearchTool.execute({ ...brief, travelWindow: { from: '2026-09-01', to: '2026-09-02' } }, executionContext, new AbortController().signal)
    const original = await executionContext.artifacts.get(first.artifact.id)
    const second = await webResearchTool.execute(brief, executionContext, new AbortController().signal)
    expect(second.artifact.id).not.toBe(first.artifact.id)
    expect(await executionContext.artifacts.get(first.artifact.id)).toEqual(original)
    expect((await executionContext.artifacts.get(second.artifact.id)).payload.brief.travelWindow)
      .toEqual({ from: '2026-10-01' })
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

  it('does not persist research after the Trip changes during the provider call', async () => {
    const delegate = new MockResearchAgent([finding])
    const executionContext = context(delegate) as any
    const research = vi.fn(async (...args: Parameters<typeof delegate.research>) => {
      const result = await delegate.research(...args)
      await executionContext.trips.update('t', { travelDays: 10 }, 0)
      return result
    })
    executionContext.research = { research }
    await expect(webResearchTool.execute(brief, executionContext, new AbortController().signal))
      .rejects.toMatchObject({ code: 'TRIP_CONTEXT_VERSION_CONFLICT' })
    expect(research).toHaveBeenCalledOnce()
    expect(await executionContext.artifacts.listForTrip('t')).toEqual([])
  })
})
