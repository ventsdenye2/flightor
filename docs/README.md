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
5. [`CODEX_KICKOFF_PROMPT.md`](./CODEX_KICKOFF_PROMPT.md) — continuation
   guidance and single-agent working conventions.
6. Domain and operational notes below — useful implementation context, but not
   authority over the architecture or accepted ADRs.

## Phase decisions

- [`adr/0001-agent-runtime-phase-0-1.md`](./adr/0001-agent-runtime-phase-0-1.md)
  — Tool Calling Runtime and the first vertical slice.
- [`adr/0002-cloud-state-phase-2.md`](./adr/0002-cloud-state-phase-2.md)
  — cloud identity, trips, conversations, artifacts, and Memory.
- [`adr/0003-core-tools-phase-3.md`](./adr/0003-core-tools-phase-3.md)
  — Phase 3 Core Tool contracts and Phase 4 engine boundaries.
- [`adr/0004-production-route-engine-phase-4.md`](./adr/0004-production-route-engine-phase-4.md)
  — production topology, bounded path search, Pareto optimization, and
  AeroDataBox adapter boundaries.
- [`adr/0005-core-tools-and-production-research-phase-4b.md`](./adr/0005-core-tools-and-production-research-phase-4b.md)
  — remaining Core Tools, immutable fare confirmation, restricted production
  Research, and Travel Guide artifact composition.
- [`adr/0006-agent-api-and-route-generation-phase-5.md`](./adr/0006-agent-api-and-route-generation-phase-5.md)
  — the authenticated public Planner API, restricted conversation tool
  vocabulary, and the explicit idempotent route-generation run boundary.
- [`adr/0007-plan-and-flight-workspace-phase-6.md`](./adr/0007-plan-and-flight-workspace-phase-6.md)
  — Trip Workspace information architecture, typed Artifact rendering, unified
  manual/Agent flight search, and Flight Explorer ownership.

Phase 6 visual tokens and fidelity constraints are recorded in
[`design/phase6-design-system.md`](./design/phase6-design-system.md).

## Domain and operations

- [ADR 0015](./adr/0015-transient-planner-progress.md) — 300-second Planner
  turns with temporary execution-stage and connection feedback.

- [ADR 0014](./adr/0014-provider-connecting-fares.md) — complete provider connecting
  fares in search, route comparison, confirmation and multi-transfer display.

- [本地测试登录](./local-test-login.md) — explicit developer-tools sign-in on the real local backend; [ADR 0013](./adr/0013-local-test-authentication.md).
- [路线研究与攻略生成 MVP](./design/travel-guide-mvp.md) — implemented scope,
  source-backed Agent-authored daily schedules, local commands and boundaries.
  [ADR 0012](./adr/0012-agent-authored-itineraries.md) records the scoped decision;
  [DEMO_STATUS](./DEMO_STATUS.md) separates implementation from live acceptance.
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

- [Phase 7–9 operation and acceptance](./PHASE789_ACCEPTANCE.md)
- [ADR 0008](./adr/0008-route-discovery-and-cloud-workspaces.md) — route detail, reviewed discovery and cloud workspaces.

- [今晚微信 Agent 演示状态](./DEMO_STATUS.md) — 完整对话与行程生成链路的实时验收记录。
