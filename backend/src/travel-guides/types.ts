import type { OpenRouterClient } from '../providers/openrouter/client.js'
import type { SerpTravelGuideResult } from '../providers/serpapi/client.js'
import type { DestinationInterest } from '../destinations/catalog.js'
import type { RoutePick } from '../route-plans/engine.js'
import type { BilingualText } from '../conversation-agent/types.js'

/** The only origins/destinations that can appear in a generated guide. */
export interface TravelGuideRoute {
  kind: RoutePick['kind']
  cities: string[]
  citySeq: string[]
}

export type TravelGuideSourceKind = 'web' | 'catalog' | 'rules'

export interface TravelGuideSource {
  source: TravelGuideSourceKind
  title: string
  url: string
  domain: string
}

export interface TravelGuideItem {
  title: BilingualText
  description: BilingualText
  city: BilingualText
  cityIata: string
  source: TravelGuideSourceKind
  sources: TravelGuideSource[]
}

export interface TravelGuideDay {
  day: number
  city: BilingualText
  cityIata: string
  items: TravelGuideItem[]
}

export interface TravelGuide {
  /** The exact deterministic route for which this guide was generated. */
  route: TravelGuideRoute
  summary: BilingualText
  days: TravelGuideDay[]
  sources: TravelGuideSource[]
  source: TravelGuideSourceKind
  warnings: string[]
}

/** Only verified catalog fields are accepted by the server-side search. */
export interface TravelGuideSearchInput {
  cityIata: string
  interests: readonly DestinationInterest[]
  travelDays: number
}

export interface TravelResearchProvider {
  searchTravelGuide(input: TravelGuideSearchInput): Promise<readonly SerpTravelGuideResult[]>
}

export interface TravelGuideRedis {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>
}

export interface TravelGuideDependencies {
  research?: TravelResearchProvider
  redis?: TravelGuideRedis
  llm?: Pick<OpenRouterClient, 'chat'>
}
