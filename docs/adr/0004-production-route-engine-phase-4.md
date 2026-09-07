# ADR 0004: Phase 4 Production Route Engine

- Status: Accepted
- Date: 2026-09-07
- Owners: FlightOR architecture and integration owner
- Authority: `docs/FLIGHTOR_ARCHITECTURE.md`

## Context

Phase 3 established strict Agent tools and provider-free service seams for
connection discovery, path planning, and route optimization. Production still
injects unavailable implementations. Phase 4 must replace those placeholders
without importing legacy HTTP DTOs, OAG payloads, or LLM-generated routes as
domain authority.

The existing PostgreSQL schema already contains versioned topology, airport,
schedule, and connection data. AeroDataBox is the primary aviation provider,
but its airport route endpoint is a statistical snapshot rather than a complete
schedule graph. OAG remains an optional ingestion source. Missing provider keys
or partial topology therefore cannot be interpreted as proof that a route is
unreachable.

## Decision

### 1. Engine ownership and data flow

The production flow is:

```text
trusted Trip Context + canonical locations
  -> TopologyRepository (active normalized PostgreSQL snapshot)
  -> ProductionConnectionSearchService (preferred-first, then general graph)
  -> DeterministicFlightRoutePlanner (bounded path enumeration)
  -> ParetoRouteOptimizer (hard constraints, Pareto frontier, representatives)
  -> versioned route_set artifacts
```

The Planner Agent may select tools and explain persisted results, but it does
not construct graph paths or scores. Route services do not call the Tool
Registry, LLMs, legacy route-plan directives, or provider-specific HTTP routes.

### 2. Topology repository boundary

`TopologyRepository` is the only Phase 4 route-engine reader of topology tables.
It returns normalized `TopologySnapshot` and `TopologyCandidatePath` values. It
does not expose SQL rows, provider keys, OAG contracts, or legacy reachability
responses.

No database migration is required for the first production slice. The adapter
uses the existing `topology_versions`, `airports`, `cities`, `route_edges`,
`schedule_services`, and `connection_options` tables. Missing terminal,
airport-change, timezone-aware instant, or MCT facts remain explicitly unknown
and produce verification metadata or warnings; they are never guessed.

An absent active snapshot or a partial-coverage miss yields `unknown`. Only a
complete active snapshot may establish `unreachable` within the bounded query.

### 3. Connection discovery and cost bounds

Connection discovery applies hard exclusions before paid work, searches
preferred hubs first, and then always searches general hubs. Preferred
locations are bonuses, not an exclusive allow-list. `stopover_only` locations
may be transit nodes but are not silently promoted to required visits.

The first production algorithm is deliberately bounded:

- at most two transfers in topology expansion;
- at most 500 normalized edge candidates and 200 complete paths;
- deterministic ordering and cycle prevention;
- no fare call for structurally rejected candidates;
- a configurable fare shortlist and total provider-call budget;
- 10 hours for a playable stopover and 18 hours for a strong stopover signal;
- self-transfer rejected unless the active trip explicitly allows it;
- same-airport self-transfer below 8 hours and airport-change transfer below
  12 hours are rejected when those facts are known.

Fare enrichment is best-effort. Provider failure preserves structurally valid
candidates as partial/unknown with warnings; it does not fabricate a price.

### 4. Path planning hard constraints

`DeterministicFlightRoutePlanner` receives only canonical nodes, normalized
connection edges, a date window, and explicit normalized constraints. It checks
endpoint consistency, date ordering, required and excluded locations,
self-transfer and airport-change policies, transfer/duration/travel-day limits,
cycles, and known connection feasibility before scoring.

It uses stable adjacency ordering and bounded depth-first/beam enumeration.
`truncated=true` means a configured bound stopped exploration.
`exhausted=true` means all candidates within the declared bounded world were
examined. Unknown verification may remain a partial path but is never promoted
to verified feasibility.

### 5. Optimization and explanations

`ParetoRouteOptimizer` scores only paths that passed hard validation. Scores are
normalized to `[0, 1]` and include the positive dimensions in the architecture
plus these explicit penalties:

- total travel time;
- transfer count;
- self-transfer risk;
- airport-change penalty;
- backtracking penalty;
- dead-time penalty;
- excessive complexity.

Unknown positive facts contribute zero. Unknown risk facts receive a
conservative penalty. Weights use a strict controlled schema and are clamped;
arbitrary model-defined dimensions are rejected.

Dominated candidates are removed before representative selection.
Representatives are `cheapest`, `balanced`, `most_fun`, and `best_match`. The
same route may receive multiple badges, and the implementation does not invent
four distinct routes when fewer unique representatives exist.

Explanations are deterministic structured output derived from hard-constraint
checks and score contributions. Every optimized artifact records service and
algorithm versions, normalized score breakdown, trade-offs, and warnings.

### 6. AeroDataBox adapter

The production adapter supports both direct and RapidAPI gateways with explicit
authentication modes. It initially maps airport lookup, airport term search,
airport FIDS schedules, daily route statistics, and flight status. It preserves
partial fields and normalizes all non-2xx responses into bounded, secret-free
errors. HTTP 204 is a valid empty result and is distinct from provider outage.

AeroDataBox airport search is not treated as general city resolution. City
resolution continues through FlightOR-owned reference data or another approved
provider. Daily route statistics are not presented as authoritative weekly
schedules, and FIDS data is not fare or booking availability.

### 7. Production composition and compatibility

Phase 4 replaces unavailable route services only in the isolated cloud Agent
composition. The legacy `/v1/agent/converse`, legacy route endpoints, and
mini-program protocol remain unchanged. OAG is never a required runtime
dependency. Mock and unavailable implementations remain for tests and graceful
degradation.

## Validation requirements

- AeroDataBox HTTP/auth/error/normalization tests without live credentials.
- PostgreSQL topology adapter tests, including complete-versus-partial coverage.
- Connection-search tests for preferred-first/general fallback, exclusions,
  self-transfer, cost bounds, partial provider failure, and deterministic order.
- Synthetic golden-world tests for path constraints, truncation, Pareto
  dominance, badge merging, tie-breaking, conservative unknown scoring, and
  deterministic explanations.
- Cloud Agent composition test proving production services replace Phase 3
  unavailable placeholders without changing the public v2 contract.
- Full backend tests/typecheck/build, root regressions, mini-program build, and
  `git diff --check`.

## Consequences

Phase 4 creates a production, provider-normalized route engine while preserving
the migration boundary around the old system. It intentionally leaves exact
terminal and airport-change calculations, global schedule completeness, and
advanced topology caching for later evidence-backed iterations rather than
guessing facts the current schema cannot prove.

## Provider references

- [AeroDataBox official API documentation](https://doc.aerodatabox.com/)
- [AeroDataBox direct-gateway OpenAPI](https://doc.aerodatabox.com/docs/openapi-direct-v1.json)
- [AeroDataBox RapidAPI OpenAPI](https://doc.aerodatabox.com/docs/openapi-rapidapi-v1.json)
- [AeroDataBox official plan limits](https://aerodatabox.com/pricing/)
