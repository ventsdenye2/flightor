import { describe, expect, it, vi } from 'vitest'
import { NativeResearchAgent, type NativeResearchReceipt } from './native.js'
import type { NativeResearchAuditFinish, NativeResearchAuditStart, NativeResearchLedger } from './native-infrastructure.js'
import type { ResearchBrief } from './types.js'

const brief: ResearchBrief = {
  destinations: [{ id: 'city-tyo', type: 'city', name: 'Tokyo', countryCode: 'JP' }],
  interests: ['museums'], questions: ['What is open this month?'], researchTypes: ['activity'], maxResults: 2
}
const qwenPreambleFixture = "I'll research cultural sites suitable for relaxed walking visits."

class Ledger implements NativeResearchLedger {
  starts: NativeResearchAuditStart[] = []
  finishes: Array<{ auditId: string; input: NativeResearchAuditFinish }> = []
  async reserve(input: NativeResearchAuditStart) { this.starts.push(input); return { auditId: '8f8f5eb8-b4ad-4ef9-8c35-64f44d964022' } }
  async finish(auditId: string, input: NativeResearchAuditFinish) { this.finishes.push({ auditId, input }) }
}

function receipt(overrides: Partial<NativeResearchReceipt> = {}): NativeResearchReceipt {
  return {
    finishReason: 'stop', message: { role: 'assistant', content: JSON.stringify({ disposition: 'recommend', uncertainties: [], findings: [{ category: 'activity', destinationIndex: 0, title: 'Museum', summary: 'Visit the museum.', sourceUrls: ['https://www.gotokyo.org/museum'] }] }),
      annotations: [{ type: 'url_citation', url_citation: { url: 'https://www.gotokyo.org/museum', title: 'Museum', content: 'Official visitor information.' } }] },
    usage: { server_tool_use: { web_search_requests: 1 } }, ...overrides
  }
}

function receiptWithContent(content: string, toolCalls?: unknown): NativeResearchReceipt {
  return receipt({ message: { role: 'assistant', content,
    annotations: [{ type: 'url_citation', url_citation: { url: 'https://www.gotokyo.org/museum', title: 'Museum', content: 'Official visitor information.' } }],
    ...(toolCalls === undefined ? {} : { tool_calls: toolCalls }) } })
}

function responseContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ disposition: 'recommend', uncertainties: [], findings: [{ category: 'activity', destinationIndex: 0, title: 'Museum', summary: 'Visit the museum.', sourceUrls: ['https://www.gotokyo.org/museum'] }], ...overrides })
}

