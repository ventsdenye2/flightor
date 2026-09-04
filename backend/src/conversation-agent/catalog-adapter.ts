import * as destinationCatalog from '../destinations/catalog.js'
import type {
  DestinationInterest,
  DestinationRecommendation,
  DestinationRegion
} from '../destinations/catalog.js'
import { ORIGINS } from '../route-plans/engine.js'
import type { TripState } from './schema.js'

/**
 * The catalog is the authority for destination names, IATA codes and
 * recommendation copy.  This adapter intentionally treats the catalog
 * helpers as opaque at the conversation boundary: it keeps this agent
 * compatible with the small, pure catalog API while still protecting the
 * protocol from malformed helper output.
 */

export interface DestinationMentionResult {
  iatas: string[]
  regions: DestinationRegion[]
  mentions: Array<{ iata: string; index: number }>
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function asIata(value: unknown): string | undefined {
  const normalized = asString(value)?.toUpperCase()
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined
}

function collectStringValues(value: unknown, keys: ReadonlySet<string>, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, keys, output)
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key)) {
      if (Array.isArray(item)) {
        for (const child of item) {
          const text = asString(child)
          if (text) output.push(text)
          else if (isRecord(child)) {
            for (const field of ['iata', 'code', 'value', 'id']) {
              const nested = asString(child[field])
              if (nested) output.push(nested)
            }
          }
        }
      } else {
        const text = asString(item)
        if (text) output.push(text)
      }
      continue
    }
    if (isRecord(item) || Array.isArray(item)) collectStringValues(item, keys, output)
  }
}

function collectMentions(value: unknown, iatas: string[], regions: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMentions(item, iatas, regions)
    return
  }
  if (!isRecord(value)) return

  for (const key of ['iata', 'iata_code', 'iataCode', 'code', 'required_iata', 'requiredIata']) {
    const iata = asIata(value[key])
    if (iata) iatas.push(iata)
  }
  for (const key of ['region', 'region_id', 'regionId']) {
    const region = asString(value[key])
    if (region) regions.push(region)
  }
  for (const key of ['iatas', 'required_iatas', 'requiredIatas', 'cities', 'destinations', 'matches', 'mentions', 'items']) {
    collectMentions(value[key], iatas, regions)
  }
}

function localRegionMentions(text: string): DestinationRegion[] {
  const found: Array<{ index: number; region: DestinationRegion }> = []
  const patterns: Array<{ pattern: RegExp; region: DestinationRegion }> = [
    { pattern: /日本|日[本]|japan/gi, region: 'japan' as DestinationRegion },
    { pattern: /欧洲|欧盟|申根|欧洲大陆|europe|schengen/gi, region: 'schengen' as DestinationRegion },
    { pattern: /东南亚|东亚|免签|落地签|southeast\s+asia|visa[- ]free/gi, region: 'visa_free' as DestinationRegion }
  ]
  for (const item of patterns) {
    for (const match of text.matchAll(item.pattern)) {
      found.push({ index: match.index ?? Number.MAX_SAFE_INTEGER, region: item.region })
    }
  }
  found.sort((left, right) => left.index - right.index)
  const result: DestinationRegion[] = []
  for (const item of found) {
    if (!result.includes(item.region)) result.push(item.region)
  }
  return result
}

function callResolver(text: string): unknown {
  const resolver = destinationCatalog.resolveDestinationMentions as unknown as (...args: unknown[]) => unknown
  try {
    return resolver(text)
  } catch {
    return undefined
  }
}

/**
 * Resolve only mentions that occur in user text.  It is important that this
 * helper never receives model output: a model can suggest a city, but only a
 * textual/catalog match is allowed to enter required_iatas.
 */
export function resolveMentions(text: string): DestinationMentionResult {
  const result = callResolver(text)
  const iatas: string[] = []
  const regions: string[] = []
  collectMentions(result, iatas, regions)

  // A few catalog implementations return `{ iatas, regions }` and others
  // return an array of match records.  The generic collector above covers
  // both; local region aliases fill in only the region vocabulary and never
  // turn a country into a city.
  for (const region of localRegionMentions(text)) regions.push(region)

  const uniqueIatas = [...new Set(iatas)]
  const uniqueRegions = [...new Set(regions)] as DestinationRegion[]
  const profiles = (destinationCatalog.DESTINATION_PROFILES as unknown as readonly UnknownRecord[] | undefined) ?? []
  const mentions = uniqueIatas.map((iata, order) => {
    const profile = profiles.find(item => asIata(item.iata) === iata)
    const cityZh = asString(profile?.cityZh)
    const cityEn = asString(profile?.cityEn)
    const iataIndex = new RegExp(`(?:^|[^A-Za-z0-9])${iata}(?=$|[^A-Za-z0-9])`, 'i').exec(text)?.index ?? -1
    const zhIndex = cityZh ? text.indexOf(cityZh) : -1
    const enIndex = cityEn
      ? new RegExp(`(?:^|[^A-Za-z])${cityEn.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?=$|[^A-Za-z])`, 'i').exec(text)?.index ?? -1
      : -1
    const candidates = [iataIndex, zhIndex, enIndex].filter(index => index >= 0)
    return { iata, index: candidates.length > 0 ? Math.min(...candidates) : text.length + order }
  }).sort((left, right) => left.index - right.index)
  return { iatas: uniqueIatas, regions: uniqueRegions, mentions }
}

