import type { ProviderCallOptions } from '../../aviation/providers/provider.js'
import type { FareSearchInput, FareSearchResult } from '../types.js'
import type { FareProvider, FlexibleFareSearchInput, RefreshFareInput } from './provider.js'

export interface MockFareProviderOptions {
  search?: FareSearchResult
  flexible?: FareSearchResult[]
  refresh?: FareSearchResult
  failure?: Error
  failures?: Partial<Record<'search' | 'flexible' | 'refresh', Error>>
}

export class MockFareProvider implements FareProvider {
  readonly name = 'mock-fares'
  constructor(private readonly options: MockFareProviderOptions = {}) {}
  private fail(method: 'search' | 'flexible' | 'refresh'): void { const error = this.options.failures?.[method] ?? this.options.failure; if (error) throw error }
  async searchFlights(_input: FareSearchInput, _options?: ProviderCallOptions): Promise<FareSearchResult> { this.fail('search'); if (!this.options.search) throw new Error('Mock search result is not configured'); return this.options.search }
  async searchFlexibleFlights(_input: FlexibleFareSearchInput, _options?: ProviderCallOptions): Promise<FareSearchResult[]> { this.fail('flexible'); return this.options.flexible ?? [] }
  async refreshFlight(_input: RefreshFareInput, _options?: ProviderCallOptions): Promise<FareSearchResult> { this.fail('refresh'); if (!this.options.refresh) throw new Error('Mock refresh result is not configured'); return this.options.refresh }
}
