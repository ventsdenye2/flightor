import type { DestinationRecommendation } from '../destinations/catalog.js'
import type { RoutePick } from '../route-plans/engine.js'
import type { TripState } from './schema.js'
import type { TravelGuide } from '../travel-guides/types.js'

export type { DestinationRecommendation, RoutePick }

export interface BilingualText {
  zh: string
  en: string
}

export interface SuggestedAction {
  id: string
  label: BilingualText
  message: string
}

export interface ConversationResponse {
  phase: 'discover' | 'clarify' | 'plan'
  reply: BilingualText
  state: TripState
  recommendations: DestinationRecommendation[]
  routes: RoutePick[]
  missing: string[]
  suggestedActions: SuggestedAction[]
  source: 'llm' | 'rules'
  warnings: string[]
  /** Present only when the latest user turn explicitly requested a guide. */
  travelGuide?: TravelGuide
}
