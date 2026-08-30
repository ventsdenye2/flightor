import type { AppEnv } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson, withQuery } from '../../lib/http.js'

export type OagProduct = 'schedules' | 'connections' | 'locations' | 'flightInfo'

export interface OagPage<T = unknown> {
  data?: T[]
  paging?: Record<string, unknown>
  [key: string]: unknown
}

export class OagClient {
  constructor(private readonly config: AppEnv) {}

  private keyFor(product: OagProduct): string {
    const key = {
      schedules: this.config.OAG_SCHEDULES_KEY,
      connections: this.config.OAG_CONNECTIONS_KEY || this.config.OAG_FLIGHT_INFO_KEY,
      locations: this.config.OAG_MASTER_DATA_KEY,
      flightInfo: this.config.OAG_FLIGHT_INFO_KEY
    }[product]
    if (!key) throw new AppError('PROVIDER_NOT_CONFIGURED', `OAG ${product} is not configured`, 503)
    return key
  }

  private pathFor(product: OagProduct): string {
    return {
      schedules: this.config.OAG_SCHEDULES_PATH,
      connections: this.config.OAG_CONNECTIONS_PATH,
      locations: this.config.OAG_LOCATIONS_PATH,
      flightInfo: this.config.OAG_FLIGHT_INFO_PATH
    }[product]
  }

  async request<T = unknown>(product: OagProduct, params: Record<string, unknown>): Promise<OagPage<T>> {
    const url = withQuery(this.config.OAG_BASE_URL, this.pathFor(product), params)
    return fetchJson<OagPage<T>>(
      url,
      {
        method: 'GET',
        headers: { Accept: 'application/json', 'Subscription-Key': this.keyFor(product) }
      },
      { provider: `oag:${product}`, timeoutMs: 12_000 }
    )
  }

  schedules(params: { origin: string; destination: string; dateFrom: string; dateTo?: string; limit?: number }) {
    const date = params.dateTo && params.dateTo !== params.dateFrom
      ? `${params.dateFrom}/${params.dateTo}`
      : params.dateFrom
    return this.request('schedules', {
      DepartureAirport: params.origin.toUpperCase(),
      ArrivalAirport: params.destination.toUpperCase(),
      DepartureDate: date,
      ServiceType: 'Passenger',
      Limit: Math.min(1000, Math.max(1, params.limit ?? 100))
    })
  }

  connections(params: { origin: string; destination: string; dateFrom: string; dateTo?: string; limit?: number }) {
    return this.request('connections', {
      DepartureAirport: params.origin.toUpperCase(),
      ArrivalAirport: params.destination.toUpperCase(),
      DepartureDate: params.dateFrom,
      ToDate: params.dateTo ?? params.dateFrom,
      Service: 'Passenger',
      Limit: Math.min(1000, Math.max(1, params.limit ?? 100))
    })
  }

  locations(params: { airportCode?: string; countryCode?: string; cityCode?: string; limit?: number }) {
    return this.request('locations', {
      AirportCode: params.airportCode?.toUpperCase(),
      CountryCode: params.countryCode?.toUpperCase(),
      CityCode: params.cityCode?.toUpperCase(),
      CodeType: 'IATA',
      Limit: Math.min(1000, Math.max(1, params.limit ?? 100))
    })
  }

  flightInfo(params: {
    origin?: string
    destination?: string
    date?: string
    carrierCode?: string
    flightNumber?: string
    limit?: number
  }) {
    return this.request('flightInfo', {
      DepartureAirport: params.origin?.toUpperCase(),
      ArrivalAirport: params.destination?.toUpperCase(),
      DepartureDateTime: params.date,
      CarrierCode: params.carrierCode?.toUpperCase(),
      FlightNumber: params.flightNumber,
      FlightType: 'scheduled',
      CodeType: 'IATA',
      version: 'v2',
      Limit: Math.min(100, Math.max(1, params.limit ?? 100))
    })
  }
}
