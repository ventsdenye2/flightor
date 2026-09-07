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
