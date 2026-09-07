import { createHash } from 'node:crypto'
import type { VerificationRecord } from '../aviation/types.js'
import { researchSourceAuthoritySchema } from './types.js'
import type { ResearchSourceCandidate } from './search-provider.js'

export type ResearchVerificationCategory = 'event' | 'seasonal' | 'activity' | 'stopover' | 'practical'
export type ResearchSourceAuthority = ResearchSourceCandidate['authority']

/** Category TTLs are deliberately conservative because search results are snippet-only evidence. */
export const RESEARCH_VERIFICATION_TTL_DAYS: Readonly<Record<ResearchVerificationCategory, number>> = {
  event: 30,
  seasonal: 45,
  activity: 90,
  stopover: 90,
  practical: 60
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp',
  'ne.jp', 'or.jp', 'go.jp', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.sg'
])

const KNOWN_MEDIA_HOSTS = new Set([
  'apnews.com', 'bbc.com', 'bbc.co.uk', 'reuters.com', 'theguardian.com',
  'nytimes.com', 'nhk.or.jp', 'npr.org'
])

function normalizedHostname(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (!parsed.hostname || parsed.username || parsed.password) return undefined
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  } catch {
    return undefined
  }
}

/**
 * This is intentionally not a full public-suffix implementation.  It errs on
 * the side of merging domains, which prevents two subdomains or two pages on
 * the same registrable host from being treated as independent evidence.
 */
export function registrableResearchHostname(value: string): string {
  const hostname = normalizedHostname(value) ?? value.trim().toLowerCase().replace(/^www\./, '')
  const labels = hostname.split('.').filter(Boolean)
  if (labels.length <= 2) return hostname
  const suffix = labels.slice(-2).join('.')
  return MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix) ? labels.slice(-3).join('.') : suffix
}

function looksGovernmentHostname(hostname: string): boolean {
  const governmentSuffixes = [
    '.gov', '.gov.cn', '.gov.uk', '.gov.au', '.gov.sg', '.gov.jp', '.gov.kr', '.govt.nz',
    '.gouv.fr', '.go.jp', '.go.kr', '.go.th', '.go.id'
  ]
  return governmentSuffixes.some(suffix => hostname.endsWith(suffix))
}

function looksPublicTourismHostname(hostname: string): boolean {
  // These patterns are deliberately narrow.  A generic travel blog or a
  // result whose title says “official” must remain unknown.
  return /(^|\.)(visit|tourism|japan\.travel|spain\.info|france\.fr)$/.test(hostname)
    || hostname.endsWith('.tourism')
    || hostname === 'japan.travel'
    // Tokyo Metropolitan Government identifies this exact host as its tourism
    // portal: https://www.english.metro.tokyo.lg.jp/w/029-101-004128
    || hostname === 'gotokyo.org'
    || hostname.endsWith('.visit')
}

/** Classify only host-level authority; title/snippet wording is never used. */
export function classifyResearchSourceAuthority(url: string): ResearchSourceAuthority {
  const hostname = normalizedHostname(url)
  if (!hostname) return 'unknown'
  if (looksGovernmentHostname(hostname) || looksPublicTourismHostname(hostname)) return 'government_tourism'
  if (KNOWN_MEDIA_HOSTS.has(hostname) || [...KNOWN_MEDIA_HOSTS].some(value => hostname.endsWith(`.${value}`))) return 'reliable_media'
  return 'unknown'
}

export const classifySourceAuthority = classifyResearchSourceAuthority
export const registrableDomain = registrableResearchHostname

function addDays(iso: string, days: number): string {
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return iso
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString()
}

function sourceReference(source: ResearchSourceCandidate): { provider: string; reference: string } {
  return { provider: 'research-search', reference: source.url }
}

function uniqueSources(sources: readonly ResearchSourceCandidate[]): ResearchSourceCandidate[] {
  const seen = new Set<string>()
  const result: ResearchSourceCandidate[] = []
  for (const source of sources) {
    const hostname = normalizedHostname(source.url)
    if (!hostname) continue
    let canonical: string
    try {
      const parsed = new URL(source.url)
      parsed.hash = ''
      parsed.hostname = hostname
      canonical = parsed.toString()
    } catch {
      continue
    }
    if (seen.has(canonical)) continue
    seen.add(canonical)
    result.push(source)
  }
  return result
}

export interface ResearchVerificationOptions {
  /** Stable timestamp supplied by the research run. */
  checkedAt?: string
  /** A testable clock used when checkedAt is omitted or malformed. */
  now?: Date
}

function stableCheckedAt(options?: ResearchVerificationOptions): string {
  if (options?.checkedAt && !Number.isNaN(Date.parse(options.checkedAt))) return new Date(options.checkedAt).toISOString()
  // The helper is pure: production supplies the research-run timestamp, while
  // standalone callers get a stable epoch rather than an implicit wall clock.
  const now = options?.now ?? new Date(0)
  return Number.isNaN(now.getTime()) ? new Date(0).toISOString() : now.toISOString()
}

/**
 * Deterministically verify the evidence available to the research domain.
 * Organic search candidates contain title/snippet metadata only, so even a
 * government result cannot fully verify an event/date claim at this stage.
 */
export function verifyResearchFinding(
  category: ResearchVerificationCategory,
  sources: readonly ResearchSourceCandidate[],
  options?: ResearchVerificationOptions
): VerificationRecord {
  const checkedAt = stableCheckedAt(options)
  const normalizedSources = uniqueSources(sources).slice(0, 20)
  const authoritative = normalizedSources.some(source => {
    const computed = classifyResearchSourceAuthority(source.url)
    const declared = researchSourceAuthoritySchema.safeParse(source.authority).success ? source.authority : 'unknown'
    return computed === 'government_tourism' && declared === 'government_tourism'
  })
  const independentRoots = new Set(normalizedSources.map(source => registrableResearchHostname(source.url)))
  let status: VerificationRecord['status'] = 'unverified'
  let confidence = 0
  if (category === 'event') {
    // Dates in a title, `date` field, or snippet are never enough for verified.
    if (authoritative || independentRoots.size >= 2) {
      status = 'partially_verified'
      confidence = authoritative ? 0.58 : 0.45
    } else if (normalizedSources.length > 0) {
      status = 'unverified'
      confidence = 0.2
    }
  } else if (authoritative || independentRoots.size >= 2) {
    // Organic results expose only title/snippet metadata. A recognized host is
    // useful evidence, but without fetched or structured content it cannot
    // support a fully verified user-facing claim.
    status = 'partially_verified'
    confidence = authoritative ? 0.58 : 0.48
  } else if (normalizedSources.length > 0) {
    status = 'unverified'
    confidence = 0.2
  }

  const expiresAt = addDays(checkedAt, RESEARCH_VERIFICATION_TTL_DAYS[category])
  // This provider path is snippet-only, so no branch above yields `verified`.
  // A future fetched/structured source type must add a distinct evidence mode
  // rather than weakening these branches in place.
  return {
    status,
    checkedAt,
    expiresAt,
    confidence,
    sources: normalizedSources.map(sourceReference)
  }
}

/** Friendly aliases for domain callers/tests. */
export const buildResearchVerification = verifyResearchFinding
export const verifyResearchSources = verifyResearchFinding

/** Stable digest helper shared by deterministic research IDs. */
export function researchEvidenceDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}
