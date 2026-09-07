# FlightOR Agent Tool Registry

This file is the source-of-truth inventory for Agent-facing tools. It follows
`docs/FLIGHTOR_ARCHITECTURE.md`; implementation status means both code and contract
tests exist. Provider-specific payloads must be normalized before crossing a
tool boundary.

The public conversation API is the authenticated `POST /v1/agent/converse`.
Its Planner registry is intentionally smaller than the complete deterministic
Core Tool registry: conversation may gather facts, update Trip/Memory, search
fares, research, and build an outline, but it cannot start final route
generation. Final connection search, complete-path planning, Pareto
optimization, and route-price confirmation run only behind the explicit
owner-scoped route-generation run API described below. `agent-v2` is a removed
migration seam, not a current public API.

## Status legend

- **Implemented**: registered in the new runtime and covered by contract tests.
- **Partial**: a reusable domain/provider foundation exists, but the Agent tool
  contract is not complete.
- **Planned**: no production Agent tool contract exists yet.

`generation-only` is an additional boundary label, not a weaker implementation
status: the tool is implemented and tested, but is intentionally absent from
the public conversation Planner registry and may run only inside the explicit
route-generation composition.

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

- Status: **Implemented** (AeroDataBox airport search/lookup/FIDS/status adapter + Mock/OAG-compatible seams)
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

- Status: **Implemented** (normalized SerpApi/Mock providers + owner-scoped Artifact Repository + Phase 6 shared manual/Agent service)
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
- Product path: Agent tool execution and authenticated `POST /v1/flight-searches`
  both call `backend/src/fares/search-service.ts`; the manual response returns a
  compact ref/summary and Flight Explorer loads the full Artifact by ID. The
  manual action requires an owner-scoped `Idempotency-Key`; the current bounded
  24-hour in-process store is safe for the single-process deployment and must be
  replaced by PostgreSQL/Redis before multi-instance rollout.

## Context and Memory tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `get_user_memory` | Implemented | Active authenticated user → enabled flag, Markdown when enabled, version | None | free | User-scoped cloud Memory repository | No model cache; disabled memory is not returned or injected; authorization failures are explicit |
| `update_user_memory` | Implemented | Markdown replacement + expected version → new Markdown/version | Writes enabled User Memory only | free | Clear long-term user preference; no provider | 8 KiB UTF-8 limit and optimistic concurrency; disabled/stale writes fail closed |
| `delete_user_memory` | Planned | Explicit confirmation scope → reset/deleted version | Destructive user-directed Memory reset | free | Authenticated user instruction | Invalidates derived profile; version/auth conflicts fail closed |

## Geography and destination tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `search_destinations` | Implemented (Phase 4B) | Bounded region/interests filters + active Trip constraints → `destination_set` v1 artifact | Creates artifact | cheap | Curated catalog + optional normalized aviation accessibility | Catalog coverage and provider failure are explicit; accessibility is only `direct` or `unknown` |
| `recommend_destinations` | Implemented (Phase 4B) | Active Trip + optional enabled Memory → scored `destination_set` v1 artifact | Creates artifact | cheap | Deterministic FlightOR scoring over catalog facts | Trip exclusions override Memory; suggestions never become required destinations |

## Flight and fare tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `search_flexible_flights` | Implemented (Phase 3) | Canonical leg + ≤31-day window → `flight_search` v2 artifact + compact sampled-date summary | Creates artifact | paid | `FareProvider` (SerpApi/Mock) | Provider discloses sampled/success/failed dates; partial success is preserved and total failure is explicit |
| `search_connection_flights` | Implemented (Phase 4 production; generation-only) | Trusted canonical leg/window + cloud Trip transfer/location policy → `route_set:connection_edges` artifact | Creates artifact | expensive | PostgreSQL `TopologyRepository` + bounded `ConnectionSearchService` + optional fare enrichment | Preferred-first then general topology; partial coverage remains unknown; cost bounds and deterministic ordering are tested; excluded from the conversation Planner registry |
| `confirm_flight_price` | Implemented (Phase 4B) | Owner-scoped artifact/offer binding → immutable refreshed `flight_search` v1 snapshot | Creates successor artifact | paid | `FareProvider.refreshFlight` | Query, endpoints and offer ID are revalidated; source artifact is never mutated |
| `confirm_route_price` | Implemented (Phase 4B; generation-only) | Owner-scoped route/path ref → refreshed fare-critical legs + successor `route_set` | Creates fare snapshots and successor route artifact | expensive | FlightOR confirmation service + `FareProvider` | Maximum 12 legs and process-wide concurrency 2; weak bindings/partial failures cannot claim a current total; excluded from the conversation Planner registry |

