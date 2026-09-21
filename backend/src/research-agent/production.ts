import { admitClaimEvidence, hasClaimConflict, sourcePageSchema } from './claim-evidence.js'
import type { ResearchSourceReader } from './source-reader.js'
import { createHash } from 'node:crypto'
import { AppError } from '../lib/errors.js'
import { admitDraftTemporalEvidence } from './temporal-evidence.js'
import {
  researchArtifactSchema,
  researchBriefSchema,
  researchFindingSchema,
  researchSourceSchema,
  type ResearchAgent,
  type ResearchArtifact,
  type ResearchBrief,
  type ResearchExecutionContext
} from './types.js'
import {
  researchSearchInputSchema,
  researchSearchResultSchema,
  researchSourceCandidateSchema,
  type ResearchDraftFinding,
  type ResearchSearchInput,
  type ResearchSearchProvider,
  type ResearchSourceCandidate,
  type ResearchSynthesisModel
} from './search-provider.js'
import {
  classifyResearchSourceAuthority,
  verifyResearchFinding
} from './verification.js'
import {
  MAX_RESEARCH_SEARCH_TASKS,
  validateResearchQueryPlan,
  type ResearchQueryPlanner,
  type ResearchQueryTask
} from './query-planner.js'

const MAX_SEARCH_CALLS = MAX_RESEARCH_SEARCH_TASKS
const MAX_SOURCES = 50
const DEFAULT_MAX_RESULTS = 10
const MAX_CONTEXT_PREFERENCES = 32
const MAX_CONTEXT_PREFERENCE_LENGTH = 160

export interface ProductionResearchAgentOptions {
  searchProvider: ResearchSearchProvider
  synthesisModel?: ResearchSynthesisModel
  queryPlanner?: ResearchQueryPlanner
  /** Injectable clock for deterministic artifact/verification tests. */
  now?: () => Date
  maxSearchCalls?: number
  maxSources?: number
  sourceReader?: ResearchSourceReader
}

interface NormalizedSource extends ResearchSourceCandidate {
  destinationIndex: number
}

function isProvider(value: unknown): value is ResearchSearchProvider {
  return typeof value === 'object' && value !== null && typeof (value as { search?: unknown }).search === 'function'
}

function isSynthesis(value: unknown): value is ResearchSynthesisModel {
  return typeof value === 'object' && value !== null && typeof (value as { synthesize?: unknown }).synthesize === 'function'
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new AppError('RESEARCH_CANCELLED', 'Research was cancelled', 499)
}

function boundedWarning(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240) || 'research warning'
}

function hostnameFromUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (!parsed.hostname || parsed.username || parsed.password) return undefined
    return parsed.hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function canonicalSourceUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (!parsed.hostname || parsed.username || parsed.password) return undefined
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.hash = ''
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = ''
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    const params = [...parsed.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    parsed.search = ''
    for (const [key, item] of params) parsed.searchParams.append(key, item)
    return parsed.toString()
  } catch {
    return undefined
  }
}

function nowIso(clock?: () => Date): string {
  const value = clock?.() ?? new Date()
  return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString()
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

function validateContext(context: ResearchExecutionContext): void {
  if (!context || typeof context.requestId !== 'string' || context.requestId.trim().length === 0 || context.requestId.length > 160) {
    throw new AppError('INVALID_RESEARCH_CONTEXT', 'Research request context is invalid', 400)
  }
  if (context.preferenceSummary !== undefined) {
    if (!Array.isArray(context.preferenceSummary) || context.preferenceSummary.length > MAX_CONTEXT_PREFERENCES || context.preferenceSummary.some(item => typeof item !== 'string' || item.trim().length === 0 || item.length > MAX_CONTEXT_PREFERENCE_LENGTH)) {
      throw new AppError('INVALID_RESEARCH_CONTEXT', 'Research preference summary is invalid', 400)
    }
  }
}

function normalizeSource(value: unknown, destinationIndex: number): NormalizedSource | undefined {
  const parsed = researchSourceCandidateSchema.safeParse(value)
  if (!parsed.success) return undefined
  const candidate = parsed.data
  const url = canonicalSourceUrl(candidate.url)
  const hostname = url ? hostnameFromUrl(url) : undefined
  if (!url || !hostname) return undefined
  const authority = classifyResearchSourceAuthority(url)
  const normalized = {
    title: candidate.title.replace(/\s+/g, ' ').trim().slice(0, 240),
    snippet: candidate.snippet.replace(/\s+/g, ' ').trim().slice(0, 800),
    url,
    domain: hostname,
    authority,
    ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {})
  }
  const checked = researchSourceCandidateSchema.safeParse(normalized)
  return checked.success ? { ...checked.data, destinationIndex } : undefined
}

