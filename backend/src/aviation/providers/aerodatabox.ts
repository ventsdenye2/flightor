import { AppError } from '../../lib/errors.js'
import type { AirportRoute, FlightStatus, LocationRef, LocationResolution, ScheduledFlight } from '../types.js'
import type { AviationProvider, AirportLookupInput, AirportRoutesInput, FlightStatusInput, ProviderCallOptions, ResolveLocationInput, ScheduleSearchInput } from './provider.js'

export interface AeroDataBoxConfig {
  AERODATABOX_API_KEY?: string
  AERODATABOX_BASE_URL?: string
}

/** Configuration-safe shell until AeroDataBox endpoint mappings are approved. */
export class AeroDataBoxProvider implements AviationProvider {
  readonly name = 'aerodatabox'
  constructor(private readonly config: AeroDataBoxConfig) {}
  private unavailable(): never {
    if (!this.config.AERODATABOX_API_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', 'AeroDataBox is not configured', 503)
    throw new AppError('PROVIDER_CAPABILITY_UNAVAILABLE', 'AeroDataBox capability is not mapped yet', 501, { provider: this.name })
  }
  async resolveLocation(_input: ResolveLocationInput, _options?: ProviderCallOptions): Promise<LocationResolution> { return this.unavailable() }
  async getAirport(_input: AirportLookupInput, _options?: ProviderCallOptions): Promise<LocationRef | undefined> { return this.unavailable() }
  async getAirportRoutes(_input: AirportRoutesInput, _options?: ProviderCallOptions): Promise<AirportRoute[]> { return this.unavailable() }
  async getSchedules(_input: ScheduleSearchInput, _options?: ProviderCallOptions): Promise<ScheduledFlight[]> { return this.unavailable() }
  async getFlightStatus(_input: FlightStatusInput, _options?: ProviderCallOptions): Promise<FlightStatus | undefined> { return this.unavailable() }
}
