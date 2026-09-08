# FlightOR Agent Tool Registry

This file is the source-of-truth inventory for Agent-facing tools. It follows
`docs/FLIGHTOR_ARCHITECTURE.md`; implementation status means both code and contract
tests exist. Provider-specific payloads must be normalized before crossing a
tool boundary.

The public conversation API is the authenticated `POST /v1/agent/converse`.
Its Planner registry is intentionally smaller than the complete deterministic
Core Tool registry: conversation may gather facts, update Trip/Memory, search
fares, research, and build an outline. It may queue final route generation only
through the zero-argument `start_route_generation` operation after an
unambiguous current user instruction. Final connection search, complete-path planning, Pareto
optimization, and route-price confirmation run only behind the explicit,
owner-scoped route-generation domain service described below. `agent-v2` is a removed
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

## Agentic goal controls

The durable Agentic completion protocol is **Implemented** in the PostgreSQL
production composition and the in-memory test seam. Goal controls validate
results without prescribing an end-to-end tool sequence:

| Tool | Status | Input / output | Authority and behavior |
| --- | --- | --- | --- |
| `declare_goal` | Implemented | `travel_guide`, `flight_search`, or `trip_context_update` plus bounded user-intent parameters → durable goal/run | Owner, Trip, Conversation, context version, timestamps and idempotency binding come from the server. Final route generation uses its dedicated authorized start operation. |
| `get_active_goal` | Implemented | `{ goalId?, kind? }` → matching goal/existing run or bounded candidates | Read-only and owner/Trip scoped. Inspection does not accept saved parameters for this turn, activate a Goal, or create/close a run. An existing returned run may belong to an earlier Trip version. |
| `resume_goal` | Implemented | `{ goalId }` → goal/current-context run | Explicitly activates a saved objective whose parameters match the current request. Reuses a current run or creates one from the server Trip snapshot; satisfied/cancelled Goals cannot resume. Changed parameters require `declare_goal`. |
| `finish_goal` | Implemented | `{ goalId }` → goal/run plus verification status | Returns `pending`, `satisfied`, `partial`, `failed` or `cancelled`. Shares completion with response finalization; domain constraints/coverage and lineage are verified before an atomic Goal/Goal-run status commit. |
| `cancel_goal` | Implemented | `{ goalId }` → cancelled goal and active run | Owner/Trip scope is server checked; cancellation is persistent and late tool results cannot convert it to success. |
| `start_route_generation` | Implemented | `{}` → queued route-generation run with durable goal/run lineage | Available to the Planner only for an unambiguous current user instruction. The server records `explicit_user_message`; the authenticated HTTP action records `button`. Internal route-engine tools remain hidden. |

The Planner remains free to choose, skip, repeat and reorder the existing
domain tools. The goal protocol validates the result; it is not an end-to-end
workflow. During the current functional milestone, configured fare and
research calls are not blocked by a product cost budget, although normal
timeouts, cancellation, rate limits and duplicate-call guards still apply.

The runtime verifies the Goals touched in a turn before returning a final text
response, including when the model omitted `finish_goal`. Flight-search
verification checks accepted airports/dates and sampled-date coverage; guide
verification checks requested day/destination coverage and eligible referenced
research; route verification checks accepted constraints and source path lineage.
The existence of an Artifact or verified evidence is insufficient by itself.
Reading a Goal does not add it to this turn's delivery. The Agent inspects saved
parameters, then explicitly chooses `resume_goal` or declares a new objective;
the server does not select that intent from keywords or prior Goal existence.

Every Planner response carries a server-derived `delivery` with aggregate and
per-Goal status, Artifact IDs, missing requirements and warnings. Only
`delivery.status=satisfied` permits `stopReason=completed`. `responded` pairs with
`not_requested` for ordinary conversation; incomplete durable goals use
`goal_pending|goal_partial|goal_failed|goal_cancelled`. Transport/runtime failures
retain their own stop reasons and the separate delivery verdict. The client must
not infer completion from text or a background route run's `succeeded` status.

