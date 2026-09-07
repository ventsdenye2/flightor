# ADR 0007: Phase 6 Plan and Flight Workspace

- Status: Accepted
- Date: 2026-09-07
- Owners: FlightOR architecture and frontend integration owner
- Authority: `docs/FLIGHTOR_ARCHITECTURE.md`

## Context

Phase 5 made the authenticated Planner and explicit route-generation run the
product path. The mini-program still presents that path through a large legacy
Plan component, turn-shaped JSON panels, and a separate Search tab backed by a
legacy response model. Artifact references are persisted, but they are not yet
first-class timeline items and complete Artifact payloads are not rendered by a
typed registry.

The existing `/v1/flight-searches` route and `flightService` also predate the
cloud-state boundary: they return an inline search response rather than an
owner-scoped immutable `flight_search` Artifact. Agent `search_flights` already
creates the correct Artifact. Phase 6 must unify those paths before visual
polish so manual and Agent searches cannot drift.

## Decision

### 1. Primary navigation and page ownership

The primary tabs become, in order:

```text
Plan | Explore | Trips | Profile
```

Plan is the default Trip Workspace. Search is removed from the tab bar but its
capability remains available through the Flight Explorer subpage. `pages/search`
is retained as the migration target for that subpage; `pages/index` stops being
a primary product entry.

### 2. Plan is a Trip Workspace

The workspace has four separate layers:

1. compact, editable Trip Context chips;
2. user and Planner conversation messages;
3. immutable Artifact cards associated with the turn that produced them;
4. explicit product actions, including Flight Quick Search and Generate Route.

The UI does not print the Trip Context JSON. Removing a chip is an explicit
Trip Context edit, not a local display-only mutation. Generate Route is enabled
only when the server advertises the action and cloud identifiers are valid;
mock mode never advertises an unavailable route-generation capability.

### 3. Artifact renderer registry

`ArtifactRef` remains compact in conversation and history state. The client
loads the complete payload through owner-scoped `GET /v1/artifacts/:id`, caches
it per owner/session, validates the common envelope, and dispatches by
`type + schemaVersion + payload.kind`.

The initial registry supports:

```text
flight_search                -> FlightSearchCard
research                     -> ResearchCard / ActivityCard
travel_guide                 -> TravelGuideCard
route_set:connection_edges   -> RoutePreview
route_set:flight_paths       -> RoutePreview
route_set:optimized_routes   -> RoutePreview / Generate result entry
```

Unknown or unsupported Artifact versions render a bounded unavailable card.
They are never guessed, cast into another renderer, or copied into the Planner
reply string. Loading, retry, empty, unavailable, stale, and owner/session-change
states are visible.

### 4. One flight-search domain path

Manual Flight Quick Search and Agent `search_flights` share one backend domain
service that:

```text
validates canonical locations and dates
-> invokes FareProvider
-> validates returned route facts
-> stores one immutable owner-scoped FlightSearchArtifact
-> returns a compact ArtifactRef and summary
```

The authenticated manual REST action binds the Artifact to an owned Trip and
required owned same-Trip Conversation because the Phase 6 entry point is the
Plan workspace. It may expose a query-oriented request shape for
the UI, but it cannot call the legacy inline search implementation as a second
business path. The old inline route remains compatibility-only until Phase 10
and is not used by the new Plan or Flight Explorer flow.

### 5. Flight Explorer is Artifact-driven

Flight Explorer receives an Artifact ID (or starts the same authenticated
manual search action), then derives filters, sorting, flexible-date matrix,
alternate-airport presentation, map, and risk warnings from validated Artifact
facts. Production UI never imports mock airport, deal, hub, coordinate, or price
data. Missing dimensions remain absent or explicitly unavailable.

### 6. State and race safety

Artifact loads and quick searches capture owner, Trip, Conversation, and local
session at start. Late responses after logout or session switch are ignored.
Only persisted refs and compact view state enter local history; complete
Artifact payloads remain server authority. Retry is bounded and every search
submit uses a required `Idempotency-Key`. The current single-process deployment
uses a 24-hour, 512-entry owner-scoped in-memory store that deduplicates
concurrent requests and rejects key reuse with different input. A multi-instance
deployment must replace this store with the same contract backed by PostgreSQL
or Redis.

### 7. Visual system

Phase 6 uses the locked system in `docs/design/phase6-design-system.md` and the
two concept images in `docs/design/`. Visual fidelity cannot override data
truth, accessibility, mini-program constraints, or the contracts above.

## Validation requirements

- Backend contract tests prove manual and Agent search share the Artifact
  creation service and enforce Trip/Conversation ownership.
- Client tests cover Artifact envelope validation, renderer dispatch, loading
  failure, owner/session invalidation, quick-search request shape, and navigation.
- Plan tests prove messages and Artifact cards remain separate and mock mode has
  no enabled Generate Route action.
- Flight Explorer tests prove no production mock imports and deterministic
  filtering/sorting from Artifact payloads.
- Typecheck, backend tests/build, root regression tests, WeChat build, and
  `git diff --check` pass at the automated phase gate. Rendered or real-device
  interaction remains a separately recorded manual acceptance item when the
  required runtime is unavailable.

## Consequences

Phase 6 removes Search as a top-level mental model without removing flight
search. The Trip Workspace becomes the single planning surface, and Artifact
renderers become reusable foundations for Phase 7 route visualization and
Phase 9 Trips. A small compatibility surface remains until the final cleanup,
but new product code has one flight-search authority.

## Acceptance record

Accepted implementation evidence on 2026-09-07:

- backend: 64 test files / 301 tests passed, with 5 database integration tests
  explicitly skipped because `TEST_DATABASE_URL` was not supplied;
- frontend: Trip Context 8/8, Artifact/flight/auth-state 19/19, Phase 6 contract
  18/18, and the complete root regression suite passed;
- backend and frontend TypeScript checks passed;
- backend build and WeChat mini-program production build passed;
- no live SerpApi/AeroDataBox/OpenRouter call, authenticated device session, or
  real-device visual QA was claimed.

Independent review found no remaining P1/P2 issue after the legacy selected-
flight `planTrip` branch was removed. Plan now has one Agent-backed Trip
Workspace authority; logout and account/session changes also invalidate late
flight and authentication responses.

The current manual UI accepts one canonical airport pair, one exact outbound
date, and an optional exact return date. Unsupported alternate-airport and
stay-range controls were removed instead of silently narrowing them. The shared
domain action still supports an explicit bounded departure window for callers
that can present the sampled-date Artifact honestly. A production per-cell
matrix remains withheld until the Artifact contains matrix facts.

Rendered H5 QA was not claimed: this checkout does not include
`@tarojs/plugin-platform-h5` or Playwright. The installed WeChat DevTools CLI
also lacked an initialized targetable IDE profile in this environment. The
production WeChat build is accepted; real-device/rendered interaction remains
an explicit manual acceptance item rather than being inferred from static
checks.
