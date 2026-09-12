import { randomUUID } from 'node:crypto'
import { AppError } from '../lib/errors.js'
import { classifyResearchSourceAuthority, verifyResearchFinding } from './verification.js'
import { researchArtifactSchema, researchBriefSchema, researchSourceSchema, type ResearchAgent, type ResearchArtifact, type ResearchBrief, type ResearchExecutionContext } from './types.js'
import { checkedUsdMicros, nativeBudgetUnavailable, type NativeResearchLedger } from './native-infrastructure.js'

const MODELS = new Set(['qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash'])
const MAX_TIMEOUT_MS = 95_000

function responseSchema(brief: ResearchBrief): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: ['disposition', 'uncertainties', 'findings'], properties: {
    disposition: { type: 'string', enum: ['recommend', 'partial', 'clarify'] },
    uncertainties: { type: 'array', maxItems: 24, items: { type: 'string', minLength: 1, maxLength: 240 } },
    findings: { type: 'array', maxItems: brief.maxResults ?? 10, items: { type: 'object', additionalProperties: false, required: ['category', 'destinationIndex', 'title', 'summary', 'sourceUrls'], properties: {
      category: { type: 'string', enum: brief.researchTypes }, destinationIndex: { type: 'integer', minimum: 0, maximum: brief.destinations.length - 1 },
      title: { type: 'string', minLength: 1, maxLength: 240 }, summary: { type: 'string', minLength: 1, maxLength: 1500 },
      sourceUrls: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', format: 'uri' } }
    } } }
  } }
}

export interface NativeResearchReceipt {
  id?: string
  model?: string
  provider?: string
  finishReason?: string
  message?: { role?: string; content?: unknown; annotations?: unknown; tool_calls?: unknown }
  usage?: Record<string, unknown>
  searchCalls?: number
  /** Provider-reported final USD charge, converted by the transport without rounding. */
  costUsdMicros?: number
}

export interface NativeResearchTransport {
  complete(input: { body: Record<string, unknown>; signal: AbortSignal; timeoutMs: number }): Promise<NativeResearchReceipt>
}

export interface NativeResearchAgentOptions {
  model: string
  transport: NativeResearchTransport
  ledger: NativeResearchLedger
  budgetId: string
  maxCallUsdMicros: number
  timeoutMs?: number
  maxTokens?: number
  now?: () => Date
}

type Candidate = { category: ResearchBrief['researchTypes'][number]; destinationIndex: number; title: string; summary: string; sourceUrls: string[] }

