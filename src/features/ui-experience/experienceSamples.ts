// Preview composition lives outside product components. Replace these values at
// the application boundary when a real data adapter is ready.
import { lisbonTrip, kyotoTrip, partialTrip, emptyTrip, complexTrip } from './sampleTrips'
import { defaultFlightDataset, kyotoFlightDataset, emptyFlightDataset } from './flightSamples'
import { exploreItems, kyotoExploreItems } from './exploreSamples'
import type { TripPresentation } from './presentation'
import type { FlightSearchDataset } from './flightSamples'
import type { ExploreItem } from './exploreSamples'

export interface ExperienceSample {
  id: string
  label: string
  trip: TripPresentation
  searchDataset: FlightSearchDataset
  exploreItems: ExploreItem[]
  imageError?: boolean
}
export const experienceSamples: ExperienceSample[] = [
  { id: 'lisbon', label: '里斯本 7 天', trip: lisbonTrip, searchDataset: defaultFlightDataset, exploreItems },
  { id: 'kyoto', label: '京都 3 天', trip: kyotoTrip, searchDataset: kyotoFlightDataset, exploreItems: kyotoExploreItems },
  { id: 'partial', label: '部分结果', trip: partialTrip, searchDataset: defaultFlightDataset, exploreItems },
  { id: 'empty', label: '等待补充', trip: emptyTrip, searchDataset: emptyFlightDataset, exploreItems: [] },
  { id: 'complex', label: '复杂中转', trip: complexTrip, searchDataset: defaultFlightDataset, exploreItems },
  { id: 'image-error', label: '图片失败', trip: lisbonTrip, searchDataset: defaultFlightDataset, exploreItems, imageError: true },
]
