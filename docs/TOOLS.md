# FlightOR Agent Tool Registry

2026-09-21 publication update: `save_travel_guide` keeps its Planner choice schema, Goal authority and raw evidence lineage. The domain write boundary now stores a server-owned publication v1 with artifact/context/flight revision and content-hash binding. The public Artifact endpoint returns its conservative display projection; raw summaries/notes remain internal audit/Agent research input. A successful, committed guide-only batch may end without another model reply, after the shared verifier confirms every touched Goal. Budget feasibility is `undetermined` until a cost ledger exists; retaining the budget constraint is not an affordability result. Old guide/history reads fail closed to limited display. See [ADR 0024](adr/0024-guide-publication-contract.md) and [frozen G1 contract](design/budget-travel-agent/G1_PUBLICATION_RUBRIC_V1.md). No tool is granted new external authority or paid quota.

> 2026-09-20: B1 context, opt-in B2 Goal acceptance, B3 stable guide decisions/repair, B4 early committed-result publication and B5 bounded observability are implemented. B2 is disabled by default and its PostgreSQL acceptance/rollback/concurrency checks have now run in a dedicated local instance; real Provider acceptance remains pending. B3–B5 work in both Goal modes; contracts and compatibility are recorded under [ADR 0019](adr/0019-lean-planner-evaluation.md). Every tool modification must update this inventory and its verification record in the same change batch; see [maintenance rules](DOCS_MAINTENANCE.md).

This file is the source-of-truth inventory for Agent-facing tools. It follows
`docs/FLIGHTOR_ARCHITECTURE.md`; implementation status means both code and contract
tests exist. Provider-specific payloads must be normalized before crossing a
tool boundary.

The public conversation API is the authenticated `POST /v1/agent/converse`.
The mini-program uses the same workflow via `POST /v1/agent/turns` and
`GET /v1/agent/turns/:turnId` for temporary execution-stage feedback and committed Artifact references under
[ADR 0015](adr/0015-transient-planner-progress.md). This adds no Agent-facing
tools or context messages; the production turn budget is 300 seconds.
Accepted turns carry Trip/conversation/generation scope. Snapshots include monotonic
`artifactRevision` and at most 24 compact, current-version `flight_search`/`travel_guide`
refs. Only a successful workspace commit can publish them; a tool's returned refs
cannot. `POST /v1/agent/turns/:turnId/cancel` is owner-scoped and idempotent,
aborts active execution and retains committed refs. It does not cancel a persisted
Goal or undo a committed transaction. The client waits for acknowledgement before
unlocking submissions. Scope, version reconciliation, compatibility and concurrency
semantics are specified in [RUNTIME_PLAN §5](design/budget-travel-agent/RUNTIME_PLAN.md).
In DSH mode the cancellation snapshot remains nonterminal until parent domain
tool promises drain; the cancel POST awaits service settlement. The unchanged
315-second outer timeout is a timeout, not proof of a completed cancellation.
Another turn in the same owned conversation cannot begin while its predecessor
is still draining. See [ADR 0015](adr/0015-transient-planner-progress.md).
Its Planner registry is intentionally smaller than the complete deterministic
Core Tool registry: conversation may gather facts, update Trip/Memory, search
fares, research, and author daily travel guides. It may queue final route generation only
through the zero-argument `start_route_generation` operation after an
unambiguous current user instruction. Final connection search, complete-path planning, Pareto
optimization, and route-price confirmation run only behind the explicit,
owner-scoped route-generation domain service described below. `agent-v2` is a removed
migration seam, not a current public API.

## Status legend

- **Implemented**: registered in the new runtime and covered by contract tests.
- **Partial**: a reusable domain/provider foundation exists, but the Agent tool
  contract is not complete.
- **Planned**: no production Agent tool contract exists yet.

`generation-only` is an additional boundary label, not a weaker implementation
status: the tool is implemented and tested, but is intentionally absent from
the public conversation Planner registry and may run only inside the explicit
route-generation composition.

## Agentic goal controls

Before the first model call, CloudPlannerService supplies a bounded read-only
PlanningContext with compatible research findings, unfinished Goal parameters and
saved-guide summaries. This can avoid a discovery-only `get_active_goal` or
list/read round trip when the retained material is sufficient. It never activates
a Goal or creates a Run. Omitted or changed material still uses existing read
tools; saving still revalidates authority, version, evidence and selection.
Coverage gaps describe only the preload, not mandatory new research or accepted
Goal requirements. No tool schema or completion authority changed in B1. Exact
limits, expiry/date handling and metadata are in
[RUNTIME_PLAN section 2.1](design/budget-travel-agent/RUNTIME_PLAN.md).

### B2 opt-in business-tool protocol

`PLANNER_LEAN_GOALS_ENABLED=false` (default) retains the table below. With `true`,
the Planner hides `declare_goal`, `resume_goal`, `finish_goal`; read and cancel
remain available. Core registry/direct legacy callers retain their existing API.

| Business tools with optional `intent` / `goalRef` | Accepted kind | Completion behavior |
| --- | --- | --- |
| `research_destination`, `web_research`, `search_destinations`, `recommend_destinations`, `plan_trip_route` | `travel_guide` | Bind once, keep attempt running |
| `save_travel_guide` | `travel_guide`, required if no accepted goal | Existing save result plus shared completion feedback |
| `search_flights`, `search_flexible_flights`, `confirm_flight_price` | `flight_search` | Existing result plus shared completion feedback |
| `update_trip_context` | `trip_context_update` | Existing update result plus shared completion feedback |

`intent` is `{kind, parameters}` using the same bounded parameter schema as
`declare_goal`; `goalRef` is an existing UUID, not permission to access it.
Supply at most one; subsequent calls may omit both. Calls before acceptance may
remain ephemeral except guide save, which requires a goal. Once accepted,
business writes stay within that Goal's kind/parameters/current version;
semantic switching or weakening produces `GOAL_INTENT_CONFLICT`, kind mismatch
produces `GOAL_KIND_MISMATCH`, missing initial intent for save produces
`GOAL_INTENT_REQUIRED`. New user turns may explicitly resume unfinished Goals.
Another generation's running attempt is never taken over.