function abortError(signal: AbortSignal, caller?: AbortSignal): AppError {
  return new AppError(caller?.aborted ? 'RESEARCH_CANCELLED' : 'NATIVE_RESEARCH_TIMEOUT', caller?.aborted ? 'Research was cancelled' : 'Native research exceeded its deadline', 502)
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function countSearches(receipt: NativeResearchReceipt): number {
  const usage = receipt.usage ?? {}
  const serverToolUse = asObject(usage.server_tool_use)
  const details = asObject(usage.server_tool_use_details)
  const values = [receipt.searchCalls, serverToolUse?.web_search_requests, details?.web_search_requests].filter(value => value !== undefined && value !== null)
  if (!values.length) throw new AppError('NATIVE_RESEARCH_SEARCH_COUNT_UNKNOWN', 'Native research response omitted its search count', 502)
  if (values.some(value => !Number.isInteger(value) || Number(value) < 0 || Number(value) > 24) || values.some(value => value !== values[0])) {
    throw new AppError('NATIVE_RESEARCH_SEARCH_COUNT_INVALID', 'Native research response reported an invalid or conflicting search count', 502)
  }
  return values[0] as number
}

type NativeResearchFraming = 'direct_json' | 'extract_final_fenced_json' | 'extract_single_json_suffix'

/**
 * Remove only one unambiguous presentation wrapper. The JSON contract remains
 * authoritative in candidates(): this routine never selects a later object,
 * alters a parsed value, or projects unknown fields away.
 */
function normalizeFraming(content: string): { content: string; framing: NativeResearchFraming } {
  const trimmed = content.trim()
  try {
    JSON.parse(trimmed)
    return { content: trimmed, framing: 'direct_json' }
  } catch { /* a provider may put a single prose or fence wrapper around JSON */ }

  // A single standalone final fence is unambiguous. Prose before it must not
  // itself contain JSON delimiters, otherwise selecting this block is unsafe.
  if ((trimmed.match(/```/g) ?? []).length === 2) {
    const fenced = /(?:^|\r?\n)[ \t]*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/i.exec(trimmed)
    if (fenced && !/[{}\[\]]/.test(trimmed.slice(0, fenced.index))) {
      return { content: fenced[1]!, framing: 'extract_final_fenced_json' }
    }
  }

  // Inspect the first opening brace only and require the complete remainder to
  // be one JSON object. This intentionally rejects multiple objects, trailing
  // prose, markdown, and an earlier malformed object.
  const start = trimmed.indexOf('{')
  if (start > 0) {
    const prefix = trimmed.slice(0, start)
    if (prefix.trim() && !/[{}\[\]`]/.test(prefix)) {
      try {
        const parsed = JSON.parse(trimmed.slice(start))
        if (asObject(parsed)) return { content: trimmed.slice(start), framing: 'extract_single_json_suffix' }
      } catch { /* framing remains invalid */ }
    }
  }
  throw new AppError('NATIVE_RESEARCH_OUTPUT_INVALID', 'Native research response did not contain one unambiguous JSON object', 502)
}

function hasMeaningfulToolCalls(toolCalls: unknown): boolean {
  return Array.isArray(toolCalls) ? toolCalls.length > 0 : toolCalls !== undefined && toolCalls !== null
}

function candidates(content: string, brief: ResearchBrief): { disposition: 'recommend' | 'partial' | 'clarify'; uncertainties: string[]; findings: Candidate[] } {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new AppError('NATIVE_RESEARCH_OUTPUT_INVALID', 'Native research response was not valid JSON', 502) }
  const body = asObject(parsed)
  if (!body || Object.keys(body).some(key => !['disposition', 'uncertainties', 'findings'].includes(key))) throw new AppError('NATIVE_RESEARCH_OUTPUT_INVALID', 'Native research response had unsupported fields', 502)
  const disposition = body.disposition === undefined ? 'recommend' : body.disposition
  if (disposition !== 'recommend' && disposition !== 'partial' && disposition !== 'clarify') throw new AppError('NATIVE_RESEARCH_OUTPUT_INVALID', 'Native research disposition was invalid', 502)
  const uncertainties = body.uncertainties === undefined ? [] : body.uncertainties
  if (!Array.isArray(uncertainties) || uncertainties.length > 24 || uncertainties.some(value => typeof value !== 'string' || !value.trim() || value.length > 240)) throw new AppError('NATIVE_RESEARCH_OUTPUT_INVALID', 'Native research uncertainties were invalid', 502)
  const findings = body.findings
  if (!Array.isArray(findings) || findings.length > (brief.maxResults ?? 10)) throw new AppError('NATIVE_RESEARCH_OUTPUT_INVALID', 'Native research findings exceeded their bound', 502)
  const checked: Candidate[] = findings.map(value => {
    const item = asObject(value)
    if (!item || Object.keys(item).sort().join(',') !== 'category,destinationIndex,sourceUrls,summary,title' || !brief.researchTypes.includes(item.category as Candidate['category']) ||
      !Number.isInteger(item.destinationIndex) || Number(item.destinationIndex) < 0 || Number(item.destinationIndex) >= brief.destinations.length ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 240 || typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 1500 ||
      !Array.isArray(item.sourceUrls) || item.sourceUrls.length < 1 || item.sourceUrls.length > 20 || item.sourceUrls.some(url => typeof url !== 'string')) {
      throw new AppError('NATIVE_RESEARCH_OUTPUT_INVALID', 'Native research finding was invalid', 502)
    }
    return { category: item.category as Candidate['category'], destinationIndex: item.destinationIndex as number, title: item.title.trim(), summary: item.summary.trim(), sourceUrls: [...new Set(item.sourceUrls)] as string[] }
  })
  return { disposition, uncertainties: uncertainties.map(value => (value as string).trim()), findings: checked }
}

