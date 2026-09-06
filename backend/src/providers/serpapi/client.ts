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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.replace(/\s+/g, ' ').trim()
  if (!result || result.length > maximum) return undefined
  return result
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
