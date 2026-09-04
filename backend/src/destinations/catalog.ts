/**
 * A small, reviewable destination directory used by deterministic planning.
 *
 * This file intentionally contains only curated destination metadata.  It is
 * not a visa, fare, or flight-status source; those facts must be confirmed by
 * the relevant provider before a booking decision is made.
 */

export type DestinationRegion = 'japan' | 'schengen' | 'visa_free'

export type DestinationInterest = 'culture' | 'food' | 'nature' | 'shopping' | 'nightlife'

export type DestinationCostTier = 1 | 2 | 3 | 4

export interface DestinationProfile {
  /** The airport code used when building a route. */
  iata: string
  cityZh: string
  cityEn: string
  countryCode: string
  region: DestinationRegion
  tags: DestinationInterest[]
  minStayDays: number
  costTier: DestinationCostTier
  lat: number
  lon: number
  /** Canonical airport/city code for same-city aliases such as HND. */
  canonicalIata?: string
}

export interface DestinationRecommendation {
  iata: string
  cityZh: string
  cityEn: string
  region: DestinationRegion
  reason: {
    zh: string
    en: string
  }
  suggestedDays: number
}

export interface DestinationRecommendationInput {
  regions?: readonly DestinationRegion[]
  interests?: readonly DestinationInterest[]
  excludedIatas?: readonly string[]
  requiredIatas?: readonly string[]
  limit?: number
}

/**
 * The directory order is part of the deterministic tie-break.  Keep additions
 * explicit and reviewable rather than deriving cities from country names.
 */
