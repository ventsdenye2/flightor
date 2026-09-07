# ADR 0003: Phase 3 Core Tool Contracts

- Status: Accepted
- Date: 2026-09-06
- Owners: FlightOR architecture and integration owner
- Authority: `docs/FLIGHTOR_ARCHITECTURE.md`

## Context

Phase 0/1 established the Tool Calling Runtime, provider abstractions, and the
first trip/location/flight vertical slice. Phase 2 established authenticated,
owner-scoped cloud state and artifact persistence. Phase 3 completes the first
Core Tool surface while preserving the deliberate separation between Planner,
Research Agent, providers, and the deterministic FlightOR engine.

The architecture assigns graph construction, bounded path search, and Pareto
optimization to Phase 4. Phase 3 therefore freezes typed service boundaries,
mock implementations, tool contracts, artifact handoffs, and failure semantics.
It does not disguise missing engine capability with LLM route generation or
legacy route-plan directives.

## Decision

### 1. Phase 3 scope

Phase 3 adds these Agent-facing tools:

- `search_flexible_flights`
- `search_connection_flights`
- `plan_flight_route`
- `optimize_route`
- `web_research`

The existing `get_trip_context`, `update_trip_context`, `resolve_location`,
`search_flights`, `get_user_memory`, and `update_user_memory` contracts remain
compatible.

### 2. Artifact handoff is the default

Tools persist complete normalized results and return only an artifact reference,
a compact summary, warnings, and bounded status metadata to the Planner. Tools
that consume prior results accept artifact IDs rather than inline provider
payloads. Artifact lookup remains authenticated and owner/trip scoped.

Phase 3 uses existing artifact types:

- flexible fare results: `flight_search`, schema version 2;
- connection candidates, complete paths, and optimized sets: `route_set`, with
  an explicit `kind` discriminator;
- research results: `research`, schema version 1.

Artifact schema versions describe payload contracts, not database migrations.
The relational artifact envelope remains unchanged.

### 3. Flexible fare search

`search_flexible_flights` accepts canonical airport references and a bounded
departure window of at most 31 calendar days. A supplied return date is fixed
for every sampled departure date in this phase. Providers may sample rather than
exhaust the window; the artifact and compact result must disclose scanned,
successful, and failed dates.

The tool calls `FareProvider.searchFlexibleFlights`, validates every normalized
result and route endpoint, and persists a single version-2 `flight_search`
artifact containing the window and nested per-date results. It never flattens
away date provenance or guesses a fare. An empty successful search is valid;
total provider failure is a bounded tool failure.

### 4. Deterministic route service seams

The runtime receives three explicit domain dependencies:

- `ConnectionSearchService`
- `FlightRoutePlanner`
- `RouteOptimizer`

Their boundaries are:

- connection search may orchestrate normalized topology, aviation, and fare
  services internally, but never calls Agent tools;
- route planning consumes canonical constraints and candidate-edge artifacts and
  performs no provider calls;
- optimization consumes complete paths and performs no discovery or provider
  calls.

The three tools persist typed `route_set` artifacts with `kind` equal to
`connection_edges`, `flight_paths`, or `optimized_routes`. Each payload records
its algorithm/service version, source artifact IDs, verification state,
warnings, and bounded/truncated status.

Until Phase 4 supplies production algorithms, production composition injects
explicit unavailable implementations. These fail with bounded, secret-free
errors. Mocks provide deterministic contract and end-to-end tests. The legacy
`route-plans` implementation and topology HTTP responses are not imported as
new domain authority.

### 5. Trusted references

Locations used as facts must be canonical and runtime-trusted: resolved during
the current generation or loaded from the persisted Trip Context. Model input
cannot create trust. Route tools load source artifacts through the active
authenticated Artifact Repository and reject missing, cross-owner,
cross-trip, wrong-type, or malformed payloads.

`unknown` coverage is distinct from `unreachable`. Self-transfer is not treated
as protected unless normalized authoritative data explicitly says so.

### 6. Research boundary

`web_research` delegates only a validated `ResearchBrief` to `ResearchAgent`.
The execution context contains only request ID and cancellation signal. It does
not expose Conversation, Trip Context, Memory, aviation/fare providers, or the
Tool Registry. The full `ResearchArtifact` is validated and persisted; the
Planner receives a compact artifact reference and summary.

No unrestricted legacy search pipeline, full Conversation inheritance, Memory
write, Trip mutation, route decision, or structured flight/location lookup is
allowed inside Research Agent. Production research may remain explicitly
unavailable until the later Research/Discovery phase; routing continues without
fabricated research.

### 7. Runtime and compatibility

All new tools use strict schemas, bounded inputs, timeouts, cost metadata,
cancellation, generation-current checks before persistence, and compact
secret-free failures. Artifact-producing tools are stateful and are not marked
parallel-safe.

Phase 3 does not switch `/v1/agent/converse`, remove the old
conversation-agent, change Plan/Search/Explore/Profile, require OAG, or alter the
mini-program protocol. Agent API migration remains Phase 5.

## Validation requirements

- Unit and contract tests for every service seam and mock.
- Tool tests for strict validation, trusted locations/source artifacts, compact
  output, complete persistence, malformed downstream output, cancellation, and
  unavailable capability.
- Flexible search tests for window bounds, sampled-date disclosure, empty
  success, and endpoint integrity.
- Route tests for artifact kind/version checking and deterministic handoffs.
- Research tests proving minimal context and no Trip/Memory mutation.
- Backend tests, typecheck, and build; root regression tests; mini-program build;
  and `git diff --check`.

## Consequences

Phase 3 exposes the complete first Core Tool vocabulary without prematurely
claiming that Phase 4 route algorithms or later production research exist. The
typed seams allow those capabilities to replace unavailable implementations
without changing Planner-facing tool contracts. Persisted, versioned artifacts
keep large provider and engine outputs out of model context and preserve audit
and ownership boundaries.
