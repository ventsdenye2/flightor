# FlightOR Agent Architecture v1

2026-09-21: [ADR 0024](adr/0024-guide-publication-contract.md) adds a server-owned guide publication boundary, shared by cards, final confirmation and restored history. Raw research and authored prose stay in audit storage and domain validation, not public guide prose. Publication is committed with the artifact and bound to its context, flight revision and content hash. Cost coverage remains incomplete/undetermined; `delivery.satisfied` retains its domain meaning. Guide-only successful batches may omit final model narration only after authoritative completion and current-generation checks. Planner remains autonomous; no new runtime agent or harness. Offline evidence and outstanding live/platform checks are in [progress](design/budget-travel-agent/progress.md).

> **Current checkpoint — 2026-09-20:** B0/B1 are committed at cabbf51, B2 at d895d0e, B3 at 6649644 and B4 at 1ce177b. B5 adds bounded per-turn model/tool/HTTP diagnostics and client result-commit timing. B2 business-tool Goal acceptance remains disabled by default (`PLANNER_LEAN_GOALS_ENABLED=false`) and its PostgreSQL acceptance/rollback/concurrency checks have now run in an isolated PostgreSQL 16 instance. B3–B5 work with either Goal protocol; G1 database checks are in progress; real Provider/platform acceptance and formal performance measurements remain unrun. [RUNTIME_PLAN](design/budget-travel-agent/RUNTIME_PLAN.md) owns exact limits and compatibility; offline checks do not replace [dated live acceptance](FLIGHT_FIRST_ACCEPTANCE.md). Follow [documentation maintenance](DOCS_MAINTENANCE.md) in every change batch.

### B5 observation ownership

`backend/src/lib/planner-observation.ts` owns an AsyncLocalStorage recorder per
CloudPlanner turn. Runtime and shared OpenRouter/HTTP adapters attach nested
spans; model adapter wrappers reuse an existing model span. The default route
logs one bounded `plannerObservation` summary, outside model context and public
turn responses. No diagnostic database, queue, extra model request or provider
configuration change is introduced. Span exclusive time subtracts the union
of child intervals, while wall duration uses one server monotonic clock.
Unknown tokens/costs stay null; known model cost is not total external billing.
Outbound config is normalized before hashing, and a hash of the credential-free
gateway origin/path distinguishes routes without emitting URLs or prompt data.

The Artifact workspace records saves only after repository commit; Goal
completion records firstVerified only after durable satisfied commit. Native
research records valid reported search counts even when content validation
fails, independently from tool and HTTP attempt counts. Closed observations
ignore late callbacks and retain interrupted spans. Limits and exact accounting
semantics are owned by [RUNTIME_PLAN §6](design/budget-travel-agent/RUNTIME_PLAN.md).

Client `plannerTelemetry` keeps bounded in-memory measurements associated with
the accepted turn/generation and current account/session/workspace. Plan loads
eligible current-turn references; PlannerPage records actual result branch
effect commits. This is explicitly commit evidence, not browser/device paint.
Server and client elapsed times must not be subtracted across devices. Extraction
and the unrun benchmark boundary are in
[EVALUATION §4.1](design/budget-travel-agent/EVALUATION.md).

### Selection retries and current-version adoption

An owner-scoped PATCH containing only the already persisted flight choice is
an idempotent no-op, including a retry after a Trip Context edit. It returns the
original selection revision/contextVersion and does not refresh its validity
or write the aggregate; the workspace still reports the current Trip version
and stale route generation. The choice identity includes layover preference.
Changing that preference, choosing another source, or adopting again after
clearing is a new write: optimistic workspace version and current source/run
checks still apply. A historical saved choice is not proof of a current valid
fare or satisfied guide. This existing behavior is covered by G1 PostgreSQL
integration checks; it does not broaden the narrow compatible-offer exception.

> Status: **Product + engineering baseline**
>
> Purpose: This document is the authoritative design contract for the next major iteration of FlightOR.
> All future Agent, backend, provider, route-planning, discovery, admin, and frontend work should follow this document unless a later architecture decision explicitly supersedes it.
>
> Guiding idea:
>
> **LLM understands and decides. Tools provide facts and computation. FlightOR owns route intelligence. The UI renders structured artifacts, not only text.**

---

## 0. Executive Summary

FlightOR is a travel-planning product focused on two simultaneous goals:

1. Design routes that are **interesting, playable, and personalized**.
2. Use flexible dates, creative stopovers, self-transfer opportunities, and route ordering to **reduce airfare as much as reasonably possible**.

The new product is **Agent-first**, but not “LLM-does-everything”.

The system should be divided into clear responsibility boundaries:

```text
User
  │
  ▼
FlightOR Agent (LLM)
  │
  ├─ understands intent
  ├─ decides what information is missing
  ├─ chooses tools
  ├─ discusses options with the user
  └─ explains recommendations
  │
  ▼
Tool Runtime
  │
  ├─ validates arguments
  ├─ applies permissions / budgets / rate limits
  ├─ executes deterministic domain services
  └─ returns structured artifacts
  │
  ▼
FlightOR Domain Services
  │
  ├─ Aviation / topology
  ├─ Fare search
  ├─ Destination research
  ├─ Connection engine
  ├─ Route planner
  ├─ Route optimizer
  ├─ Memory
  └─ Discovery
  │
  ▼
Providers
  ├─ AeroDataBox — primary aviation data
  ├─ SerpApi / Google Flights — primary fare data
  ├─ Web research — events / destination information
  └─ OAG — optional aviation enhancement/fallback, never a hard dependency
```

The current rule-first extraction pipeline must be replaced. Business-language regexes must **not** be the primary interpreter of user intent.

---

# 1. Product Principles

## 1.1 Agent owns semantic understanding

The Agent receives the user conversation directly and decides what the user means.

Do **not** pre-parse user messages using business regexes such as:

- “北京” → PEK
- “一万五” → 15000
- “动漫” → culture
- “日本” → japan

before the LLM is allowed to reason.

Instead:

- LLM understands that “北京” is an origin concept.
- LLM calls `resolve_location`.
- LLM understands that “一万五” is a budget.
- LLM calls `update_trip_context`.
- LLM understands that the user wants destination ideas.
- LLM calls `recommend_destinations`.

Deterministic code still validates tool arguments and provider results.

### Rule

> **Remove semantic authority from regex parsing; retain deterministic schema, domain and safety validation.**

---

## 1.2 Tools own facts and computation

The LLM must never invent:

- airport identifiers;
- whether a route exists;
- scheduled flight availability;
- current airfare;
- actual flight times;
- event dates;
- airport coordinates;
- route scores;
- saved user memory state.

Facts must come from tools/providers or verified internal data.

---

## 1.3 FlightOR owns route intelligence

AeroDataBox, SerpApi and other providers provide data.

They do **not** define the product.

FlightOR should own:

- preferred-city-aware connection discovery;
- creative stopover generation;
- self-transfer policy;
- route permutation/search;
- experience scoring;
- price-vs-effort scoring;
- Pareto filtering;
- route representative selection;
- explanations.

This is the primary product moat.

---

## 1.4 User remains in control

The Agent can proactively suggest destinations, stopovers and alternate routes.

However:

- user corrections immediately override prior assumptions;
- long-term Memory is a soft preference, never a hard trip constraint;
- the current trip always takes priority over Memory;
- the user decides when to generate routes;
- the user decides what route to use;
- FlightOR does not purchase or book tickets.

---

# 2. Core Product Flow

The main planning flow is:

```text
Conversation starts
      │
      ▼
Load optional User Memory
      │
      ▼
User discusses trip with Agent
      │
      ├─ Agent can search the web
      ├─ Agent can research events
      ├─ Agent can search flights
      ├─ Agent can recommend destinations
      └─ Agent updates Trip Context
      │
      ▼
User decides information is sufficient
      │
      ▼
User presses "Generate Route"
      │
      ▼
Route Generation
      │
      ├─ destination candidates
      ├─ preferred-city candidates
      ├─ topology search
      ├─ flight/fare search
      ├─ stopover exploration
      ├─ route construction
      └─ multi-objective optimization
      │
      ▼
Distinct Route Artifacts
      │
      ├─ Cheapest
      ├─ Balanced
      ├─ Most Fun
      └─ Best Match
      │
      ▼
Visual Route Workspace
      │
      ├─ map
      ├─ timeline
      ├─ activities
      ├─ flights
      ├─ cost
      └─ explanation
      │
      ▼
User can return to Agent and revise
```

### Minimum requirements before "Generate Route"

The button is enabled only when the system has:

1. origin;
2. approximate departure time/window.

Everything else may be unknown.

For the Phase 5 generation slice, the deterministic engine also requires one
final visit destination resolved to a canonical airport. It does not yet
compose multiple visit destinations, a return window/round trip, or required
ground legs. Those inputs must produce an explicit unsupported-input result;
they must not be silently truncated or presented as a complete itinerary.

