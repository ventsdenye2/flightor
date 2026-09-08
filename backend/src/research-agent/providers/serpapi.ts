import { AppError } from '../../lib/errors.js'
import type { SerpApiClient, SerpOrganicResult } from '../../providers/serpapi/client.js'
import {
  researchSearchInputSchema,
  researchSearchResultSchema,
  type ResearchSearchInput,
  type ResearchSearchProvider,
  type ResearchSearchResult,
  type ResearchSourceCandidate
} from '../search-provider.js'
import { classifyResearchSourceAuthority } from '../verification.js'
import type { ResearchQueryPolicy, ResearchQueryScope } from '../query-policy.js'
import { CURATED_RESEARCH_QUERY_POLICY } from '../curated-query-policy.js'

const MAX_QUERY_LENGTH = 480
const MAX_QUERY_PART_LENGTH = 160

type OrganicSearchMethod = (input: Parameters<SerpApiClient['searchOrganic']>[0], signal?: AbortSignal) => Promise<SerpOrganicResult[]>
type OrganicClient = { searchOrganic?: OrganicSearchMethod; searchGoogleOrganic?: OrganicSearchMethod }

function sanitizeQueryPart(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    // Search operators are server policy, not user input.  Remove their
    // syntax instead of allowing a model/user string to add site restrictions.
    .replace(/(?:site|inurl|intitle|allinurl|allintitle|filetype|related|cache)\s*:/gi, ' ')
    .replace(/:/g, ' ')
    .replace(/[+\-~|{}[\]()<>"]+/g, ' ')
    .replace(/\b(?:AND|OR|NOT)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_PART_LENGTH)
}

function scopeClause(scope: ResearchQueryScope | undefined): string {
  if (!scope) return ''
  return ` (${scope.domains.map(domain => `site:${domain}`).join(' OR ')})`
}

function buildQuery(input: ResearchSearchInput, policy: ResearchQueryPolicy = CURATED_RESEARCH_QUERY_POLICY): string {
  const parts = [
    input.destination.name,
    ...(input.searchTerms ? [input.searchTerms] : input.questions)
  ]
  // Categories constrain synthesis; combining all their labels into every
  // topic query incorrectly requires one source to discuss unrelated topics.
  // Evergreen activity pages rarely mention the exact trip dates. Keep the
  // full window in the synthesis brief; only date-sensitive searches need it.
  if (input.researchTypes.every(type => type === 'event' || type === 'seasonal')) {
    if (input.travelWindow?.from) parts.push(input.travelWindow.from.slice(0, 7))
    if (input.travelWindow?.to && input.travelWindow.to.slice(0, 7) !== input.travelWindow?.from?.slice(0, 7)) parts.push(input.travelWindow.to.slice(0, 7))
  }
  const query = parts.map(sanitizeQueryPart).filter(Boolean).join(' ')
  // Exact, server-owned domains come from an injected product policy. No
  // model/user string can add a search operator or destination special-case.
  const officialScope = scopeClause(policy.scopeFor(input.destination))
  return query.slice(0, MAX_QUERY_LENGTH - officialScope.length) + officialScope
}

function toCandidate(result: SerpOrganicResult): ResearchSourceCandidate | undefined {
  if (typeof result.title !== 'string' || typeof result.snippet !== 'string') return undefined
  const title = result.title.replace(/\s+/g, ' ').trim().slice(0, 240)
  const snippet = result.snippet.replace(/\s+/g, ' ').trim().slice(0, 800)
  if (!title || !snippet || typeof result.url !== 'string') return undefined
  let parsed: URL
  try {
    parsed = new URL(result.url)
  } catch {
    return undefined
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) return undefined
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.hash = ''
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = ''
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  const params = [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  parsed.search = ''
  for (const [key, value] of params) parsed.searchParams.append(key, value)
  const url = parsed.toString()
  const authority = classifyResearchSourceAuthority(url)
  const publishedAt = typeof result.publishedAt === 'string' && !Number.isNaN(Date.parse(result.publishedAt))
    ? new Date(result.publishedAt).toISOString()
    : undefined
  return {
    title,
    snippet,
    url,
    domain: parsed.hostname,
    authority,
    ...(publishedAt ? { publishedAt } : {})
  }
}

/** Dedicated research adapter; it has no fare/provider dependency. */
export class SerpApiResearchSearchProvider implements ResearchSearchProvider {
  readonly name = 'serpapi-research'

  constructor(
    private readonly client: OrganicClient,
    private readonly queryPolicy: ResearchQueryPolicy = CURATED_RESEARCH_QUERY_POLICY
  ) {}

  async search(input: ResearchSearchInput, options?: { signal?: AbortSignal }): Promise<ResearchSearchResult> {
    const validated = researchSearchInputSchema.parse(input)
    if (options?.signal?.aborted) {
      throw new AppError('PROVIDER_CANCELLED', 'Research search was cancelled', 502, { provider: this.name })
    }
    const scope = this.queryPolicy.scopeFor(validated.destination)
    const query = buildQuery(validated, this.queryPolicy)
    if (!query || query.length > MAX_QUERY_LENGTH) {
      throw new AppError('INVALID_RESEARCH_SEARCH', 'Research query is empty or too long', 400)
    }
    const search = this.client.searchOrganic ?? this.client.searchGoogleOrganic
    if (!search) throw new AppError('PROVIDER_UNAVAILABLE', 'SerpApi organic search is unavailable', 502, { provider: this.name })
    const results = await search.call(this.client, {
      query,
      limit: validated.maxResults,
      hl: 'en',
      gl: validated.destination.countryCode.toLowerCase()
    }, options?.signal)
    if (options?.signal?.aborted) {
      throw new AppError('PROVIDER_CANCELLED', 'Research search was cancelled', 502, { provider: this.name })
    }
    const candidates: ResearchSourceCandidate[] = []
    const seen = new Set<string>()
    for (const result of results) {
      const candidate = toCandidate(result)
      if (!candidate) continue
      if (seen.has(candidate.url)) continue
      seen.add(candidate.url)
      candidates.push(candidate)
      if (candidates.length >= validated.maxResults) break
    }
    return researchSearchResultSchema.parse({
      candidates,
      checkedAt: new Date().toISOString(),
      warnings: scope?.warning ? [scope.warning] : []
    })
  }
}

export const SerpApiResearchProvider = SerpApiResearchSearchProvider

export { buildQuery as buildSerpApiResearchQuery, buildQuery as buildResearchQuery }