Results may add `acceptedGoal: {goalId, runId, kind, contextVersion}` and
`completion: {status, artifactIds, missing, warnings}`. These are server-derived.
The atomic acceptance transaction creates both records or neither; late
cancellation closes only its own attempt. Save and runtime finalization share
`completeGoal`, and partial feedback keeps the run open for corrections.
Goal completion outages retain the saved Artifact result with pending feedback.
Automatic completion first records the Artifact in the Run working set. Its
2.5-second child deadline (shorter near the outer tool deadline) returns pending
with `goal_verification_timeout` rather than discarding an already saved result;
parent cancellation still applies. Lean tools allow an extra 5 seconds within
the registry's 120-second cap; the whole-turn deadline is unchanged.
Early card publication is independently provided by B4's workspace commit observer. B3 offers stable
candidateRef decisions alongside the legacy positional input below. Guide Goal parameters may also include
optional `requiredEvidenceTypes`; omission has no default rewrite and preserves the legacy contract that every
`researchTypes` category is required. When explicitly present, it must be a subset of `researchTypes` and only
those categories are required; `researchTypes` then describes the bounded exploration scope. An explicit empty
array means no additional category requirement. The accepted parameter object is immutable, so reducing this
subset after acceptance is a conflict. See [ADR 0021](adr/0021-guide-required-evidence.md).

### Runtime diagnostics (B5; no new public tool)

Server-only `plannerObservation` logs correlate model/tool/HTTP spans and
committed save/Goal milestones by request, Trip, conversation and generation.
Tool attempts (including rejected calls), actual HTTP adapter attempts and
provider-reported native searches are distinct counters. Research model spans
are children of their tool span; durations must not be added across levels.
Save/revision attempts and classified repair responses are counted without
logging tool arguments, model messages or research content. A saved Artifact
and committed satisfied Goal have separate timestamps. Unknown token/cost
values remain null; existing costUnits remain budget units, not USD.
OpenRouter metadata describes normalized outbound config, returned model/provider
and a hashed, credential-free route identity. Public tool schemas, results,
turn responses and model context are unchanged by these diagnostics. Limits,
client commit evidence and extraction are owned by
[RUNTIME_PLAN §6](design/budget-travel-agent/RUNTIME_PLAN.md) and
[EVALUATION §4](design/budget-travel-agent/EVALUATION.md).

### Stable guide decisions and repair (B3)

`research_destination`/`web_research` findings and retained planning-context
findings include `candidateRef`. `read_artifact` adds up to 50 candidate summaries
for supported current-version research. These locators are derived from stored
evidence and authenticated context, are stable across process restarts, and do
not grant access or certify freshness. Duplicate finding IDs cannot be selected.

Research `read_artifact` output also includes `researchReuse`: `status` is
`current_candidates`, `historical_only` (a different Trip Context version), or
`unavailable` (missing context/version or unsupported research). It reports
`sourceTripContextVersion` and `currentTripContextVersion` (null when unknown),
plus a server-authored notice. Historical content stays readable, but has no
`candidates` and explicitly forbids reusing old-message candidateRefs for a new
guide. Only locators in current candidate output may be selected; publication
and source-version checks still decide acceptance. These are model-facing tool
fields, not a change to the public Artifact HTTP response or an ownership bypass.

`save_travel_guide` accepts full `days` with cityId/kind/theme/notes and items
with candidateRef/timeOfDay/planningNote/requestedActivityIds. Legacy item
researchIndex/findingId plus top-level researchArtifactIds remains valid; do not
mix both forms on one item. Optional `supportingRefs` accepts candidate strings
or `{researchArtifactId,findingId}` objects, independently of day activities.
The service restores `supportingEvidence` in the v1 Artifact and counts its
eligible categories and sources toward the same Goal constraints, including
maxResults. It never schedules a practical note as a fabricated attraction.

On `needs_revision`, `repair.issues[].classification` is draft_invalid,
evidence_missing or context_conflict; `details` supplies paths, affected days,
category/location/date and blocked checks where determinable. repair includes
up to 50 existing candidate summaries and `candidateSearchComplete:false`.
Check these and other saved evidence before new research. At most 400 feedback
items are returned per field; `feedbackTruncated:true` marks excess results.

Repair the latest same-generation draft with `draftRef`, `expectedRevision`,
`replacementDays` and/or `supportingRefs`. Only specified existing days change;
supportingRefs replaces the complete support selection. Unspecified days and
supports remain. Conflicting version/generation/flight/Goal/Run/revision requires
a fresh full draft. Successful save clears it; drafts do not survive restarts.
Every attempt reruns full source and content checks before persistence.

The shared `requiredGuideEvidenceTypes` interpretation is used by goal
acceptance, save validation, durable completion, read-only PlanningContext and
repair feedback. It never mutates an accepted Goal or infers requirements from
the Research Artifact brief. If the field is absent, all legacy
`researchTypes` remain required; if present, only its explicit subset is
required while the rest remain exploration categories. A selected optional
event still goes through the ADR 0020 temporal evidence/date check. Old
Artifacts and source query briefs are unchanged, and old/new Goal JSON needs no
migration; however, an older strict reader may reject the new field, so a code
rollback must account for that compatibility boundary.

Saved results also return optional server-owned `budget` and supportingEvidence.
Budget copies Trip amount/currency/scope with period=trip_total and
partyBasis=unspecified; neither the model nor display converts it to daily or
per-person amounts. Old persisted v1 payloads remain readable. No new database
migration or provider call is introduced. See [exact limits](design/budget-travel-agent/RUNTIME_PLAN.md).

Tool failure envelopes retain existing code/message/details and add
`error.classification` for malformed/invalid input (draft_invalid), provider
failures and research deadlines (provider_unavailable), and version/selection
conflicts (context_conflict). Provider details allow only provider/retryAfter
alongside domainCode; no raw response is exposed. Parent cancellation remains
cancellation. Research aliases retain their shared adapter cooldown.

