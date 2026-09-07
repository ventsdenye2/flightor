# ADR 0005: Phase 4B Core Tools and Production Research

- Status: Accepted
- Date: 2026-09-07
- Owners: FlightOR architecture and integration owner
- Authority: `docs/FLIGHTOR_ARCHITECTURE.md`

## Context

Phase 4 made connection discovery, bounded path construction, and Pareto route
optimization production capabilities. Before the new Planner becomes the public
product path, FlightOR still needs the remaining destination, trip-structure,
fare-confirmation, destination-research, and travel-guide tools. Phase 3 also
defined a restricted `ResearchAgent` seam whose production implementation is
intentionally unavailable.

The repository already contains a small curated destination catalog, legacy
trip-plan and travel-guide code, a normalized `FareProvider.refreshFlight`
operation, immutable Artifact persistence, and a shared SerpApi HTTP client.
Those pieces are useful inputs, but their old request DTOs and rule-first flows
must not become authority for the new Agent architecture.

## Decision

### 1. Tool-to-domain boundaries

The Phase 4B flow is:

```text
Planner tool
  -> strict artifact/context binding
  -> destination, trip-structure, fare, research, or guide domain service
  -> immutable versioned Artifact
  -> compact summary + artifact reference
```

Agent-facing tools never call other Agent-facing tools. Complete destination,
route, research, confirmation, and guide payloads remain outside the model
context. The active authenticated repositories enforce user and trip ownership;
model-supplied IDs are only lookup keys.

### 2. Destination discovery and recommendation

`search_destinations` performs an explicit bounded catalog search. It may use a
canonical Trip origin to annotate normalized aviation accessibility, but a
provider failure produces `unknown` accessibility rather than a fabricated
route. The first implementation is honest about curated-catalog coverage and
does not present the catalog as a complete global destination index.

`recommend_destinations` reads the active Trip Context and enabled User Memory
inside the trusted tool boundary. Trip exclusions and `avoid` overrides are hard
constraints. Required destinations are retained; preferred destinations,
interests, cost tier, and available accessibility are deterministic soft
signals. Memory may contribute only bounded, explainable catalog matches and
never overrides a current-trip exclusion.

Both tools create `destination_set` schema-version-1 artifacts. Each candidate
contains a canonical location, catalog metadata, deterministic score/reasons,
accessibility status, and verification metadata. The Planner receives at most a
small candidate preview and coverage warnings.

### 3. Trip route structure

`plan_trip_route` consumes an owner-scoped `destination_set` artifact and the
active Trip Context. A deterministic `TripRoutePlanner` allocates the declared
travel days across required/selected visit cities, respects `visit`,
`stopover_only`, and `avoid` roles, and rejects impossible minimum-stay or
travel-day constraints. It does not search or optimize flights.

The result is an immutable `route` schema-version-1 artifact with a
`trip_route_plan` discriminator. It stores the ordered cities, visit duration,
day allocation, explicit activity references, unresolved ground-transfer
seams, source artifact IDs, deterministic reasons, and warnings. It never
invents an attraction, transfer duration, coordinate, or price. Research facts
may be referenced only through validated owner-scoped Research Artifacts.

### 4. Fare confirmation

`confirm_flight_price` accepts only a `flight_search` artifact ID and offer ID.
The query, route endpoints, and original offer are loaded from the Artifact;
the model cannot resubmit or alter them. Confirmation calls
`FareProvider.refreshFlight`, validates exact query/offer binding, and creates a
new immutable `flight_search` snapshot. It never mutates or silently blesses the
source artifact.

`confirm_route_price` accepts a supported `route_set` artifact and a bounded
path selection. It confirms only fare-critical edges, with at most two provider
calls concurrently and a fixed maximum call count. Strong
`fareArtifactId`/`fareOfferId` bindings are validated through Artifact
persistence. Existing route edges that contain only an offer ID are supported
as an explicitly weak migration binding using the edge's canonical endpoints
and date; such an edge cannot make the route fully verified.

Each successful leg produces a new fare snapshot. The route confirmation
creates a successor `route_set` artifact whose `sourceArtifactIds` retain the
original route and new fare snapshots. Partial failures preserve structurally
valid legs but remove any claim that an unrefreshed fare is current. Provider
outage, offer disappearance, stale data, and total failure are explicit and
never replaced with an estimate or fake price.

### 5. Restricted production Research Agent

The production research flow is:

```text
validated minimal ResearchBrief
  -> bounded query plan
  -> ResearchSearchProvider
  -> normalized source candidates
  -> optional model synthesis over those candidates only
  -> deterministic verification
  -> ResearchArtifact v2
```

