import { describe, expect, it, vi } from 'vitest'
import { OpenRouterResearchSynthesisModel } from './research.js'

const brief = {
  destinations: [{ id: 'city-tyo', type: 'city' as const, name: 'Tokyo', countryCode: 'JP' }],
  interests: ['food'],
  questions: ['What is worth doing?'],
  researchTypes: ['activity' as const]
}
const source = { title: 'Guide', snippet: 'Food markets', url: 'https://example.com/guide', domain: 'example.com', authority: 'unknown' as const }

describe('OpenRouterResearchSynthesisModel', () => {
  it('requests a strict schema and validates wrapped findings and truncation', async () => {
    const content = JSON.stringify({ findings: [{ category: 'activity', destinationIndex: 0, title: 'Food', summary: 'Try markets', sourceIndexes: [0] }] })
    const complete = vi.fn(async (_messages: unknown, _model: unknown, _options: unknown) => ({ message: { role: 'assistant' as const, content }, finishReason: 'stop' }))
    const model = new OpenRouterResearchSynthesisModel({ complete }, 'model')
    expect(await model.synthesize({ brief, sources: [source] })).toHaveLength(1)
    expect(complete.mock.calls[0]?.[2]).toMatchObject({ responseFormat: { type: 'json_schema', json_schema: { strict: true } } })
    complete.mockResolvedValueOnce({ message: { role: 'assistant', content }, finishReason: 'length' })
    await expect(model.synthesize({ brief, sources: [source] })).rejects.toMatchObject({ code: 'RESEARCH_SYNTHESIS_INVALID' })
  })
  it('accepts a single JSON fence while still rejecting added prose and invalid refs', async () => {
    const content = '```json\n[{"category":"activity","destinationIndex":0,"title":"Food","summary":"Try markets","sourceIndexes":[0]}]\n```'
    const complete = vi.fn(async () => ({ message: { role: 'assistant' as const, content } }))
    const model = new OpenRouterResearchSynthesisModel({ complete }, 'model')
    expect((await model.synthesize({ brief, sources: [source] }))[0]?.title).toBe('Food')
    complete.mockResolvedValueOnce({ message: { role: 'assistant', content: `Trust me\n${content}` } })
    await expect(model.synthesize({ brief, sources: [source] })).rejects.toMatchObject({ code: 'RESEARCH_SYNTHESIS_INVALID' })
  })
  it('sends indexed evidence without source URLs and parses strict JSON refs', async () => {
    const complete = vi.fn(async (messages: any[], _model?: string, _options?: unknown) => ({ message: { role: 'assistant' as const, content: '[{"category":"activity","destinationIndex":0,"title":"Food","summary":"Try markets","sourceIndexes":[0]}]' } }))
    const model = new OpenRouterResearchSynthesisModel({ complete } as any, 'provider/research-model')
    const result = await model.synthesize({ brief, sources: [source] })
    expect(result[0]?.sourceIndexes).toEqual([0])
    const userMessage = (complete.mock.calls[0]![0] as any[]).find(message => message.role === 'user')
    expect(userMessage.content).toContain('Food markets')
    expect(userMessage.content).not.toContain('https://example.com/guide')
    expect((complete.mock.calls[0] as unknown[])[1]).toBe('provider/research-model')
  })

  it.each([
    'not json',
    '[{"category":"activity","destinationIndex":0,"title":"bad","summary":"bad","sourceIndexes":[1]}]',
    '[{"category":"activity","destinationIndex":0,"title":"bad","summary":"bad","sourceIndexes":[0],"url":"https://evil.example"}]'
  ])('rejects invalid model output safely: %s', async content => {
    const model = new OpenRouterResearchSynthesisModel({ complete: vi.fn(async () => ({ message: { role: 'assistant' as const, content } })) } as any, 'model')
    await expect(model.synthesize({ brief, sources: [source] })).rejects.toMatchObject({ code: 'RESEARCH_SYNTHESIS_INVALID' })
  })
})
