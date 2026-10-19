import { z } from 'zod';

export const searchInputSchema = z.object({
  origin: z.string().min(2).max(100).describe('City/airport code or supported city name, e.g. BJS, PEK, PKX, 北京'),
  destination: z.string().min(2).max(100).describe('City/airport code or supported city name, e.g. LIS, 里斯本'),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Explicit year and local departure date YYYY-MM-DD'),
  adults: z.literal(1).default(1).describe('Version 0.1 supports exactly one adult'),
  cabin: z.literal('economy').default('economy'),
  currency: z.enum(['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'SGD']).default('USD'),
  maxResults: z.number().int().min(1).max(5).default(3),
}).strict();
export type SearchInput = z.input<typeof searchInputSchema>;
export type SearchQuery = z.output<typeof searchInputSchema>;
export const detailsInputSchema = z.object({ searchId: z.string().uuid(), candidateId: z.string().regex(/^[a-f0-9]{16}$/) }).strict();
export type DetailsInput = z.infer<typeof detailsInputSchema>;

export interface Location { code: string; name: string; aliases: string[]; airports: string[]; timeZone: string; kind: 'city'|'airport' }
export interface Money { amount: number; currency: SearchQuery['currency']; basis: 'per_adult'; checkoutVerified: false }
export interface Segment {
  airline: string | null; flightNumber: string; origin: string; destination: string;
  departureLocal: string | null; arrivalLocal: string | null;
  departureTimeZone: string | null; arrivalTimeZone: string | null;
  durationMinutes: number | null;
}
export interface Connection {
  city: string; durationMinutes: number | null; selfTransfer: boolean | null;
  airportChange: boolean | null; collectAndRecheckBaggage: boolean | null;
}
export interface FlightDetails {
  observedAt: string; segments: Segment[]; connections: Connection[];
  baggage: { carryOn: string | null; checked: string | null };
  warnings: string[]; rawTextPath: string; screenshotPath: string;
}
export interface Candidate {
  id: string; price: Money; airlines: string[]; departureAirport: string; arrivalAirport: string;
  departureLocal: string; arrivalLocal: string; durationMinutes: number | null;
  stopCount: number | null; summaryText: string; details: FlightDetails | null;
}
export interface SearchResult {
  schemaVersion: 1; searchId: string; status: 'complete' | 'partial' | 'no_results';
  source: 'Trip.com'; quoteType: 'search_quote'; query: SearchQuery;
  resolved: { origin: Location; destination: Location }; observedAt: string;
  sourceUrl: string; sort: 'cheapest'; providerResultCount: number | null;
  coverage: 'provider_sorted_results' | 'unknown'; lowestPriceVerified: boolean;
  attempts: number; candidates: Candidate[]; warnings: string[];
  evidence: { screenshotPath: string; rawTextPath: string; resultPath: string };
}
export interface ToolFailure {
  status: 'error' | 'needs_user_action' | 'cancelled'; code: string;
  message: string; retryable: boolean; attempts: number;
  evidence?: { screenshotPath?: string; rawTextPath?: string };
}
