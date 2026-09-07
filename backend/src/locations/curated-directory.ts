import type { LocationIdentityDirectory, LocationIdentityPolicy } from './identity.js'

/** The reviewed product aliases currently supported by FlightOR. */
export const CURATED_LOCATION_IDENTITY_DIRECTORY: LocationIdentityDirectory = {
  groups: {
    TYO: { cityCode: 'TYO', representativeAirport: 'NRT' },
    NRT: { cityCode: 'TYO', representativeAirport: 'NRT' },
    HND: { cityCode: 'TYO', representativeAirport: 'NRT' },
    OSA: { cityCode: 'OSA', representativeAirport: 'KIX' },
    KIX: { cityCode: 'OSA', representativeAirport: 'KIX' }
  }
}

export const CURATED_LOCATION_IDENTITY_POLICY: LocationIdentityPolicy = {
  directory: CURATED_LOCATION_IDENTITY_DIRECTORY
}
