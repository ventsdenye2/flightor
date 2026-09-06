import type { AviationProvider, AirportLookupInput, AirportRoutesInput, FlightStatusInput, ProviderCallOptions, ResolveLocationInput, ScheduleSearchInput } from './provider.js'
import type { AirportRoute, FlightStatus, LocationRef, LocationResolution, ScheduledFlight } from '../types.js'

export interface MockAviationResults {
  resolveLocation?: LocationResolution
  getAirport?: LocationRef
  getAirportRoutes?: AirportRoute[]
  getSchedules?: ScheduledFlight[]
  getFlightStatus?: FlightStatus
}

export interface MockAviationProviderOptions extends MockAviationResults {
  failure?: Error
  failures?: Partial<Record<'resolveLocation' | 'getAirport' | 'getAirportRoutes' | 'getSchedules' | 'getFlightStatus', Error>>
}

export class MockAviationProvider implements AviationProvider {
  readonly name = 'mock-aviation'
  private readonly options: MockAviationProviderOptions
  constructor(options: MockAviationProviderOptions = {}) { this.options = options }
  private fail(method: keyof MockAviationResults): void {
    const error = this.options.failures?.[method] ?? this.options.failure
    if (error) throw error
  }
  async resolveLocation(_input: ResolveLocationInput, _options?: ProviderCallOptions): Promise<LocationResolution> { this.fail('resolveLocation'); return this.options.resolveLocation ?? { matches: [], verification: { status: 'unverified', checkedAt: new Date(0).toISOString(), confidence: 0, sources: [{ provider: this.name }] } } }
  async getAirport(_input: AirportLookupInput, _options?: ProviderCallOptions): Promise<LocationRef | undefined> { this.fail('getAirport'); return this.options.getAirport }
  async getAirportRoutes(_input: AirportRoutesInput, _options?: ProviderCallOptions): Promise<AirportRoute[]> { this.fail('getAirportRoutes'); return this.options.getAirportRoutes ?? [] }
  async getSchedules(_input: ScheduleSearchInput, _options?: ProviderCallOptions): Promise<ScheduledFlight[]> { this.fail('getSchedules'); return this.options.getSchedules ?? [] }
  async getFlightStatus(_input: FlightStatusInput, _options?: ProviderCallOptions): Promise<FlightStatus | undefined> { this.fail('getFlightStatus'); return this.options.getFlightStatus }
}
