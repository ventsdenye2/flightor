# ADR 0006: Phase 5 Agent API and Explicit Route Generation

- Status: Accepted; conversational authorization amended by ADR 0010 on 2026-09-08
- Date: 2026-09-07
- Owners: FlightOR architecture and integration owner
- Authority: `docs/FLIGHTOR_ARCHITECTURE.md`

## Context

Phases 0-4B established the tool-loop Planner, authenticated cloud state,
production route primitives, immutable Artifacts, and the restricted production
Research Agent. The mini-program still uses the legacy client-owned conversation
payload, while the cloud Planner previously lived behind a temporary migration
seam. Final route generation also needs a product action separate from ordinary
conversation so the model cannot start an expensive search without the user's
decision.

The current connection and path engines operate on one canonical airport origin
and one canonical airport destination. They can discover and rank bounded
stopover paths, but they do not yet compose multiple visit-city legs, round trips,
ground transfers, or city-stay schedules. Phase 5 must expose that boundary
honestly instead of presenting a partial path as a complete itinerary.

## Decision

### 1. One public Planner API

The authenticated public conversation endpoint is:

```text
POST /v1/agent/converse
```

Its strict request is camelCase and contains only `tripId`, `conversationId`, and
`message`. The user identity always comes from the access token. The server loads
the owned Trip, Conversation, Memory, and Artifact repositories; a body-supplied
user identity is never accepted.

The response contains the authoritative IDs, compact Trip Context summary,
reply, typed Artifact references with presentation hints, suggested actions,
bounded warnings, stop reason, and `memoryChanged` when applicable. Complete
Artifact payloads remain available through the owner-scoped Artifact endpoint
and are not copied into the model reply.

The temporary `agent-v2` product seam is removed rather than retained as a
second public API. The former rule-first converse implementation remains
unregistered during the cutover and is removed only after the new path and
mini-program regression suite pass.

### 2. Conversation cannot invoke final-route primitives

The conversation Planner uses a restricted registry. It can resolve locations,
update Trip Context and Memory, search flights, discover destinations, plan a
trip outline, research, and build a travel guide. It cannot call
`search_connection_flights`, `plan_flight_route`, `optimize_route`, or
`confirm_route_price`.

When the Trip contains enough supported input, the API may suggest a
`generate_route` action. That suggestion is metadata only. As amended by ADR
0010, an unambiguous current user instruction may call the zero-argument
`start_route_generation` domain operation; discussion, readiness, a suggestion,
or Planner inference cannot. The tool records `explicit_user_message`
authorization and queues the same deterministic service as the product button,
without exposing any internal route primitive to the model.

### 3. Route generation is an authenticated run resource

The explicit action creates a persistent run:

```text
POST   /v1/trips/:tripId/route-generation-runs
GET    /v1/route-generation-runs/:runId
DELETE /v1/route-generation-runs/:runId
```

Creation requires an `Idempotency-Key`. The strict body may bind the request to
the current Conversation and expected Trip Context version. The server derives
ownership from authentication, snapshots the accepted Trip Context, stores a
canonical request hash, and enqueues only the opaque run identifier. Reusing a
key with the same request returns the existing run; reusing it for different
input returns a conflict.

Public run IDs are UUIDs. Internal queue IDs are never exposed as product
identifiers. Reads and cancellation are owner-scoped. Status progresses through
`queued`, `running`, and exactly one of `succeeded`, `failed`, or `cancelled`.
Cancellation is cooperative and persistent: the API records the request and the
worker checks it at phase and provider boundaries. Terminal runs are immutable.

### 4. Frozen input and stale-result semantics

Generation uses the frozen Trip Context and version stored with the run. A later
Trip edit does not change a running job. Status responses retain that context
version and indicate when a successful result is stale relative to the current
Trip. A stale result remains auditable but is never silently applied as the
current route.

The create request may include `expectedTripVersion`; a mismatch fails before a
job is created. A supplied Conversation must belong to the same authenticated
user and Trip. Acceptance locks the owned Trip aggregate in the same transaction
that stores the frozen snapshot and enqueues the job, so a concurrent Trip edit
either wins first and causes a version conflict or waits until the run is fully
accepted. A soft preferred destination is never promoted into the final visit;
the run requires exactly one explicit required/visit destination.

### 5. Deterministic worker composition

The worker invokes domain services directly, not the Agent Tool Registry or an
LLM. The supported flow is:

```text
frozen Trip Context
  -> select one supported destination
  -> connection search
  -> bounded complete-path planning
  -> hard validation and Pareto optimization
  -> immutable route_set Artifact chain
```

Provider facts and fares come only from normalized production providers. Missing
or partial fare coverage remains an explicit warning or unavailable result; the
worker never manufactures a fare. Artifact references returned by the run are
compact, and the complete result is loaded through the Artifact API.

The worker heartbeats the claimed job while it is active and periodically
recovers stale processing jobs. A recovered route job is not eligible again
until the run heartbeat is old enough for the same reclaim window. Persistent
cancellation is rechecked before/after topology work and at each fare-provider
boundary. Every worker mutation predicates the row on `status = running`, so a
concurrent cancellation or terminal result always wins. If the queue job
exhausts its retry budget, the same atomic statement terminalizes any still
queued/running public run with a sanitized error; clients are never left polling
a run that has no remaining job.

### 6. Supported MVP shape

Phase 5 generation accepts exactly one final visit destination that resolves to
a canonical airport, with an origin airport and bounded departure window. The
route engine may select intermediate connections and playable stopovers within
its Phase 4 limits.

Multiple visit destinations, a return window, round-trip composition, and
required ground legs fail with an explicit unsupported-input error. They are not
silently truncated, reordered, or represented as a completed route. A later leg
orchestrator may extend the same run resource without changing the authorization,
idempotency, cancellation, or Artifact boundaries.

### 7. Mini-program session migration

The mini-program creates or resumes an authenticated cloud Trip and Conversation,
then sends only the new request shape. Persisted session identifiers are scoped
to the authenticated owner. Logging out clears access credentials and owner-bound
session material.

Legacy local histories remain readable for migration but are not replayed into
the new API as authoritative state. The client does not synthesize legacy
`state`, recommendation, route, or price objects from the new reply. Authentication
and network failures remain visible errors rather than mock assistant messages.

### 8. Observability and bounded output

Conversation messages store request and generation IDs, compact tool traces,
Artifact IDs, and stop reason. Route runs store phase, status, timestamps,
heartbeat/cancellation state, bounded warnings, and sanitized errors. General
logs may include safe user, Trip, Conversation, run, job, provider, and duration
identifiers, but never API keys, tokens, or full private Memory.

## Validation requirements

- Request/response schema tests for the new public conversation endpoint.
- Authentication and cross-owner rejection for Trip, Conversation, Artifact,
  and route-run resources.
- Tests proving the Planner registry excludes final-route primitives and that
  only the dedicated, explicitly authorized start operation can queue them.
- Idempotency replay/conflict, expected-version conflict, frozen input,
  cancellation, terminal-state, and stale-result tests.
- Explicit rejection tests for return windows and unsupported multi-visit input.
- Worker success, provider partial failure, cancellation, and no-fake-fare tests.
- Mini-program transport/session tests proving exact request shape, owner-scoped
  persistence, logout cleanup, and no silent mock fallback.
- Full backend and root tests, typecheck, builds, and `git diff --check`.
- PostgreSQL concurrency tests for Trip-edit acceptance, cancellation versus
  progress writes, job heartbeat, and stale recovery (enabled by
  `TEST_DATABASE_URL`).

## Consequences

FlightOR has one authenticated Planner API and an explicit, auditable boundary
between planning conversation and expensive deterministic route generation.
The run resource is suitable for mini-program polling and later orchestration
growth. The first generation slice remains narrower than the product's intended
multi-city and round-trip experience; that limitation is visible in contracts
and UI rather than hidden behind incomplete results.

## Acceptance status

The Phase 5 code gate passed on 2026-09-07. The final tree passed 294 backend
tests (with five database-dependent tests skipped), the complete root regression
suite, backend and frontend TypeScript checks, backend and WeChat builds, and
`git diff --check`. Independent review found no remaining P1 blocker.

The accepted fixes include transaction-serialized Trip/run acceptance,
provider-boundary cancellation checkpoints, worker heartbeat and stale recovery,
terminal job exhaustion, resumable race-safe client polling, sequential weekly
service-date materialization, semantic city preference/exclusion across
constituent airports, bounded calendar windows, and stable bounded route IDs.
The real PostgreSQL concurrency suite remains opt-in through
`TEST_DATABASE_URL`; live migrated-database and credentialed-provider smoke tests
remain deployment acceptance, not hidden code-gate passes.