function queryInputs(brief: ResearchBrief, destinationIndex: number, preferences: readonly string[], questionIndex = 0, searchTerms?: string): ResearchSearchInput {
  const destination = brief.destinations[destinationIndex]
  if (!destination) throw new AppError('INVALID_RESEARCH_BRIEF', 'Research destination is missing', 400)
  const interests = [...brief.interests, ...preferences].slice(0, 32)
  return researchSearchInputSchema.parse({
    destination,
    ...(brief.travelWindow ? { travelWindow: brief.travelWindow } : {}),
    interests,
    questions: [brief.questions[questionIndex]!],
    ...(searchTerms ? { searchTerms } : {}),
    researchTypes: brief.researchTypes,
    maxResults: Math.min(20, Math.max(10, brief.maxResults ?? DEFAULT_MAX_RESULTS))
  })
}

function draftIsValid(draft: unknown, brief: ResearchBrief, sourceCount: number): draft is ResearchDraftFinding {
  if (typeof draft !== 'object' || draft === null) return false
  const candidate = draft as Record<string, unknown>
  if (Object.keys(candidate).filter(key => key !== 'temporalEvidence' && key !== 'claimEvidence').sort().join(',') !== 'category,destinationIndex,sourceIndexes,summary,title') return false
  if (!brief.researchTypes.includes(candidate.category as ResearchBrief['researchTypes'][number])) return false
  if (!Number.isInteger(candidate.destinationIndex) || Number(candidate.destinationIndex) < 0 || Number(candidate.destinationIndex) >= brief.destinations.length) return false
  if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0 || candidate.title.length > 240) return false
  if (typeof candidate.summary !== 'string' || candidate.summary.trim().length === 0 || candidate.summary.length > 1_500) return false
  if (!Array.isArray(candidate.sourceIndexes) || candidate.sourceIndexes.length < 1 || candidate.sourceIndexes.length > 20) return false
  return candidate.sourceIndexes.every(index => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < sourceCount)
}

function warningForVerification(category: ResearchDraftFinding['category'], status: ResearchArtifact['findings'][number]['verification']['status']): string[] {
  const warnings: string[] = []
  if (status === 'unverified') warnings.push('evidence_unverified')
  if (status === 'partially_verified') warnings.push('evidence_partially_verified')
  if (category === 'event') warnings.push('event_date_is_snippet_only')
  return warnings
}

function sourceForFinding(source: ResearchSourceCandidate): ResearchArtifact['findings'][number]['sources'][number] {
  const { destinationIndex: _destinationIndex, ...candidate } = source as ResearchSourceCandidate & { destinationIndex?: number }
  return researchSourceSchema.parse(candidate)
}

function findingId(category: string, destination: ResearchBrief['destinations'][number], title: string, sources: readonly ResearchSourceCandidate[]): string {
  return `finding_${digest({ category, destination, title, sources: sources.map(source => source.url) })}`
}

