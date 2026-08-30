import type { AppEnv } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { fetchJson, withQuery } from '../../lib/http.js'

export interface SerpFlightSearch {
  origin: string
  destination: string
  departDate: string
  returnDate?: string
  currency?: string
  travelClass?: number
}

export class SerpApiClient {
  constructor(private readonly config: AppEnv) {}

  async searchFlights(input: SerpFlightSearch): Promise<Record<string, unknown>> {
    if (!this.config.SERPAPI_KEY) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'SerpApi is not configured', 503)
    }
    const url = withQuery(this.config.SERPAPI_BASE_URL, '', {
      engine: 'google_flights',
      departure_id: input.origin.toUpperCase(),
      arrival_id: input.destination.toUpperCase(),
      outbound_date: input.departDate,
      return_date: input.returnDate,
      type: input.returnDate ? 1 : 2,
      travel_class: input.travelClass ?? 1,
      currency: input.currency ?? 'CNY',
      hl: 'zh-cn',
      api_key: this.config.SERPAPI_KEY
    })
    return fetchJson<Record<string, unknown>>(url, { method: 'GET' }, { provider: 'serpapi', timeoutMs: 30_000 })
  }
}