function sources(annotations: unknown): Map<string, ResearchArtifact['findings'][number]['sources'][number]> {
  const result = new Map<string, ResearchArtifact['findings'][number]['sources'][number]>()
  if (!Array.isArray(annotations)) return result
  for (const annotation of annotations) {
    const citation = asObject(asObject(annotation)?.url_citation)
    if (!citation || typeof citation.url !== 'string' || typeof citation.title !== 'string' || typeof citation.content !== 'string') continue
    try {
      const url = new URL(citation.url)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue
      url.hash = ''
      const value = researchSourceSchema.safeParse({ title: citation.title.trim().slice(0, 240), url: url.toString(), domain: url.hostname.toLowerCase(), snippet: citation.content.trim().slice(0, 800), authority: classifyResearchSourceAuthority(url.toString()) })
      if (value.success) result.set(url.toString(), value.data)
    } catch { /* an invalid annotation is not a source */ }
  }
  return result
}

function errorDetails(error: unknown): { code: string; message: string } {
  const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'NATIVE_RESEARCH_FAILED'
  return { code, message: error instanceof Error ? error.message.slice(0, 240) : 'Native research failed' }
}

/** One native provider call. Domain evidence, workspace persistence, and delivery remain outside this adapter. */
export class NativeResearchAgent implements ResearchAgent {
  private readonly timeoutMs: number
  private readonly maxTokens: number
  constructor(private readonly options: NativeResearchAgentOptions) {
    if (!MODELS.has(options.model)) throw new AppError('NATIVE_RESEARCH_MODEL_UNSUPPORTED', 'Native research model is not approved', 503)
    if (!options.budgetId.trim() || checkedUsdMicros(options.maxCallUsdMicros, 'maxCallUsdMicros') === 0) throw nativeBudgetUnavailable()
    this.timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(options.timeoutMs ?? MAX_TIMEOUT_MS)))
    this.maxTokens = Math.min(4_000, Math.max(1, Math.floor(options.maxTokens ?? 3_200)))
  }

  async research(input: ResearchBrief, context: ResearchExecutionContext): Promise<ResearchArtifact> {
    const brief = researchBriefSchema.parse(input)
    if (!context.requestId.trim() || context.requestId.length > 160) throw new AppError('INVALID_RESEARCH_CONTEXT', 'Research request id is invalid', 400)
    if (context.signal?.aborted) throw context.signal.reason ?? new AppError('RESEARCH_CANCELLED', 'Research was cancelled', 499)
    const generationId = randomUUID()
    const body = { model: this.options.model, max_tokens: this.maxTokens, temperature: 0,
      reasoning: this.options.model === 'z-ai/glm-5.3-flash' ? { enabled: true, effort: 'low', exclude: true } : { enabled: false, exclude: true },
      provider: { require_parameters: true, allow_fallbacks: false }, tools: [{ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5, max_total_results: 10, max_uses: 2, max_characters: 800 } }], max_tool_calls: 2,
      response_format: { type: 'json_schema', json_schema: { name: 'native_travel_research', strict: true, schema: responseSchema(brief) } },
      messages: [{ role: 'system', content: 'Return the configured JSON schema only. Every finding needs category, destinationIndex, title, summary, and sourceUrls. sourceUrls must exactly name returned URL-citation annotations. Clarify means no recommendations.' }, { role: 'user', content: JSON.stringify({ brief, preferenceSummary: context.preferenceSummary ?? [] }) }] }
    const audit = await this.options.ledger.reserve({ requestId: context.requestId, generationId, ...(context.ownerId ? { ownerId: context.ownerId } : {}), ...(context.tripId ? { tripId: context.tripId } : {}),
      ...(context.conversationId ? { conversationId: context.conversationId } : {}), ...(context.goalId ? { goalId: context.goalId } : {}), ...(context.runId ? { runId: context.runId } : {}), ...(context.tripContextVersion === undefined ? {} : { tripContextVersion: context.tripContextVersion }),
      budgetId: this.options.budgetId, provider: 'openrouter', model: this.options.model, reservedUsdMicros: this.options.maxCallUsdMicros,
      request: body })
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
    let receipt: NativeResearchReceipt | undefined
    try {
      receipt = await this.options.transport.complete({ body, signal, timeoutMs: this.timeoutMs })
      if (signal.aborted) throw abortError(signal, context.signal)
      if (receipt.finishReason !== 'stop' || receipt.message?.role !== 'assistant' || typeof receipt.message.content !== 'string' || !receipt.message.content.trim() || hasMeaningfulToolCalls(receipt.message.tool_calls)) {
        throw new AppError('NATIVE_RESEARCH_MODEL_INCOMPLETE', 'Native research response did not complete normally', 502)
      }
      const normalized = normalizeFraming(receipt.message.content)
      const parsed = candidates(normalized.content, brief)
      const queryCount = countSearches(receipt)
      const citations = sources(receipt.message.annotations)
      const checkedAt = (this.options.now?.() ?? new Date()).toISOString()
      const findings: ResearchArtifact['findings'] = parsed.disposition === 'clarify' ? [] : parsed.findings.flatMap((candidate, index) => {
        const admitted = candidate.sourceUrls.map(url => citations.get(url)).filter((value): value is ResearchArtifact['findings'][number]['sources'][number] => value !== undefined)
        if (admitted.length !== candidate.sourceUrls.length) return []
        const verification = verifyResearchFinding(candidate.category, admitted, { checkedAt })
        if (verification.status === 'verified') throw new AppError('NATIVE_RESEARCH_VERIFICATION_POLICY_INVALID', 'Snippet evidence cannot become verified', 502)
        return [{ id: `native_${generationId}_${index}`, category: candidate.category, destinations: [brief.destinations[candidate.destinationIndex]!], title: candidate.title, summary: candidate.summary, sources: admitted, verification,
          warnings: ['research_evidence_is_snippet_only', `evidence_${verification.status}`, ...(candidate.category === 'event' ? ['event_date_is_snippet_only'] : [])] }]
      })
      const disposition = parsed.disposition === 'clarify' ? 'clarify' : parsed.disposition === 'partial' || findings.length !== parsed.findings.length ? 'partial' : 'recommend'
      const artifact = researchArtifactSchema.parse({ id: `research_${generationId}`, type: 'research', schemaVersion: 2, brief, findings, queryCount,
        disposition, ...(parsed.uncertainties.length ? { uncertainties: parsed.uncertainties } : {}), generationAuditId: audit.auditId,
        warnings: ['research_evidence_is_snippet_only', ...(findings.length !== parsed.findings.length ? ['native_research_findings_excluded'] : [])], createdAt: checkedAt })
      const settledUsdMicros = receipt.costUsdMicros === undefined ? undefined : checkedUsdMicros(receipt.costUsdMicros, 'receipt costUsdMicros')
      await this.options.ledger.finish(audit.auditId, { status: 'succeeded', receipt, normalization: { framing: normalized.framing, disposition, uncertainties: parsed.uncertainties, acceptedFindingCount: findings.length }, ...(settledUsdMicros === undefined ? {} : { settledUsdMicros }) })
      return artifact
    } catch (error) {
      const status = context.signal?.aborted ? 'cancelled' : signal.aborted ? 'timed_out' : 'failed'
      const settledUsdMicros = receipt?.costUsdMicros === undefined ? undefined : checkedUsdMicros(receipt.costUsdMicros, 'receipt costUsdMicros')
      if (!(error !== null && typeof error === 'object' && 'auditFinalized' in error && error.auditFinalized === true)) {
        await this.options.ledger.finish(audit.auditId, { status, ...(receipt ? { receipt } : {}), error: errorDetails(error), ...(settledUsdMicros === undefined ? {} : { settledUsdMicros }) })
      }
      throw error
    }
  }
}