function buildFallbackFindings(
  brief: ResearchBrief,
  sources: readonly NormalizedSource[],
  checkedAt: string,
  maxResults: number
): ResearchArtifact['findings'] {
  const findings: ResearchArtifact['findings'] = []
  for (const source of sources) {
    if (findings.length >= maxResults) break
    const destination = brief.destinations[source.destinationIndex]
    if (!destination) continue
    const category: ResearchDraftFinding['category'] = brief.researchTypes[0] ?? 'activity'
    // Raw snippets have not been checked for relevance or travel-window fit.
    // Source authority alone must not promote an old event into an itinerary.
    const categoryVerification = { ...verifyResearchFinding(category, [source], { checkedAt }), status: 'unverified' as const, confidence: 0.1 }
    const finding = {
      id: findingId(category, destination, source.title, [source]),
      category,
      destinations: [destination],
      title: source.title,
      summary: source.snippet,
      sources: [sourceForFinding(source)],
      verification: categoryVerification,
      warnings: [...warningForVerification(category, categoryVerification.status), 'raw_source_requires_synthesis']
    }
    const parsed = researchFindingSchema.safeParse(finding)
    if (parsed.success) findings.push(parsed.data)
  }
  return findings
}

function buildSynthesizedFindings(
  brief: ResearchBrief,
  drafts: readonly ResearchDraftFinding[],
  sources: readonly NormalizedSource[],
  checkedAt: string,
  maxResults: number
): ResearchArtifact['findings'] {
  const findings: ResearchArtifact['findings'] = []
  const seen = new Set<string>()
  for (const draft of drafts) {
    if (findings.length >= maxResults || !draftIsValid(draft, brief, sources.length)) continue
    const destination = brief.destinations[draft.destinationIndex]
    if (!destination) continue
    const selected = [...new Set(draft.sourceIndexes)].map(index => sources[index]).filter((source): source is NormalizedSource => source !== undefined)
    if (selected.length === 0) continue
    if (selected.some(source => source.destinationIndex !== draft.destinationIndex)) continue
    const category = draft.category
    const title = draft.title.replace(/\s+/g, ' ').trim()
    const summary = draft.summary.replace(/\s+/g, ' ').trim()
    const id = findingId(category, destination, title, selected)
    if (seen.has(id)) continue
    seen.add(id)
    const verification = verifyResearchFinding(category, selected, { checkedAt })
    const claimEvidence = admitClaimEvidence(draft.claimEvidence, sources, draft.sourceIndexes)
    const rejectedClaims = (draft.claimEvidence?.length ?? 0) > claimEvidence.length
    const temporalEvidence = admitDraftTemporalEvidence(draft.temporalEvidence, sources, draft.sourceIndexes)
    const finding = {
      id,
      category,
      destinations: [destination],
      title,
      summary,
      ...(temporalEvidence ? { temporalEvidence } : {}),
      ...(claimEvidence.length ? { claimEvidence } : {}),
      sources: selected.map(sourceForFinding),
      verification,
      warnings: [...warningForVerification(category, verification.status),
        ...(rejectedClaims ? ['claim_evidence_rejected'] : []),
        ...(hasClaimConflict(claimEvidence) ? ['claim_evidence_conflict'] : [])]
    }
    const parsed = researchFindingSchema.safeParse(finding)
    if (parsed.success) findings.push(parsed.data)
  }
  return findings
}

export class ProductionResearchAgent implements ResearchAgent {
  private readonly searchProvider: ResearchSearchProvider
  private readonly synthesisModel: ResearchSynthesisModel | undefined
  private readonly queryPlanner: ResearchQueryPlanner | undefined
  private readonly clock: (() => Date) | undefined
  private readonly searchCallLimit: number
  private readonly sourceLimit: number
  private readonly sourceReader: ResearchSourceReader | undefined

