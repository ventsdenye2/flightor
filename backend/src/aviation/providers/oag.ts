import type { OagClient } from '../../providers/oag/client.js'
import { normalizeLocation, normalizeSchedule, responseRecords } from '../../providers/oag/normalizers.js'
import { AppError } from '../../lib/errors.js'
import type { AirportRoute, FlightStatus, LocationRef, LocationResolution, ScheduledFlight } from '../types.js'
import type { AviationProvider, AirportLookupInput, AirportRoutesInput, FlightStatusInput, ProviderCallOptions, ResolveLocationInput, ScheduleSearchInput } from './provider.js'

type Client = Pick<OagClient, 'locations' | 'schedules' | 'flightInfo'>
function location(value: ReturnType<typeof normalizeLocation>): LocationRef | undefined {
  if (!value) return undefined
  return { id: value.iata, type: value.type.toLowerCase().includes('city') ? 'city' : 'airport', name: value.name, countryCode: value.countryCode, iata: value.iata, ...(value.cityCode ? { cityCode: value.cityCode } : {}), ...(value.latitude !== null ? { latitude: value.latitude } : {}), ...(value.longitude !== null ? { longitude: value.longitude } : {}), ...(value.timezone ? { timezone: value.timezone } : {}) }
}
function schedule(value: ReturnType<typeof normalizeSchedule>): ScheduledFlight | undefined {
  if (!value) return undefined
  return { id: value.providerKey, originIata: value.origin, destinationIata: value.destination, ...(value.departureLocal ? { departureLocal: value.departureLocal } : {}), ...(value.arrivalLocal ? { arrivalLocal: value.arrivalLocal } : {}), ...(value.marketingCarrierCode ? { marketingCarrier: value.marketingCarrierCode } : {}), ...(value.operatingCarrierCode ? { operatingCarrier: value.operatingCarrierCode } : {}), ...(value.flightNumber ? { flightNumber: value.flightNumber } : {}) }
}

export class OagAviationProvider implements AviationProvider {
  readonly name = 'oag'
  constructor(private readonly client: Client) {}
  async resolveLocation(input: ResolveLocationInput, _options?: ProviderCallOptions): Promise<LocationResolution> {
    const query = input.query.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(query)) throw new AppError('PROVIDER_CAPABILITY_UNAVAILABLE', 'OAG location search only supports IATA lookup', 501)
    const response = await this.client.locations({ airportCode: query, ...(input.limit !== undefined ? { limit: input.limit } : {}) })
    const matches = responseRecords(response).map(item => location(normalizeLocation(item))).filter((item): item is LocationRef => Boolean(item)).slice(0, input.limit ?? 20)
    const now = new Date().toISOString()
    return { matches, verification: { status: matches.length ? 'verified' : 'unverified', checkedAt: now, confidence: matches.length ? 0.9 : 0, sources: [{ provider: this.name, reference: query }] } }
  }
  async getAirport(input: AirportLookupInput): Promise<LocationRef | undefined> {
    const response = await this.client.locations({ airportCode: input.iata, limit: 1 })
    return responseRecords(response).map(item => location(normalizeLocation(item))).find((item): item is LocationRef => Boolean(item))
  }
  async getAirportRoutes(_input: AirportRoutesInput): Promise<AirportRoute[]> { throw new AppError('PROVIDER_CAPABILITY_UNAVAILABLE', 'OAG airport route capability is not mapped', 501) }
  async getSchedules(input: ScheduleSearchInput): Promise<ScheduledFlight[]> {
    const response = await this.client.schedules({ origin: input.origin, destination: input.destination, dateFrom: input.dateFrom, ...(input.dateTo ? { dateTo: input.dateTo } : {}) })
    return responseRecords(response).map(item => schedule(normalizeSchedule(item, { origin: input.origin, destination: input.destination, date: input.dateFrom }))).filter((item): item is ScheduledFlight => Boolean(item))
  }
  async getFlightStatus(input: FlightStatusInput): Promise<FlightStatus | undefined> {
    const response = await this.client.flightInfo(input)
    const item = responseRecords(response).map(value => schedule(normalizeSchedule(value, { origin: input.origin, destination: input.destination, date: input.date }))).find((value): value is ScheduledFlight => Boolean(value))
    if (!item) return undefined
    return { id: item.id, status: 'scheduled', originIata: item.originIata, destinationIata: item.destinationIata, ...(item.departureLocal ? { scheduledDeparture: item.departureLocal } : {}), ...(item.arrivalLocal ? { scheduledArrival: item.arrivalLocal } : {}), updatedAt: new Date().toISOString() }
  }
}

export { OagAviationProvider as OagProvider }