The conversation Agent may discuss candidate route concepts from incomplete
requirements and should explicitly communicate assumptions when relevant. It
does not execute final connection/path/optimization work; the explicit run
validates the Phase 5 supported shape before doing so.

---

# 3. State Model

Four state domains must remain separate.

```text
User Memory
= long-term preferences of the person

Conversation
= natural-language interaction history

Trip Context
= constraints and preferences for this trip

Artifacts
= structured outputs produced during this trip
```

Do not merge them into one giant `TripState`.

---

# 4. User Memory

## 4.1 Product behavior

Memory is:

- optional;
- cloud-hosted;
- bound to the user account, not a device;
- available to WeChat mini-program and future web frontend;
- user-visible;
- user-editable;
- user-deletable;
- stored primarily as Markdown.

A user can turn Memory off.

When disabled:

- Agent must not load the memory;
- Agent must not write the memory;
- memory content must not be injected into LLM context.

---

## 4.2 Markdown is the source of truth

Example:

```md
# 我的旅行偏好

## 常用出发地
- 北京

## 偏好城市
- 东京
- 首尔
- 新加坡

## 兴趣
- 动漫
- 美食
- 摄影
- 城市漫游

## 旅行风格
- 比较在意机票价格
- 可以接受多城市路线
- 可以接受长时间中转，如果中转城市值得玩
- 不喜欢为了很少的价格差增加大量折腾

## 航班偏好
- 可以接受廉航
- 可以接受 self-transfer，但希望留足时间
```

The user may freely edit the Markdown.

A structured runtime profile may be generated from the Markdown for efficient scoring, but:

> **Markdown remains authoritative. The structured profile is derived cache only.**

---

## 4.3 Memory write policy

Automatically save only **clear long-term preferences**.

Examples allowed:

- “以后转机可以优先考虑首尔。”
- “我一般比较看重价格。”
- “我一直很喜欢动漫和摄影。”
- “我可以接受 self-transfer。”

Do not automatically save:

- “这次预算 8000。”
- “国庆想去法国。”
- “这次不想坐廉航。”
- “东京还挺好玩的。”

Ambiguous inference must not modify Memory.

---

## 4.4 Priority order

```text
Current explicit user message
        >
Current Trip Context
        >
User Memory
        >
FlightOR defaults
```

Example:

Memory:

```text
喜欢东京
```

Current trip:

```text
这次不要经过日本
```

Japan must be excluded.

---

## 4.5 Persistence model

Recommended tables:

```text
user_memories
- user_id
- enabled
- markdown
- version
- parse_version
- updated_at

user_memory_profiles
- user_id
- memory_version
- parsed_json
- updated_at
```

Use optimistic concurrency:

```text
expected_version
```

Memory edits must fail with a version conflict rather than silently overwrite a newer edit.

---

# 5. Identity and Multi-device Design

One WeChat user currently maps to one FlightOR user account and one Memory.

For local developer-tools testing, an explicitly enabled `local_test` identity can use the same session and owner-scoped repositories. It is a separate account, defaults to disabled, requires a loopback connection and local key, and is prohibited in production. WeChat authentication never silently falls back to it. See [ADR 0013](adr/0013-local-test-authentication.md).

However, identity must be designed for future web login.

Recommended model:

```text
users
user_identities
```

Example identities:

```text
wechat_openid
email
future_oauth_provider
```

The domain model uses internal `user_id`.

Never use WeChat OpenID as the universal primary key throughout the application.

Cloud persistence should eventually include:

- Memory;
- conversations;
- trips;
- route artifacts;
- saved routes;
- alerts.

Local storage may remain as a cache/offline convenience, never as authoritative long-term user state.

---

# 6. Trip Context

`TripContext` is the current trip state.

Calendar semantics and conflict validation are defined in
[ADR 0017](adr/0017-inclusive-trip-dates.md): exact windows identify one date,
and travelDays counts the inclusive span. Contradictory snapshots are rejected
before writes and cannot satisfy guide delivery; historical snapshots stay readable.

Recommended shape:

```ts
interface TripContext {
  id: string

  origin?: LocationRef

  departureWindow?: {
    from?: string
    to?: string
    precision: 'exact' | 'approximate'
  }

  returnWindow?: {
    from?: string
    to?: string
    precision: 'exact' | 'approximate'
  }

  travelDays?: number

  budget?: {
    amount: number
    currency: string
    scope: 'airfare' | 'transport' | 'trip'
  }

  destinationIntent: {
    mode: 'explicit' | 'open' | 'mixed'
    required: LocationRef[]
    preferred: LocationRef[]
    excluded: LocationRef[]
  }

  interests: string[]

  pace?: 'relaxed' | 'balanced' | 'intensive'

  priorities: {
    price?: number
    comfort?: number
    experience?: number
    simplicity?: number
  }

  transferPreferences: {
    acceptsSelfTransfer?: boolean
    acceptsLongStopover?: boolean
    acceptsAirportChange?: boolean
  }

  locationRoleOverrides: Array<{
    location: LocationRef
    role: 'visit' | 'stopover_only' | 'avoid'
  }>

  mustIncludeEvents: ActivityRef[]

  requiredGroundLegs: Array<{
    from: LocationRef
    to: LocationRef
    mode: 'rail' | 'bus' | 'ferry' | 'ground'
  }>

  notes: string[]

  version: number
}
```

### Important

Do not force the user to understand separate “preferred destination” and “preferred stopover” settings.

A long-term preferred city influences both.

The current trip may override its role:

```text
东京只想中转，不想正式玩
```

becomes a trip-local `stopover_only` override.

---

# 7. Artifacts

Agent tools should produce structured artifacts rather than only text.

Core artifact types:

```text
ResearchArtifact
ActivityArtifact
FlightSearchArtifact
DestinationSetArtifact
RouteSetArtifact
RouteArtifact
TravelGuideArtifact
```

Artifacts should:

- have stable IDs;
- be stored separately from chat text;
- be renderable by multiple clients;
- contain verification metadata;
- be referenceable by later tool calls;
- avoid flooding LLM context with huge JSON payloads.

Example:

```text
route_set_id = rs_xxx
```

The Agent receives compact summaries and IDs.

The frontend fetches full artifact detail when needed.

All Artifact-producing domain services use `backend/src/artifacts/workspace.ts`
as the shared read/write boundary, including manual search and background route
generation. The workspace freezes a server-read Trip Context version, checks
owner/Trip scope and cancellation, and repeats the version checkpoint after
external calls and immediately before persistence. PostgreSQL also checks the
current Trip and Goal/run state within the Artifact insert transaction.

Source Artifacts must belong to the same owner and Trip and carry the same
context version as the output. Compatible evidence may come from a different
Goal/run; the new output records its own lineage and the source IDs. Legacy
Artifacts without a version and sources from another version remain readable
for history, but cannot be composed into a current result without an explicit
compatibility policy. Relabeling an old five-day route as a new ten-day guide is
invalid. Cross-version compatibility is not currently implemented: return a
stable conflict and let the Agent choose fresh evidence or re-plan.

---

# 8. Agent Runtime

## 8.1 Standard loop

```ts
for step in 0..MAX_STEPS {
  response = LLM(messages, tools)

  if response has no tool calls:
    delivery = verify goals touched by this turn
    return response with server-derived delivery and stop reason

  execute tool calls
  append tool results
}
```

### Required protections

- maximum tool steps;
- maximum provider cost per turn;
- request timeout;
- retry policy by provider;
- tool argument schema validation;
- tool-specific permission policy;
- tool execution tracing;
- cancellation / generation ID;
- bounded failure responses that preserve the separate delivery verdict.

---

## 8.2 Tool call concurrency

Parallelize only independent calls.

Examples:

Safe:

```text
resolve Tokyo
resolve Seoul
```

Potentially parallel:

```text
search PEK → NRT
search PEK → KIX
```

Do not parallelize state mutations that may conflict.

---

## 8.3 Tool composition rule

Agent-facing tools should not recursively call other Agent-facing tools.

Instead:

```text
Agent Tool
   ↓
Domain Service
   ↓
Provider / algorithm services
```

A high-level tool such as `search_connection_flights` may internally call domain services that also power `search_flights`, but should not invoke another tool through the Agent runtime.

This keeps execution deterministic and testable.

### Agentic orchestration and completion

The Planner Agent is the orchestration layer. FlightOR must not replace its
planning loop with a fixed end-to-end application workflow for an ordinary
conversation request. The Agent may choose, skip, repeat and reorder composable
tools as the request and intermediate results require, and it may re-plan after
a partial result or recoverable failure.

Domain tools may encapsulate one cohesive capability, but a tool must not call
another Agent-facing tool or a nested Agent runtime. Shared domain services own
facts, validation and persistence; the Agent owns the changing plan.