Trip changes must precede research/guide/flight acceptance; changing the version
afterward requires a new turn. A durable Trip-update intent submits its requested
fields in one operation. `start_route_generation` remains separately authorized
and cannot replace an already accepted goal in the same lean turn. Roll back
between turns by setting the flag to `false` and restarting the API; no data
migration is involved. Full contract: [RUNTIME_PLAN section 2.2](design/budget-travel-agent/RUNTIME_PLAN.md).

The legacy durable Agentic completion protocol is **Implemented** in the PostgreSQL
production composition and the in-memory test seam. Goal controls validate
results without prescribing an end-to-end tool sequence:

| Tool | Status | Input / output | Authority and behavior |
| --- | --- | --- | --- |
| `declare_goal` | Implemented | `travel_guide`, `flight_search`, or `trip_context_update` plus bounded user-intent parameters → durable goal/run | Owner, Trip, Conversation, context version, timestamps and idempotency binding come from the server. Final route generation uses its dedicated authorized start operation. |
| `get_active_goal` | Implemented | `{ goalId?, kind? }` → matching goal/existing run or bounded candidates | Read-only and owner/Trip scoped. Inspection does not accept saved parameters for this turn, activate a Goal, or create/close a run. An existing returned run may belong to an earlier Trip version. |
| `resume_goal` | Implemented | `{ goalId }` → goal/current-context run | Explicitly activates a saved objective whose parameters match the current request. Reuses only this generation's current run or creates one after earlier attempts end; another generation's running attempt returns `GOAL_RUN_ALREADY_RUNNING` without takeover, including after a Trip change. Satisfied/cancelled Goals cannot resume. Changed parameters require `declare_goal`; abandoned-run recovery needs a separate liveness policy. |
| `finish_goal` | Implemented | `{ goalId }` → goal/run plus verification status | Returns `pending`, `satisfied`, `partial`, `failed` or `cancelled`. Shares completion with response finalization; domain constraints/coverage and lineage are verified before an atomic Goal/Goal-run status commit. |
| `cancel_goal` | Implemented | `{ goalId }` → cancelled goal and active run | Owner/Trip scope is server checked; cancellation is persistent and late tool results cannot convert it to success. |
| `start_route_generation` | Implemented | `{}` → queued route-generation run with durable goal/run lineage | Available to the Planner only for an unambiguous current user instruction. The server records `explicit_user_message`; the authenticated HTTP action records `button`. Internal route-engine tools remain hidden. |

The Planner remains free to choose, skip, repeat and reorder the existing
domain tools. The goal protocol validates the result; it is not an end-to-end
workflow. During the current functional milestone, configured fare and
research calls are not blocked by a product cost budget, although normal
timeouts, cancellation, rate limits and duplicate-call guards still apply.

The runtime verifies the Goals touched in a turn before returning a final text
response, including when the model omitted `finish_goal`. Flight-search
verification checks accepted airports/dates and sampled-date coverage; guide
verification checks requested day/destination coverage and eligible referenced
research; route verification checks accepted constraints and source path lineage.
The existence of an Artifact or verified evidence is insufficient by itself.
Reading a Goal does not add it to this turn's delivery. The Agent inspects saved
parameters, then explicitly chooses `resume_goal` or declares a new objective;
the server does not select that intent from keywords or prior Goal existence.

Turn exit closes any still-running attempt owned by that generation; the durable
Goal and saved evidence remain resumable. Background route runs and other
generations retain their own lifetime. Cleanup is bounded and reports
`goal_attempt_cleanup_failed` when persistence is unavailable; this does not
claim crash recovery or repair historical abandoned runs.

Every Planner response carries a server-derived `delivery` with aggregate and
per-Goal status, Artifact IDs, missing requirements and warnings. Only
`delivery.status=satisfied` permits `stopReason=completed`. `responded` pairs with
`not_requested` for ordinary conversation; incomplete durable goals use
`goal_pending|goal_partial|goal_failed|goal_cancelled`. Transport/runtime failures
retain their own stop reasons and the separate delivery verdict. The client must
not infer completion from text or a background route run's `succeeded` status.

`backend/src/agent/goals/completion.ts` coordinates completion through
`GoalRunRepository.commitCompletion`: PostgreSQL locks Trip, Goal and Goal run,
validates owner/scope, revisions, context version and terminal-state rules, then
commits both planning statuses together. A concurrent cancel or stale completion
cannot leave one planning record satisfied and the other unfinished.

## Shared Artifact workspace

Artifact-producing tools and non-conversational actions use the domain workspace
in `backend/src/artifacts/workspace.ts`. It freezes the server-read Trip version,
checks cancellation/current operation, validates source owner/Trip/type/schema and
context version, and checkpoints after external work and before writes.
PostgreSQL repeats current Trip and Goal/run checks in the insert transaction.

Sources may be reused across Goals/runs only within the same owner, Trip and
context version. Old-version and unversioned legacy Artifacts remain readable as
history; without an explicit compatibility policy they cannot be composed into
a new current-version Artifact. The server returns a stable conflict instead of
copying a new version onto old evidence. This boundary applies equally to fare
search/confirmation, destinations, trip planning, research, guides and background
route generation. Tools never supply their own duplicate lineage-write policy.

## Phase 1 vertical slice

### `get_trip_context`

- Status: **Implemented** (Phase 2 PostgreSQL immutable snapshots + in-memory test seam)
- Purpose: Read the current trip's `TripContext` without loading User Memory,
  Conversation history, or Artifacts into the same state object.
- Input: `{}`. The active trip identity comes from the authenticated runtime
  context, never from model-supplied authority.
- Output: `{ tripContext: TripContext }`.
- Side effects: None.
- Cost class: `free`.
- Authority: FlightOR trip store for the active trip.
- Provider dependencies: None.
- Cache behavior: No tool-level cache; the trip repository may cache by version.
- Failure behavior: Rejects missing/unauthorized active-trip context and returns
  a structured tool error. It never fabricates an empty persisted trip.

### `update_trip_context`