  constructor(options: ProductionResearchAgentOptions)
  constructor(searchProvider: ResearchSearchProvider, synthesisModel?: ResearchSynthesisModel, options?: Omit<ProductionResearchAgentOptions, 'searchProvider' | 'synthesisModel'>)
  constructor(
    optionsOrProvider: ProductionResearchAgentOptions | ResearchSearchProvider,
    model?: ResearchSynthesisModel,
    limits?: Omit<ProductionResearchAgentOptions, 'searchProvider' | 'synthesisModel'>
  ) {
    const options = isProvider(optionsOrProvider)
      ? { ...(limits ?? {}), searchProvider: optionsOrProvider, ...(model ? { synthesisModel: model } : {}) }
      : optionsOrProvider
    if (!isProvider(options.searchProvider)) throw new AppError('INVALID_RESEARCH_PROVIDER', 'Research search provider is invalid', 400)
    this.searchProvider = options.searchProvider
    this.synthesisModel = isSynthesis(options.synthesisModel) ? options.synthesisModel : undefined
    this.queryPlanner = options.queryPlanner
    this.sourceReader = options.sourceReader
    this.clock = options.now
    this.searchCallLimit = Math.min(MAX_SEARCH_CALLS, Math.max(1, Math.floor(options.maxSearchCalls ?? MAX_SEARCH_CALLS)))
    this.sourceLimit = Math.min(MAX_SOURCES, Math.max(1, Math.floor(options.maxSources ?? MAX_SOURCES)))
  }