For requests that require a durable result, use a typed goal and a generic
server-verified completion operation. The completion verifier reads
owner-scoped persisted Artifacts, lineage, the active run and Trip Context
version and returns `pending`, `satisfied`, `partial` or `failed`; cancellation
remains `cancelled`. Model text, tool names, prompt phrases and call counts are
never completion evidence.
Ordinary conversation without a durable goal may still finish directly with a
text response.

Explicit `finish_goal` and response finalization use the same completion service
in `backend/src/agent/goals/completion.ts`. Before returning a text-only model
response, the runtime verifies every Goal touched in that turn even if the model
omitted `finish_goal`. A pending, partial, failed or cancelled verdict cannot be
promoted by a narrated success. The Agent may use completion feedback to choose
its next tools within the normal loop; the server does not prescribe a repair
sequence or inspect keywords.

`stopReason` describes why the turn stopped. `completed` is reserved for a
verified `delivery.status=satisfied`; `responded` means an ordinary response
without a requested durable delivery (`not_requested`). Other Goal outcomes use
`goal_pending`, `goal_partial`, `goal_failed` or `goal_cancelled`. Runtime failures
such as timeout retain their own stop reason and carry a separate delivery
verdict. Evidence verification and business completion are separate: correct
sources alone do not establish matching dates, destinations or full day coverage.

Completion commits the durable planning Goal and its Goal run atomically through
`GoalRunRepository.commitCompletion`. The PostgreSQL transaction locks Trip,
Goal and Goal run in that order and validates scope, expected revisions, current
Trip version and legal transitions before updating either completion status.
Cancellation and immutable terminal runs cannot be overwritten by late success.
The public route-generation run is a separate execution resource; its
`succeeded` status alone is not the business delivery verdict.

Goals persist across turns and process restarts. A goal records its accepted
Trip Context version, authorization source, current status and result Artifact
references so the Agent can resume or re-plan after a timeout without deriving
business state from old prose. Partial Artifacts remain saved and auditable;
they can inform another plan but cannot satisfy a complete goal.

A conversational Goal run belongs to its creating generation's execution
lifetime. When that turn ends, any still-running attempt owned by that generation
closes as `failed`, or `cancelled` for cancellation/supersession. This execution
cleanup preserves the durable Goal's status and working set; it is not a business
completion verdict. An explicit resume can start a fresh attempt for an unfinished
Goal. Optimistic revisions preserve concurrent terminal completion. Background
route runs and other generations retain their independent lifetimes. Cleanup
is bounded, and storage failure is reported as `goal_attempt_cleanup_failed`.
`resume_goal` may reuse a running attempt only within its creating generation.
An attempt still running in another generation returns `GOAL_RUN_ALREADY_RUNNING`,
even after a Trip version change; it is not activated, closed or taken over.
Recovery of abandoned historical attempts requires a separate liveness policy.

Goal inspection and acceptance are separate operations. `get_active_goal` is a
read-only query: it neither creates a run nor binds saved parameters to the
current turn. The Agent explicitly chooses `resume_goal` for an unchanged
objective or declares a new Goal when the accepted parameters change.

The runtime maintains an owner/trip/run-scoped working set for Artifacts and
canonical location resolutions. A tool may use a validated latest-compatible
result from that working set or an explicit compatible reference when the Agent
needs to choose between alternatives. In both cases, the server establishes
authority and lineage; the model does not establish facts by copying an object
or an Artifact ID. The current owner-scoped Trip snapshot is also a valid source
for seeding the current-turn location ledger: a previously saved canonical city
or airport can be reused by `research_destination` without another provider
lookup. The Trip snapshot remains subject to the same owner, Trip and version
workspace checks; this reuse does not authorize arbitrary IDs or copied fields.

Research query wording is a bounded model capability within the research
domain. The domain fixes at most eight destination/question tasks; a query
planner can only supply one short plain-text topic per task. The adapter owns
canonical destinations, date handling and source restrictions. Invalid planning
falls back to the original questions with an explicit warning, without extra
search calls. Planning, search and synthesis share the operation cancellation
signal. The original brief remains the synthesis and audit input.

Airport time presentation is also server-owned. Raw timestamps remain immutable;
Artifact presentation and Agent reads derive the same local airport time and
explicit offset from canonical IANA zones. Without a trusted zone, display the
known UTC/provider time basis explicitly instead of guessing from client locale.

For the current functional milestone, configured fare and research tools may be
used autonomously when relevant to an accepted goal. Cost optimization is not a
completion gate, although validation, timeout, cancellation, rate-limit and
duplicate-call protections still apply.

Final route generation still requires explicit authorization. Either the
Generate Route product action or an unambiguous conversational instruction is
valid authorization; discussion, readiness and Agent inference are not. The
durable goal records the authorization source.

---

## 8.4 Planner Agent and delegated Research Agent

FlightOR exposes one user-facing Agent, not several peer Agents.

```text
User
  │
  ▼
Planner Agent
  │
  ├──────────────┐
  ▼              ▼
Research Agent   Structured Tools
  │              │
  ▼              ├─ Location
ResearchArtifact ├─ Flight
                 ├─ Memory
                 └─ Trip Context
        \          /
         \        /
          ▼      ▼
       FlightOR Engine
       ├─ Connection
       ├─ Path Search
       └─ Optimizer
```

### Planner Agent

The Planner Agent is the only Agent that talks directly to the user. It:

- understands user intent and manages the conversation;
- reads and updates Trip Context;
- reads enabled User Memory and updates it only for clear long-term
  preferences;
- decides when open-world research is needed;
- delegates a minimal brief to the Research Agent;
- calls structured location, flight, Memory and Trip Context tools;
- requests deterministic route-engine work;
- combines Artifact references; and
- explains recommendations to the user.

The Planner Agent has only the access it needs to the active user's
Conversation, Trip Context, enabled Memory and Artifacts. Access is always
enforced by server-side ownership checks; model-supplied user or resource IDs
are never authority.

### Research Agent

The Research Agent is a restricted sub-Agent scheduled by the Planner Agent.
It handles open-world travel research such as current events, exhibitions,
festivals, seasonal conditions, current destination and stopover activities,
dynamic opening information, and time-window-specific opportunities.

It receives only the minimum context required for the research task and does
not inherit the complete Conversation. Its sole product output is a verified
`ResearchArtifact`.

```ts
interface ResearchBrief {
  destinations: LocationRef[]
  travelWindow?: {
    from?: string
    to?: string
  }
  interests: string[]
  questions: string[]
  researchTypes: Array<
    | 'event'
    | 'seasonal'
    | 'activity'
    | 'stopover'
    | 'practical'
  >
  maxResults?: number
}
```

The Research Agent must not:

- modify User Memory or Trip Context;
- decide the final route or run route optimization;
- own long-term user state;
- turn research findings into required destinations or required events; or
- perform structured aviation/fare queries.

The durable travel-guide Goal separates exploration from required evidence with
optional `requiredEvidenceTypes`. It has no default value: when omitted, the
legacy contract requires every `researchTypes` category; when present, it must
be a subset of `researchTypes` and only that subset is required. An explicit
empty array is valid and means no extra category coverage requirement. The
research brief remains an independent exploration request and is not rewritten
from the Goal. The shared domain interpretation is used by save, durable
completion, PlanningContext and repair feedback; accepted parameters remain
immutable and are part of the existing fingerprint/idempotency boundary. A
selected optional event still requires the ADR 0020 temporal evidence/date
check. Existing Artifact/source-query payloads and old/new Goal JSON need no
migration, but an older strict reader may reject the new field during rollback.

`resolve_location`, `search_flights`, and `search_flexible_flights` remain
Planner-owned structured tools. Route generation remains deterministic:

```text
Planner Agent
      ↓
FlightOR deterministic engine
      ↓
Connection Engine
Route Planner
Route Optimizer
```

The Planner decides how, or whether, a `ResearchArtifact` should influence the
active trip.

---

# 9. Agent-facing Tool Set v1

The repository must maintain `docs/TOOLS.md`.

Every Agent-facing tool must document:

- purpose;
- input schema;
- output schema;
- cost class;
- side effects;
- authority;
- provider dependencies;
- caching;
- failure behavior;
- implementation status.

## 9.1 Context / Memory

### `get_trip_context`

Read current trip state.

### `update_trip_context`

Apply explicit user constraints/preferences to current trip.

Cost: free
Side effect: state mutation
Authority: user-derived

### `get_user_memory`

Return Memory Markdown and version when enabled.

### `update_user_memory`

Update only clear long-term preferences.

Must use optimistic versioning.

### `delete_user_memory`

User-directed memory deletion/reset operation.

---

## 9.2 Geography / Destinations

### `resolve_location`

Resolve natural-language location into canonical city/airport references.

### `search_destinations`

Search destination candidates matching region, interests or accessibility.

### `recommend_destinations`

Generate scored destination recommendations using:

- Trip Context;
- Memory;
- season/time;
- origin accessibility;
- curated destination data.

---

## 9.3 Flight / Fare

### `search_flights`

Search real flight/fare options for one requested leg.

