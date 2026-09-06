import type {
  AirportRoute,
  FlightStatus,
  LocationRef,
  LocationResolution,
  ScheduledFlight
} from '../types.js'

export interface ProviderCallOptions {
  signal?: AbortSignal
}

export interface ResolveLocationInput {
  query: string
  types?: Array<'city' | 'airport'>
  limit?: number
}

export interface AirportLookupInput {
  iata: string
}

export interface AirportRoutesInput {
  origin: string
  date?: string
}

export interface ScheduleSearchInput {
  origin: string
  destination: string
  dateFrom: string
  dateTo?: string
}

export interface FlightStatusInput {
  carrierCode?: string
  flightNumber?: string
  date?: string
  origin?: string
  destination?: string
}

export interface AviationProvider {
  readonly name: string
  resolveLocation(input: ResolveLocationInput, options?: ProviderCallOptions): Promise<LocationResolution>
  getAirport(input: AirportLookupInput, options?: ProviderCallOptions): Promise<LocationRef | undefined>
  getAirportRoutes(input: AirportRoutesInput, options?: ProviderCallOptions): Promise<AirportRoute[]>
  getSchedules(input: ScheduleSearchInput, options?: ProviderCallOptions): Promise<ScheduledFlight[]>
  getFlightStatus(input: FlightStatusInput, options?: ProviderCallOptions): Promise<FlightStatus | undefined>
}
