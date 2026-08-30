import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    create extension if not exists pg_trgm;

    create table countries (
      code char(2) primary key,
      name_zh text not null,
      name_en text not null,
      region text,
      is_popular boolean not null default false,
      popularity_rank smallint,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint countries_code_upper_chk check (code = upper(code))
    );
    create index countries_popular_idx on countries (popularity_rank) where is_popular and active;
    create index countries_name_en_trgm_idx on countries using gin (name_en gin_trgm_ops);
    create index countries_name_zh_trgm_idx on countries using gin (name_zh gin_trgm_ops);

    create table cities (
      id bigint generated always as identity primary key,
      country_code char(2) not null references countries(code),
      iata_code char(3),
      name_zh text not null default '',
      name_en text not null,
      latitude double precision,
      longitude double precision,
      timezone text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint cities_iata_upper_chk check (iata_code is null or iata_code = upper(iata_code)),
      constraint cities_latitude_chk check (latitude is null or latitude between -90 and 90),
      constraint cities_longitude_chk check (longitude is null or longitude between -180 and 180)
    );
    create unique index cities_iata_code_uidx on cities (iata_code) where iata_code is not null;
    create index cities_country_code_idx on cities (country_code);
    create index cities_name_en_trgm_idx on cities using gin (name_en gin_trgm_ops);
    create index cities_name_zh_trgm_idx on cities using gin (name_zh gin_trgm_ops);

    create table airports (
      id bigint generated always as identity primary key,
      iata_code char(3),
      icao_code text,
      city_id bigint references cities(id),
      country_code char(2) not null references countries(code),
      name_zh text not null default '',
      name_en text not null,
      latitude double precision,
      longitude double precision,
      timezone text,
      active boolean not null default true,
      source_updated_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint airports_iata_upper_chk check (iata_code is null or iata_code = upper(iata_code)),
      constraint airports_latitude_chk check (latitude is null or latitude between -90 and 90),
      constraint airports_longitude_chk check (longitude is null or longitude between -180 and 180)
    );
    create unique index airports_iata_code_uidx on airports (iata_code) where iata_code is not null;
    create unique index airports_icao_code_uidx on airports (icao_code) where icao_code is not null;
    create index airports_city_id_idx on airports (city_id);
    create index airports_country_code_active_idx on airports (country_code, active);
    create index airports_name_en_trgm_idx on airports using gin (name_en gin_trgm_ops);
    create index airports_name_zh_trgm_idx on airports using gin (name_zh gin_trgm_ops);

    create table airport_aliases (
      id bigint generated always as identity primary key,
      airport_id bigint not null references airports(id) on delete cascade,
      locale text not null,
      alias text not null,
      alias_normalized text not null,
      unique (airport_id, locale, alias_normalized)
    );
    create index airport_aliases_airport_id_idx on airport_aliases (airport_id);
    create index airport_aliases_normalized_trgm_idx on airport_aliases using gin (alias_normalized gin_trgm_ops);

    create table airlines (
      id bigint generated always as identity primary key,
      iata_code char(2),
      icao_code text,
      name text not null,
      alliance text,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index airlines_iata_code_uidx on airlines (iata_code) where iata_code is not null;
    create unique index airlines_icao_code_uidx on airlines (icao_code) where icao_code is not null;

    create table users (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      wechat_openid text not null unique,
      nickname text not null default '',
      avatar_url text not null default '',
      status text not null default 'active' check (status in ('active', 'disabled')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz not null default now()
    );

    create table user_sessions (
      id bigint generated always as identity primary key,
      user_id bigint not null references users(id) on delete cascade,
      refresh_token_hash char(64) not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      rotated_at timestamptz
    );
    create index user_sessions_user_id_idx on user_sessions (user_id);
    create index user_sessions_active_expiry_idx on user_sessions (expires_at) where revoked_at is null;

    create table transit_country_preferences (
      user_id bigint not null references users(id) on delete cascade,
      country_code char(2) not null references countries(code),
      preference text not null check (preference in ('preferred', 'excluded')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (user_id, country_code)
    );
    create index transit_country_preferences_country_code_idx on transit_country_preferences (country_code);

    create table topology_versions (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      source text not null,
      status text not null check (status in ('building', 'active', 'retired', 'failed')),
      coverage jsonb not null default '{}'::jsonb,
      coverage_complete boolean not null default false,
      activated_at timestamptz,
      created_at timestamptz not null default now()
    );
    create unique index topology_versions_one_active_idx on topology_versions ((status)) where status = 'active';

    create table schedule_services (
      id bigint generated always as identity primary key,
      topology_version_id bigint not null references topology_versions(id) on delete cascade,
      provider text not null,
      provider_key text not null,
      marketing_carrier_code text,
      operating_carrier_code text,
      flight_number text,
      origin_airport_id bigint not null references airports(id),
      destination_airport_id bigint not null references airports(id),
      valid_from date,
      valid_to date,
      operating_days_mask smallint not null default 127 check (operating_days_mask between 0 and 127),
      departure_local time,
      arrival_local time,
      arrival_day_offset smallint not null default 0,
      service_type text not null default 'passenger',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (provider, provider_key, topology_version_id),
      check (origin_airport_id <> destination_airport_id)
    );
    create index schedule_services_topology_version_id_idx on schedule_services (topology_version_id);
    create index schedule_services_origin_destination_dates_idx on schedule_services (origin_airport_id, destination_airport_id, valid_from, valid_to);
    create index schedule_services_destination_airport_id_idx on schedule_services (destination_airport_id);

    create table route_edges (
      id bigint generated always as identity primary key,
      topology_version_id bigint not null references topology_versions(id) on delete cascade,
      origin_airport_id bigint not null references airports(id),
      destination_airport_id bigint not null references airports(id),
      valid_from date,
      valid_to date,
      operating_days_mask smallint not null default 127 check (operating_days_mask between 0 and 127),
      weekly_frequency smallint not null default 0,
      source text not null,
      last_confirmed_at timestamptz,
      created_at timestamptz not null default now(),
      check (origin_airport_id <> destination_airport_id)
    );
    create index route_edges_topology_version_id_idx on route_edges (topology_version_id);
    create index route_edges_origin_dates_destination_idx on route_edges (origin_airport_id, valid_from, valid_to, destination_airport_id);
    create index route_edges_destination_airport_id_idx on route_edges (destination_airport_id);

    create table connection_options (
      id bigint generated always as identity primary key,
      topology_version_id bigint not null references topology_versions(id) on delete cascade,
      provider text not null,
      provider_key text not null,
      origin_airport_id bigint not null references airports(id),
      destination_airport_id bigint not null references airports(id),
      hub_airport_id bigint not null references airports(id),
      connection_minutes integer not null check (connection_minutes >= 0),
      mct_status text,
      is_self_connection boolean not null default false,
      valid_from date,
      valid_to date,
      operating_days_mask smallint not null default 127 check (operating_days_mask between 0 and 127),
      created_at timestamptz not null default now(),
      unique (provider, provider_key, topology_version_id)
    );
    create index connection_options_topology_version_id_idx on connection_options (topology_version_id);
    create index connection_options_origin_destination_date_idx on connection_options (origin_airport_id, destination_airport_id, valid_from);
    create index connection_options_hub_date_idx on connection_options (hub_airport_id, valid_from);
    create index connection_options_destination_airport_id_idx on connection_options (destination_airport_id);

    create table mct_rules (
      id bigint generated always as identity primary key,
      airport_id bigint not null references airports(id),
      provider text not null,
      rule_key text not null,
      arrival_scope text,
      departure_scope text,
      arrival_terminal text,
      departure_terminal text,
      minimum_minutes integer not null check (minimum_minutes > 0),
      valid_from date,
      valid_to date,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (provider, rule_key)
    );
    create index mct_rules_airport_dates_idx on mct_rules (airport_id, valid_from, valid_to);

    create table flight_searches (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint references users(id) on delete set null,
      request_hash char(64) not null,
      request_json jsonb not null,
      status text not null default 'queued' check (status in ('queued', 'processing', 'partial', 'completed', 'failed')),
      topology_version_id bigint references topology_versions(id) on delete set null,
      error_code text,
      error_message text,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz
    );
    create index flight_searches_user_created_idx on flight_searches (user_id, created_at desc);
    create index flight_searches_request_hash_expiry_idx on flight_searches (request_hash, expires_at desc);
    create index flight_searches_topology_version_id_idx on flight_searches (topology_version_id);
    create index flight_searches_active_status_idx on flight_searches (status, created_at) where status in ('queued', 'processing', 'partial');

    create table flight_offers (
      id bigint generated always as identity primary key,
      search_id bigint not null references flight_searches(id) on delete cascade,
      provider text not null,
      provider_offer_id text,
      total_amount numeric(12,2) not null check (total_amount >= 0),
      currency char(3) not null,
      total_duration_minutes integer not null check (total_duration_minutes >= 0),
      transfer_type text not null check (transfer_type in ('direct', 'airline', 'self')),
      risk_level text not null check (risk_level in ('low', 'medium', 'high', 'unknown')),
      expires_at timestamptz,
      raw_json jsonb,
      created_at timestamptz not null default now()
    );
    create index flight_offers_search_price_idx on flight_offers (search_id, total_amount);
    create unique index flight_offers_provider_offer_uidx on flight_offers (provider, provider_offer_id, search_id) where provider_offer_id is not null;

    create table flight_segments (
      id bigint generated always as identity primary key,
      offer_id bigint not null references flight_offers(id) on delete cascade,
      sequence_no smallint not null check (sequence_no >= 0),
      origin_airport_id bigint not null references airports(id),
      destination_airport_id bigint not null references airports(id),
      marketing_carrier_code text,
      operating_carrier_code text,
      flight_number text,
      departs_at timestamptz not null,
      arrives_at timestamptz not null,
      duration_minutes integer not null check (duration_minutes > 0),
      baggage_recheck boolean,
      protected_connection boolean,
      unique (offer_id, sequence_no),
      check (origin_airport_id <> destination_airport_id),
      check (arrives_at > departs_at)
    );
    create index flight_segments_origin_departure_idx on flight_segments (origin_airport_id, departs_at);
    create index flight_segments_destination_airport_id_idx on flight_segments (destination_airport_id);

    create table recommendations (
      id bigint generated always as identity primary key,
      search_id bigint not null references flight_searches(id) on delete cascade,
      offer_id bigint not null references flight_offers(id) on delete cascade,
      score numeric(8,4) not null,
      score_components jsonb not null default '{}'::jsonb,
      reasons jsonb not null default '[]'::jsonb,
      rule_version text not null,
      created_at timestamptz not null default now(),
      unique (search_id, offer_id, rule_version)
    );
    create index recommendations_offer_id_idx on recommendations (offer_id);
    create index recommendations_search_score_idx on recommendations (search_id, score desc);

    create table saved_trips (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint not null references users(id) on delete cascade,
      title text not null,
      trip_json jsonb not null,
      version integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index saved_trips_user_created_idx on saved_trips (user_id, created_at desc);

    create table price_alerts (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint not null references users(id) on delete cascade,
      origin_airport_id bigint not null references airports(id),
      destination_airport_id bigint not null references airports(id),
      criteria jsonb not null,
      target_amount numeric(12,2) not null check (target_amount > 0),
      currency char(3) not null,
      status text not null default 'active' check (status in ('active', 'paused', 'fired', 'deleted')),
      next_check_at timestamptz not null default now(),
      last_checked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (origin_airport_id <> destination_airport_id)
    );
    create index price_alerts_user_id_idx on price_alerts (user_id);
    create index price_alerts_due_idx on price_alerts (next_check_at) where status = 'active';
    create index price_alerts_origin_airport_id_idx on price_alerts (origin_airport_id);
    create index price_alerts_destination_airport_id_idx on price_alerts (destination_airport_id);

    create table sync_runs (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      provider text not null,
      dataset text not null,
      status text not null check (status in ('queued', 'running', 'completed', 'failed')),
      cursor_json jsonb,
      rows_seen bigint not null default 0,
      rows_written bigint not null default 0,
      error_summary text,
      started_at timestamptz,
      finished_at timestamptz,
      created_at timestamptz not null default now()
    );
    create index sync_runs_provider_dataset_created_idx on sync_runs (provider, dataset, created_at desc);

    create table jobs (
      id bigint generated always as identity primary key,
      type text not null,
      payload jsonb not null default '{}'::jsonb,
      status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
      run_at timestamptz not null default now(),
      attempts integer not null default 0,
      max_attempts integer not null default 5 check (max_attempts > 0),
      locked_by text,
      locked_at timestamptz,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz
    );
    create index jobs_pending_run_at_idx on jobs (run_at, id) where status = 'pending';
    create index jobs_processing_locked_idx on jobs (locked_at) where status = 'processing';

    create table provider_calls (
      id bigint generated always as identity primary key,
      request_id text,
      provider text not null,
      action text not null,
      request_hash char(64),
      status_code integer,
      duration_ms integer not null check (duration_ms >= 0),
      quota_cost numeric(10,4) not null default 0,
      error_code text,
      created_at timestamptz not null default now()
    );
    create index provider_calls_provider_created_idx on provider_calls (provider, created_at desc);
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    drop table if exists provider_calls;
    drop table if exists jobs;
    drop table if exists sync_runs;
    drop table if exists price_alerts;
    drop table if exists saved_trips;
    drop table if exists recommendations;
    drop table if exists flight_segments;
    drop table if exists flight_offers;
    drop table if exists flight_searches;
    drop table if exists mct_rules;
    drop table if exists connection_options;
    drop table if exists route_edges;
    drop table if exists schedule_services;
    drop table if exists topology_versions;
    drop table if exists transit_country_preferences;
    drop table if exists user_sessions;
    drop table if exists users;
    drop table if exists airlines;
    drop table if exists airport_aliases;
    drop table if exists airports;
    drop table if exists cities;
    drop table if exists countries;
  `).execute(db)
}