function recommendationIata(value: unknown): string | undefined {
  if (typeof value === 'string') return asIata(value)
  if (!isRecord(value)) return undefined
  for (const key of ['iata', 'iata_code', 'iataCode', 'code']) {
    const iata = asIata(value[key])
    if (iata) return iata
  }
  return undefined
}

function normalizeRecommendationResult(value: unknown): DestinationRecommendation[] {
  const source = isRecord(value)
    ? value.recommendations ?? value.items ?? value.results ?? value.destinations
    : value
  if (!Array.isArray(source)) return []
  return source.filter((item): item is DestinationRecommendation => isRecord(item)) as DestinationRecommendation[]
}

/**
 * Ask the server-side catalog for recommendations.  No third-party provider
 * is called here; catalog output is deterministic and can be safely sent in
 * the discover phase before a date is known.
 */
export function recommendFromCatalog(state: TripState): DestinationRecommendation[] {
  const recommender = destinationCatalog.recommendDestinations as unknown as (...args: unknown[]) => unknown
  const candidates: unknown[] = [
    {
      regions: state.regions,
      interests: state.interests,
      excludedIatas: state.excluded_iatas,
      requiredIatas: state.required_iatas,
      limit: 3
    },
    state,
    {
      regions: state.regions,
      interests: state.interests,
      budget_max: state.budget_max,
      pace: state.pace,
      priorities: state.priorities,
      required_iatas: state.required_iatas,
      excluded_iatas: state.excluded_iatas
    }
  ]

  let value: unknown
  for (const candidate of candidates) {
    try {
      value = recommender(candidate)
      break
    } catch {
      // The fixed catalog contract is pure.  The second call shape is only a
      // compatibility guard for an in-flight catalog implementation.
    }
  }

  const excluded = new Set(state.excluded_iatas)
  const required = new Set(state.required_iatas)
  const excludedCanonical = new Set([...excluded].map(canonicalDestinationIata))
  const requiredCanonical = new Set([...required].map(canonicalDestinationIata))
  return normalizeRecommendationResult(value)
    .filter(item => {
      const iata = recommendationIata(item)
      return !iata || (!excluded.has(iata) && !required.has(iata)
        && !excludedCanonical.has(canonicalDestinationIata(iata))
        && !requiredCanonical.has(canonicalDestinationIata(iata)))
    })
    .slice(0, 3)
}

export function getRecommendationIata(value: unknown): string | undefined {
  return recommendationIata(value)
}

export function canonicalDestinationIata(iata: string): string {
  const resolver = destinationCatalog.getCanonicalDestinationIata as unknown as ((value: string) => string | undefined) | undefined
  return resolver?.(iata) ?? iata
}

/** Client state may only name a departure airport/city supported by journey.ts. */
export function isSupportedOrigin(value: string): boolean {
  const normalized = value.trim().toUpperCase()
  const lower = value.trim().toLowerCase()
  return ORIGINS.some(origin => origin.iata === normalized
    || origin.city === value.trim()
    || origin.enCity.toLowerCase() === lower)
}

/** Destination state is restricted to the server catalog, including aliases such as HND. */
export function isSupportedDestinationIata(value: string): boolean {
  const profile = destinationCatalog.getDestinationProfile as unknown as ((iata: string) => unknown) | undefined
  return Boolean(profile?.(value))
}

export function destinationRegionForIata(iata: string): DestinationRegion | undefined {
  const profile = destinationCatalog.getDestinationProfile as unknown as ((value: string) => { region?: unknown } | undefined) | undefined
  const region = profile?.(iata)?.region
  return region === 'japan' || region === 'schengen' || region === 'visa_free' ? region : undefined
}

export type { DestinationInterest, DestinationRecommendation, DestinationRegion }