### `search_flexible_flights`

Search date-flexible options inside a date window.

### `search_connection_flights` (generation-only)

FlightOR connection discovery tool.

Responsibilities:

- preferred-city-first candidate exploration;
- general hub graph exploration;
- traditional itinerary candidates;
- self-transfer candidates;
- stopover candidates;
- route/fare evaluation.

This is a FlightOR domain tool, not a wrapper around one provider API.

### `confirm_flight_price`

Refresh/verify one selected flight option.

### `confirm_route_price` (generation-only)

Refresh/verify the fare-critical legs of a selected route.

---

## 9.4 Route Planning

### `plan_trip_route`

Create a travel-experience structure:

- cities;
- visit duration;
- activities;
- land transfers;
- day allocation.

Does not own global flight optimization.

### `plan_flight_route` (generation-only)

Generate complete flight path candidates across trip cities.

Conceptually:

```text
Edge candidates → complete paths
```

### `optimize_route` (generation-only)

Rank/filter complete route candidates.

Conceptually:

```text
Complete paths → Pareto frontier → representative routes
```

Does not discover flights itself.

### Conversation Planner boundary

The public conversation runtime uses a restricted Planner registry. It may
read/update Trip Context and enabled Memory, resolve locations, search fares,
discover destinations, plan a trip outline, research, and build a travel
guide. It must not expose the final route-engine tools
`search_connection_flights`, `plan_flight_route`, `optimize_route`, or
`confirm_route_price` to the model. The complete Core Tool registry remains
available to deterministic engine composition and contract tests. The Planner
may call only `start_route_generation` to queue that composition, and only when
the current user message unambiguously requests final generation; it cannot
invoke the internal engine tools directly.

Final generation is an authenticated explicit action, never an inferred
conversational side effect. The product button uses this run resource:

```text
POST   /v1/trips/:tripId/route-generation-runs
GET    /v1/route-generation-runs/:runId
DELETE /v1/route-generation-runs/:runId
```

HTTP creation requires an `Idempotency-Key` and accepts only
`{ conversationId?, expectedTripVersion? }`. The server derives the owner from
the access token, validates the optional Conversation belongs to the same Trip,
freezes the accepted Trip Context/version, records `button` authorization, and
enqueues only the opaque run ID. `start_route_generation` calls the same domain
service with server-owned scope/idempotency and records
`explicit_user_message` authorization.
The same key and request replay the existing run; changing the request under a
key is a conflict. Reads and cancellation are owner-scoped. Cancellation is
cooperative and persistent, while terminal runs are immutable. Status is
`queued`, `running`, then exactly one of `succeeded`, `failed`, or `cancelled`.

The worker invokes deterministic domain services directly:

```text
frozen Trip Context
  → connection search
  → bounded complete-path planning
  → hard validation and Pareto optimization
  → immutable route_set Artifacts
```

The run reports its frozen context version, bounded progress/warnings and
compact Artifact references. A current-version conflict while queued/running
fails the attempt with `TRIP_CONTEXT_VERSION_CONFLICT`; the immutable snapshot
does not permit stale writes. Results completed before a subsequent Trip edit
remain auditable and can be marked stale. Execution success does not establish
Goal satisfaction; the domain verifier supplies the delivery verdict. Missing
credentials or partial fare coverage remain explicit unavailable/warning states,
never invented prices.

---

## 9.5 Research

### `web_research`

General internet research for the active conversation.

Used for:

- current events;
- exhibitions;
- festivals;
- seasonal conditions;
- destination questions.

### `research_destination`

Structured destination research.

Research findings may carry optional v2 `temporalEvidence` with `from`, `to`,
`sourceUrl` and `quote`. The date fields are occurrence dates only when the
quote comes from a retrieved snippet and contains one or two complete ISO dates;
query windows and source expiry are not occurrence evidence. Save and durable
Goal verification use the same validator: missing or mismatched evidence
rejects an event scheduled against Trip dates, and `allowPartial` does not waive
that requirement. Existing artifacts remain readable, but readability is not a
fresh verification pass. The current native research path does not produce this
evidence, so it cannot by itself support date-bound event scheduling.

### `save_travel_guide`

The conversation Planner authors the daily city selection, activity order,
suggested time blocks, themes and personal planning notes. It submits research
finding references directly; a prior destination set or route outline is not
required. The guide domain restores source-owned facts and shares the Goal's
content validator before persisting the submitted schedule and its derived
route projection. Revision feedback does not write an invalid guide.

B3 adds stateless candidate locators bound to owner/Trip/version and canonical
research content. Every resolution re-reads scoped evidence; locators are not
capabilities. The tool maps compact selections to the existing domain contract,
which restores source facts and persists optional supportingEvidence and budget
in guide schema v1 (new authored builderVersion agent-authored-guide-v2).
Support facts satisfy evidence categories without becoming scheduled visits;
the completion verifier loads their lineage too. Budget is copied from Trip
with total-period and unspecified party basis, never inferred from model prose.

One in-memory draft per execution context enables revision-checked replacement
of selected existing days/supports. Its binding includes generation, Goal/Run
and flight selection; any stale binding requires full current input. All source
and whole-guide constraints rerun on repair. Errors are classified, feedback is
bounded and blocked checks explicit. No new durable workflow/table or automatic
research retry is introduced. Old v1 payloads remain readable; new optional
fields require compatible readers. Turning B2 off changes only Goal control,
not B3 persisted fields. See [runtime contract sections 3–4](design/budget-travel-agent/RUNTIME_PLAN.md).

Source facts and suggested planning text remain separate. Existing owner,
version, cancellation and delivery checks apply. `build_travel_guide` remains a
deterministic compatibility tool in the full Core registry, outside the public
Planner registry. See [ADR 0012](adr/0012-agent-authored-itineraries.md).

---

# 10. Provider Architecture

## 10.1 Primary provider strategy

```text
AeroDataBox
= primary aviation data

SerpApi / Google Flights
= primary fare data

FlightOR
= connection + route intelligence

OAG
= optional enhancement / fallback
```

FlightOR core functionality must remain usable with OAG credentials removed.

---

## 10.2 Aviation Provider

```ts
interface AviationProvider {
  resolveLocation(...)
  getAirport(...)
  getAirportRoutes(...)
  getSchedules(...)
  getFlightStatus(...)
}
```

Implementations:

```text
AeroDataBoxProvider — primary
OagProvider — optional
MockAviationProvider — tests
```

Do not let Agent tools depend directly on AeroDataBox-specific response shapes.

Normalize at provider boundary.

---

## 10.3 Fare Provider

```ts
interface FareProvider {
  searchFlights(...)
  searchFlexibleFlights(...)
  refreshFlight(...)
}
```

Implementations:

```text
SerpApiFareProvider
MockFareProvider
```

Fare data is time-sensitive and requires `checkedAt`.

Provider connecting fares are complete priced itineraries. Preserve their full
segment list and reported layovers in FareOffer, and carry each offer into route
generation as one edge with one total price and immutable fare references.
`airline` identifies a provider connecting offer without asserting protection or
baggage handling. Internal transfer counts, airports and time constraints remain
subject to route validation. See [ADR 0014](adr/0014-provider-connecting-fares.md).

---

## 10.4 AeroDataBox usage

Initial required capability families:

1. airport search/details;
2. airport route statistics / route graph;
3. schedules / airport departures-arrivals;
4. flight status.

Do not initially spend effort integrating unrelated aircraft/fleet/runway APIs.

### Subscription strategy

Development:

```text
Trial / Starter
```

Production topology/cache requirements should be reviewed against AeroDataBox retention/caching license terms before launch.

---

# 11. Connection Engine

This is a core FlightOR domain.

Concept:

```text
search_connection_flights
= Edge Search
```

Input:

- origin;
- destination;
- date window;
- Trip Context;
- preferred cities from Memory;
- trip-local location role overrides;
- self-transfer preference;
- stopover preference.

---

## 11.1 Candidate search order

### Stage A — preferred-city-first

Example:

```text
PEK → CDG
preferred cities:
Tokyo
Seoul
Singapore
```

Test:

```text
PEK → TYO → PAR
PEK → SEL → PAR
PEK → SIN → PAR
```

Preferred cities receive a bonus, not exclusivity.

### Stage B — topology expansion

Explore strong hub candidates from local route graph.

### Stage C — schedule feasibility

Verify that relevant legs exist for the time window.

### Stage D — fare search

Query real fares only for sufficiently promising candidates.

This is essential for controlling provider cost.

---

## 11.2 Stopover behavior

FlightOR should actively support:

- long layovers;
- one-day stopovers;
- one-to-two-night stopovers;
- preferred-city stopovers.

Stopover is a feature, not an error case.

---

## 11.3 Self-transfer

Self-transfer is allowed.

It must:

- be clearly labeled;
- receive a risk penalty;
- use conservative timing buffers;
- warn about baggage/re-check/security risks;
- never be described as protected connection unless the provider explicitly indicates it.