`backend/src/agent/goals/completion.ts` coordinates completion through
`GoalRunRepository.commitCompletion`: PostgreSQL locks Trip, Goal and Goal run,
validates owner/scope, revisions, context version and terminal-state rules, then
commits both planning statuses together. A concurrent cancel or stale completion
cannot leave one planning record satisfied and the other unfinished.

## Shared Artifact workspace

Artifact-producing tools and non-conversational actions use the domain workspace
in `backend/src/artifacts/workspace.ts`. It freezes the server-read Trip version,
checks cancellation/current operation, validates source owner/Trip/type/schema and
context version, and checkpoints after external work and before writes.
PostgreSQL repeats current Trip and Goal/run checks in the insert transaction.

Sources may be reused across Goals/runs only within the same owner, Trip and
context version. Old-version and unversioned legacy Artifacts remain readable as
history; without an explicit compatibility policy they cannot be composed into
a new current-version Artifact. The server returns a stable conflict instead of
copying a new version onto old evidence. This boundary applies equally to fare
search/confirmation, destinations, trip planning, research, guides and background
route generation. Tools never supply their own duplicate lineage-write policy.

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
- Input: `{ patch, expectedVersion?: number }`. The patch uses the Trip Context
  fields, with canonical location ID strings in `origin`, each
  `destinationIntent.required/preferred/excluded` entry,
  `locationRoleOverrides[].location`, and `requiredGroundLegs[].from/to`.
  IDs must come from this turn's authoritative location/destination results or
  the existing owned Trip. `origin: null` still clears the field. Unknown fields,
  unknown/ambiguous IDs and invalid ranges are rejected; the model cannot select
  another Trip ID. The shared patch schema preserves omitted fields; full-Trip
  defaults such as `requiredGroundLegs=[]` are not implicit edits. An explicit
  empty array clears a list.
- Output: `{ tripContext: TripContext, changed: boolean }`.
- Side effects: Mutates only the active Trip Context; it never writes User
  Memory or Conversation history.
- Cost class: `free`.
- Authority: Explicit current-user statements interpreted by the Agent and
  validated deterministically. One boundary restores canonical LocationRefs for
  every location field and validates the resulting Trip patch before mutation.
  Legacy full-object arguments remain compatible, but their ID/type select the
  trusted server record; copied names, countries, airport codes, coordinates and
  time zones cannot override its facts.
- Provider dependencies: None.
- Cache behavior: Invalidates any trip-context cache after a successful write.
- Failure behavior: Validation, authorization, or version conflicts are returned
  as structured tool errors; writes are atomic. When `expectedVersion` is omitted,
  the update is bound to the server version read for location resolution, so a
  concurrent Trip edit cannot silently replace the snapshot used by this patch.

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
  travelClass? }` using an IATA selector or a trusted airport ID. The fare domain
  resolves authoritative airport facts before a paid call; copied location
  descriptions cannot override the provider record.
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

Both research tools use `executeResearchBrief` to bind the request to one accepted
Trip/workspace snapshot. When `web_research.travelWindow` is omitted, it inherits
the same `researchTravelWindow(snapshot)` as `research_destination`: start from
the departure window, extend its latest departure by `travelDays - 1`, and use an
explicit return-window end when present. A Trip without dates supplies no window.
An explicit research window, including a partial window, is preserved; it is not
widened to manufacture goal coverage. The normal verifier still checks whether
saved evidence covers the accepted Trip. Defaults are applied before the new
research call and Artifact write, never to an existing Artifact. A changed Trip
version rejects the attempt at the workspace boundary.

Production research has an injected `ResearchQueryPlanner` for retrieval wording.
The domain first selects up to eight destination/question tasks; one bounded
OpenRouter request returns short terms for exactly those indexed tasks. The
planner cannot change task coverage, add sources or supply URLs/search operators.
Original questions remain in the saved brief and synthesis input. The search
adapter alone adds canonical destination, date-sensitive constraints and the
server source policy, with at most two search requests in flight. Invalid or
unavailable query planning falls back to the original sanitized query and adds
`research_query_planning_unavailable_or_invalid`. Caller cancellation propagates
through query planning, search and synthesis; the additional model request stays
inside the research tool's existing deadline. Shorter queries improve retrieval
intent but do not verify sources or guarantee results.

## Runtime-wide execution policy

- Tool arguments and tool results are schema validated.
- Unknown tools fail closed.
- The runtime enforces a maximum tool-step count, a configurable cost ledger,
  per-tool timeout, caller cancellation, generation-current guard, and
  structured traces. The production Planner's function-first configuration
  sets the ledger ceiling above its maximum possible per-turn tool-call cost,
  so cost does not block a valid plan in this milestone.
- Independent read-only calls may run concurrently. State mutations are ordered.
- Agent-facing tools call domain services/providers directly and never recurse
  through the Agent tool registry.
- Tool errors returned to the model are bounded, deterministic, and secret-free.

## Public Planner registry boundary (Phase 5)

`createPlannerToolRegistry()` is the vocabulary exposed by the public
conversation runtime. It includes:

```text
declare_goal
get_active_goal
resume_goal
finish_goal
cancel_goal
start_route_generation
get_trip_artifacts
read_artifact
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
but the model cannot call them directly. `start_route_generation` only queues
that deterministic composition after explicit conversational authorization.