export const DESTINATION_PROFILES: readonly DestinationProfile[] = [
  // Japan.  HND is deliberately represented as an alias profile so an
  // explicit HND request is preserved while recommendations remain city-level.
  {
    iata: 'NRT',
    cityZh: '东京',
    cityEn: 'Tokyo',
    countryCode: 'JP',
    region: 'japan',
    tags: ['culture', 'food', 'shopping', 'nightlife', 'nature'],
    minStayDays: 3,
    costTier: 3,
    lat: 35.772,
    lon: 140.3929
  },
  {
    iata: 'HND',
    cityZh: '东京',
    cityEn: 'Tokyo',
    countryCode: 'JP',
    region: 'japan',
    tags: ['culture', 'food', 'shopping', 'nightlife', 'nature'],
    minStayDays: 3,
    costTier: 3,
    lat: 35.5494,
    lon: 139.7798,
    canonicalIata: 'NRT'
  },
  {
    iata: 'KIX',
    cityZh: '大阪',
    cityEn: 'Osaka',
    countryCode: 'JP',
    region: 'japan',
    tags: ['food', 'culture', 'shopping', 'nightlife', 'nature'],
    minStayDays: 2,
    costTier: 2,
    lat: 34.4347,
    lon: 135.244
  },

  // Schengen directory (the same bounded set used by the existing planner).
  {
    iata: 'CDG',
    cityZh: '巴黎',
    cityEn: 'Paris',
    countryCode: 'FR',
    region: 'schengen',
    tags: ['culture', 'food', 'shopping', 'nightlife'],
    minStayDays: 3,
    costTier: 3,
    lat: 49.0097,
    lon: 2.5479
  },
  {
    iata: 'AMS',
    cityZh: '阿姆斯特丹',
    cityEn: 'Amsterdam',
    countryCode: 'NL',
    region: 'schengen',
    tags: ['culture', 'food', 'nature', 'nightlife'],
    minStayDays: 2,
    costTier: 3,
    lat: 52.3105,
    lon: 4.7683
  },
  {
    iata: 'FRA',
    cityZh: '法兰克福',
    cityEn: 'Frankfurt',
    countryCode: 'DE',
    region: 'schengen',
    tags: ['culture', 'food', 'shopping'],
    minStayDays: 2,
    costTier: 2,
    lat: 50.0379,
    lon: 8.5622
  },
  {
    iata: 'MUC',
    cityZh: '慕尼黑',
    cityEn: 'Munich',
    countryCode: 'DE',
    region: 'schengen',
    tags: ['culture', 'food', 'nature'],
    minStayDays: 2,
    costTier: 2,
    lat: 48.3538,
    lon: 11.7861
  },
  {
    iata: 'ZRH',
    cityZh: '苏黎世',
    cityEn: 'Zurich',
    countryCode: 'CH',
    region: 'schengen',
    tags: ['nature', 'shopping', 'food'],
    minStayDays: 2,
    costTier: 4,
    lat: 47.4582,
    lon: 8.5556
  },
  {
    iata: 'VIE',
    cityZh: '维也纳',
    cityEn: 'Vienna',
    countryCode: 'AT',
    region: 'schengen',
    tags: ['culture', 'food', 'nightlife'],
    minStayDays: 2,
    costTier: 2,
    lat: 48.1103,
    lon: 16.5697
  },
  {
    iata: 'PRG',
    cityZh: '布拉格',
    cityEn: 'Prague',
    countryCode: 'CZ',
    region: 'schengen',
    tags: ['culture', 'food', 'nightlife'],
    minStayDays: 2,
    costTier: 2,
    lat: 50.1008,
    lon: 14.26
  },
  {
    iata: 'FCO',
    cityZh: '罗马',
    cityEn: 'Rome',
    countryCode: 'IT',
    region: 'schengen',
    tags: ['culture', 'food', 'nightlife'],
    minStayDays: 3,
    costTier: 3,
    lat: 41.8003,
    lon: 12.2389
  },
  {
    iata: 'MXP',
    cityZh: '米兰',
    cityEn: 'Milan',
    countryCode: 'IT',
    region: 'schengen',
    tags: ['shopping', 'food', 'culture', 'nightlife'],
    minStayDays: 2,
    costTier: 3,
    lat: 45.6306,
    lon: 8.7283
  },
  {
    iata: 'BCN',
    cityZh: '巴塞罗那',
    cityEn: 'Barcelona',
    countryCode: 'ES',
    region: 'schengen',
    tags: ['culture', 'food', 'nightlife', 'nature'],
    minStayDays: 3,
    costTier: 3,
    lat: 41.2974,
    lon: 2.0833
  },
  {
    iata: 'MAD',
    cityZh: '马德里',
    cityEn: 'Madrid',
    countryCode: 'ES',
    region: 'schengen',
    tags: ['culture', 'food', 'nightlife', 'shopping'],
    minStayDays: 2,
    costTier: 2,
    lat: 40.4983,
    lon: -3.5676
  },
  {
    iata: 'LIS',
    cityZh: '里斯本',
    cityEn: 'Lisbon',
    countryCode: 'PT',
    region: 'schengen',
    tags: ['culture', 'food', 'nature', 'nightlife'],
    minStayDays: 3,
    costTier: 2,
    lat: 38.7742,
    lon: -9.1342
  },
  {
    iata: 'ATH',
    cityZh: '雅典',
    cityEn: 'Athens',
    countryCode: 'GR',
    region: 'schengen',
    tags: ['culture', 'nature', 'food', 'nightlife'],
    minStayDays: 3,
    costTier: 2,
    lat: 37.9364,
    lon: 23.9445
  },
  {
    iata: 'BUD',
    cityZh: '布达佩斯',
    cityEn: 'Budapest',
    countryCode: 'HU',
    region: 'schengen',
    tags: ['culture', 'nightlife', 'food'],
    minStayDays: 2,
    costTier: 2,
    lat: 47.4372,
    lon: 19.2556
  },
  {
    iata: 'CPH',
    cityZh: '哥本哈根',
    cityEn: 'Copenhagen',
    countryCode: 'DK',
    region: 'schengen',
    tags: ['culture', 'food', 'nature', 'shopping'],
    minStayDays: 2,
    costTier: 3,
    lat: 55.618,
    lon: 12.656
  },
  {
    iata: 'HEL',
    cityZh: '赫尔辛基',
    cityEn: 'Helsinki',
    countryCode: 'FI',
    region: 'schengen',
    tags: ['nature', 'culture', 'shopping', 'food'],
    minStayDays: 2,
    costTier: 3,
    lat: 60.3172,
    lon: 24.9633
  },

  // Existing bounded visa-free/landing-visa candidate directory.
  {
    iata: 'BKK',
    cityZh: '曼谷',
    cityEn: 'Bangkok',
    countryCode: 'TH',
    region: 'visa_free',
    tags: ['food', 'culture', 'shopping', 'nightlife'],
    minStayDays: 3,
    costTier: 1,
    lat: 13.69,
    lon: 100.7501
  },
  {
    iata: 'KUL',
    cityZh: '吉隆坡',
    cityEn: 'Kuala Lumpur',
    countryCode: 'MY',
    region: 'visa_free',
    tags: ['food', 'shopping', 'culture', 'nature'],
    minStayDays: 2,
    costTier: 1,
    lat: 2.7456,
    lon: 101.7099
  },
  {
    iata: 'SIN',
    cityZh: '新加坡',
    cityEn: 'Singapore',
    countryCode: 'SG',
    region: 'visa_free',
    tags: ['food', 'shopping', 'nature', 'culture'],
    minStayDays: 3,
    costTier: 3,
    lat: 1.3644,
    lon: 103.9915
  },
  {
    iata: 'HAN',
    cityZh: '河内',
    cityEn: 'Hanoi',
    countryCode: 'VN',
    region: 'visa_free',
    tags: ['food', 'culture', 'nature'],
    minStayDays: 2,
    costTier: 1,
    lat: 21.2212,
    lon: 105.807
  },
  {
    iata: 'SGN',
    cityZh: '胡志明市',
    cityEn: 'Ho Chi Minh City',
    countryCode: 'VN',
    region: 'visa_free',
    tags: ['food', 'culture', 'nightlife', 'shopping'],
    minStayDays: 2,
    costTier: 1,
    lat: 10.8108,
    lon: 106.6519
  },
  {
    iata: 'DPS',
    cityZh: '巴厘岛',
    cityEn: 'Bali',
    countryCode: 'ID',
    region: 'visa_free',
    tags: ['nature', 'food', 'culture'],
    minStayDays: 4,
    costTier: 2,
    lat: -8.7482,
    lon: 115.1672
  },
  {
    iata: 'BEG',
    cityZh: '贝尔格莱德',
    cityEn: 'Belgrade',
    countryCode: 'RS',
    region: 'visa_free',
    tags: ['culture', 'nightlife', 'food'],
    minStayDays: 2,
    costTier: 1,
    lat: 44.8182,
    lon: 20.3091
  },
  {
    iata: 'IST',
    cityZh: '伊斯坦布尔',
    cityEn: 'Istanbul',
    countryCode: 'TR',
    region: 'visa_free',
    tags: ['culture', 'food', 'shopping', 'nightlife'],
    minStayDays: 3,
    costTier: 2,
    lat: 41.2753,
    lon: 28.7519
  },
  {
    iata: 'CJU',
    cityZh: '济州岛',
    cityEn: 'Jeju',
    countryCode: 'KR',
    region: 'visa_free',
    tags: ['nature', 'food'],
    minStayDays: 3,
    costTier: 2,
    lat: 33.5113,
    lon: 126.493
  }
] as const