  async research(input: ResearchBrief, context: ResearchExecutionContext): Promise<ResearchArtifact> {
    validateContext(context)
    abortIfNeeded(context.signal)
    const brief = researchBriefSchema.parse(input)
    const checkedAt = nowIso(this.clock)
    const warnings: string[] = []
    const sources: NormalizedSource[] = []
    const seenUrls = new Set<string>()
    const preferences = context.preferenceSummary ?? []
    // Cover destinations round-robin for every requested question, bounded by
    // the search budget. Later questions must not be silently excluded.
    const searches: ResearchQueryTask[] = []
    for (let questionIndex = 0; questionIndex < brief.questions.length && searches.length < this.searchCallLimit; questionIndex += 1) {
      for (let destinationIndex = 0; destinationIndex < brief.destinations.length && searches.length < this.searchCallLimit; destinationIndex += 1) {
        searches.push({ destinationIndex, questionIndex })
      }
    }
    const covered = new Set(searches.map(search => search.destinationIndex)).size
    const callCount = searches.length
    if (covered < brief.destinations.length) warnings.push(`research_destinations_skipped:${brief.destinations.length - covered}`)
    if (callCount < brief.destinations.length * brief.questions.length) warnings.push('research_questions_partially_sampled')

    let plannedTerms: string[] = []
    if (this.queryPlanner) {
      try {
        const planInput = { brief, tasks: searches }
        const queries = await this.queryPlanner.plan(structuredClone(planInput), { ...(context.signal ? { signal: context.signal } : {}) })
        abortIfNeeded(context.signal)
        plannedTerms = validateResearchQueryPlan(planInput, { queries }).map(query => query.searchTerms)
      } catch (error) {
        if (context.signal?.aborted) throw context.signal.reason ?? error
        warnings.push('research_query_planning_unavailable_or_invalid')
      }
    }

    // Two rolling workers keep the concurrency bound without making each pair
    // wait for its slowest member. Consume settled results in request order.
    const outcomes: Array<PromiseSettledResult<Awaited<ReturnType<ResearchSearchProvider['search']>>>> = new Array(searches.length)
    let nextSearch = 0
    await Promise.all(Array.from({ length: Math.min(2, searches.length) }, async () => {
      while (nextSearch < searches.length) {
        abortIfNeeded(context.signal)
        const index = nextSearch++
        const search = searches[index]!
        try {
          const value = await this.searchProvider.search(
            queryInputs(brief, search.destinationIndex, preferences, search.questionIndex, plannedTerms[index]),
            { ...(context.signal ? { signal: context.signal } : {}) }
          )
          outcomes[index] = { status: 'fulfilled', value }
        } catch (reason) {
          outcomes[index] = { status: 'rejected', reason }
        }
      }
    }))
    abortIfNeeded(context.signal)
    for (let index = 0; index < searches.length; index += 1) {
      const { destinationIndex } = searches[index]!
      try {
        const outcome = outcomes[index]!
        if (outcome.status === 'rejected') throw outcome.reason
        const result = researchSearchResultSchema.parse(outcome.value)
        abortIfNeeded(context.signal)
        const candidates = Array.isArray(result.candidates) ? result.candidates : []
        for (const candidate of candidates) {
          if (sources.length >= this.sourceLimit) break
          const normalized = normalizeSource(candidate, destinationIndex)
          if (!normalized || seenUrls.has(normalized.url)) continue
          seenUrls.add(normalized.url)
          sources.push(normalized)
        }
        for (const warning of result.warnings ?? []) {
          if (warnings.length < 40) warnings.push(boundedWarning(warning))
        }
      } catch (error) {
        if (context.signal?.aborted) throw context.signal.reason ?? error
        warnings.push(boundedWarning(`research_provider_failed:${this.searchProvider.name}:destination_${destinationIndex}`))
      }
    }

    // Only server reads may supply page snapshots; normalizeSource discards provider-supplied pages.
    // Four sources, two workers: bounded latency/input, no new search/model call.
    if (this.sourceReader && this.synthesisModel) {
      const rank = (source: NormalizedSource) => ['official_venue', 'official_organizer', 'official_event'].includes(source.authority) ? 0
        : source.authority === 'government_tourism' ? 1 : 2
      const reading = [...sources].sort((a, b) => rank(a) - rank(b)).slice(0, 4)
      let next = 0
      await Promise.all(Array.from({ length: Math.min(2, reading.length) }, async () => {
        while (next < reading.length) {
          abortIfNeeded(context.signal)
          const source = reading[next++]!
          try {
            source.page = sourcePageSchema.parse(await this.sourceReader!.read(source.url, context.signal ? { signal: context.signal } : {}))
          } catch (error) {
            if (context.signal?.aborted) throw context.signal.reason ?? error
            warnings.push('research_source_read_failed')
          }
        }
      }))
      abortIfNeeded(context.signal)
      if (sources.length > reading.length) warnings.push('research_source_read_limit')
    }

    let findings: ResearchArtifact['findings'] = []
    const maxResults = brief.maxResults ?? DEFAULT_MAX_RESULTS
    if (sources.length > 0 && this.synthesisModel) {
      try {
        abortIfNeeded(context.signal)
        const synthesisInputSources = sources.map(({ destinationIndex: _destinationIndex, ...source }) => source)
        const drafts = await this.synthesisModel.synthesize({ brief, sources: synthesisInputSources }, { ...(context.signal ? { signal: context.signal } : {}) })
        abortIfNeeded(context.signal)
        const validDrafts = Array.isArray(drafts) ? drafts.filter(draft => draftIsValid(draft, brief, sources.length)) : []
        if (!Array.isArray(drafts) || (drafts.length > 0 && validDrafts.length === 0)) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'Research synthesis returned no valid indexed findings', 502)
        findings = buildSynthesizedFindings(brief, validDrafts, sources, checkedAt, maxResults)
        if (validDrafts.length > 0 && findings.length === 0) throw new AppError('RESEARCH_SYNTHESIS_INVALID', 'Research synthesis returned no usable findings', 502)
      } catch (error) {
        if (context.signal?.aborted) throw context.signal.reason ?? error
        warnings.push(boundedWarning('research_synthesis_unavailable_or_invalid'))
        findings = buildFallbackFindings(brief, sources, checkedAt, maxResults)
      }
    } else {
      findings = buildFallbackFindings(brief, sources, checkedAt, maxResults)
    }

    const artifact = {
      id: `research_${digest({
        brief,
        sources: sources.map(({ destinationIndex: _destinationIndex, ...source }) => source),
        findings: findings.map(({ verification: _verification, warnings: _warnings, ...finding }) => finding)
      })}`,
      type: 'research' as const,
      schemaVersion: 2 as const,
      brief,
      findings: findings.slice(0, maxResults),
      queryCount: callCount,
      warnings: warnings.slice(0, 40),
      createdAt: checkedAt
    }
    return researchArtifactSchema.parse(artifact)
  }
}
