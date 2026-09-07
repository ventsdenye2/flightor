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

function researchTypeLabel(value: ResearchSearchInput['researchTypes'][number]): string {
  return value === 'event'
    ? 'events'
    : value === 'seasonal'
      ? 'seasonal highlights'
      : value === 'activity'
        ? 'activities'
        : value === 'stopover'
          ? 'stopover ideas'
          : 'practical travel information'
}

function buildQuery(input: ResearchSearchInput): string {
  const parts = [
    input.destination.name,
    ...input.researchTypes.map(researchTypeLabel),
    ...input.interests,
    ...input.questions
  ]
  if (input.travelWindow?.from) parts.push(`from ${input.travelWindow.from}`)
  if (input.travelWindow?.to) parts.push(`to ${input.travelWindow.to}`)
  const query = parts.map(sanitizeQueryPart).filter(Boolean).join(' ')
  return query.slice(0, MAX_QUERY_LENGTH)
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

  constructor(private readonly client: OrganicClient) {}

  async search(input: ResearchSearchInput, options?: { signal?: AbortSignal }): Promise<ResearchSearchResult> {
    const validated = researchSearchInputSchema.parse(input)
    if (options?.signal?.aborted) {
      throw new AppError('PROVIDER_CANCELLED', 'Research search was cancelled', 502, { provider: this.name })
    }
    const query = buildQuery(validated)
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
      warnings: []
    })
  }
}

export const SerpApiResearchProvider = SerpApiResearchSearchProvider

export { buildQuery as buildSerpApiResearchQuery, buildQuery as buildResearchQuery }