Recommended configurable defaults:

```text
same-airport self-transfer minimum buffer: 8h
airport-change minimum buffer: 12h
playable stopover threshold: 10h
strong stopover threshold: 18h
```

These are product defaults, not legal/airline guarantees.

Store them in configuration, not hardcoded across UI code.

---

## 11.4 Airport changes

Allowed.

Examples:

- NRT → HND
- LHR → LGW

Apply:

- additional time/risk penalty;
- explicit visual indicator;
- larger buffer.

---

# 12. Flight Route Planner

Concept:

```text
plan_flight_route
= Path Search
```

It receives:

- trip city candidates;
- required cities;
- optional cities;
- route graph;
- candidate flight edges;
- date constraints;
- trip duration.

It generates complete candidate paths.

The LLM must not brute-force city permutations via repeated tool calls.

The planner handles search internally using deterministic algorithms.

Possible strategies:

- bounded DFS / beam search;
- branch-and-bound;
- heuristic pruning;
- cached graph edges;
- hard constraints first, soft scoring later.

Search space must be bounded.

---

# 13. Route Optimizer

Concept:

```text
optimize_route
= Path Ranking
```

It does not:

- discover new flights;
- invent new cities;
- call providers.

It evaluates existing complete candidates.

---

## 13.1 Score components

Recommended normalized dimensions:

### Positive

```text
airfareSaving
preferredCityMatch
interestMatch
eventMatch
seasonMatch
stopoverPlayability
additionalCityValue
routeNovelty
```

### Negative

```text
totalTravelTime
transferCount
selfTransferRisk
airportChangePenalty
backtrackingPenalty
deadTimePenalty
excessiveComplexity
```

---

## 13.2 User-specific weights

Weights derive from:

1. explicit current trip preferences;
2. Memory;
3. FlightOR defaults.

The user does not need to manually configure numeric weights.

The Agent translates natural-language preferences into scoring priorities.

---

## 13.3 Pareto frontier

Do not collapse every candidate into only one opaque scalar score.

Use:

1. hard validation;
2. Pareto filtering;
3. weighted scoring inside the remaining set;
4. representative-route selection.

Representative labels:

```text
Cheapest
Balanced
Most Fun
Best Match
```

Do not force four distinct routes.

If one route wins multiple categories:

```text
Balanced · Best Match
```

Use one route with multiple badges.

---

# 14. "Fun" Route Definition

“Fun” is user-relative.

Possible positive features:

- matching interest cities;
- matching preferred cities;
- meaningful stopover;
- current event match;
- seasonal relevance;
- adding a worthwhile city;
- interesting mixed transport;
- reducing backtracking;
- good ratio of travel time to experience.

Do not define “fun” as simply “more cities”.

Too many cities can reduce the score for relaxed users.

---

# 15. Visa / Entry Policy

v1 does **not** claim legal immigration eligibility.

Always treat visa/entry information as informational only.

Product-level disclaimer:

> **签证、过境及入境条件可能因护照、行程和政策变化而不同，请在出行前自行确认最新要求。**

The Agent must not make definitive claims such as:

```text
你一定可以免签进入韩国
```

even if research suggests it.

---

# 16. Research and Verification

Users do not need raw source/provider names in ordinary route UI.

However, all externally derived facts must keep internal provenance.

---

## 16.1 Verification record

```ts
interface VerificationRecord {
  status: 'verified' | 'partially_verified' | 'stale' | 'unverified'
  checkedAt: string
  expiresAt?: string
  confidence: number
  sources: SourceRecord[]
}
```

---

## 16.2 Event source priority

Preferred source order:

1. official event website;
2. official organizer;
3. government/tourism board;
4. official venue;
5. reliable media;
6. travel/content websites.

Important event dates should normally have:

- one authoritative official source; or
- multiple independent supporting sources.

For structured research, the durable date contract is narrower than a source's
query window or expiry metadata. Optional v2 `temporalEvidence` consists of
`from`/`to` occurrence dates, `sourceUrl`, and a `quote` copied from a retrieved
snippet. `quote` must contain one or two complete ISO dates; source metadata
alone cannot satisfy the contract. The save path and durable verifier share the
same check, and `allowPartial` does not exempt a date-bound event. Native
research currently has no such evidence output, so a native finding cannot be
used as proof for event scheduling on Trip dates.

---

## 16.3 Fare verification

Fare artifacts must include internally:

```text
checkedAt
provider
currency
query parameters
```

The frontend may show a user-friendly “updated recently” label without exposing provider implementation.

---

# 17. Route Visual Design

Route output is not a wall of text.

The route detail experience must use:

```text
Route Hero
+
Interactive Map
+
Timeline
+
Activities
+
Flights / Cost
+
Why this route
```

---

## 17.1 Route Hero

Show:

- trip title;
- date/duration;
- city sequence;
- estimated airfare/transport;
- savings estimate where meaningful;
- representative badges.

Example:

```text
日本 + 韩国 · 9日

北京 → 大阪 → 京都 → 东京 → 首尔 → 北京

预计机票 ¥4,280
综合最佳 · 最符合偏好
```

---

## 17.2 Interactive route map

Map displays:

- visit cities;
- stopover cities;
- airports;
- flight edges;
- rail/ground edges;
- activity markers;
- preferred-city indicator;
- airport-change indicator.

Clicking a city opens:

- stay duration;
- activities;
- why selected;
- next segment.

Clicking an edge opens:

- transport type;
- duration;
- estimated/current fare;
- flight options.

The map must be functional navigation, not decorative.

---

## 17.3 Timeline

Answer:

```text
每天怎么玩？
```

Timeline includes:

- day;
- city;
- flight/rail movements;
- selected activities;
- user-required events;
- stopover play windows.

---

## 17.4 Cost / flight section

Show leg-level airfare options.

Each leg can open the Flight Explorer.

---

## 17.5 Why this route

Explain concrete optimizer reasons:

```text
✓ 比传统方案预计便宜 ¥X
✓ 命中你喜欢的东京和首尔
✓ 首尔停留时间适合游玩
✓ 活动时间与出行日期匹配
✓ 大阪进、东京出减少回头路
```

This explanation should be based on optimizer/artifact data, not invented post-hoc by the LLM.

---

# 18. Flight Search Product Integration

Do **not** remove the existing flight-search capability.

Instead, remove it as an isolated primary product silo.

Flight search becomes:

1. an Agent tool;
2. a quick structured action inside Plan;
3. a detailed subpage named Flight Explorer;
4. a leg-detail tool from Route Detail.

---

## 18.1 One unified flight artifact

Both:

```text
User manually opens "Search Flights"
```

and:

```text
Agent calls search_flights
```

must produce the same:

```text
FlightSearchArtifact
```

Do not maintain two search implementations.

---

## 18.2 Flight Explorer

Reuse useful concepts from the existing SearchPage:

- direct / airline-transfer / self-transfer;
- recommended / price / duration sorting;
- flexible-date price matrix;
- map;
- risk warnings;
- alternate origin/destination airport;
- route details.

Flight Explorer is a subpage, not a main Tab.

---

# 19. Frontend Information Architecture

Primary tabs:

```text
Plan
Explore
Trips
Profile
```

`Plan` remains the primary default entry for v1.

---

## 19.1 Plan — Trip Workspace

Contains:

- current Trip Context chips;
- Agent conversation;
- embedded research cards;
- embedded activity cards;
- embedded flight-search cards;
- route preview/draft;
- quick actions;
- Generate Route button.

The full structured context is secondary, not the visual center.

---

## 19.2 Explore — Discovery Feed

Content categories:

```text
event
seasonal
theme
stopover
deal
```

Feed ranking considers:

```text
content quality
freshness
Memory match
origin accessibility
fare attractiveness
novelty
```

Clicking a content card creates a `TripSeed`.

The template is adapted to the user rather than copied blindly.

---

## 19.3 Trips

Cloud-backed trip history:

- currently planning;
- generated;
- saved;
- archived.

Routes and conversations remain associated with the same Trip.

---

## 19.4 Profile

Contains:

- account;
- Memory on/off;
- Memory Markdown editor;
- saved routes;
- alerts;
- settings;
- data controls.

Existing local `TOGO` should be migrated into Memory preferences rather than remain a separate long-term preference subsystem.

---

# 20. Explore Discovery System

Explore content is produced by:

```text
Automatic discovery
      ↓
Deduplication + verification
      ↓
LLM draft generation
      ↓
Human review
      ↓
Publish
```

AI must not auto-publish v1 content.

---

## 20.1 Content types

```text
Event
Seasonal
Theme
Stopover
Deal
```

---

## 20.2 Discovery lifecycle

```text
candidate
→ draft
→ review
→ published
→ stale
→ expired / archived
```

Time-sensitive items must automatically become stale/expired.

---

## 20.3 TripTemplate

Explore content may reference a curated `TripTemplate`.

A TripTemplate contains:

- route concept;
- anchor destinations;
- optional destinations;
- recommended stopovers;
- suggested duration;
- interests;
- experience goals;
- valid time window;
- source/verification metadata.

It must **not** permanently store final airfare or fixed real-time flights.

---

## 20.4 Clicking Explore content

```text
Explore Content
      ↓
TripTemplate
      ↓
TripSeed
      ↓
User Memory + current context
      ↓
Agent Workspace
      ↓
Generate Route
```

The final route is recalculated using current flight/fare data.

---

# 21. Admin Web App

Create:

```text
apps/admin/
```

Recommended stack:

```text
React
Vite
TypeScript
React Router
TanStack Query
lightweight component system
```

Do not use Next.js for this internal SPA unless later requirements justify it.

---

## 21.1 Admin v1 pages

### Dashboard

- pending review;
- newly discovered;
- soon-to-expire;
- provider/discovery failures;
- published templates.

### Review Queue

Filter by:

- content type;
- status;
- freshness;
- quality.

### Template Editor

Edit:

- title;
- summary;
- destination set;
- tags;
- duration;
- route concept;
- stopover ideas;
- source facts;
- validity window.

Show preview.

### Published

- edit;
- unpublish;
- reverify;
- regenerate;
- archive.

### Discovery Monitor

Show:

- last run;
- candidates found;
- errors;
- retry action.

---

## 21.2 Human review actions

```text
Save
Approve & Publish
Regenerate with Instruction
Reject
```

---

## 21.3 Versioning

Use immutable template versions.

Recommended:

```text
trip_templates
trip_template_versions
```

Every:

- AI generation;
- human edit;
- regeneration;
- publication

creates/records a version.

---

# 22. Backend Domain Layout

Target direction:

```text
backend/src/
├── agent/
│   ├── runtime/
│   ├── tools/
│   ├── prompts/
│   └── types/
│
├── memory/
├── trips/
├── artifacts/
├── aviation/
│   ├── providers/
│   ├── topology/
│   └── services/
│
├── fares/
│   ├── providers/
│   └── services/
│
├── destinations/
├── routing/
│   ├── connections/
│   ├── planner/
│   └── optimizer/
│
├── research/
├── discovery/
│   ├── sources/
│   ├── jobs/
│   ├── candidates/
│   ├── templates/
│   ├── review/
│   └── ranking/
│
├── auth/
├── db/
├── routes/
└── app/
```

Do not perform a destructive “move everything at once” refactor.

Migrate domain by domain.

---

# 23. Frontend Migration Strategy

Current WeChat frontend remains under `src/` during the first backend/Agent migration.

Do **not** immediately move the entire mini-program into `apps/weapp`.

Reason:

- unnecessary file churn;
- harder review;
- merge risk;
- harder regression tracking.

First:

1. stabilize backend contracts;
2. introduce Artifact rendering;
3. refactor tabs/pages;
4. only later consider monorepo physical relocation.

The admin app may start under `apps/admin/` immediately because it is new.

---

# 24. Public API and explicit route generation

FlightOR has one public Planner conversation workflow, with synchronous and
short-polling transports under [ADR 0015](adr/0015-transient-planner-progress.md). The old client-owned
rule-first converse protocol and the temporary `agent-v2` seam are not current
product APIs.

## 24.1 Planner conversation

The mini-program uses `POST /v1/agent/turns` and owner-scoped
`GET /v1/agent/turns/:turnId` for temporary execution activity and its eventual
response. The same Planner service, request and final response remain available
through the synchronous endpoint below. The Planner has a 300-second turn budget;
progress never enters Conversation, Memory, Trip or Artifacts. This local MVP
uses a bounded process-local status cache and cannot resume that status after a
server restart. See ADR 0015 for connectivity and lifecycle semantics.

B4 publishes compact flight/guide references from the workspace commit observer,
after repository completion and a fresh scope checkpoint. Tool-return metadata
cannot publish an unsaved card. Temporary snapshots carry Trip/conversation/generation
and an artifact revision; current version/flight selection reconciliation removes
outdated refs, and guards asynchronous context reads against newer publications.
The client merges scoped revision snapshots and retains committed refs even without
final assistant prose. This is saved output, not proof of Goal satisfaction.

Owner-scoped `POST /v1/agent/turns/:turnId/cancel` terminates execution, preserves
committed refs and rejects late events. It does not undo transactions or cancel a
persisted Goal. Same-scope new generations supersede running predecessors; client
mutations wait for terminal acknowledgement while browsing/draft editing remain
available. Exact bounds and compatibility are in [RUNTIME_PLAN §5](design/budget-travel-agent/RUNTIME_PLAN.md).

```text
POST /v1/agent/converse
Authorization: Bearer <access token>
```

The strict request is:

```ts
{
  tripId: string,
  conversationId: string,
  message: string
}
```

The server derives `userId` from the access token and rejects any Trip or
Conversation that is not owned by that user or bound to that Trip. The response
is intentionally compact:

```ts
{
  conversationId: string,
  tripId: string,
  reply: string,
  tripContextSummary: TripContextSummary,
  artifactRefs: Array<{
    id: string,
    type: ArtifactType,
    schemaVersion: number,
    presentationHint: string
  }>,
  suggestedActions: SuggestedAction[],
  memoryChanged?: boolean,
  warnings: string[],
  stopReason: string,
  delivery: {
    status: 'not_requested' | 'pending' | 'satisfied' | 'partial' | 'failed' | 'cancelled',
    goalId?: string,
    kind?: GoalKind,
    artifactIds: string[],
    missing: string[],
    warnings: string[],
    goals: GoalDeliveryItem[]
  }
}
```

Large Artifacts are fetched by owner-scoped ID. `suggestedActions` is metadata
only: a `generate_route` suggestion never starts a worker. The conversation
Planner registry excludes final connection search, complete-path planning,
optimization, and route-price confirmation; those tools are available only to
the deterministic generation composition. An unambiguous current user message
may authorize the Planner's zero-argument `start_route_generation` operation;
discussion, readiness, suggestions, and Planner inference may not.

`delivery` is a server verdict, persisted with the assistant message. The
per-goal entries contain Goal identity/kind, verification status, Artifact IDs,
missing requirements and warnings; optional top-level Goal identity describes
a single applicable Goal. Clients render this verdict rather than inferring
completion from `reply`, tool traces or a successful route worker. After a
conversation result, the client reconciles `GET /v1/trips/:id/workspace` and
attaches any accepted background route run to the existing polling/cancellation
flow. Workspace reads refresh unfinished delivery snapshots with the same
verifiers, so background progress can update delivery without another POST.

## 24.2 Route-generation run

The user explicitly starts final generation either through the authenticated
run resource (the Generate Route button) or an unambiguous current conversation
instruction handled by `start_route_generation`:

```text
POST   /v1/trips/:tripId/route-generation-runs
GET    /v1/route-generation-runs/:runId
DELETE /v1/route-generation-runs/:runId
```

HTTP creation requires the `Idempotency-Key` header. Its strict body is
`{ conversationId?, expectedTripVersion? }`. The server validates ownership and
same-Trip Conversation binding, snapshots the accepted Trip Context and version,
stores a canonical request binding, creates a durable `route_generation` Goal
and frozen Goal run with `button` authorization, and enqueues only the opaque
public route-run ID. The Agent tool derives idempotency and authority from the
authenticated runtime and records `explicit_user_message` instead.
The same key and request replay the existing run; a different request under the
same key is a conflict. Reads and cancellation are owner-scoped. Cancellation
is cooperative and persistent; terminal runs are immutable.

Run status is `queued → running → succeeded|failed|cancelled`. Status responses
include bounded progress, warnings, sanitized errors, the frozen context version,
and compact result Artifact references. The snapshot is immutable, but it does
not authorize writes after the live Trip changes: a queued or running attempt
that encounters a different current version fails with
`TRIP_CONTEXT_VERSION_CONFLICT`. The worker checks before work, after provider
calls and at Artifact writes; a fresh run is required for the revised Trip.
Already-persisted historical results remain auditable with their original
version. A run that completed before a later Trip edit may be reported as stale;
this does not permit an in-flight stale snapshot to finish as current work.

Route Artifacts preserve Goal ID, Goal run ID, Trip Context version and source
lineage. The shared server-side completion service verifies the result and
atomically updates the planning Goal and Goal run to `satisfied` or `partial`;
failure and cancellation also synchronize those planning records. Route-run
execution success and verified business delivery remain distinct.

Phase 5 supports exactly one final visit destination resolved to a canonical
airport, one canonical origin airport, and a bounded departure window. Return
windows, multiple visit destinations, round-trip composition, and required
ground legs return explicit unsupported-input errors. The run must not silently
truncate, reorder, or fabricate a complete itinerary. Missing credentials and
partial fare coverage are explicit unavailable/warning states; no fare is
invented.

Examples of owner-scoped state/artifact endpoints:

