# OAG integration

OAG is used server-side for route topology, connections/MCT data, airport master data and optional flight status. SerpApi or Duffel remains the fare provider.

## Security

Never place an OAG or fare-provider key in `src/`, a committed file, or the mini-program build. Configure keys only in `backend/.env` for local development and a Secret Manager for production. Keys pasted into chat, tickets, logs, or screenshots should be rotated before production.

## Backend environment variables

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
| `OAG_CONNECTIONS_PATH` | Override the default `/flight-connections` path |
| `OAG_LOCATIONS_PATH` | Override the default `/locations` path |
| `OAG_FLIGHT_INFO_PATH` | Override the default `/flight-instances/` path |

Existing fare and AI variables remain:

| Variable | Purpose |
|---|---|
| `SERPAPI_KEY` | Google Flights fare search |
| `DUFFEL_TOKEN` | Alternative live offer provider |
| `SEARCH_PROVIDER` | `serpapi` or `duffel` |
| `OPENROUTER_API_KEY` | Natural-language parsing and itinerary generation |

Master Data Locations and Flight Info Connections currently require `version=v1`. The backend adapter supplies this automatically. Connections uses `Service=p` and accepts a maximum seven-day date range.

## Backend sync jobs

### Live connectivity refresh

Use the protected backend endpoint to enqueue a route sync:

```http
POST /v1/admin/sync/oag/route
X-Admin-Token: <ADMIN_API_TOKEN>
Content-Type: application/json

{"origin":"SZX","destination":"LHR","dateFrom":"2026-09-15","includeConnections":true,"limit":100}
```

The Worker normalizes the provider response, writes a new topology version, rebuilds route edges and activates the version only after the transaction succeeds. Existing active data remains readable throughout the sync.

### Airport master data

```http
POST /v1/admin/sync/oag/location
X-Admin-Token: <ADMIN_API_TOKEN>
Content-Type: application/json

{"airportCode":"LHR"}
```

The first backend version deliberately syncs one airport per job so failed records can be retried independently. Country-wide pagination can be added after the Master Data subscription is validated.

### Flight instance/status (provider client)

The server-side OAG provider includes a Flight Info v2 client. A public status endpoint is intentionally not exposed yet; it should be added together with caching and per-user quota controls.

## Trial quota guidance

Only enqueue explicit, bounded sync jobs during the OAG trial. Normal fare search does not automatically consume OAG calls. Production should schedule bounded refreshes and persist Schedules and Master Data rather than querying the full topology per user request.