const profileOrder = new Map<string, number>(DESTINATION_PROFILES.map((profile, index) => [profile.iata, index]))
const CATALOG_REGIONS: readonly DestinationRegion[] = ['japan', 'schengen', 'visa_free']

function canonicalIata(profile: DestinationProfile): string {
  return profile.canonicalIata ?? profile.iata
}

function normalizedIata(value: string): string {
  return value.trim().toUpperCase()
}

function profileForIata(value: string): DestinationProfile | undefined {
  const iata = normalizedIata(value)
  return DESTINATION_PROFILES.find(profile => profile.iata === iata || canonicalIata(profile) === iata)
}

function uniqueRegions(values: readonly DestinationRegion[]): DestinationRegion[] {
  const seen = new Set<DestinationRegion>()
  const result: DestinationRegion[] = []
  for (const value of values) {
    if (!CATALOG_REGIONS.includes(value) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function iataTokenIndex(text: string, iata: string): number {
  const escaped = iata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'i').exec(text)
  return match?.index ?? -1
}

function cityTokenIndex(text: string, profile: DestinationProfile): number {
  const zhIndex = text.indexOf(profile.cityZh)
  const enMatch = new RegExp(`(?:^|[^A-Za-z])${profile.cityEn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z])`, 'i').exec(text)
  const enIndex = enMatch?.index ?? -1
  if (zhIndex < 0) return enIndex
  if (enIndex < 0) return zhIndex
  return Math.min(zhIndex, enIndex)
}

/**
 * Resolve only names and airport codes present in the directory.
 *
 * Country names are intentionally absent from the matching vocabulary: a
 * mention of “日本/Japan” does not silently become Tokyo or Osaka.
 */
export function resolveDestinationMentions(text: string): DestinationProfile[] {
  const candidates: Array<{ profile: DestinationProfile; index: number; specificity: number; order: number }> = []
  for (const profile of DESTINATION_PROFILES) {
    const codeIndex = iataTokenIndex(text, profile.iata)
    const cityIndex = cityTokenIndex(text, profile)
    if (codeIndex >= 0) {
      candidates.push({ profile, index: cityIndex >= 0 ? Math.min(codeIndex, cityIndex) : codeIndex, specificity: 2, order: profileOrder.get(profile.iata) ?? 0 })
    } else if (cityIndex >= 0) {
      candidates.push({ profile, index: cityIndex, specificity: 1, order: profileOrder.get(profile.iata) ?? 0 })
    }
  }

  const byCity = new Map<string, (typeof candidates)[number]>()
  for (const candidate of candidates) {
    const key = canonicalIata(candidate.profile)
    const previous = byCity.get(key)
    if (!previous
      || candidate.specificity > previous.specificity
      || (candidate.specificity === previous.specificity && candidate.index < previous.index)
      || (candidate.specificity === previous.specificity && candidate.index === previous.index && candidate.order < previous.order)) {
      byCity.set(key, candidate)
    }
  }

  return [...byCity.values()]
    .sort((left, right) => left.index - right.index || left.order - right.order)
    .map(item => item.profile)
}

const INTEREST_LABELS: Record<DestinationInterest, { zh: string; en: string }> = {
  culture: { zh: '文化', en: 'culture' },
  food: { zh: '美食', en: 'food' },
  nature: { zh: '自然', en: 'nature' },
  shopping: { zh: '购物', en: 'shopping' },
  nightlife: { zh: '夜生活', en: 'nightlife' }
}

const REGION_LABELS: Record<DestinationRegion, { zh: string; en: string }> = {
  japan: { zh: '日本目录', en: 'Japan directory' },
  schengen: { zh: '申根目录', en: 'Schengen directory' },
  visa_free: { zh: '免签候选目录', en: 'visa-free candidate directory' }
}

function reasonFor(profile: DestinationProfile, interests: readonly DestinationInterest[]): { zh: string; en: string } {
  const matched = interests.filter(interest => profile.tags.includes(interest))
  if (matched.length === 0) {
    const region = REGION_LABELS[profile.region]
    return {
      zh: `来自${region.zh}，建议至少停留 ${profile.minStayDays} 天。`,
      en: `From the ${region.en}; plan at least ${profile.minStayDays} days.`
    }
  }
  const zhInterests = matched.map(interest => INTEREST_LABELS[interest].zh).join('、')
  const enInterests = matched.map(interest => INTEREST_LABELS[interest].en).join(', ')
  return {
    zh: `匹配${zhInterests}偏好，建议至少停留 ${profile.minStayDays} 天。`,
    en: `Matches your ${enInterests} preference${matched.length > 1 ? 's' : ''}; plan at least ${profile.minStayDays} days.`
  }
}

function recommendationFor(profile: DestinationProfile, interests: readonly DestinationInterest[]): DestinationRecommendation {
  return {
    iata: profile.iata,
    cityZh: profile.cityZh,
    cityEn: profile.cityEn,
    region: profile.region,
    reason: reasonFor(profile, interests),
    suggestedDays: profile.minStayDays
  }
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(50, Math.floor(value)))
}

function interestScore(profile: DestinationProfile, interests: readonly DestinationInterest[]): number {
  return interests.reduce((score, interest) => score + (profile.tags.includes(interest) ? 1 : 0), 0)
}

function preferenceCompare(
  left: DestinationProfile,
  right: DestinationProfile,
  interests: readonly DestinationInterest[],
  requiredKeys: ReadonlySet<string>,
  includeCost: boolean
): number {
  const leftRequired = requiredKeys.has(canonicalIata(left)) ? 1 : 0
  const rightRequired = requiredKeys.has(canonicalIata(right)) ? 1 : 0
  if (leftRequired !== rightRequired) return rightRequired - leftRequired
  const leftScore = interestScore(left, interests)
  const rightScore = interestScore(right, interests)
  if (leftScore !== rightScore) return rightScore - leftScore
  if (includeCost && left.costTier !== right.costTier) return left.costTier - right.costTier
  const leftOrder = profileOrder.get(left.iata) ?? Number.MAX_SAFE_INTEGER
  const rightOrder = profileOrder.get(right.iata) ?? Number.MAX_SAFE_INTEGER
  return leftOrder - rightOrder || left.iata.localeCompare(right.iata)
}

/**
 * Rank a deterministic, directory-only destination set.
 *
 * Required cities are placed first and are never replaced by an alias for a
 * different airport.  Same-city aliases are still de-duplicated by canonical
 * city code, so Tokyo appears once unless a caller explicitly resolves HND.
 */
export function recommendDestinations(input: DestinationRecommendationInput = {}): DestinationRecommendation[] {
  const interests = [...new Set(input.interests ?? [])]
  const excluded = new Set<string>()
  for (const value of input.excludedIatas ?? []) {
    const profile = profileForIata(value)
    if (profile) excluded.add(canonicalIata(profile))
  }

  const explicitRegions = uniqueRegions(input.regions ?? [])
  const requiredRegionOrder: DestinationRegion[] = []
  const requiredRegionSeen = new Set<DestinationRegion>()
  for (const value of input.requiredIatas ?? []) {
    const profile = profileForIata(value)
    if (!profile || excluded.has(canonicalIata(profile)) || requiredRegionSeen.has(profile.region)) continue
    requiredRegionSeen.add(profile.region)
    requiredRegionOrder.push(profile.region)
  }

  let regions: DestinationRegion[]
  if (explicitRegions.length > 0) {
    regions = explicitRegions
  } else if (requiredRegionOrder.length > 0) {
    regions = requiredRegionOrder
  } else {
    // An omitted/empty region is a recommendation request, not permission to
    // mix every region into one itinerary.  Use the first available directory
    // city after interest ranking as one stable preferred region.
    const preferred = DESTINATION_PROFILES
      .filter(profile => !excluded.has(canonicalIata(profile)))
      .reduce<DestinationProfile | undefined>((best, profile) => {
        if (!best || preferenceCompare(profile, best, interests, new Set(), false) < 0) return profile
        return best
      }, undefined)
    regions = preferred ? [preferred.region] : []
  }
  const regionSet = new Set<DestinationRegion>(regions)

  const required: DestinationProfile[] = []
  const requiredKeys = new Set<string>()
  for (const value of input.requiredIatas ?? []) {
    const profile = profileForIata(value)
    if (!profile || !regionSet.has(profile.region)) continue
    const key = canonicalIata(profile)
    if (excluded.has(key) || requiredKeys.has(key)) continue
    required.push(profile)
    requiredKeys.add(key)
  }

  const available = DESTINATION_PROFILES.filter(profile => regionSet.has(profile.region) && !excluded.has(canonicalIata(profile)))
  const byCity = new Map<string, DestinationProfile>()
  for (const profile of required) byCity.set(canonicalIata(profile), profile)
  for (const profile of available) {
    const key = canonicalIata(profile)
    if (!byCity.has(key)) byCity.set(key, profile)
  }

  const ranked = [...byCity.values()].sort((left, right) => preferenceCompare(left, right, interests, requiredKeys, true))

  const defaultLimit = 8
  // Required destinations are hard constraints.  If a caller supplies a
  // smaller limit, expand just enough to retain all valid required cities.
  const requestedLimit = boundedLimit(input.limit, defaultLimit)
  const needsCoverage = explicitRegions.length > 1 && requestedLimit >= explicitRegions.length
  const coverage: DestinationProfile[] = []
  if (needsCoverage) {
    for (const region of explicitRegions) {
      const bestForRegion = [...byCity.values()]
        .filter(profile => profile.region === region)
        .sort((left, right) => preferenceCompare(left, right, interests, requiredKeys, true))[0]
      if (bestForRegion) coverage.push(bestForRegion)
    }
  }
  const protectedKeys = new Set<string>([
    ...required.map(profile => canonicalIata(profile)),
    ...coverage.map(profile => canonicalIata(profile))
  ])
  const protectedProfiles = ranked.filter(profile => protectedKeys.has(canonicalIata(profile)))
  const fill = ranked.filter(profile => !protectedKeys.has(canonicalIata(profile)))
  const limit = Math.max(requestedLimit, required.length, protectedProfiles.length)
  return [...protectedProfiles, ...fill.slice(0, Math.max(0, limit - protectedProfiles.length))]
    .map(profile => recommendationFor(profile, interests))
}

/** Resolve a directory profile by IATA while preserving same-city aliases. */
export function getDestinationProfile(iata: string): DestinationProfile | undefined {
  const normalized = normalizedIata(iata)
  return DESTINATION_PROFILES.find(profile => profile.iata === normalized)
}

/** Return the city-level canonical key used for alias de-duplication. */
export function getCanonicalDestinationIata(iata: string): string | undefined {
  const profile = getDestinationProfile(iata)
  return profile ? canonicalIata(profile) : undefined
}
