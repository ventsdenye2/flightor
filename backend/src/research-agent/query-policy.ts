import type { LocationRef } from '../aviation/types.js'
import { cityGroupingCode, type LocationIdentityPolicy } from '../locations/identity.js'

export interface ResearchQueryScope {
  readonly domains: readonly string[]
  readonly warning?: string
}

export interface ResearchQueryPolicy {
  scopeFor(destination: LocationRef): ResearchQueryScope | undefined
}

export interface CuratedResearchQueryScope {
  readonly countryCode: string
  readonly cityCode: string
  readonly domains: readonly string[]
  readonly warning?: string
}

function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase()
  if (domain.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes('..')) {
    throw new Error(`Invalid curated research domain: ${value}`)
  }
  return domain
}

/** Data-driven lookup; the algorithm contains no destination-specific cases. */
export class CuratedResearchQueryPolicy implements ResearchQueryPolicy {
  private readonly scopes: ReadonlyMap<string, ResearchQueryScope>

  constructor(entries: readonly CuratedResearchQueryScope[], private readonly identity: LocationIdentityPolicy) {
    const scopes = new Map<string, ResearchQueryScope>()
    for (const entry of entries) {
      const countryCode = entry.countryCode.trim().toUpperCase()
      const cityCode = entry.cityCode.trim().toUpperCase()
      const domains = [...new Set(entry.domains.map(normalizeDomain))]
      if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(cityCode) || domains.length === 0 || domains.length > 8) {
        throw new Error('Invalid curated research query scope')
      }
      const key = `${countryCode}:${cityCode}`
      if (scopes.has(key)) throw new Error(`Duplicate curated research query scope: ${key}`)
      scopes.set(key, { domains, ...(entry.warning ? { warning: entry.warning } : {}) })
    }
    this.scopes = scopes
  }

  scopeFor(destination: LocationRef): ResearchQueryScope | undefined {
    const cityCode = cityGroupingCode(destination, this.identity)
    return this.scopes.get(`${destination.countryCode}:${cityCode}`)
  }
}

export const OPEN_RESEARCH_QUERY_POLICY: ResearchQueryPolicy = {
  scopeFor: () => undefined
}
