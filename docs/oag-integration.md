# OAG integration

OAG is used server-side for route topology, connections/MCT data, airport master data and optional flight status. SerpApi or Duffel remains the fare provider.

## Security

Never place an OAG or fare-provider key in `src/`, a committed file, or the mini-program build. Configure keys only in the WeChat cloud function environment. Keys pasted into chat, tickets, logs, or screenshots should be rotated before production.

## `searchProxy` environment variables

Required for OAG:

| Variable | Product | Purpose |
|---|---|---|
| `OAG_SCHEDULES_KEY` | Schedules | Direct route and operating-day lookup |
| `OAG_FLIGHT_INFO_KEY` | Flight Info Trial/v2 | Connections fallback and flight-instance lookup |
| `OAG_MASTER_DATA_KEY` | Master Data Locations | Airport/city/country/timezone lookup |

Optional:

| Variable | Purpose |
|---|---|
| `OAG_CONNECTIONS_KEY` | Separate Connections key; falls back to `OAG_FLIGHT_INFO_KEY` |
| `OAG_SCHEDULES_PATH` | Override the default `/flights` path if the subscription contract differs |
| `OAG_CONNECTIONS_PATH` | Override the default `/connections` path |
| `OAG_LOCATIONS_PATH` | Override the default `/locations` path |
| `OAG_FLIGHT_INFO_PATH` | Override the default `/flight-instances/` path |

Existing fare and AI variables remain:

| Variable | Purpose |
|---|---|
| `SERPAPI_KEY` | Google Flights fare search |
| `DUFFEL_TOKEN` | Alternative live offer provider |
| `SEARCH_PROVIDER` | `serpapi` or `duffel` |
| `OPENROUTER_API_KEY` | Natural-language parsing and itinerary generation |

## Cloud function actions

### Live connectivity refresh

```json
{
  "action": "connectivity",
  "origin": "SZX",
  "destination": "LHR",
  "date": "2026-09-15",
  "max_transfers": 2,
  "live": true
}
```

This calls Schedules and Connections, adds observed OAG edges to the in-process topology, then returns direct status and simple paths. Identical OD/date lookups are cached for six hours within a warm cloud-function instance.

### Airport master data

```json
{
  "action": "airport_metadata",
  "airport_code": "LHR"
}
```

Country and city queries are also supported through `country_code` and `city_code`.

### Flight instance/status

```json
{
  "action": "flight_info",
  "carrier_code": "SQ",
  "flight_number": "322",
  "date": "2026-09-15"
}
```

## Trial quota guidance

Use `live: true` only for explicit refreshes during the OAG trial. Normal fare search does not automatically consume OAG calls. Production should persist Schedules and Master Data in a database and refresh them on a scheduled job rather than querying the full topology per user request.
