import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
export type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonColumn = ColumnType<JsonValue, JsonValue | string, JsonValue | string>

export interface CountriesTable {
  code: string
  name_zh: string
  name_en: string
  region: string | null
  is_popular: Generated<boolean>
  popularity_rank: number | null
  active: Generated<boolean>
  created_at: Timestamp
  updated_at: Timestamp
}

export interface CitiesTable {
  id: Generated<string>
  country_code: string
  iata_code: string | null
  name_zh: string
  name_en: string
  latitude: number | null
  longitude: number | null
  timezone: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface AirportsTable {
  id: Generated<string>
  iata_code: string | null
  icao_code: string | null
  city_id: string | null
  country_code: string
  name_zh: string
  name_en: string
  latitude: number | null
  longitude: number | null
  timezone: string | null
  active: Generated<boolean>
  source_updated_at: NullableTimestamp
  created_at: Timestamp
  updated_at: Timestamp
}

export interface UsersTable {
  id: Generated<string>
  public_id: string
  wechat_openid: string
  nickname: string
  avatar_url: string
  status: Generated<string>
  created_at: Timestamp
  updated_at: Timestamp
  last_login_at: Timestamp
}

export interface UserSessionsTable {
  id: Generated<string>
  user_id: string
  refresh_token_hash: string
  expires_at: Timestamp
  revoked_at: NullableTimestamp
  created_at: Timestamp
  rotated_at: NullableTimestamp
}

export interface TransitCountryPreferencesTable {
  user_id: string
  country_code: string
  preference: 'preferred' | 'excluded'
  created_at: Timestamp
  updated_at: Timestamp
}

export interface TopologyVersionsTable {
  id: Generated<string>
  public_id: string
  source: string
  status: string
  coverage: JsonColumn
  coverage_complete: Generated<boolean>
  activated_at: NullableTimestamp
  created_at: Timestamp
}

export interface RouteEdgesTable {
  id: Generated<string>
  topology_version_id: string
  origin_airport_id: string
  destination_airport_id: string
  valid_from: string | null
  valid_to: string | null
  operating_days_mask: Generated<number>
  weekly_frequency: Generated<number>
  source: string
  last_confirmed_at: NullableTimestamp
  created_at: Timestamp
}

export interface FlightSearchesTable {
  id: Generated<string>
  public_id: string
  user_id: string | null
  request_hash: string
  request_json: JsonColumn
  status: Generated<string>
  topology_version_id: string | null
  error_code: string | null
  error_message: string | null
  expires_at: Timestamp
  created_at: Timestamp
  updated_at: Timestamp
  completed_at: NullableTimestamp
}

export interface FlightOffersTable {
  id: Generated<string>
  search_id: string
  provider: string
  provider_offer_id: string | null
  total_amount: string
  currency: string
  total_duration_minutes: number
  transfer_type: string
  risk_level: string
  expires_at: NullableTimestamp
  raw_json: JsonColumn | null
  created_at: Timestamp
}

export interface FlightSegmentsTable {
  id: Generated<string>
  offer_id: string
  sequence_no: number
  origin_airport_id: string
  destination_airport_id: string
  marketing_carrier_code: string | null
  operating_carrier_code: string | null
  flight_number: string | null
  departs_at: Timestamp
  arrives_at: Timestamp
  duration_minutes: number
  baggage_recheck: boolean | null
  protected_connection: boolean | null
}

export interface RecommendationsTable {
  id: Generated<string>
  search_id: string
  offer_id: string
  score: string
  score_components: JsonColumn
  reasons: JsonColumn
  rule_version: string
  created_at: Timestamp
}

export interface JobsTable {
  id: Generated<string>
  type: string
  payload: JsonColumn
  status: Generated<string>
  run_at: Timestamp
  attempts: Generated<number>
  max_attempts: Generated<number>
  locked_by: string | null
  locked_at: NullableTimestamp
  last_error: string | null
  created_at: Timestamp
  updated_at: Timestamp
  completed_at: NullableTimestamp
}

export interface Database {
  countries: CountriesTable
  cities: CitiesTable
  airports: AirportsTable
  users: UsersTable
  user_sessions: UserSessionsTable
  transit_country_preferences: TransitCountryPreferencesTable
  topology_versions: TopologyVersionsTable
  route_edges: RouteEdgesTable
  flight_searches: FlightSearchesTable
  flight_offers: FlightOffersTable
  flight_segments: FlightSegmentsTable
  recommendations: RecommendationsTable
  jobs: JobsTable
}

export type Country = Selectable<CountriesTable>
export type NewCountry = Insertable<CountriesTable>
export type Airport = Selectable<AirportsTable>
export type User = Selectable<UsersTable>
export type NewUser = Insertable<UsersTable>
export type Session = Selectable<UserSessionsTable>
export type NewSession = Insertable<UserSessionsTable>
export type Preference = Selectable<TransitCountryPreferencesTable>
export type NewPreference = Insertable<TransitCountryPreferencesTable>
export type SearchRow = Selectable<FlightSearchesTable>
export type NewSearch = Insertable<FlightSearchesTable>
export type SearchUpdate = Updateable<FlightSearchesTable>
export type Job = Selectable<JobsTable>
export type NewJob = Insertable<JobsTable>