describe('NativeResearchAgent', () => {
  it('uses one bounded native call, keeps minimum context, and records a typed audit reference', async () => {
    const ledger = new Ledger()
    const complete = vi.fn(async () => receipt({ costUsdMicros: 17 }))
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete }, ledger, budgetId: 'shared-production-budget', maxCallUsdMicros: 20, now: () => new Date('2026-09-13T00:00:00.000Z') })
    const result = await agent.research(brief, { requestId: 'request-1', ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', tripContextVersion: 2, preferenceSummary: ['quiet pace'] })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0]?.[0].body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.not.stringContaining('Conversation') })]))
    expect(result).toMatchObject({ disposition: 'recommend', generationAuditId: '8f8f5eb8-b4ad-4ef9-8c35-64f44d964022', queryCount: 1 })
    expect(result.findings[0]?.verification.status).not.toBe('verified')
    expect(ledger.starts[0]).toMatchObject({ requestId: 'request-1', budgetId: 'shared-production-budget', reservedUsdMicros: 20 })
    expect(ledger.starts[0]?.generationId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(ledger.finishes).toEqual([expect.objectContaining({ input: expect.objectContaining({ status: 'succeeded', settledUsdMicros: 17 }) })])
  })

  it('fails closed when search accounting is absent and does not retry', async () => {
    const ledger = new Ledger()
    const complete = vi.fn(async () => receipt({ usage: {} }))
    const agent = new NativeResearchAgent({ model: 'z-ai/glm-5.3-flash', transport: { complete }, ledger, budgetId: 'shared', maxCallUsdMicros: 1 })
    await expect(agent.research(brief, { requestId: 'request-2', ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', tripContextVersion: 0 })).rejects.toMatchObject({ code: 'NATIVE_RESEARCH_SEARCH_COUNT_UNKNOWN' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(ledger.finishes[0]?.input).toMatchObject({ status: 'failed', error: { code: 'NATIVE_RESEARCH_SEARCH_COUNT_UNKNOWN' } })
    expect(ledger.finishes[0]?.input.settledUsdMicros).toBeUndefined()
  })

  it('uses the evaluated GLM reasoning setting and sends the dynamic finding schema', async () => {
    const complete = vi.fn(async () => receipt())
    const agent = new NativeResearchAgent({ model: 'z-ai/glm-5.3-flash', transport: { complete }, ledger: new Ledger(), budgetId: 'shared', maxCallUsdMicros: 1 })
    await agent.research(brief, { requestId: 'request-3', ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', tripContextVersion: 0 })
    const body = complete.mock.calls[0]?.[0].body as Record<string, any>
    expect(body.reasoning).toEqual({ enabled: true, effort: 'low', exclude: true })
    expect(body.response_format.json_schema.schema.properties.findings.items.properties).toMatchObject({ category: { enum: ['activity'] }, destinationIndex: { maximum: 0 }, sourceUrls: { maxItems: 20 } })
  })

  it('accepts the observed Qwen prose preamble with one JSON suffix, records framing, and accepts an empty tool_calls array', async () => {
    const ledger = new Ledger()
    const complete = vi.fn(async () => receiptWithContent(`${qwenPreambleFixture}\n\n${JSON.stringify({ findings: [{ category: 'activity', destinationIndex: 0, title: 'Museum', summary: 'Visit the museum.', sourceUrls: ['https://www.gotokyo.org/museum'] }] })}`, []))
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete }, ledger, budgetId: 'shared', maxCallUsdMicros: 1 })
    const result = await agent.research(brief, { requestId: 'request-preamble', ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', tripContextVersion: 0 })
    expect(result.findings).toHaveLength(1)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(ledger.finishes[0]?.input.normalization).toMatchObject({ framing: 'extract_single_json_suffix', acceptedFindingCount: 1 })
  })

  it('accepts one final JSON code fence and records the presentation wrapper', async () => {
    const ledger = new Ledger()
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete: async () => receiptWithContent(`Sources checked.\n\n\`\`\`json\n${responseContent()}\n\`\`\``) }, ledger, budgetId: 'shared', maxCallUsdMicros: 1 })
    await agent.research(brief, { requestId: 'request-fence', ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', tripContextVersion: 0 })
    expect(ledger.finishes[0]?.input.normalization).toMatchObject({ framing: 'extract_final_fenced_json' })
  })

  it('rejects ambiguous framing and unknown fields without selecting or repairing a later object', async () => {
    const valid = responseContent()
    const invalid = [
      `Earlier ${valid}\n${valid}`,
      `Earlier {invalid}\n${valid}`,
      `Earlier [draft] ${valid}`,
      `Earlier ${valid} trailing prose`,
      `Earlier ${responseContent({ extra: 'must remain invalid' })}`,
      `\`\`\`json\n${valid}\n\`\`\`\n\`\`\`json\n${valid}\n\`\`\``
    ]
    for (const content of invalid) {
      const ledger = new Ledger()
      const complete = vi.fn(async () => receiptWithContent(content))
      const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete }, ledger, budgetId: 'shared', maxCallUsdMicros: 1 })
      await expect(agent.research(brief, { requestId: `request-invalid-${invalid.indexOf(content)}`, ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', tripContextVersion: 0 })).rejects.toMatchObject({ code: 'NATIVE_RESEARCH_OUTPUT_INVALID' })
      expect(complete).toHaveBeenCalledTimes(1)
      expect(ledger.finishes[0]?.input).toMatchObject({ status: 'failed', error: { code: 'NATIVE_RESEARCH_OUTPUT_INVALID' } })
    }
  })

  it('does not construct an enabled provider without a positive explicit budget cap', () => {
    expect(() => new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete: async () => receipt() }, ledger: new Ledger(), budgetId: 'shared', maxCallUsdMicros: 0 }))
      .toThrow(/budget/i)
  })
})
