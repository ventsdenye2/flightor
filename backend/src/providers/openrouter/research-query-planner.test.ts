import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatOptions } from '../../agent/runtime/model.js'
import { OpenRouterResearchQueryPlanner } from './research-query-planner.js'
import type { ResearchQueryPlanInput } from '../../research-agent/query-planner.js'

const input: ResearchQueryPlanInput = {
  brief: {
    destinations: [{ id: 'city-a', type: 'city', name: 'City A', countryCode: 'FR' }],
    interests: ['culture'], questions: ['请列出适合慢节奏文化旅行的艺术博物馆及其值得参观的原因'], researchTypes: ['activity']
  },
  tasks: [{ destinationIndex: 0, questionIndex: 0 }]
}
const query = { destinationIndex: 0, questionIndex: 0, searchTerms: 'art museums' }

describe('OpenRouterResearchQueryPlanner', () => {
  it('makes one strict indexed JSON request with no tools and the original cancellation signal', async () => {
    const complete = vi.fn(async (_messages: ChatMessage[], _model?: string, _options?: ChatOptions) => ({
      message: { role: 'assistant' as const, content: JSON.stringify({ queries: [query] }) }, finishReason: 'stop'
    }))
    const signal = new AbortController().signal
    const planner = new OpenRouterResearchQueryPlanner({ complete }, 'research-model')
    expect(await planner.plan(input, { signal })).toEqual([query])
    expect(complete).toHaveBeenCalledOnce()
    const [messages, model, options] = complete.mock.calls[0]!
    expect(model).toBe('research-model')
    expect(options).toMatchObject({
      signal, timeoutMs: 15_000, maxTokens: 1_500, reasoning: { enabled: false, exclude: true },
      responseFormat: { type: 'json_schema', json_schema: { name: 'research_query_plan', strict: true, schema: { additionalProperties: false } } }
    })
    expect(options?.tools).toBeUndefined()
    expect(JSON.parse(messages[1]!.content!)).toEqual(input)
  })

  it.each([
    'not json',
    JSON.stringify({ queries: [{ ...query, questionIndex: 2 }] }),
    JSON.stringify({ queries: [{ ...query, searchTerms: 'site:invented.example museums' }] }),
    JSON.stringify({ queries: [{ ...query, url: 'https://invented.example' }] }),
    JSON.stringify({ queries: [], sources: [] })
  ])('rejects malformed, unsafe or out-of-task output: %s', async content => {
    const complete = vi.fn(async () => ({ message: { role: 'assistant' as const, content } }))
    await expect(new OpenRouterResearchQueryPlanner({ complete }, 'model').plan(input))
      .rejects.toMatchObject({ code: 'RESEARCH_QUERY_PLAN_INVALID' })
  })

  it.each(['length', 'content_filter'])('rejects incomplete completions: %s', async finishReason => {
    const complete = vi.fn(async () => ({ message: { role: 'assistant' as const, content: JSON.stringify({ queries: [query] }) }, finishReason }))
    await expect(new OpenRouterResearchQueryPlanner({ complete }, 'model').plan(input))
      .rejects.toMatchObject({ code: 'RESEARCH_QUERY_PLAN_INVALID' })
  })

  it('propagates caller cancellation before and after the model call', async () => {
    const controller = new AbortController()
    const complete = vi.fn(async () => {
      controller.abort(new Error('caller cancelled'))
      return { message: { role: 'assistant' as const, content: JSON.stringify({ queries: [query] }) } }
    })
    const planner = new OpenRouterResearchQueryPlanner({ complete }, 'model')
    await expect(planner.plan(input, { signal: controller.signal })).rejects.toThrow('caller cancelled')
    expect(complete).toHaveBeenCalledOnce()
    await expect(planner.plan(input, { signal: controller.signal })).rejects.toThrow('caller cancelled')
    expect(complete).toHaveBeenCalledOnce()
  })
})
