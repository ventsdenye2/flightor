import { describe, expect, it, vi } from 'vitest'
import { MockResearchAgent } from '../../research-agent/mock.js'
import { InMemoryArtifactRepository } from '../../artifacts/repository.js'
import { webResearchTool } from './web-research.js'
import { locationRefKey } from '../../aviation/types.js'

const brief = { destinations: [{ id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP' }], interests: ['food'], questions: ['What is worth doing?'], researchTypes: ['activity' as const], maxResults: 1 }
const context = (research: MockResearchAgent) => ({ requestId: 'r', conversationId: 'c', tripId: 't', artifacts: new InMemoryArtifactRepository('u', new Set(['t'])), research, resolvedLocationKeys: new Set([locationRefKey(brief.destinations[0])]), isGenerationCurrent: () => true }) as never

describe('webResearchTool', () => {
  it('persists full artifact and returns a compact result', async () => {
    const delegate = new MockResearchAgent([{ title: 'A', summary: 'B', sourceUrls: ['https://example.com'], verifiedAt: '2026-09-06T00:00:00.000Z', confidence: 'confirmed' }])
    const research = vi.fn(delegate.research.bind(delegate))
    const agent = { research } as unknown as MockResearchAgent
    const executionContext = context(agent) as any
    const result = await webResearchTool.execute(brief, executionContext, new AbortController().signal)
    expect(result.summary).toMatchObject({ findingCount: 1 })
    expect(JSON.stringify(result)).not.toContain('https://example.com')
    const stored = await executionContext.artifacts.get(result.artifact.id)
    expect(stored.payload.findings).toHaveLength(1)
    expect(research).toHaveBeenCalledOnce()
    expect(Object.keys(research.mock.calls[0]![1] as object).sort()).toEqual(['requestId', 'signal'])
  })

  it('rejects mismatched agent output and avoids persistence when stale', async () => {
    const agent = { research: vi.fn(async () => ({ id: 'x', type: 'research', schemaVersion: 1, brief: { ...brief, questions: ['other'] }, findings: [], createdAt: '2026-09-06T00:00:00.000Z' })) }
    await expect(webResearchTool.execute(brief, context(agent as any), new AbortController().signal)).rejects.toThrow('mismatched')
    const stale = { ...context(new MockResearchAgent()), isGenerationCurrent: () => false } as any
    await expect(webResearchTool.execute(brief, stale, new AbortController().signal)).rejects.toThrow('cancelled')
  })

  it('rejects destination references that were not established by the runtime', async () => {
    const executionContext = { ...(context(new MockResearchAgent()) as any), resolvedLocationKeys: new Set() }
    await expect(webResearchTool.execute(brief, executionContext, new AbortController().signal)).rejects.toThrow('authoritative')
  })
})