2026-09-26：同值显式设置通过真实 setter 写入新 Trip 版本后，服务器将实际提交字段的 canonical SHA-256、owner/Trip/run/generation/写入版本作为可选 `tripUpdateReceipt` 保存在既有 Run working set；先独立读回与预期 patch 全量比对。该回执不是模型入参、不修改已接受 Goal 参数。完成验证仅在回执作用域、当前版本及全部请求字段 hash 一致时确认同值更新；完全无回执的历史记录沿用既有字段差异规则；已有回执却scope、版本、值或字段覆盖不匹配则返回pending / trip_update_receipt_stale，不回落差异规则。不能把当前字段存在当作保存完成。取消、版本竞争或 owner 不一致不能生成有效回执；最终完成仍经共享 verifier 与原子 completion。

- Status: **Implemented** (Phase 2 PostgreSQL optimistic concurrency + in-memory test seam)
- Purpose: Apply explicit, trip-local user constraints and preferences.
- Date contract: `exact` windows identify one date; `approximate` windows may
  contain possible dates. `travelDays` counts departure and return inclusively.
  The merged snapshot must admit a matching date pair; otherwise
  `TRIP_DATES_INCONSISTENT` rejects the write without consuming a version.
  Correct conflicting fields together; the server never adds a checkout day.
  See [ADR 0017](adr/0017-inclusive-trip-dates.md).
- Input: `{ patch, expectedVersion?: number }`. The patch uses the Trip Context
  fields, with canonical location ID strings in `origin`, each
  `destinationIntent.required/preferred/excluded` entry,
  `locationRoleOverrides[].location`, and `requiredGroundLegs[].from/to`.
  IDs must come from this turn's authoritative location/destination results or
  the existing owned Trip. `origin: null` still clears the field. Unknown fields,
  unknown/ambiguous IDs and invalid ranges are rejected; the model cannot select
  another Trip ID. The shared patch schema preserves omitted fields; full-Trip
  defaults such as `requiredGroundLegs=[]` are not implicit edits. An explicit
  empty array clears a list.
- Output: `{ tripContext: TripContext, changed: boolean }`.
- Side effects: Mutates only the active Trip Context; it never writes User
  Memory or Conversation history.
- Cost class: `free`.
- Authority: Explicit current-user statements interpreted by the Agent and
  validated deterministically. One boundary restores canonical LocationRefs for
  every location field and validates the resulting Trip patch before mutation.
  Legacy full-object arguments remain compatible, but their ID/type select the
  trusted server record; copied names, countries, airport codes, coordinates and
  time zones cannot override its facts.
- Provider dependencies: None.
- Cache behavior: Invalidates any trip-context cache after a successful write.
- Failure behavior: Validation, authorization, or version conflicts are returned
  as structured tool errors; writes are atomic. When `expectedVersion` is omitted,
  the update is bound to the server version read for location resolution, so a
  concurrent Trip edit cannot silently replace the snapshot used by this patch.

### `resolve_location`

- Status: **Implemented** (AeroDataBox airport search/lookup/FIDS/status adapter + Mock/OAG-compatible seams)
- Purpose: Resolve a natural-language place into FlightOR-owned city/airport
  references before those references are used as facts.
- Input: `{ query: string, types?: ('city' | 'airport')[], limit?: number }`.
- Output: `{ matches: LocationRef[], verification: VerificationRecord }`.
- Side effects: None.
- Cost class: `cheap`.
- Authority: Aviation provider data normalized by FlightOR.
- Provider dependencies: Primary `AviationProvider` (AeroDataBox); optional OAG
  fallback; mock provider in tests.
- Cache behavior: Long-lived normalized cache by query, locale, and provider
  dataset version, subject to provider licence terms.
- Failure behavior: Empty matches are valid. Provider unavailability, timeout,
  and malformed provider payloads are distinct structured failures; no airport
  code is invented.

### `search_flights`

- Status: **Implemented** (normalized SerpApi/Mock providers + owner-scoped Artifact Repository + Phase 6 shared manual/Agent service)
- Purpose: Search real fare options for one requested leg and return the same
  `FlightSearchArtifact` contract used by manual Flight Explorer flows.
- Input: `{ origin, destination, departureDate, returnDate?, currency?,
  travelClass? }` using an IATA selector or a trusted airport ID. The fare domain
  resolves authoritative airport facts before a paid call; copied location
  descriptions cannot override the provider record.
- Output: `{ artifact: { id, type, schemaVersion }, summary }` for the Planner.
  The repository stores the complete normalized `FlightSearchArtifact`, including
  offers, query parameters, `checkedAt`, provider provenance, and verification.
  Exact-date and flexible-date summaries include `itineraries.counts` and the
  cheapest complete itinerary per transfer type (route, segment count, times,
  duration and total price). Connecting offers retain every segment and reported
  layover; `airline` does not assert protected ticketing or baggage transfer.
- Side effects: Creates an Artifact/search record when persistence is enabled;
  it does not book or purchase anything.
- Cost class: `paid`.
- Authority: Fare provider response normalized by FlightOR.
- Provider dependencies: Primary `FareProvider` (SerpApi); mock provider in tests.
- Cache behavior: Short-lived cache keyed by the normalized fare query. Cached
  output retains original `checkedAt` and freshness metadata.
- Failure behavior: No-offer is a valid empty artifact. Provider failure or
  timeout yields a structured error/unconfirmed state; prices are never guessed.
- Product path: Agent tool execution and authenticated `POST /v1/flight-searches`
  both call `backend/src/fares/search-service.ts`; the manual response returns a
  compact ref/summary and Flight Explorer loads the full Artifact by ID. The
  manual action requires an owner-scoped `Idempotency-Key`; the current bounded
  24-hour in-process store is safe for the single-process deployment and must be
  replaced by PostgreSQL/Redis before multi-instance rollout.