## Route planning tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `plan_trip_route` | Implemented (Phase 4B) | Owner-scoped destination set + active Trip constraints → `route:trip_route_plan` v1 | Creates artifact | cheap | Deterministic FlightOR trip-structure planner | Required/excluded/role/day constraints fail closed; ground transport and activities are never invented |
| `plan_flight_route` | Implemented (Phase 4 production; generation-only) | Trusted candidate-edge artifact + canonical nodes/window + cloud Trip constraints → `route_set:flight_paths` artifact | Creates artifact | cheap | Deterministic bounded `FlightRoutePlanner`; no provider calls | Hard constraints precede scoring; stable path order, cycle prevention, conservative unknowns, truncation/exhaustion are explicit; excluded from the conversation Planner registry |
| `optimize_route` | Implemented (Phase 4 production; generation-only) | Trusted complete-path artifact + controlled bounded weights + cloud Trip preferences → `route_set:optimized_routes` artifact | Creates artifact | cheap | Deterministic Pareto `RouteOptimizer`; no discovery/provider calls | Full score breakdown, penalties, merged badges, trade-offs, algorithm version, and malformed-source rejection are persisted; excluded from the conversation Planner registry |

## Research tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `web_research` | Implemented (Phase 4B compatibility vocabulary) | Strict minimal `ResearchBrief` → `research` v2 artifact + compact status counts | Creates artifact | paid | Restricted production `ResearchAgent`; SerpApi research adapter; optional OpenRouter synthesis | Bounded snippets only; provider/model failure degrades conservatively; missing SerpApi key is explicit unavailable |
| `research_destination` | Implemented (Phase 4B) | Trusted destination + active Trip window/interests/questions → `research` v2 artifact | Creates artifact | paid | Same restricted Research pipeline | Every finding has standard verification/TTL; event snippet evidence is never fully verified |
| `build_travel_guide` | Implemented (Phase 4B) | Owner-scoped trip-route + research refs → `travel_guide` v1 artifact | Creates artifact | cheap | Deterministic FlightOR composition | Performs no search; stale/unverified findings are omitted and missing days remain empty |

## Runtime-wide execution policy

- Tool arguments and tool results are schema validated.
- Unknown tools fail closed.
- The runtime enforces a maximum tool-step count, per-turn cost budget, per-tool
  timeout, caller cancellation, generation-current guard, and structured traces.
- Independent read-only calls may run concurrently. State mutations are ordered.
- Agent-facing tools call domain services/providers directly and never recurse
  through the Agent tool registry.
- Tool errors returned to the model are bounded, deterministic, and secret-free.

## Public Planner registry boundary (Phase 5)

`createPlannerToolRegistry()` is the vocabulary exposed by the public
conversation runtime. It includes:

```text
get_trip_context
update_trip_context
resolve_location
search_flights
search_flexible_flights
confirm_flight_price
search_destinations
recommend_destinations
plan_trip_route
research_destination
web_research
build_travel_guide
get_user_memory
update_user_memory
```

It deliberately excludes `search_connection_flights`, `plan_flight_route`,
`optimize_route`, and `confirm_route_price`. Those tools remain implemented in
the complete Core Tool registry for deterministic engine composition and tests,
but a model response or tool call cannot use them to start a final route.

The explicit action is an authenticated, owner-scoped run resource:

```text
POST   /v1/trips/:tripId/route-generation-runs
GET    /v1/route-generation-runs/:runId
DELETE /v1/route-generation-runs/:runId
```

Creation requires `Idempotency-Key` and accepts only the strict body
`{ conversationId?, expectedTripVersion? }`. The server snapshots the owned
Trip Context, validates an optional same-Trip Conversation, stores a canonical
request binding, and enqueues only the opaque run ID. Replaying the same key
returns the existing run; changing the request under an existing key is a
conflict. Reads and cancellation are owner-scoped. Cancellation is cooperative
and persistent, and terminal runs are immutable.

Run status is `queued → running → succeeded|failed|cancelled`, with bounded
progress, warnings, sanitized errors, and compact result Artifact references.
The worker uses the frozen context version, so later Trip edits do not mutate a
running run. Successful results report their frozen version and whether they
are stale relative to the current Trip.

The Phase 5 generation slice accepts exactly one final visit destination with a
canonical airport, an origin airport, and a bounded departure window. Return
windows, multiple visit destinations, round-trip composition, and required
ground legs are explicit unsupported-input errors; they are never silently
truncated or represented as a complete route. Missing provider credentials or
partial fare coverage produce explicit unavailable/warning states and never
invent fare facts. `destinationIntent.preferred` remains a soft exploration and
ranking input; it cannot by itself authorize final route generation. Run
acceptance locks the Trip aggregate against concurrent context edits, persistent
cancellation is checked at provider boundaries, and worker heartbeat/recovery
keeps interrupted jobs retryable without exhausting attempts before the run is
stale enough to reclaim.

## Phase 7–9 consumers

Planner now exposes `get_trip_artifacts` (at most 20 current-trip references) and `read_artifact` (bounded, explicitly truncated JSON excerpts) to answer about persisted routes, research and guides across turns. Reads remain user- and trip-scoped. Saved prices are not fresh confirmation. Destination summaries include the exact canonical location for safe tool handoff; Research still requires a location resolved within the active turn. Neither read tool triggers final route generation.
Route, research, guide and destination Artifacts now have client renderers. Cloud workspace restoration retains Artifact references and generation runs. Discovery runs constrained research through a dedicated Worker job and requires human publication; it adds no autonomous publish tool to the Planner registry. See [ADR 0008](./adr/0008-route-discovery-and-cloud-workspaces.md).
