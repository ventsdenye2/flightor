import { describe, expect, it, vi } from 'vitest'
import { NativeResearchAgent, type NativeResearchReceipt } from './native.js'
import type { NativeResearchAuditFinish, NativeResearchAuditStart, NativeResearchLedger } from './native-infrastructure.js'
import type { ResearchBrief } from './types.js'
import { observePlannerTurn } from '../lib/planner-observation.js'

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

  it.each([
    ['incomplete finish reason', receipt({ finishReason: 'length', usage: { server_tool_use: { web_search_requests: 3 } } }), 'NATIVE_RESEARCH_MODEL_INCOMPLETE'],
    ['malformed output', receipt({ usage: { server_tool_use: { web_search_requests: 3 } }, message: {
      role: 'assistant', content: '{malformed', annotations: []
    } }), 'NATIVE_RESEARCH_OUTPUT_INVALID']
  ])('records valid provider search count before %s while preserving the original error', async (_label, failedReceipt, code) => {
    const ledger = new Ledger()
    const complete = vi.fn(async () => failedReceipt)
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete }, ledger, budgetId: 'shared', maxCallUsdMicros: 1 })
    let observation: any
    await expect(observePlannerTurn({ requestId: 'observed-failure', tripId: 'trip', conversationId: 'conversation', generationId: 'generation' },
      () => agent.research(brief, { requestId: 'observed-failure', tripId: 'trip', conversationId: 'conversation' }), value => { observation = value }))
      .rejects.toMatchObject({ code })
    expect(observation.providerReportedSearches).toBe(3)
    expect(observation.spans.find((span: any) => span.name === 'native_research')).toMatchObject({
      search: { requestedLimit: 2, reportedCount: 3, exceedsLimit: true }
    })
  })

  it('keeps missing search accounting unknown without overwriting the original output error', async () => {
    const ledger = new Ledger()
    const complete = vi.fn(async () => receipt({ usage: {} }))
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete }, ledger, budgetId: 'shared', maxCallUsdMicros: 1 })
    let observation: any
    await expect(observePlannerTurn({ requestId: 'missing-search', tripId: 'trip', conversationId: 'conversation', generationId: 'generation' },
      () => agent.research(brief, { requestId: 'missing-search' }), value => { observation = value }))
      .rejects.toMatchObject({ code: 'NATIVE_RESEARCH_SEARCH_COUNT_UNKNOWN' })
    expect(observation.providerReportedSearches).toBeNull()
    expect(observation.spans.find((span: any) => span.name === 'native_research')).toMatchObject({
      search: { requestedLimit: 2, reportedCount: null, exceedsLimit: null }
    })
  })

  it.each([
    ['reserve rejected', async () => { throw Object.assign(new Error('budget denied'), { code: 'BUDGET_REJECTED' }) }],
    ['invalid request context', undefined]
  ])('does not record a search request before %s', async (_label, reserve) => {
    const ledger = new Ledger()
    if (reserve) ledger.reserve = reserve as Ledger['reserve']
    const complete = vi.fn(async () => receipt({ usage: { server_tool_use: { web_search_requests: 3 } } }))
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete }, ledger, budgetId: 'shared', maxCallUsdMicros: 1 })
    let observation: any
    const requestId = reserve ? 'reserve-rejected' : ''
    await expect(observePlannerTurn({ requestId: requestId || 'invalid-context', tripId: 'trip', conversationId: 'conversation', generationId: 'generation' },
      () => agent.research(brief, { requestId }), value => { observation = value })).rejects.toBeTruthy()
    expect(observation.providerReportedSearches).toBeNull()
    expect(observation.spans.find((span: any) => span.name === 'native_research')).not.toHaveProperty('search')
    expect(complete).not.toHaveBeenCalled()
  })

  it.each([
    ['delta seconds', { 'retry-after': '45' }, 45_000],
    ['HTTP date', { 'Retry-After': 'Sun, 13 Sep 2026 00:00:45 GMT' }, 45_000],
    ['missing header', {}, 30_000],
    ['invalid header', { 'retry-after': 'private upstream error; key=secret' }, 30_000],
    ['expired HTTP date', { 'retry-after': 'Sun, 13 Sep 2026 00:00:00 GMT' }, 30_000]
  ])('suppresses further reservations and provider calls after 429 with %s, then recovers', async (_label, headers, cooldownMs) => {
    let now = Date.parse('2026-09-13T00:00:00.000Z')
    const ledger = new Ledger()
    const http = { status: 429, headers: headers as Record<string, string>, body: 'raw upstream evidence', bodyTruncated: false, bodyIncomplete: false }
    const complete = vi.fn().mockResolvedValueOnce({ provider: 'openrouter', http }).mockResolvedValue(receipt({ costUsdMicros: 17 }))
    const agent = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete }, ledger, budgetId: 'shared', maxCallUsdMicros: 20, now: () => new Date(now) })

    await expect(agent.research(brief, { requestId: 'destination-research' })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', statusCode: 429,
      details: { provider: 'openrouter', status: 429, retryAfter: cooldownMs / 1_000 }
    })
    now += 8_000
    await expect(agent.research({ ...brief, questions: ['Find more detailed walking routes'] }, { requestId: 'web-research' })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', details: { provider: 'openrouter', status: 429, retryAfter: (cooldownMs - 8_000) / 1_000 }
    })
    now += cooldownMs - 8_001
    await expect(agent.research(brief, { requestId: 'another-retry' })).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED', details: { retryAfter: 1 } })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(ledger.starts).toHaveLength(1)
    expect(ledger.finishes).toEqual([{ auditId: '8f8f5eb8-b4ad-4ef9-8c35-64f44d964022', input: {
      status: 'failed', receipt: { provider: 'openrouter', http },
      error: { code: 'PROVIDER_RATE_LIMITED', message: 'openrouter returned HTTP 429' }
    } }])

    now += 1
    await expect(agent.research(brief, { requestId: 'after-cooldown' })).resolves.toMatchObject({ disposition: 'recommend' })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(ledger.starts).toHaveLength(2)
    expect(ledger.finishes).toHaveLength(2)
    expect(ledger.finishes[1]?.input).toMatchObject({ status: 'succeeded', settledUsdMicros: 17 })
  })

  it('keeps a rate limit local to its provider instance', async () => {
    const limitedLedger = new Ledger()
    const limited = new NativeResearchAgent({ model: 'qwen/qwen3.8-flash', transport: { complete: async () => ({
      http: { status: 429, headers: {}, body: '', bodyTruncated: false, bodyIncomplete: false }
    }) }, ledger: limitedLedger, budgetId: 'shared', maxCallUsdMicros: 20 })
    await expect(limited.research(brief, { requestId: 'qwen' })).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' })

    const otherLedger = new Ledger()
    const other = new NativeResearchAgent({ model: 'z-ai/glm-5.3-flash', transport: { complete: async () => receipt() }, ledger: otherLedger, budgetId: 'shared', maxCallUsdMicros: 20 })
    await expect(other.research(brief, { requestId: 'glm' })).resolves.toMatchObject({ disposition: 'recommend' })
    expect(otherLedger.starts).toHaveLength(1)
    expect(limitedLedger.finishes[0]?.input).not.toHaveProperty('settledUsdMicros')
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