## Context and Memory tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `get_user_memory` | Implemented | Active authenticated user → enabled flag, Markdown when enabled, version | None | free | User-scoped cloud Memory repository | No model cache; disabled memory is not returned or injected; authorization failures are explicit |
| `update_user_memory` | Implemented | Markdown replacement + expected version → new Markdown/version | Writes enabled User Memory only | free | Clear long-term user preference; no provider | 8 KiB UTF-8 limit and optimistic concurrency; disabled/stale writes fail closed |
| `delete_user_memory` | Planned | Explicit confirmation scope → reset/deleted version | Destructive user-directed Memory reset | free | Authenticated user instruction | Invalidates derived profile; version/auth conflicts fail closed |

## Geography and destination tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `search_destinations` | Implemented (Phase 4B) | Bounded region/interests filters + active Trip constraints → `destination_set` v1 artifact | Creates artifact | cheap | Curated catalog + optional normalized aviation accessibility | Catalog coverage and provider failure are explicit; accessibility is only `direct` or `unknown` |
| `recommend_destinations` | Implemented (Phase 4B) | Active Trip + optional enabled Memory → scored `destination_set` v1 artifact | Creates artifact | cheap | Deterministic FlightOR scoring over catalog facts | Trip exclusions override Memory; suggestions never become required destinations |

## Flight and fare tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `search_flexible_flights` | Implemented (Phase 3) | Canonical leg + ≤31-day window → `flight_search` v2 artifact + compact sampled-date summary | Creates artifact | paid | `FareProvider` (SerpApi/Mock) | Provider discloses sampled/success/failed dates; partial success is preserved and total failure is explicit |
| `search_connection_flights` | Implemented (Phase 4 production; generation-only) | Trusted canonical leg/window + cloud Trip transfer/location policy → `route_set:connection_edges` artifact | Creates artifact | expensive | PostgreSQL `TopologyRepository` + bounded `ConnectionSearchService` + optional fare enrichment | Preferred-first then general topology; partial coverage remains unknown; cost bounds and deterministic ordering are tested; excluded from the conversation Planner registry |
| `confirm_flight_price` | Implemented (Phase 4B) | Owner-scoped artifact/offer binding → immutable refreshed `flight_search` v1 snapshot | Creates successor artifact | paid | `FareProvider.refreshFlight` | Query, endpoints and offer ID are revalidated; source artifact is never mutated |
| `confirm_route_price` | Implemented (Phase 4B; generation-only) | Owner-scoped route/path ref → refreshed fare-critical legs + successor `route_set` | Creates fare snapshots and successor route artifact | expensive | FlightOR confirmation service + `FareProvider` | Maximum 12 legs and process-wide concurrency 2; weak bindings/partial failures cannot claim a current total; excluded from the conversation Planner registry |

## Route planning tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `plan_trip_route` | Implemented (Phase 4B) | Owner-scoped destination set + active Trip constraints → `route:trip_route_plan` v1 | Creates artifact | cheap | Deterministic FlightOR trip-structure planner | Required/excluded/role/day constraints fail closed; ground transport and activities are never invented |
| `plan_flight_route` | Implemented (Phase 4 production; generation-only) | Trusted candidate-edge artifact + canonical nodes/window + cloud Trip constraints → `route_set:flight_paths` artifact | Creates artifact | cheap | Deterministic bounded `FlightRoutePlanner`; no provider calls | Hard constraints precede scoring; stable path order, cycle prevention, conservative unknowns, truncation/exhaustion are explicit; excluded from the conversation Planner registry |
| `optimize_route` | Implemented (Phase 4 production; generation-only) | Trusted complete-path artifact + controlled bounded weights + cloud Trip preferences → `route_set:optimized_routes` artifact | Creates artifact | cheap | Deterministic Pareto `RouteOptimizer`; no discovery/provider calls | Full score breakdown, penalties, merged badges, trade-offs, algorithm version, and malformed-source rejection are persisted; excluded from the conversation Planner registry |

## Research tools

| Tool | Status | Input / output | Side effects | Cost | Authority / providers | Cache / failure |
| --- | --- | --- | --- | --- | --- | --- |
| `web_research` | Implemented (Phase 4B compatibility vocabulary) | Strict minimal `ResearchBrief` → `research` v2 artifact + compact source-bound findings | Creates artifact | paid | Restricted production `ResearchAgent`; SerpApi research adapter; optional OpenRouter synthesis | Bounded snippets only; provider/model failure degrades conservatively; missing SerpApi key is explicit unavailable |
| `research_destination` | Implemented (Phase 4B; G1 evidence contract) | Trusted destination + active Trip window/interests/questions → `research` v2 artifact + selectable finding IDs, summaries, locations, optional `temporalEvidence` and verification status | Creates artifact | paid | Same restricted Research pipeline | Canonical locations may be reused from the current owner-scoped Trip snapshot; `temporalEvidence` is optional (`from`/`to`/`sourceUrl`/`quote`) but required for date-bound event scheduling; quote must be a retrieved snippet containing 1–2 complete ISO dates; native research currently does not provide it |
| `save_travel_guide` | Implemented (ADR 0012 + B3) | Stable candidate refs or legacy indices + authored days + optional supportingRefs; same-turn draft patches → saved v1 or classified repair | Creates derived route and guide artifacts after validation | cheap | Server restores evidence and Trip budget; shared Goal validator | No provider calls or automatic redistribution; unused research excluded; source/date/version/cancellation checks and bounded feedback; draft patches do not persist across turns |
| `build_travel_guide` | Implemented (Phase 4B; compatibility only) | Owner-scoped trip-route + research refs → `travel_guide` v1 artifact | Creates artifact | cheap | Deterministic FlightOR composition | Excluded from public Planner; retained in complete Core registry; stale/unverified findings are omitted and missing days remain empty |

Both research tools use `executeResearchBrief` to bind the request to one accepted
Trip/workspace snapshot. When `web_research.travelWindow` is omitted, it inherits
the same `researchTravelWindow(snapshot)` as `research_destination`: start from
the departure window, extend its latest departure by `travelDays - 1`, and use an
explicit return-window end when present. A Trip without dates supplies no window.
An explicit research window, including a partial window, is preserved; it is not
widened to manufacture goal coverage. The normal verifier still checks whether
saved evidence covers the accepted Trip. Defaults are applied before the new
research call and Artifact write, never to an existing Artifact. A changed Trip
version rejects the attempt at the workspace boundary.

