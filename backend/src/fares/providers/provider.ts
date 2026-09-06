import type { ProviderCallOptions } from '../../aviation/providers/provider.js'
import type { FareSearchInput, FareSearchResult } from '../types.js'

export interface FlexibleFareSearchInput extends Omit<FareSearchInput, 'departureDate'> {
  departureDateFrom: string
  departureDateTo: string
}

export interface RefreshFareInput {
  offerId: string
  query: FareSearchInput
}

export interface FareProvider {
  readonly name: string
  searchFlights(input: FareSearchInput, options?: ProviderCallOptions): Promise<FareSearchResult>
  searchFlexibleFlights(input: FlexibleFareSearchInput, options?: ProviderCallOptions): Promise<FareSearchResult[]>
  refreshFlight(input: RefreshFareInput, options?: ProviderCallOptions): Promise<FareSearchResult>
}
