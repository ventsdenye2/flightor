# FlightOR Agent Tool Registry

This file is the source-of-truth inventory for Agent-facing tools. It follows
`FLIGHTOR_ARCHITECTURE.md`; implementation status means both code and contract
tests exist. Provider-specific payloads must be normalized before crossing a
tool boundary.

## Status legend

- **Implemented**: registered in the new runtime and covered by contract tests.
- **Partial**: a reusable domain/provider foundation exists, but the Agent tool
  contract is not complete.
- **Planned**: no production Agent tool contract exists yet.

## Phase 1 vertical slice

### `get_trip_context`

- Status: **Implemented** (Phase 2 PostgreSQL immutable snapshots + in-memory test seam)
- Purpose: Read the current trip's `TripContext` without loading User Memory,
  Conversation history, or Artifacts into the same state object.
- Input: `{}`. The active trip identity comes from the authenticated runtime
  context, never from model-supplied authority.
- Output: `{ tripContext: TripContext }`.
- Side effects: None.
- Cost class: `free`.
- Authority: FlightOR trip store for the active trip.
- Provider dependencies: None.
- Cache behavior: No tool-level cache; the trip repository may cache by version.
- Failure behavior: Rejects missing/unauthorized active-trip context and returns
  a structured tool error. It never fabricates an empty persisted trip.

### `update_trip_context`

- Status: **Implemented** (Phase 2 PostgreSQL optimistic concurrency + in-memory test seam)
- Purpose: Apply explicit, trip-local user constraints and preferences.
- Input: `{ patch: TripContextPatch, expectedVersion?: number }`; unknown fields
  and invalid ranges are rejected. The model cannot select another trip ID.
- Output: `{ tripContext: TripContext, changed: boolean }`.
- Side effects: Mutates only the active Trip Context; it never writes User
  Memory or Conversation history.
- Cost class: `free`.
- Authority: Explicit current-user statements interpreted by the Agent and
  validated deterministically.
- Provider dependencies: None.
- Cache behavior: Invalidates any trip-context cache after a successful write.
- Failure behavior: Validation, authorization, or version conflicts are returned
  as structured tool errors; writes are atomic.

### `resolve_location`

- Status: **Implemented** (Mock/OAG contract path tested; primary AeroDataBox endpoint mapping remains partial)
- Purpose: Resolve a natural-language place into FlightOR-owned city/airport
  references before those references are used as facts.
- Input: `{ query: string, types?: ('city' | 'airport')[], limit?: number }`.
- Output: `{ matches: LocationRef[], verification: VerificationRecord }`.
- Side effects: None.
- Cost class: `cheap`.
- Authority: Aviation provider data normalized by FlightOR.
- Provider dependencies: Primary `AviationProvider` (AeroDataBox); optional OAG
  fallback; mock provider in tests.
- Cache behavior: Long-lived normalized cache by query, locale, and provider
  dataset version, subject to provider licence terms.
- Failure behavior: Empty matches are valid. Provider unavailability, timeout,
  and malformed provider payloads are distinct structured failures; no airport
  code is invented.

### `search_flights`

- Status: **Implemented** (normalized SerpApi/Mock providers + Phase 2 cloud Artifact Repository)
- Purpose: Search real fare options for one requested leg and return the same
  `FlightSearchArtifact` contract used by manual Flight Explorer flows.
- Input: `{ origin, destination, departureDate, returnDate?, currency?,
  travelClass? }` using canonical location/airport references.
- Output: `{ artifact: { id, type, schemaVersion }, summary }` for the Planner.
  The repository stores the complete normalized `FlightSearchArtifact`, including
  offers, query parameters, `checkedAt`, provider provenance, and verification.
- Side effects: Creates an Artifact/search record when persistence is enabled;
  it does not book or purchase anything.
- Cost class: `paid`.
- Authority: Fare provider response normalized by FlightOR.
- Provider dependencies: Primary `FareProvider` (SerpApi); mock provider in tests.
- Cache behavior: Short-lived cache keyed by the normalized fare query. Cached
  output retains original `checkedAt` and freshness metadata.
