# ADR 0001: Parallel Agent Runtime Foundation

- Status: Accepted for Phase 0 and Phase 1 implementation
- Date: 2026-09-06
- Authority: `FLIGHTOR_ARCHITECTURE.md`

## Context and current-to-target gap

The repository already has a Fastify backend, OpenRouter, SerpApi and OAG
clients, deterministic route/search code, two Agent endpoints, and a working
mini-program. The current `/v1/agent/converse` path nevertheless applies
business-language rules before the LLM and then accepts only model deltas that
those rules can prove. State is client-round-tripped as one legacy `TripState`.
OpenRouter returns untyped provider JSON and cannot carry tool schemas,
assistant tool calls, or tool-result messages.

Provider clients are concrete dependencies exposed through one `Providers`
object. SerpApi fare normalization lives partly in the HTTP route, while OAG is
used directly for topology/schedules. There is no FlightOR-owned
`AviationProvider`/`FareProvider` boundary, no AeroDataBox configuration, no
mock provider contract, no tool registry, and no per-turn tool/cost budget.

The frontend expects the existing conversation and flight-search response
shapes, and the existing database does not yet separate cloud Conversation,
Trip Context, User Memory, and Artifacts. Those Phase 2+ migrations must not be
pulled into this foundation milestone.

## Decision

1. Build a typed tool-calling runtime beside the legacy conversation agent.
2. Keep both existing Agent endpoints and frontend contracts unchanged during
   Phase 1; prove the vertical slice at the runtime/service boundary first.
3. Introduce FlightOR-owned provider/domain types. Concrete AeroDataBox, OAG,
   and SerpApi payloads may not cross those boundaries.
4. Use an in-memory, versioned Trip Context repository only as a Phase 1 seam.
   It is not cloud persistence and will be replaced behind the same interface
   in Phase 2.
5. Preserve the existing manual flight-search route while moving its reusable
   normalization behind `SerpApiFareProvider`. A later compatibility adapter
   will make manual and Agent search persist the same artifact path.
6. Add caller cancellation and typed completion parsing to OpenRouter without
   changing the legacy `chat()` return shape.
7. AeroDataBox is the primary aviation configuration. The Phase 1 shell fails
   explicitly for unimplemented capabilities; it never silently falls back to
   invented or catalog-only airport facts. OAG remains optional.

## Phase 0 plan and acceptance

1. Record this gap analysis and migration decision.
2. Create root `TOOLS.md` and keep implementation status honest.
3. Record baseline backend typecheck/test/build and root build behavior.
4. Make no destructive frontend, database, or directory changes.

Acceptance: documentation exists, legacy files are untouched, and baseline
failures are recorded rather than suppressed.

## Phase 1 plan and acceptance

1. Extend OpenRouter with typed tool schemas/messages, normalized completion
   parsing, bounded reasoning options, and abort propagation.
2. Add the runtime loop and registry with Zod argument/result validation,
   ordered mutations, safe parallel reads, step/cost/time bounds, traces,
   cancellation/generation guards, and deterministic fallback.
3. Add `TripContext` types and a versioned repository seam.
4. Add `AviationProvider` and `FareProvider` contracts, mock providers,
   AeroDataBox shell/configuration, optional OAG adapter seam, and normalized
   SerpApi fare adapter.
5. Register `get_trip_context`, `update_trip_context`, `resolve_location`, and
   `search_flights` in a first tool set.
6. Add contract/runtime/provider and complete mocked conversation tests.
7. Run backend typecheck, all backend tests, backend build, and applicable root
   checks. Do not delete or switch the legacy agent.

## Compatibility and consequences

- Existing `/v1/agent/converse`, `/v1/agent/chat`, `/v1/flight-searches`, route
  planner, stores, and pages remain operational and unchanged in Phase 1.
- Some capability is intentionally duplicated temporarily at adapter seams;
  shared domain services replace it before public API cutover.
- The Phase 1 in-memory trip repository is process-local and test-oriented. It
  must not be represented as multi-device cloud state.
- No OAG key is required to construct or test the new runtime.