Conversation research uses the main Planner's questions directly, without an
extra query-planning model call. The domain selects up to eight destination/
question tasks; two rolling workers run searches while preserving result order.
The search adapter adds canonical destination, date-sensitive constraints and
server source policy. The synthesis model receives the original brief and
retrieved sources. All stages share cancellation and the existing deadline.

`ResearchQueryPlanner` remains an optional injected capability for other callers,
including discovery. It returns short terms for the same indexed tasks and
cannot change coverage or supply sources/URLs. An unavailable or invalid plan
falls back to original sanitized queries with an explicit warning. Neither
wording changes nor source synthesis alone guarantee complete factual coverage.

The authored guide's `theme`, `notes`, `timeOfDay` and `planningNote` are optional
additions to the existing v1 payload. The Planner selects them while the server
copies source title/description/category/verification. Empty rest/travel days
require notes and the accepted Goal's optional `allowRestDays=true`; default
daily evidence coverage remains unchanged. See [ADR 0012](adr/0012-agent-authored-itineraries.md).

Cloud guide saves require an activated travel-guide Goal/run. `get_active_goal`
alone does not activate one; revision feedback directs the Planner to resume or
declare the appropriate objective before any write. Duplicate selections report
all affected days and finding IDs without changing the Goal's requirements.
Location selectors share a canonical lookup: safe integer IDs and the same
string IDs select identical trusted records, while unknown/ambiguous IDs fail.

## Runtime-wide execution policy

- Tool arguments and tool results are schema validated.
- Unknown tools fail closed.
- The runtime enforces a maximum tool-step count, a configurable cost ledger,
  per-tool timeout, caller cancellation, generation-current guard, and
  structured traces. The production Planner's function-first configuration
  sets the ledger ceiling above its maximum possible per-turn tool-call cost,
  so cost does not block a valid plan in this milestone.
- Independent read-only calls may run concurrently. State mutations are ordered.
- Agent-facing tools call domain services/providers directly and never recurse
  through the Agent tool registry.
- Tool errors returned to the model are bounded, deterministic, and secret-free.

## Public Planner registry boundary (Phase 5)

`createPlannerToolRegistry()` is the vocabulary exposed by the public
conversation runtime. It includes:

```text
declare_goal
get_active_goal
resume_goal
finish_goal
cancel_goal
start_route_generation
get_trip_artifacts
read_artifact
get_trip_context
update_trip_context
resolve_location
search_flights
search_flexible_flights
confirm_flight_price
search_destinations
recommend_destinations
plan_trip_route
research_destination
web_research
save_travel_guide
get_user_memory
update_user_memory
```

It deliberately excludes `search_connection_flights`, `plan_flight_route`,
`optimize_route`, and `confirm_route_price`. Those tools remain implemented in
the complete Core Tool registry for deterministic engine composition and tests,
but the model cannot call them directly. `start_route_generation` only queues
that deterministic composition after explicit conversational authorization.

The explicit action is an authenticated, owner-scoped run resource:

```text
POST   /v1/trips/:tripId/route-generation-runs
GET    /v1/route-generation-runs/:runId
DELETE /v1/route-generation-runs/:runId
```

HTTP creation represents the Generate Route button, requires `Idempotency-Key`, and accepts only the strict body
`{ conversationId?, expectedTripVersion? }`. The server snapshots the owned
Trip Context, validates an optional same-Trip Conversation, stores a canonical
request binding, creates an authorized durable Goal/run, and enqueues only the
opaque route-run ID. The Agent tool uses the same service with a server-derived
idempotency key and records `explicit_user_message`. Replaying the same key
returns the existing run; changing the request under an existing key is a
conflict. Reads and cancellation are owner-scoped. Cancellation is cooperative
and persistent, and terminal runs are immutable.

Run status is `queued → running → succeeded|failed|cancelled`, with bounded
progress, warnings, sanitized errors, and compact result Artifact references.
The worker uses the frozen context version and compares it with the live Trip.
A Trip edit encountered while queued/running fails the current attempt with
`TRIP_CONTEXT_VERSION_CONFLICT`; it cannot continue writing under the old
snapshot or relabel those results. Start a fresh run for revised conditions.
Results completed before a later edit remain auditable and may be shown as stale
with their original version. Generated Artifacts carry Goal ID, Goal run ID,
Trip Context version and source lineage. The shared completion service verifies
the accepted constraints and atomically commits the planning Goal/Goal-run
verdict, which may be `partial` even when route execution `succeeded`.

After a conversational start, the client reads the authenticated Trip workspace
and attaches the accepted run to the existing polling/cancellation flow. It does
not issue another creation request. Workspace responses refresh unfinished
message delivery verdicts through the same server verifiers.

The Phase 5 generation slice accepts exactly one final visit destination with a
canonical airport, an origin airport, and a bounded departure window. Return
windows, multiple visit destinations, round-trip composition, and required
ground legs are explicit unsupported-input errors; they are never silently
truncated or represented as a complete route. Missing provider credentials or
partial fare coverage produce explicit unavailable/warning states and never
invent fare facts. `destinationIntent.preferred` remains a soft exploration and
ranking input; it cannot by itself authorize final route generation. Run
acceptance locks the Trip aggregate against concurrent context edits, persistent
cancellation is checked at provider boundaries, and worker heartbeat/recovery
keeps interrupted jobs retryable without exhausting attempts before the run is
stale enough to reclaim.

## Phase 7–9 consumers

Planner now exposes `get_trip_artifacts` (at most 20 current-trip references) and `read_artifact` (bounded, explicitly truncated JSON excerpts) to answer about persisted routes, research and guides across turns. Reads remain user- and trip-scoped. Saved prices are not fresh confirmation. Destination summaries include the exact canonical location for safe tool handoff; Research still requires a location present in the authoritative current-turn ledger. Neither read tool triggers final route generation.

