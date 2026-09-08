import type { AppEnv } from '../../config/env.js'
import {
  getDestinationProfile,
  type DestinationInterest
} from '../../destinations/catalog.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson, withQuery } from '../../lib/http.js'

export interface SerpFlightSearch {
  origin: string
  destination: string
  departDate: string
  returnDate?: string
  currency?: string
  travelClass?: number
}

/**
 * This is intentionally smaller than a generic web-search request.  The
 * caller can only provide a catalog IATA, verified interests, and a bounded
 * trip length; the server constructs the actual Google query below.
 */
export interface SerpTravelGuideSearch {
  cityIata: string
  interests: readonly DestinationInterest[]
  travelDays: number
}

export interface SerpTravelGuideResult {
  title: string
  snippet: string
  url: string
  domain: string
}

/**
 * The small, provider-neutral portion of SerpApi's Google organic response
 * that the research domain is allowed to consume.  The URL is normalized by
 * the client before it leaves this adapter; callers never receive arbitrary
 * provider payloads.
 */
export interface SerpOrganicResult {
  title: string
  snippet: string
  url: string
  domain: string
  publishedAt?: string
}

export interface SerpOrganicSearch {
  query: string
  /** Google `num`; at most twenty results are ever requested/returned. */
  limit?: number
  /** Alias accepted by callers that use the SerpApi spelling. */
  num?: number
  hl?: string
  gl?: string
}

const GUIDE_INTEREST_TERMS: Record<DestinationInterest, string> = {
  culture: 'culture history museums',
  food: 'food markets local cuisine',
  nature: 'nature parks scenic walks',
  shopping: 'shopping districts markets',
  nightlife: 'nightlife evening areas'
}

const GUIDE_RESULT_LIMIT = 3
const MAX_GUIDE_TITLE_LENGTH = 160
const MAX_GUIDE_SNIPPET_LENGTH = 420
const MAX_GUIDE_URL_LENGTH = 500
const ORGANIC_RESULT_LIMIT = 20
const MAX_ORGANIC_QUERY_LENGTH = 480
const MAX_ORGANIC_TITLE_LENGTH = 240
const MAX_ORGANIC_SNIPPET_LENGTH = 800

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.replace(/\s+/g, ' ').trim()
  if (!result || result.length > maximum) return undefined
  return result
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AppError('PROVIDER_CANCELLED', 'serpapi request was cancelled', 502, { provider: 'serpapi' })
  }
}

function safeHttpUrl(value: unknown): { url: string; domain: string } | undefined {
  const raw = boundedText(value, MAX_GUIDE_URL_LENGTH)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (!parsed.hostname || parsed.username || parsed.password) return undefined
    return { url: parsed.toString(), domain: parsed.hostname.toLowerCase() }
  } catch {
    return undefined
  }
}

/**
 * Canonicalize a result URL only for identity/deduplication.  Credentials and
 * non-HTTP(S) schemes are rejected before this function is called.  Sorting
 * query parameters also makes SerpApi's occasional reordered tracking query
 * strings compare equal without fetching or rewriting the target resource.
 */