```text
GET /v1/artifacts/:id
GET /v1/trips/:id
GET /v1/conversations/:id
GET /v1/memory
PUT /v1/memory
```

Admin APIs stay under:

```text
/v1/admin/*
```

---

# 25. Database Direction

Suggested new domains/tables:

```text
users
user_identities

user_memories
user_memory_profiles

conversations
conversation_messages

trips
trip_context_versions

planning_goals
planning_goal_runs
route_generation_runs

artifacts
route_sets
routes
route_segments
route_activities
flight_searches

trip_templates
trip_template_versions

discovery_candidates
discovery_runs
discovery_sources

admin_users
admin_roles
```

Do not over-normalize v1 artifact internals if JSONB gives safer iteration speed.

Recommended hybrid:

- relational columns for identity/status/indexing;
- JSONB for rapidly evolving artifact payloads;
- explicit schema validation at application boundary.

Durable planning runs freeze Trip Context in JSONB while relational lineage
links a route run and every produced Artifact to its Goal/run. Historical
Artifacts remain valid with nullable Goal lineage; new Agentic work writes Goal
ID, Goal run ID, Trip Context version, and source Artifact IDs. Historical
readability does not imply eligibility as current-version composition evidence.
Planning Goal/Goal-run completion uses one transaction, with revision and Trip
version validation; it must not use two independent status updates.

---

# 26. Caching and Cost Control

Provider calls are not all equal.

Tool metadata should classify:

```text
free
cheap
paid
expensive
```

Use local/Redis caches aggressively for:

- location resolution;
- airport data;
- route topology;
- schedule discovery;
- research results where appropriate.

Fares require short-lived caching.

### Route generation strategy

Do not query real fare data for every graph edge.

Use:

```text
topology → prune → estimate → shortlist → real fare lookup
```

Provider budget must be bounded per generation request.

---

# 27. Error and Degradation Policy

A mature route must survive partial provider failures.

Examples:

### AeroDataBox unavailable

- use cached topology;
- clearly mark freshness internally;
- continue fare search where possible.

### SerpApi unavailable

- return route concepts with unconfirmed fare state;
- do not fabricate prices.

### Web research unavailable

- route generation still works;
- omit current-event enrichment.

### Planner or route-generation credentials unavailable

- return an explicit provider/unavailable state and bounded warning;
- keep the run/turn failure auditable;
- never silently switch the public Planner back to the removed rule-first
  conversation protocol;
- never fabricate a fare, route edge, or verification fact.

### OAG unavailable

- no impact on core product.

---

# 28. Observability

Every Agent turn should trace:

```text
request_id
conversation_id
trip_id
agent_step
tool_name
tool_duration
tool_result_status
provider
provider_cost_class
artifact_ids
warnings
```

Every route-generation run should additionally trace safe identifiers and
state, without private payloads:

```text
run_id
trip_id
user_id reference
context_version
job_id reference
phase/progress
status
provider
artifact_ids
warnings
cancellation_requested
stale_result
```

Do not log:

- provider API keys;
- auth tokens;
- private Memory content in ordinary application logs.

---

# 29. Security / Privacy

Memory and trip conversations are private user data.

Requirements:

- authenticated access by `user_id`;
- authorization check on every trip/artifact/memory fetch;
- never use client-provided user IDs as authority;
- redact provider/auth secrets;
- admin and consumer identities are separate;
- admin endpoints require internal roles;
- server-side validation on every tool input.

---

# 30. Testing Strategy

## 30.1 Unit

Test:

- context mutation;
- memory version conflicts;
- location normalization;
- connection scoring;
- self-transfer policy;
- stopover classification;
- Pareto filtering;
- route representative selection;
- source verification;
- provider normalization.

## 30.2 Tool contract tests

Every tool:

- valid input;
- invalid input;
- provider failure;
- empty result;
- timeout;
- deterministic serialization.

## 30.3 Agent scenario tests

Examples:

### Scenario A

```text
十月从北京出发，一周，城市你帮我选
```

Expected:

- origin resolved;
- approximate time stored;
- destination recommendation allowed;
- no regex dependency.

### Scenario B

Memory:

```text
喜欢东京、首尔
```

User:

```text
去巴黎，最好路上还能玩一下
```

Expected:

- preferred hubs explored first;
- general hubs still explored;
- multiple route styles preserved.

### Scenario C

Memory:

```text
喜欢东京
```

User:

```text
这次日本只想中转，不正式玩
```

Expected:

- Tokyo may be stopover;
- Japan must not become primary visit destination.

### Scenario D

User:

```text
这次不要经过日本
```

Expected:

- Memory preference is overridden.

### Scenario E

User asks current event question.

Expected:

- web research;
- verification metadata;
- event not automatically made mandatory until user requests it.

---

## 30.4 Route golden tests

Maintain fixed synthetic graph/fare fixtures.

Golden cases must validate:

- cheapest route;
- preferred-city route;
- stopover route;
- airport-change penalty;
- self-transfer risk;
- backtracking penalty;
- category de-duplication.

---

# 31. Migration From Current Agent

The public cutover is now defined as one authenticated Planner API:

```text
POST /v1/agent/converse
```

The old client-owned rule-first converse route is unregistered from the Fastify
application. `agent-v2` is removed rather than retained as a second product
API. The former implementation and local history may remain temporarily as
migration/test assets, but they are not a current authority and must not be
silently used as a fallback for the new API.

The mini-program session transport migration is implemented; device acceptance
remains a separate evidence boundary. It must create
or resume an authenticated owner-scoped Trip and Conversation, send only the
new camelCase request, render compact Artifact references, and invoke the
explicit route-generation run when the user presses Generate Route. It must not
replay legacy `TripState`, recommendations, route cards, or prices into the new
API as authoritative state. Logout must clear access credentials and
owner-bound session IDs.

Retain/reuse where useful:

- Fastify app infrastructure;
- provider adapters that remain useful;
- deterministic route engine concepts;
- SerpApi integration;
- race/cancellation protections;
- useful Flight Search UI components;
- risk warnings;
- route visualization components.

Do not delete migration assets until the new backend contract, route-generation
run tests, mini-program session transport, and scenario regressions pass. This
is a compatibility safeguard, not permission to expose a second public Agent
API.

---

# 32. Implementation Phases

## Phase 0 — Architecture preparation

Deliver:

- this document maintained under `docs/` (the historical root location is superseded);
- `docs/TOOLS.md`;
- architecture decision notes where needed;
- no destructive frontend refactor yet.

---

## Phase 1 — Agent Runtime + Provider Abstractions

Implement:

- tool-calling-capable OpenRouter client;
- Agent runtime loop;
- Tool Registry;
- `AviationProvider`;
- `FareProvider`;
- AeroDataBox provider;
- SerpApi normalized fare provider;
- OAG optional provider;
- Mock providers.

---

## Phase 2 — Cloud Memory + Trip Domain

Implement:

- `users/user_identities` direction;
- cloud Memory;
- Markdown editor API;
- Memory versioning;
- Trip Context;
- cloud conversations;
- core artifacts.

---

## Phase 3 — Core Tools

Implementation status (2026-09-07): the initial list completed in Phase 3/4;
the second list completed in Phase 4B. New Research writes use schema version 2,
while the v1 reader remains only for migration compatibility. See ADR 0005.

Implement first:

```text
get_trip_context
update_trip_context
get_user_memory
update_user_memory
resolve_location
search_flights
search_flexible_flights
search_connection_flights
plan_flight_route
optimize_route
web_research
```

Then:

```text
search_destinations
recommend_destinations
plan_trip_route
confirm_flight_price
confirm_route_price
research_destination
save_travel_guide
```

---

## Phase 4 — Connection / Route Engine

Implementation status (2026-09-07): completed and production-composed. The
engine uses normalized PostgreSQL topology, bounded preferred-first/general
expansion, deterministic complete-path search, and Pareto representatives. See
ADR 0004. Missing live provider credentials skip live smoke tests but do not
substitute mock facts in production.

Implement:

- preferred-city-first search;
- general graph search;
- self-transfer;
- stopover;
- airport change;
- bounded path search;
- scoring;
- Pareto frontier;
- representative routes.

---

## Phase 5 — Agent API and Explicit Route Generation

The accepted public contract is the authenticated `POST /v1/agent/converse`,
also exposed through short-polling `/v1/agent/turns` under ADR 0015.
The response is compact and Artifact-oriented; user identity is never accepted
from the body. The conversation Planner registry excludes final connection/path/
optimizer/route-confirmation tools.

Final generation is an explicit authenticated run with idempotency, owner
authorization, frozen Trip Context, cooperative cancellation, progress, stale
historical-result reporting, version-conflict failure for active work, and
terminal immutability:

```text
POST   /v1/trips/:tripId/route-generation-runs
GET    /v1/route-generation-runs/:runId
DELETE /v1/route-generation-runs/:runId
```

