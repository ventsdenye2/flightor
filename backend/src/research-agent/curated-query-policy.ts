import { CURATED_LOCATION_IDENTITY_POLICY } from '../locations/curated-directory.js'
import { CuratedResearchQueryPolicy } from './query-policy.js'

/** Reviewed product data; adapters consume this through ResearchQueryPolicy. */
export const CURATED_RESEARCH_QUERY_POLICY = new CuratedResearchQueryPolicy([
  {
    countryCode: 'JP',
    cityCode: 'TYO',
    domains: ['gotokyo.org', 'japan.travel'],
    warning: 'research_uses_curated_public_tourism_sources'
  }
], CURATED_LOCATION_IDENTITY_POLICY)