The explicit action is an authenticated, owner-scoped run resource:

```text
POST   /v1/trips/:tripId/route-generation-runs
GET    /v1/route-generation-runs/:runId
DELETE /v1/route-generation-runs/:runId
```

HTTP creation represents the Generate Route button, requires `Idempotency-Key`, and accepts only the strict body
`{ conversationId?, expectedTripVersion? }`. The server snapshots the owned
Trip Context, validates an optional same-Trip Conversation, stores a canonical
request binding, creates an authorized durable Goal/run, and enqueues only the
opaque route-run ID. The Agent tool uses the same service with a server-derived
idempotency key and records `explicit_user_message`. Replaying the same key
returns the existing run; changing the request under an existing key is a
conflict. Reads and cancellation are owner-scoped. Cancellation is cooperative
and persistent, and terminal runs are immutable.

Run status is `queued → running → succeeded|failed|cancelled`, with bounded
progress, warnings, sanitized errors, and compact result Artifact references.
The worker uses the frozen context version and compares it with the live Trip.
A Trip edit encountered while queued/running fails the current attempt with
`TRIP_CONTEXT_VERSION_CONFLICT`; it cannot continue writing under the old
snapshot or relabel those results. Start a fresh run for revised conditions.
Results completed before a later edit remain auditable and may be shown as stale
with their original version. Generated Artifacts carry Goal ID, Goal run ID,
Trip Context version and source lineage. The shared completion service verifies
the accepted constraints and atomically commits the planning Goal/Goal-run
verdict, which may be `partial` even when route execution `succeeded`.

After a conversational start, the client reads the authenticated Trip workspace
and attaches the accepted run to the existing polling/cancellation flow. It does
not issue another creation request. Workspace responses refresh unfinished
message delivery verdicts through the same server verifiers.

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

`research_destination.destination` accepts the exact resolved location ID string; the server retrieves the complete canonical object from its per-turn ledger. Full-object callers remain compatible, but their descriptive fields never override a ledger record. Unknown IDs fail with a recoverable resolution prerequisite. This avoids making model-copied coordinates part of the authority check while preserving the same-turn provider requirement.
Route, research, guide and destination Artifacts now have client renderers. Cloud workspace restoration retains Artifact references and generation runs. Discovery runs constrained research through a dedicated Worker job and requires human publication; it adds no autonomous publish tool to the Planner registry. See [ADR 0008](./adr/0008-route-discovery-and-cloud-workspaces.md).