The current engine slice supports one final visit destination with canonical
airport origin/destination and a bounded departure window. Return windows,
multiple visit destinations, round trips, and required ground legs fail
explicitly as unsupported. Missing credentials remain visible unavailable /
warning states. The backend contract, worker, mini-program session migration,
resumable polling/cancellation, and Phase 5 regression gate are complete.
Route-run acceptance is serialized with Trip Context writes;
soft `preferred` destinations never become the final visit without an explicit
required/visit selection. Worker heartbeats and periodic stale-job recovery keep
long-running or interrupted runs reclaimable without creating duplicate jobs.
Calendar windows are bounded, weekly schedules are materialized sequentially
per path, and city-level preference/exclusion semantics apply to constituent
airports without collapsing distinct airports into one graph node.

---

## Phase 6 — Plan / Flight UI

Accepted implementation:

- Artifact cards;
- flight quick search;
- Generate Route action;
- Flight Explorer subpage.

Plan is now the default Trip Workspace and the primary tabs are Plan, Explore,
Trips, and Profile. Search is a subpage. Manual and Planner flight searches use
the same fare-domain Artifact creation service; full payloads load by
owner-scoped Artifact ID. The manual UI submits one exact airport pair and exact
outbound/optional return date, while unsupported candidate-airport UI is
withheld. Search creation requires an owner-scoped idempotency key, and client
responses are invalidated across owner/session changes. Do not duplicate search
logic.

---

## Phase 7 — Route Visualization

Implement:

- route result list;
- interactive map;
- timeline;
- activity detail;
- flight detail;
- cost section;
- Why This Route.

---

## Phase 8 — Discovery + Admin

Implement:

- discovery jobs;
- candidate lifecycle;
- TripTemplate;
- verification;
- admin SPA;
- review;
- publishing;
- expiry.

---

## Phase 9 — Explore / Trips / Profile

Refactor primary tabs to:

```text
Plan
Explore
Trips
Profile
```

Move:

- TOGO preference → Memory;
- local history → cloud Trips/Conversations where appropriate;
- search page → Flight Explorer subpage.

---

# 33. Definition of Done for v1 Architecture Migration

The architecture migration is considered complete when:

1. Agent can complete a normal planning conversation without rule-first semantic parsing.
2. Agent can call tools through a bounded tool loop.
3. AeroDataBox is the primary aviation provider.
4. Product runs without OAG credentials.
5. SerpApi provides fare search/confirmation.
6. User Memory is cloud-backed Markdown and editable.
7. New conversations inherit Memory when enabled.
8. Current trip overrides Memory.
9. Both authenticated Planner transports (`/v1/agent/converse` and `/v1/agent/turns`) share one conversation workflow and final response; temporary progress never enters its context.
10. The conversation registry cannot invoke final connection/path/optimizer/route-confirmation tools.
11. User explicitly triggers route generation through the button or an unambiguous current message; both create an idempotent, owner-scoped run with persisted authorization source.
12. Route runs freeze Trip Context, support cooperative cancellation, and keep terminal results immutable.
13. The current run contract rejects unsupported return windows, multi-visit composition, and required ground legs explicitly.
14. Connection Engine prioritizes preferred cities but still searches alternatives.
15. Self-transfer and long stopovers are supported.
16. Route Optimizer returns distinct representative routes.
17. Route details have map + timeline + activity + flight visualization.
18. Existing flight-search capability survives as Flight Explorer and Agent tool.
19. Explore content is generated by discovery → AI draft → human review → publish.
20. Admin web app can review/edit/publish templates.
21. Important external facts have internal verification/provenance.
22. Visa/entry is never represented as guaranteed legal advice.
23. Core user data is cloud-hosted and future web-client compatible.
24. `docs/TOOLS.md` and this architecture document remain updated as code evolves.

---

# 34. Non-goals for v1

Do not implement yet unless directly required by a current task:

- ticket purchase / booking;
- payment;
- GDS ticketing;
- automatic visa eligibility decisions;
- vector database Memory;
- multiple user personas per account;
- fully autonomous content publication;
- ML-based route ranking;
- native mobile app;
- full monorepo relocation of current mini-program;
- OAG as required production dependency.

---

# 35. Engineering Rules for Codex / Future Contributors

1. Read this document before changing Agent architecture.
2. Update `docs/TOOLS.md` whenever an Agent-facing tool changes.
3. Do not reintroduce regex as the primary semantic parser.
4. Do not allow LLMs to invent provider facts.
5. Do not expose provider-specific schemas beyond provider adapters.
6. Do not duplicate flight-search implementations.
7. Do not mix Memory, Trip Context, Conversation and Artifacts.
8. Do not make OAG a hard dependency.
9. Do not directly publish AI-generated Explore content in v1.
10. Do not perform huge directory moves unless required by the active phase.
11. Prefer small migration-safe commits.
12. Every new route algorithm must have deterministic tests.
13. Every tool must have schema validation and failure tests.
14. Every external factual artifact must carry verification metadata internally.
15. Maintain backwards compatibility temporarily when it materially reduces migration risk.

---

# 36. Product Statement

FlightOR should feel like:

> **A travel Agent that knows what the user likes, discovers timely travel inspiration, searches real flights, finds creative low-cost connections, and turns those facts into routes that are both cheaper and more fun.**

The user should not need to understand airline topology, preferred-stopover settings, provider APIs or optimization weights.

They should simply be able to say:

> “十月从北京出发，我有一周，预算别太高，喜欢动漫和吃东西，路上如果能顺便玩一个我喜欢的城市更好。”

FlightOR should be able to understand that request, research current opportunities, discuss options, and—when the user presses **Generate Route**—produce multiple high-quality, visual, explainable route choices.

## Implementation checkpoint — 2026-09-07, Phase 7–9
Route Artifact workspaces, cloud Trips/Memory, reviewed Discovery, public Explore adoption and the apps/admin console are implemented. See ADR 0008 and [operation/acceptance](./PHASE789_ACCEPTANCE.md) for concrete scope and unverified deployment/device/provider boundaries. Single-destination outbound generation remains the accepted v1 implementation limit.


## 2026-09-21：攻略引用资料适用性

新攻略每条日程及 supportingEvidence 由服务端写入 `sourceApplicability`，仅支持 `reference_only` 和固定说明。来源核验/检索时间不证明价格、开放时间、交通时长的当前或出行日适用性。新 v3 builder 的保存及完成共用检查，Planner 不能自行提升；旧记录仍可读，客户端保守展示。语义、兼容/回滚和未实现的正文时效复核见 [ADR 0022](adr/0022-guide-source-applicability.md)。这不是 G1 内容或平台已验收。


2026-09-21：SerpApi 主研究路径增加有界正文读取及 `claimEvidence` 原文绑定，读到正文不升级为当前/未来事实已核实。攻略共享 validator 拒绝声明出处错误和同对象冲突；保持 reference_only。接入、限制与兼容见 [ADR 0023](adr/0023-source-pages-and-quoted-claims.md)。
# 2026-09-22：发布末端终稿合同

同日三项收尾：失败语言按技术可重试/材料需修订区分，publication-only revision 比较合并、history保留失败费用，每内容/语言最多2次显式重试；accepted不可覆盖。practical复用已有日程角色进入语义检查，名称与逐活动占位受发布限制。没有新Goal、工作流或数据库迁移，见[收尾验证](design/budget-travel-agent/FINALIZATION_FOLLOWUP_2026-09-22.md)。

新Planner攻略在Artifact保存边界标记为草稿，原始研究与规划正文仍供领域验收；后置GuideFinalizer复用同模型/client，无工具，一次结构化生成，最多一次表达修复。独立的publication-only短事务合并zh/en终稿，不修改Trip、航班、活动身份、顺序或Goal/Run。领域satisfied不等于内容accepted；公开读取只能投影目标语言接纳文本或明确准备/阻塞状态。完整合同、90秒/180k字符边界、同进程并发去重和素材独立扩展接口见[ADR 0025](adr/0025-bounded-guide-finalization.md)。不在数据库长事务、GET或verifier内调用模型。

## 2026-09-22 Published itinerary UI

The production overview, daily list and activity sheet render only accepted target-locale text bound to the current Trip context and selected-flight revision. They never fall back to raw summary, supportingEvidence or legacy prose. Reading/restoring/polling is GET-only; first localization and bounded technical retry require an explicit user action. The latter checks an accepted base (canLocalize), canRetry and current revision again before POST. No Planner/provider/Goal changes. Workspace summaries expose existing bounded Trip notes for explicit self-arranged flights.

The optional read-side Artifact envelope `enrichment: {contentVersion, activities: {[activityId]: {coordinates?: {latitude,longitude}, media?: {src,description,source?: {label,url}}}}}` is passed through only for the matching accepted guideContentHash and stable activity ID. Original city identity clues remain `locationHint`; city center is never a venue coordinate. No producer/provider is added, and enrichment is independent of finalization identity. See [field mapping and verification](design/budget-travel-agent/PUBLICATION_UI_2026-09-22.md).