`ResearchSearchProvider` is a dedicated domain interface. A
`SerpApiResearchSearchProvider` may share the existing SerpApi HTTP transport,
but it does not implement or depend on `FareProvider`. Search requests and
results are bounded, normalized, de-duplicated by URL, and restricted to safe
HTTP(S) URLs without credentials. Search metadata errors and missing keys are
explicit unavailable states.

`ProductionResearchAgent` receives only `ResearchBrief`, request ID,
cancellation signal, and an optional bounded preference summary. It has no
Trip, Memory, Conversation, Artifact, aviation, fare, route-engine, or Tool
Registry dependency. Its categories remain `event`, `seasonal`, `activity`,
`stopover`, and `practical`.

Model synthesis is constrained to indexed normalized search candidates. The
model may summarize and group evidence, but it cannot create source URLs or
assign final verification. Malformed synthesis falls back to conservative
source summaries rather than failing the whole route-planning product.

### 6. Research verification and compatibility

New research writes use `ResearchArtifact` schema version 2. Every finding
stores its category, destinations, bounded summary, source records, and the
standard `VerificationRecord`:

```text
status, checkedAt, expiresAt?, confidence, sources
```

Source classification is deterministic and recorded. Important event/date
claims become at most `partially_verified` with one recognized authoritative
source or at least two independent supporting domains because the current
provider supplies snippet-only evidence. A date visible only in a search result
title, date field, or snippet is never sufficient for `verified`; that status
requires a future fetched or structured authoritative-evidence mode. This cap
applies to every current Research category, not only events. A bounded warning
also discloses destinations skipped when a brief exceeds the per-run search-call
limit.

The reader accepts legacy Research Artifact v1 for migration, but tools never
rewrite old payload meaning in place. `web_research` remains a compatibility
tool over the same domain helper; `research_destination` is the preferred
Planner vocabulary. Neither tool mutates Trip Context or Memory, and Research
findings never automatically become required destinations or events.

### 7. Travel guide composition

`build_travel_guide` consumes a trusted trip-route/route artifact and optional
Research Artifacts. A deterministic `TravelGuideBuilder` references verified or
explicitly partial findings, activity IDs, and route locations. It creates a
`travel_guide` schema-version-1 artifact and exposes provenance internally.
Unknown days remain open suggestions; the service does not fill gaps with
invented attractions or provider facts. The legacy `travel-guides` endpoint can
remain during migration but is not the new Agent's authority.

### 8. Model configuration and production composition

Deployment supports `PLANNER_MODEL` and `RESEARCH_MODEL`. Each defaults to the
configured `OPENROUTER_MODEL` compatibility value, so existing deployments do
not change behavior. The cloud Planner passes `PLANNER_MODEL` explicitly to the
runtime. The research synthesis adapter passes `RESEARCH_MODEL` explicitly.
Domain code depends on model-neutral interfaces and contains no vendor or model
name.

When research credentials are unavailable, production composition injects the
explicit unavailable Research Agent. Routing, destination catalog search, and
trip structure remain usable. OAG remains optional.

### 9. API and legacy compatibility

Phase 4B adds capabilities only to the isolated cloud Planner composition. It
does not switch `/v1/agent/converse`, delete the rule-first
`conversation-agent`, change the mini-program protocol, or refactor product
tabs. Phase 5 owns the public API cutover after this phase passes review and the
full validation gate.

## Validation requirements

- Strict contract tests for all seven new tools, artifact envelopes, compact
  outputs, cancellation, owner/trip binding, and malformed downstream output.
- Destination tests for hard exclusions, Memory-vs-Trip precedence, partial
  catalog coverage, deterministic ranking, and provider-unavailable fallback.
- Trip-route tests for minimum stays, bounded day allocation, role overrides,
  artifact references, and absence of invented facts.
- Fare confirmation tests for exact and weak bindings, immutable successors,
  disappeared offers, partial provider failure, bounded concurrency, and no
  fake current total.
- Research provider, synthesis, and verification tests covering safe URLs,
  de-duplication, source independence, event/date evidence, cancellation,
  missing credentials, and conservative fallback.
- Travel-guide tests proving route/research ownership and reference-only
  composition.
- Full backend tests/typecheck/build, root regressions, mini-program build, and
  `git diff --check`.

## Consequences

Phase 4B completes the v1 Core Tool vocabulary without importing legacy DTOs or
creating a second provider stack. Immutable successor artifacts make freshness
and provenance auditable. Research becomes production-capable while remaining
strictly advisory and isolated from user-owned state. Curated destination
coverage and snippet-only evidence remain explicit limitations rather than
being presented as global or fully verified facts.

## Provider references

- [SerpApi Google Search API](https://serpapi.com/search-api)
- [SerpApi organic results schema](https://serpapi.com/organic-results)
- [SerpApi status and error codes](https://serpapi.com/api-status-and-error-codes)
