import { AppError } from '../../lib/errors.js'
import type { AgentModelClient, ChatMessage, ChatOptions } from '../../agent/runtime/model.js'
import { researchBriefSchema, type ResearchBrief } from '../../research-agent/types.js'
import {
  researchSourceCandidateSchema,
  type ResearchDraftFinding,
  type ResearchSynthesisInput,
  type ResearchSynthesisModel
} from '../../research-agent/search-provider.js'

const MAX_DRAFTS = 50
const MAX_MODEL_TOKENS = 4_000

export type OpenRouterResearchClient = Pick<AgentModelClient, 'complete'>

function synthesisPrompt(input: ResearchSynthesisInput): { system: string; user: string } {
  const indexedSources = input.sources.map((source, index) => ({
    index,
    title: source.title,
    snippet: source.snippet,
    domain: source.domain,
    authority: source.authority,
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {})
  }))
  return {
    system: [
      'You are a constrained travel research summarizer.',
      'Use only the supplied brief and indexed source snippets.',
      'Return ONLY a JSON array of objects with category, destinationIndex, title, summary, and sourceIndexes.',
      'sourceIndexes must be integer indexes into the supplied source list; never output URLs, citations, or new sources.',
      'Do not assert facts that are absent from the snippets.',
      'Select only findings relevant to the requested destination, interests, questions and travel window. Return [] when none qualify; never relabel unrelated search results to satisfy the brief.'
    ].join(' '),
    user: JSON.stringify({ brief: input.brief, sources: indexedSources })
  }
}

function parseDrafts(value: unknown, brief: ResearchBrief, sourceCount: number): ResearchDraftFinding[] {
  if (!Array.isArray(value) || value.length > MAX_DRAFTS) {
    throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output was not a bounded JSON array', 502)
  }
  const result: ResearchDraftFinding[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output contained an invalid finding', 502)
    const record = item as Record<string, unknown>
    const keys = Object.keys(record).sort().join(',')
    if (keys !== 'category,destinationIndex,sourceIndexes,summary,title') throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output contained unexpected fields', 502)
    if (!brief.researchTypes.includes(record.category as ResearchBrief['researchTypes'][number])) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output contained an invalid category', 502)
    if (!Number.isInteger(record.destinationIndex) || Number(record.destinationIndex) < 0 || Number(record.destinationIndex) >= brief.destinations.length) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output contained an invalid destination reference', 502)
    if (typeof record.title !== 'string' || record.title.trim().length === 0 || record.title.length > 240) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output contained an invalid title', 502)
    if (typeof record.summary !== 'string' || record.summary.trim().length === 0 || record.summary.length > 1_500) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output contained an invalid summary', 502)
    if (!Array.isArray(record.sourceIndexes) || record.sourceIndexes.length < 1 || record.sourceIndexes.length > 20 || !record.sourceIndexes.every(index => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < sourceCount)) {
      throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research output contained an invalid source reference', 502)
    }
    result.push({
      category: record.category as ResearchDraftFinding['category'],
      destinationIndex: record.destinationIndex as number,
      title: record.title,
      summary: record.summary,
      sourceIndexes: record.sourceIndexes as number[]
    })
  }
  return result
}

function contentFromCompletion(value: unknown): string {
  if (typeof value !== 'object' || value === null) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research response was malformed', 502)
  const message = (value as { message?: unknown }).message
  if (typeof message !== 'object' || message === null || typeof (message as { content?: unknown }).content !== 'string') throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research response had no text content', 502)
  const content = (message as { content: string }).content.trim()
  if (!content || content.length > 100_000) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research response was empty or too large', 502)
  return content
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch {
    throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'OpenRouter research response was not valid JSON', 502)
  }
}

/** OpenRouter adapter constrained to indexed source evidence and JSON output. */
export class OpenRouterResearchSynthesisModel implements ResearchSynthesisModel {
  constructor(
    private readonly client: OpenRouterResearchClient,
    private readonly model: string
  ) {}

  async synthesize(input: ResearchSynthesisInput, options?: { signal?: AbortSignal }): Promise<ResearchDraftFinding[]> {
    if (!this.model || this.model.trim().length === 0) throw new AppError('PROVIDER_NOT_CONFIGURED', 'Research synthesis model is not configured', 503)
    if (options?.signal?.aborted) throw new AppError('PROVIDER_CANCELLED', 'Research synthesis was cancelled', 502, { provider: 'openrouter' })
    const brief = researchBriefSchema.parse(input.brief)
    if (!Array.isArray(input.sources) || input.sources.length > 50) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'Research synthesis source set exceeded its bound', 400)
    const sources = input.sources.map(source => researchSourceCandidateSchema.parse(source))
    const prompt = synthesisPrompt({ brief, sources })
    const messages: ChatMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ]
    const completionOptions: ChatOptions = { maxTokens: MAX_MODEL_TOKENS, temperature: 0, reasoning: { enabled: false, exclude: true }, ...(options?.signal ? { signal: options.signal } : {}) }
    const completion = await this.client.complete(messages, this.model, completionOptions)
    if (options?.signal?.aborted) throw new AppError('PROVIDER_CANCELLED', 'Research synthesis was cancelled', 502, { provider: 'openrouter' })
    const content = contentFromCompletion(completion)
    return parseDrafts(parseJsonContent(content), brief, sources.length)
  }
}