`research_destination.destination` accepts the exact resolved location ID string; the server retrieves the complete canonical object from its per-turn ledger. The ledger is also seeded from the current owner-scoped Trip snapshot, so a location already saved there (for example, Tokyo id `8`) can be reused on a later turn without another provider lookup. Full-object callers remain compatible, but their descriptive fields never override a ledger record. Unknown IDs fail with a recoverable resolution prerequisite. This avoids making model-copied coordinates part of the authority check while preserving the current Trip owner/version boundary.

Research v2 may include optional `temporalEvidence` with only `from`, `to`,
`sourceUrl` and `quote`. `quote` must come from a retrieved search snippet and
contain one or two complete ISO dates; `queryWindow` and `expiry` are not event
occurrence evidence. The save path and durable Goal verifier share this check:
missing or mismatched evidence rejects date-bound event scheduling, and
`allowPartial` does not bypass it. Old Artifacts remain readable without being
re-verified. The current native research adapter does not produce this evidence,
so it cannot alone support event scheduling against Trip dates. The required
semantics of legacy Goal `researchTypes` remain unchanged; new explicit coverage
uses `requiredEvidenceTypes` under [ADR 0021](adr/0021-guide-required-evidence.md).
Date evidence remains governed by [ADR 0020](adr/0020-canonical-trip-locations-and-temporal-evidence.md).

Native research HTTP 429 returns `PROVIDER_RATE_LIMITED` and the safe warning
`research_provider_rate_limited`. The two research tools share the current
turn's provider cooldown: honor `Retry-After`, defaulting to 30 seconds. Calls
during cooldown fail before another request or USD reservation. The original
failure receipt and any unknown charge remain in the audit. This is an
instance-level guard, not a cross-request rate limiter. The Planner can reuse
compatible evidence or explain the interruption; changing research questions
does not remove a provider limit. Workspace messages retain safe stop reasons
and warning codes for the same failure display after restoring a conversation.
Route, research, guide and destination Artifacts now have client renderers. Cloud workspace restoration retains Artifact references and generation runs. Discovery runs constrained research through a dedicated Worker job and requires human publication; it adds no autonomous publish tool to the Planner registry. See [ADR 0008](./adr/0008-route-discovery-and-cloud-workspaces.md).


## 2026-09-21：攻略引用资料适用性

新攻略每条日程及 supportingEvidence 由服务端写入 `sourceApplicability`，仅支持 `reference_only` 和固定说明。来源核验/检索时间不证明价格、开放时间、交通时长的当前或出行日适用性。新 v3 builder 的保存及完成共用检查，Planner 不能自行提升；旧记录仍可读，客户端保守展示。语义、兼容/回滚和未实现的正文时效复核见 [ADR 0022](adr/0022-guide-source-applicability.md)。这不是 G1 内容或平台已验收。


2026-09-21：SerpApi 主研究路径增加有界正文读取及 `claimEvidence` 原文绑定，读到正文不升级为当前/未来事实已核实。攻略共享 validator 拒绝声明出处错误和同对象冲突；保持 reference_only。接入、限制与兼容见 [ADR 0023](adr/0023-source-pages-and-quoted-claims.md)。
# 2026-09-22 终稿接点补充

Planner工具权限、参数和Goal/Run语义保持不变。CloudPlanner本轮成功保存的攻略先带隐藏草稿标记；runtime返回后复用同模型/client生成`publication.finalization.variants[locale]`，最多初始+一次结构/语言修复，不向编辑调用开放工具。材料/计划缺口按activityId持久保留，不自动重规划。普通聊天、read_artifact及刷新不启动完整终稿。

Agent请求增加`locale: zh|en`（兼容缺省zh）；Artifact/Workspace/history GET按locale读持久结果；`POST /v1/artifacts/:id/localization {locale,retryRevision?}`只翻译已接纳终稿，缺失底稿保持原状态，不触发研究。技术失败仅显式携带当前revision（1或2）时有界重试；accepted复用，材料问题需修订，历史观测保留。公开failureKind/revision/canRetry供后续UI使用。精确字段、调用边界和失败回退见[ADR 0025](adr/0025-bounded-guide-finalization.md)。

## 2026-09-22 正式终稿页面读取与动作

`tripContextSummary.notes` 只读返回当前 Trip 已有的有界 notes（最多50条、每条500字符），供 Workspace/Agent 恢复明确的机票自备说明；不从未选择航班推断。没有增加 Planner 工具。正式详情加载/刷新/切换语言只读 GET；缺失语言由准备按钮调用既有 localization，技术重试同时检查 canLocalize、canRetry 和最新 revision，传输 retry=0。字段和测试见 [正式页面报告](design/budget-travel-agent/PUBLICATION_UI_2026-09-22.md)。


## 2026-09-22 发布后的地点 API（不是 Planner 工具）

GET `/v1/map-config` 公开 OSM 瓦片模板和是否配置，不含 secret。认证 GET `/v1/artifacts/:id/places` 只读当前 owner/Trip/航班/hash 的独立 enrichment；显式 POST 同路径严格接收 `{contentVersion}`，需要 accepted 底稿，最多12条线索/25秒、单查询8秒、数据库全局限流1100ms，网络不在事务内。GET、刷新、locale 切换不调用 POI；请求不提供搜索/规划/保存业务权限。实体/缓存/取消/冲突合同见 [ADR 0026](adr/0026-place-identity-and-maps.md)，不是新增 Agent 或 Goal。
# 2026-09-22 发布后媒体端点

认证 GET/POST `/v1/artifacts/:id/media` 不属于 Planner 工具表；GET仅返回当前accepted guideContentHash对应的已存活动媒体，POST `{contentVersion}` 才执行显式、有界Wikimedia补全。owner/Trip/航班/内容/活动保护复用地点快照，独立媒体事务不会改正文或地点。没有新增模型/搜索工具调用，详见[ADR0027](adr/0027-place-media.md)。
# DSH 受控执行面（2026-09-24，实验分支）