function canonicalHttpUrl(value: string): { url: string; domain: string } | undefined {
  const safe = safeHttpUrl(value)
  if (!safe) return undefined
  try {
    const parsed = new URL(safe.url)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase()
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = ''
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    const params = [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    parsed.search = ''
    for (const [key, item] of params) parsed.searchParams.append(key, item)
    return { url: parsed.toString(), domain: parsed.hostname }
  } catch {
    return undefined
  }
}

function normalizeGuideResults(value: unknown): SerpTravelGuideResult[] {
  const root = isRecord(value) ? value : {}
  const raw = Array.isArray(root.organic_results) ? root.organic_results : []
  const results: SerpTravelGuideResult[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const title = boundedText(item.title, MAX_GUIDE_TITLE_LENGTH)
    const snippet = boundedText(item.snippet, MAX_GUIDE_SNIPPET_LENGTH)
    const link = safeHttpUrl(item.link ?? item.url)
    if (!title || !snippet || !link || seen.has(link.url)) continue
    seen.add(link.url)
    results.push({ title, snippet, ...link })
    if (results.length >= GUIDE_RESULT_LIMIT) break
  }
  return results
}

function parsePublishedAt(value: unknown): string | undefined {
  const text = boundedText(value, 120)
  if (!text) return undefined
  // Provider date labels often contain a calendar date without a timezone.
  // Parse those at UTC midnight so persisted evidence does not drift with the
  // backend host timezone. Timestamps with an explicit time keep their zone.
  const hasTime = /(?:T|\s)\d{1,2}:\d{2}/.test(text)
  const timestamp = Date.parse(hasTime ? text : `${text} UTC`)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

function providerStatusError(value: unknown): boolean {
  if (!isRecord(value)) return false
  const error = value.error
  if ((typeof error === 'string' && error.trim().length > 0) || (typeof error === 'object' && error !== null) || error === true) return true
  const metadata = isRecord(value.search_metadata) ? value.search_metadata : undefined
  return typeof metadata?.status === 'string' && metadata.status.toLowerCase() === 'error'
}

function normalizeOrganicResults(value: unknown): SerpOrganicResult[] {
  const root = isRecord(value) ? value : {}
  const metadata = isRecord(root.search_metadata) ? root.search_metadata : undefined
  const information = isRecord(root.search_information) ? root.search_information : undefined
  // SerpApi documents Success + Fully empty as a successful search, even when
  // an explanatory error string is present. This is distinct from an outage.
  // https://serpapi.com/api-status-and-error-codes
  if (metadata?.status === 'Success' && information?.organic_results_state === 'Fully empty'
    && (!Array.isArray(root.organic_results) || root.organic_results.length === 0)) return []
  if (providerStatusError(root)) {
    throw new AppError('PROVIDER_UNAVAILABLE', 'serpapi returned a search error', 502, { provider: 'serpapi' })
  }
  const raw = Array.isArray(root.organic_results) ? root.organic_results : []
  const results: SerpOrganicResult[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const title = boundedText(item.title, MAX_ORGANIC_TITLE_LENGTH)
    const snippet = boundedText(item.snippet, MAX_ORGANIC_SNIPPET_LENGTH)
    const linkValue = typeof item.link === 'string' ? item.link : item.url
    const link = typeof linkValue === 'string' ? canonicalHttpUrl(linkValue) : undefined
    if (!title || !snippet || !link || seen.has(link.url)) continue
    seen.add(link.url)
    const publishedAt = parsePublishedAt(item.date ?? item.published_at ?? item.publishedAt)
    results.push({ title, snippet, url: link.url, domain: link.domain, ...(publishedAt ? { publishedAt } : {}) })
    if (results.length >= ORGANIC_RESULT_LIMIT) break
  }
  return results
}

function guideQuery(input: SerpTravelGuideSearch): string {
  const profile = getDestinationProfile(input.cityIata)
  if (!profile) throw new AppError('INVALID_TRAVEL_GUIDE_CITY', 'Travel guide city is not supported', 400)
  const interests = [...new Set(input.interests)]
    .filter(item => GUIDE_INTEREST_TERMS[item] !== undefined)
    .map(item => GUIDE_INTEREST_TERMS[item])
  const topic = interests.length > 0 ? interests.join(' ') : 'top attractions things to do'
  // All interpolated values originate in the bounded server catalog/enum.
  return `${profile.cityEn} ${input.travelDays}-day travel guide ${topic}`.slice(0, 240)
}

export class SerpApiClient {
  constructor(private readonly config: AppEnv) {}

  async searchFlights(input: SerpFlightSearch, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!this.config.SERPAPI_KEY) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'SerpApi is not configured', 503)
    }
    const url = withQuery(this.config.SERPAPI_BASE_URL, '', {
      engine: 'google_flights',
      departure_id: input.origin.toUpperCase(),
      arrival_id: input.destination.toUpperCase(),
      outbound_date: input.departDate,
      return_date: input.returnDate,
      type: input.returnDate ? 1 : 2,
      travel_class: input.travelClass ?? 1,
      currency: input.currency ?? 'CNY',
      hl: 'zh-cn',
      api_key: this.config.SERPAPI_KEY
    })
    return fetchJson<Record<string, unknown>>(url, { method: 'GET' }, {
      provider: 'serpapi',
      timeoutMs: 30_000,
      ...(signal ? { signal } : {})
    })
  }

  /**
   * Bounded Google organic search for domain adapters.  This deliberately
   * exposes no generic SerpApi parameters: the server owns the query and the
   * only user-controlled result data that escapes is a safe HTTP(S) URL plus
   * bounded text.
   */
  async searchOrganic(input: SerpOrganicSearch, signal?: AbortSignal): Promise<SerpOrganicResult[]> {
    if (!this.config.SERPAPI_KEY) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'SerpApi is not configured', 503)
    }
    throwIfAborted(signal)
    if (!input || typeof input !== 'object') throw new AppError('INVALID_RESEARCH_SEARCH', 'Organic search input is not supported', 400)
    const query = boundedText(input.query, MAX_ORGANIC_QUERY_LENGTH)
    const requestedLimit = input.limit ?? input.num ?? ORGANIC_RESULT_LIMIT
    if (!query || /[\u0000-\u001f\u007f]/.test(query) || query.length > MAX_ORGANIC_QUERY_LENGTH || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > ORGANIC_RESULT_LIMIT) {
      throw new AppError('INVALID_RESEARCH_SEARCH', 'Organic search input is not supported', 400)
    }
    const url = withQuery(this.config.SERPAPI_BASE_URL, '', {
      engine: 'google',
      q: query,
      num: requestedLimit,
      hl: input.hl ?? 'en',
      gl: input.gl ?? 'us',
      api_key: this.config.SERPAPI_KEY
    })
    const response = await fetchJson<unknown>(url, { method: 'GET' }, {
      provider: 'serpapi',
      timeoutMs: 30_000,
      ...(signal ? { signal } : {})
    })
    throwIfAborted(signal)
    return normalizeOrganicResults(response).slice(0, requestedLimit)
  }

  /** Alias retained for adapters that name the Google endpoint explicitly. */
  async searchGoogleOrganic(input: SerpOrganicSearch, signal?: AbortSignal): Promise<SerpOrganicResult[]> {
    return this.searchOrganic(input, signal)
  }

  async searchOrganicResults(input: SerpOrganicSearch, signal?: AbortSignal): Promise<SerpOrganicResult[]> {
    return this.searchOrganic(input, signal)
  }

  /** Search public travel-guide snippets through SerpApi's Google engine. */
  async searchTravelGuide(input: SerpTravelGuideSearch): Promise<SerpTravelGuideResult[]> {
    if (!this.config.SERPAPI_KEY) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'SerpApi is not configured', 503)
    }
    const profile = getDestinationProfile(input.cityIata)
    if (!profile || !Number.isInteger(input.travelDays) || input.travelDays < 1 || input.travelDays > 60) {
      throw new AppError('INVALID_TRAVEL_GUIDE_REQUEST', 'Travel guide search input is not supported', 400)
    }
    const url = withQuery(this.config.SERPAPI_BASE_URL, '', {
      engine: 'google',
      q: guideQuery(input),
      num: GUIDE_RESULT_LIMIT,
      hl: 'en',
      gl: 'us',
      api_key: this.config.SERPAPI_KEY
    })
    const response = await fetchJson<unknown>(url, { method: 'GET' }, { provider: 'serpapi', timeoutMs: 20_000 })
    return normalizeGuideResults(response)
  }
}