- Failure behavior: No-offer is a valid empty artifact. Provider failure or
  timeout yields a structured error/unconfirmed state; prices are never guessed.

## Context and Memory tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `get_user_memory` | Implemented | Active authenticated user → enabled flag, Markdown when enabled, version | None | free | User-scoped cloud Memory repository | No model cache; disabled memory is not returned or injected; authorization failures are explicit |
| `update_user_memory` | Implemented | Markdown replacement + expected version → new Markdown/version | Writes enabled User Memory only | free | Clear long-term user preference; no provider | 8 KiB UTF-8 limit and optimistic concurrency; disabled/stale writes fail closed |
| `delete_user_memory` | Planned | Explicit confirmation scope → reset/deleted version | Destructive user-directed Memory reset | free | Authenticated user instruction | Invalidates derived profile; version/auth conflicts fail closed |

## Geography and destination tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `search_destinations` | Planned | Region/interests/accessibility filters → candidate set artifact | Creates artifact | cheap | Curated data + aviation accessibility | Versioned candidate cache; partial sources are marked |
| `recommend_destinations` | Planned | Active trip + optional enabled Memory → scored destination set | Creates artifact | cheap | FlightOR scoring over verified data | Cache by inputs/data versions; never silently promotes a suggestion to required |

## Flight and fare tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `search_flexible_flights` | Planned | Canonical leg + bounded date window → flight-search artifact | Creates artifact | paid | `FareProvider` | Short TTL; partial dates and provider failures are reported |
| `search_connection_flights` | Planned | Leg/window + active preferences → candidate edge artifact | Creates artifact | expensive | FlightOR connection engine over aviation + fare providers | Topology-first cache/pruning; unavailable fares remain unconfirmed, never invented |
| `confirm_flight_price` | Planned | Existing offer/artifact ref → refreshed offer | Updates verification/freshness | paid | `FareProvider.refreshFlight` | Bypasses ordinary fare cache; stale/unavailable is explicit |
| `confirm_route_price` | Planned | Route artifact ref → refreshed fare-critical legs | Updates route verification | expensive | FlightOR service + `FareProvider` | Bounded refresh set; partial confirmation is preserved |

## Route planning tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `plan_trip_route` | Planned | Trip constraints + verified candidates → visit/day structure | Creates artifact | cheap | FlightOR trip-planning service | Deterministic inputs/version key; does not optimize global flights |
| `plan_flight_route` | Planned | Cities, dates, candidate edges → complete bounded paths | Creates artifact | cheap | FlightOR path search; no direct provider calls | Synthetic graph golden tests; bounded-search exhaustion is explicit |
| `optimize_route` | Planned | Complete path candidates + weights → Pareto representatives | Creates artifact | cheap | FlightOR optimizer; no provider calls | Deterministic by algorithm version; invalid candidates are rejected |

## Research tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `web_research` | Planned | Bounded question/context → research artifact | Creates artifact | paid | Verified web sources | Topic/freshness cache; unavailable research does not block routing |
| `research_destination` | Planned | Destination/time/interests → structured research artifact | Creates artifact | paid | Source-priority research service | Expiry by fact type; unsupported claims remain unverified |
| `build_travel_guide` | Planned | Route + verified research refs → day-level guide artifact | Creates artifact | cheap | FlightOR composition over verified artifacts | Versioned by inputs; missing current-event facts are omitted |

## Runtime-wide execution policy

- Tool arguments and tool results are schema validated.
- Unknown tools fail closed.
- The runtime enforces a maximum tool-step count, per-turn cost budget, per-tool
  timeout, caller cancellation, generation-current guard, and structured traces.
- Independent read-only calls may run concurrently. State mutations are ordered.
- Agent-facing tools call domain services/providers directly and never recurse
  through the Agent tool registry.
- Tool errors returned to the model are bounded, deterministic, and secret-free.
