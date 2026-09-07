# FlightOR Engineering Documents

This directory contains the documents that guide architecture, implementation,
operations, and Agent development. The repository-root `README.md` is the
project entry point; normative engineering guidance lives here.

## Authority order

When documents disagree, apply them in this order:

1. [`FLIGHTOR_ARCHITECTURE.md`](./FLIGHTOR_ARCHITECTURE.md) — product and
   architecture authority.
2. Accepted ADRs in [`adr/`](./adr/) — phase-specific decisions that refine the
   architecture without overriding its product boundaries.
3. [`TOOLS.md`](./TOOLS.md) — Agent Tool Registry and implementation status.
4. [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — current repository map,
   compatibility constraints, and operating context.
5. [`CODEX_KICKOFF_PROMPT.md`](./CODEX_KICKOFF_PROMPT.md) — Phase 0/1 kickoff
   requirements and Multi-Agent working conventions.
6. Domain and operational notes below — useful implementation context, but not
   authority over the architecture or accepted ADRs.

## Phase decisions

- [`adr/0001-agent-runtime-phase-0-1.md`](./adr/0001-agent-runtime-phase-0-1.md)
  — Tool Calling Runtime and the first vertical slice.
- [`adr/0002-cloud-state-phase-2.md`](./adr/0002-cloud-state-phase-2.md)
  — cloud identity, trips, conversations, artifacts, and Memory.
- [`adr/0003-core-tools-phase-3.md`](./adr/0003-core-tools-phase-3.md)
  — Phase 3 Core Tool contracts and Phase 4 engine boundaries.

## Domain and operations

- [`backend-architecture.md`](./backend-architecture.md) — legacy/current
  backend notes.
- [`multi-city-plan.md`](./multi-city-plan.md) — multi-city planning notes.
- [`oag-integration.md`](./oag-integration.md) — optional OAG integration notes.
- [`deploy.md`](./deploy.md) — deployment guidance.

AppleDouble `._*` files are retained as-is unless a dedicated cleanup is
explicitly requested. They are not engineering guidance.

## Maintenance rule

Any implementation that adds, removes, or materially changes an Agent-facing
tool must update `TOOLS.md`. Any cross-domain decision must be captured in a new
ADR before integration. Keep guidance links rooted under `docs/`; do not create
new normative architecture or requirement documents in the repository root.