Agent API 依赖 `PlannerServicePort`，仅服务端 `FLIGHTOR_AGENT_ENGINE` 选择引擎，默认仍为 `legacy`，客户端不能选择。DSH 使用官方 worker/AgentLoop；父进程执行所有业务工具并沿用 owner、Trip version、Goal/Run、Artifact 和 publication 校验，不调用 `CloudPlannerService.runTurn` 或 `AgentRuntime.run`。

DSH 模型可见的受控业务工具包括 `get_trip_context`、`get_trip_artifacts`、`read_artifact`、`resolve_location`、`get_user_memory`、`get_active_goal`、`update_trip_context`、`search_flights`、`search_flexible_flights`、`confirm_flight_price`、`update_user_memory`、`start_route_generation`，以及单一组合工具 `commit_travel_guide`。最终路线引擎仍只可由明确请求触发的 `start_route_generation` 排队；底层连接搜索、完整航线规划和 Pareto 优化不开放给会话模型。`commit_travel_guide` 需要 `travel_guide` intent，将当前版本 candidate/evidence、日程和 locale 文本一次提交；服务端复用保存校验、发布合同及 Goal verifier。失败结果不会被当作已接纳发布。首次提交不调用独立 ResearchAgent/synthesis 或 Finalizer；显式缺失语言的本地化仍走已有 bounded finalizer。

公开表达中的预算保证不是仅检查金额或“保证”字样。共享`publicProseProblems`也拒绝“整体预算仍在既定总额内”“费用控制在预算范围内”“开销不会超出预算上限”“符合/满足预算要求”及英文`within the allocated total`等有限等价表达；reply、overview、每日theme与活动name/introduction/recommendationReason统一检查。明确预算仅为目标、实际费用待核实的谨慎说明可保留。它仍是纯程序表达围栏，不能证明预算可满足；既有accepted内容不因升级而原地重写，修正文案须经真实新回合提交新版本并重新发布验收。

组合配置提供选定 provider 后公开 `web_search` 和 `web_fetch`；当前 provider 由 `DSH_SEARCH_PROVIDER` 选定，默认 `serpapi-raw`，也可明确指定 `deepseek-official`。凭证缺失时调用失败，不静默切换。Web 插件内部的 `__web_search`、`__web_fetch`、`__record_web` 不向模型暴露，只能经白名单桥接；来源会写入当前 turn 的 owner/Trip/Conversation/version scope evidence store，再转换为既有 ResearchArtifact/Guide 引用。官方搜索使用独立 `DEEPSEEK_SEARCH_API_KEY` 与 Messages API 路由，不能借用或传递 OpenRouter 凭证。模型和搜索请求需先通过持久 DSH 预算 admission；达到金额/次数限制或预算未配置时请求被拒绝，不绕过预算继续执行。

`commit_travel_guide` 的原始evidenceRefs仅限当前generation与最新Trip版本，跨轮复用走持久ResearchArtifact的candidateRef。不可用来源返回`DSH_GUIDE_NEEDS_REVISION`及`candidate_evidence_unavailable`候选/引用详情，供同一主Agent在既定一次修复限额内修正；服务端不自动删除来源或扩大读取scope。DSH只把上轮未完成Goal及库存缺口视为历史数据，当前较窄请求需匹配的新intent，不能静默降低旧Goal参数。仅DSH模型可见的commit JSON Schema增加`anyOf`要求每次完整提交携带`intent`或`goalRef`；新turn提交新intent或合法可恢复goalRef，修复重复相同已接纳intent/引用同Goal。共享runtime仍兼容已绑定Goal的省略参数调用，legacy工具schema和公开API不变；重复相同intent不新建Goal，改约束仍被拒绝。DSH实例描述移除共享wrapper的“后续不必重复”提示，snapshot最后的turnState明确本轮acceptedGoal为空、旧raw refs无效，仅用当前snapshot/read_artifact候选或本轮联网证据；不自动代写intent/引用，不调整循环限额。详见[组合发布边界](design/budget-travel-agent/DSH_PUBLICATION_2026-09-24.md)。

DSH `web_search` 的实际模型schema通过官方prompt assembly钩子限制单query，公开pre-execute钩子在预算准入前拒绝空/多query等不可执行参数，历史预留不改。DSH `web_fetch`对明确短Incapsula/Cloudflare/captcha挑战壳返回`SOURCE_CHALLENGE_REJECTED`，不产出可用来源，不绕过站点保护；通用reader仅此DSH调用启用检测，legacy默认关闭。具体识别条件和离线验证见[来源适配边界](design/budget-travel-agent/DSH_EVIDENCE_2026-09-24.md)。

Shell、文件、Git、PTC、subagent、插件安装和用户全局 profile 不在 worker 插件或工具面中。Session JSONL 是内部会话存储，不是模型可调用的文件能力。GET/publicationContext 不启动 worker；取消确认会等待父进程实际业务工具 Promise drain。

实际 DSH 核心、worker 白名单及分阶段测试见 [实施记录](design/budget-travel-agent/DSH_IMPLEMENTATION_REPORT_2026-09-24.md)；后续写入/联网以该记录实际阶段为准，不将原附件的目标列表当已验证功能。


2026-09-26 DSH durable Goal identity：DSH工具上下文的requestId独立于可能重复的Fastify HTTP request.id，固定为owner/Trip/conversation/服务端generation的SHA-256标识；同scope/generation重放稳定，新generation隔离。HTTP ID保留审计metadata，旧legacy和Goal参数指纹/owner/version检查不变。原因及真实DB证据见[DSH发布说明](design/budget-travel-agent/DSH_PUBLICATION_2026-09-24.md)。


2026-09-26 DSH预算历史回复：正式workspace/messages只读投影区分成功trip_context_update回复与guide交付；前者即使附带预算衔接攻略，也在当前语言/权威预算的纯程序检查通过后保留其自身确认正文，后者仍取accepted publication.reply。错误语言、内部信息或无依据金额/保证不能绕过检查；legacy规则不放开。验收见[DSH发布说明](design/budget-travel-agent/DSH_PUBLICATION_2026-09-24.md)。
