import type { ProviderCallOptions } from '../../aviation/providers/provider.js'
import { AppError } from '../../lib/errors.js'
import type { SerpApiClient, SerpFlightSearch } from '../../providers/serpapi/client.js'
import { itinerariesFromSerpResponse, sampleDates, type FlightOption } from '../../search/serpapi.js'
import type { FareOffer, FareSearchInput, FareSearchResult } from '../types.js'
import type { FareProvider, FlexibleFareSearchInput, RefreshFareInput } from './provider.js'

type Client = Pick<SerpApiClient, 'searchFlights'>

function checkedAt(): string { return new Date().toISOString() }

function offer(option: FlightOption, currency: string): FareOffer {
  return {
    id: option.id,
    segments: option.segments.map(segment => ({
      flightNumber: segment.flightNo,
      airline: segment.airline,
      origin: segment.origin,
      destination: segment.destination,
      departsAt: segment.departTime,
      arrivesAt: segment.arriveTime,
      durationMinutes: Math.max(0, Math.trunc(segment.duration)),
      ...(segment.aircraft ? { aircraft: segment.aircraft } : {})
    })),
    totalAmount: option.totalPrice,
    currency: currency.toUpperCase(),
    totalDurationMinutes: Math.max(0, Math.trunc(option.totalDuration)),
    airlines: [...new Set(option.segments.map(segment => segment.airline).filter(Boolean))],
    transferType: option.transferType,
    ...(option.hub ? { baggageRecheck: option.hub.baggageRecheck } : {}),
    bookingUrl: option.deepLink
  }
}

export class SerpApiFareProvider implements FareProvider {
  readonly name = 'serpapi'
  private readonly client: Client
  constructor(client: Client) { this.client = client }

  private async run(input: FareSearchInput, options?: ProviderCallOptions): Promise<FareSearchResult> {
    const query: SerpFlightSearch = {
      origin: input.origin,
      destination: input.destination,
      departDate: input.departureDate,
      ...(input.returnDate ? { returnDate: input.returnDate } : {}),
      currency: input.currency,
      travelClass: input.travelClass
    }
    const raw = await this.client.searchFlights(query, options?.signal)
    const optionsForQuery = itinerariesFromSerpResponse(raw, {
      origin: input.origin,
      destination: input.destination,
      originCandidates: [input.origin],
      destinationCandidates: [input.destination],
      departDate: input.departureDate,
      currency: input.currency
    }, input.departureDate).filter(item => {
      const first = item.segments[0]
      const last = item.segments[item.segments.length - 1]
      return first?.origin === input.origin && last?.destination === input.destination
    })
    const offers = optionsForQuery.map(item => offer(item, input.currency))
    const now = checkedAt()
    return {
      query: input,
      offers,
      provider: this.name,
      checkedAt: now,
      verification: {
        status: offers.length ? 'verified' : 'partially_verified',
        checkedAt: now,
        confidence: offers.length ? 0.9 : 0.4,
        sources: [{ provider: this.name, reference: `${input.origin}-${input.destination}-${input.departureDate}` }]
      }
    }
  }

  searchFlights(input: FareSearchInput, options?: ProviderCallOptions): Promise<FareSearchResult> { return this.run(input, options) }

  async searchFlexibleFlights(input: FlexibleFareSearchInput, options?: ProviderCallOptions): Promise<FareSearchResult[]> {
    const dates = sampleDates(input.departureDateFrom, input.departureDateTo, 4)
    const results = await Promise.all(dates.map(date => this.run({
      origin: input.origin,
      destination: input.destination,
      departureDate: date,
      ...(input.returnDate ? { returnDate: input.returnDate } : {}),
      currency: input.currency,
      travelClass: input.travelClass
    }, options)))
    return results
  }

  async refreshFlight(input: RefreshFareInput, options?: ProviderCallOptions): Promise<FareSearchResult> {
    const result = await this.run(input.query, options)
    if (!result.offers.some(item => item.id === input.offerId)) {
      throw new AppError('FARE_OFFER_UNAVAILABLE', 'The requested fare offer is no longer available', 409, { offerId: input.offerId })
    }
    return result
  }
}
