# ADR 0012 — Agent-authored travel guide MVP

Status: accepted, scoped implementation, 2026-09-08.

Product scope and runnable commands: [路线研究与攻略生成 MVP](../design/travel-guide-mvp.md).
Live verification and limitations: [DEMO_STATUS](../DEMO_STATUS.md).

## Context

The user wants useful, personal and interesting daily itineraries promptly. The
existing deterministic guide builder distributes research findings after a fixed
route outline, while the Planner can only provide artifact references. Its
selection rules also differ from the final Goal verifier, allowing a guide to be
saved and then rejected for stale research, dates or result limits.

## Decision

1. Limit this change to travel research, daily itinerary composition, validation
   and existing guide presentation. Preserve the current flight-search/route
   engine, Trip, Conversation and durable Goal contracts.
2. Expose `save_travel_guide` to the public Planner. The Planner chooses daily
   cities, activity counts, order, suggested time blocks, themes and personal
   notes. A destination set and deterministic route outline are optional tools,
   not prerequisites for this save operation. No fixed orchestration is added.
3. Restore source-owned title, summary, category and verification from referenced
   research findings. Persist recommendations in separate optional fields on the
   existing v1 guide. The domain projects the submitted days into the existing
   route structure without redistributing them.
4. Share content validation between pre-save composition and final Goal
   verification. Enforce accepted day/city/date/evidence/type/result constraints
   before writing. Return actionable revision codes on failure. Only selected
   research enters lineage; workspace owner/version/cancellation checks remain.
   Cloud saves require an activated Goal/run, and duplicate selections return
   every affected day for repair. Reading an unfinished Goal does not activate it.
5. Keep default daily evidence coverage. An intentional rest or travel day needs
   notes and `allowRestDays=true` in the accepted existing travel-guide Goal.
   This permission must be compatible with the user's request.
6. Keep SerpApi search plus source-bound Research LLM synthesis. Return compact
   findings to the Planner so it can select directly. In the conversation path,
   use Planner-authored questions without an extra query-planning model call.
   Maintain the eight-call/two-concurrent-search limits with rolling workers.
   Goal and research schemas share category meanings. Numeric location selectors
   normalize at one identity boundary and still require a trusted, unambiguous
   directory record; this does not accept model-supplied location facts.
7. Retain `build_travel_guide` in the complete Core registry for compatibility;
   the public Planner uses the authored save tool. Goal completion remains the
   server verifier's responsibility, never a model's self-reported success.

## Consequences and boundaries

This is an additive MVP. No new artifact version, Goal kind, durable Planner
worker, map provider or native-web adapter is introduced. Existing 150-second
turn and ten-tool-step limits remain. Suggested times and creative planning
notes are not proofs of opening hours, transport feasibility or budget totals.

Route and guide writes retain the existing workspace transaction boundaries.
Cancellation/version changes between them can leave a route without a guide;
that does not constitute completed guide delivery. Completion itself continues
to use the existing atomic Goal/GoalRun verifier commit.

Deterministic tests cover source authority, nonuniform authored schedules,
missing/expired evidence, scope conflicts, rest-day policy and the same final
verifier. Live Provider/database evidence and frontend build status are tracked
separately in DEMO_STATUS; compilation alone is not product acceptance.
