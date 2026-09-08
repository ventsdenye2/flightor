# ADR 0010 — Agent-owned planning and domain-verified completion

Status: accepted and implemented, revised 2026-09-08.

## Problem

Live runs exposed a structural dependency on brittle model behavior: the model
copied canonical location objects, rediscovered prerequisites in each turn,
passed intermediate Artifact IDs between several calls, and could claim that a
requested write was complete without a valid saved result. Ordinary omissions
consumed paid-tool budgets; guide requests could stop at a promise or time out
after research without saving a guide.

Hard-coding destination discovery, day planning, research and guide creation as
one application workflow would avoid those particular omissions, but would
replace an Agentic system with a fixed pipeline. The Planner must remain able to
choose, skip, repeat and reorder tools according to the user's actual request,
inspect results, and re-plan after partial results or failures.

More prompt instructions, city-specific search restrictions, keyword-based
runtime completion guards and fixed end-to-end workflows are all rejected as
long-term solutions.

## Decision

### The Planner Agent owns orchestration

The Planner remains the autonomous planning/execution loop. It selects from
composable domain tools and may adapt its plan after every structured result.
No application workflow prescribes a universal sequence such as:

```text
destination discovery → day plan → research → guide
```

Domain tools may encapsulate one cohesive business capability, but they do not
invoke other Agent tools or a nested Agent runtime. Shared domain services back
both Agent tools and non-conversational product actions.

The dependency direction is:

```text
Planner Agent → Agent Tool → Domain Service → Repository / Provider
```

The domain layer never imports the Agent runtime, HTTP routes or model messages.

### Goals and completion are explicit and server-verified

For a user request that requires a durable business result, the Agent declares
a typed, bounded goal. Goal parameters express user intent and choices; they do
not contain model-authored airport facts, prices, sources, ownership fields or
intermediate Artifact authority.

The Agent can then call any suitable tools in any valid order. When it believes
the goal is complete it calls the generic completion operation. A goal-specific
server verifier reads the current owner-scoped Trip and persisted Artifacts and
returns one of:

```text
pending | satisfied | partial | failed
```

The verifier checks Artifact type/schema, provenance and lineage, current-run
membership, Trip Context version, evidence eligibility and cancellation. The
Agent may continue planning after `pending` or a recoverable failure. A model
promise, tool name, prompt phrase or number of calls is never proof of business
completion. Evidence verification status remains distinct from goal completion
status.

Ordinary conversation that does not require a durable result does not need a
goal and can still finish with a normal text response.

Goals are durable resources rather than turn-local flags. They persist the
accepted Trip Context version, authorization source, current status and result
references so a later turn or process can resume the same objective after a
timeout or recoverable provider failure. Replaying the same idempotency key and
request returns the existing goal; reusing a key for different parameters is a
conflict.

### Runtime working set reduces bookkeeping without removing choice

The runtime maintains an owner/trip/run-scoped working set of Artifacts and
canonical location resolutions produced during the turn. Tools may accept an
explicit compatible Artifact reference when the Agent needs to choose among
alternatives, or use a well-defined latest-compatible reference from that
working set. In either case the server resolves and validates the reference;
the model never establishes ownership, lineage or canonical facts by copying
JSON.

Every Artifact-producing domain service uses the same workspace boundary for:

- owner and Trip scope;
- current run/generation;
- cancellation;
- frozen Trip Context version where the goal requires it;
- Artifact lineage and schema validation; and
- writes performed only after a fresh checkpoint.

### Location and fare facts remain server-owned

Use one shared Location Identity policy for airport identity, city grouping and
aliases. Fare tools accept small selectors such as an IATA string or a trusted
resolution handle. The shared fare boundary resolves and validates both
airports through the aviation capability before calling a fare provider.
Model-provided names, coordinates, country codes or time zones never override
authoritative airport facts. Unknown airports stop before a paid fare call.

### Research policy is general

Research keeps bounded provider calls, strict structured synthesis, source
index validation, provenance and evidence eligibility. Remove Tokyo-only query
filters and other demo-city branches. Source preferences are expressed through
a general, injectable policy rather than provider code or prompt wording.

### Current product authorization policy

During the current implementation milestone, functionality takes priority over
provider-cost optimization. The Agent may autonomously call configured fare and
research capabilities when they are relevant to the accepted user goal. Normal
schema, timeout, cancellation, rate-limit and duplicate-call protections remain
in place, but a cost budget must not prematurely prevent a valid plan.

Partial Artifacts are saved with explicit partial status and provenance. The
Agent may inspect them and continue with a different or narrower plan. Partial
evidence is never presented as complete solely because the turn or provider
deadline was reached.

Final route generation remains an explicitly authorized action. Authorization
may come from the product's Generate Route control or from an unambiguous user
request in conversation. Discussion, recommendation, readiness or an Agent
inference is not authorization. The durable route-generation goal records
whether authorization came from `button` or `explicit_user_message`.

## Consequences

- Primitive planning/research/guide tools remain available to the Planner as
  composable capabilities.
- The runtime gains a general goal registry, working set and completion
  protocol instead of a guide-specific repair branch.
- Goals persist across turns and process restarts so the Agent can resume and
  re-plan instead of rebuilding intent from conversation prose.
- `requiredSuccessfulTool`, Chinese keyword completion regexes and completion
  repair prompts are removed once the generic protocol is connected.
- Tools can expose defaults from the current working set, but retain explicit
  selection when the Agent needs to compare or branch.
- Partial results remain auditable Artifacts and are reported as partial rather
  than silently promoted to complete.
- Explicit route generation remains a separate authenticated domain action.
  The button and the Planner's zero-argument start tool share that service, but
  only a persisted `button` or `explicit_user_message` authorization may queue
  it; the Planner never receives the internal route-engine tools.

## Acceptance

- The Agent can use valid tools in different orders, skip irrelevant tools,
  retry with changed inputs and recover from a failed tool without violating
  domain invariants.
- Configured fare and research tools remain autonomously available to the Agent
  in this milestone; cost optimization is not used as a completion gate.
- A prematurely narrated success cannot satisfy a declared durable goal.
- Completion is verified from owner-scoped, current-version persisted state and
  returns `pending`, `satisfied`, `partial` or `failed` with stable reason codes.
- Cross-owner Artifacts, changed Trip versions and cancelled work cannot satisfy
  a goal; stale or unverified findings cannot become guide items.
- Location identity, Artifact persistence, version checkpoints and evidence
  eligibility each have one authoritative implementation.
- Unknown airport codes stop before fare search; model-provided descriptive
  fields cannot replace authoritative airport data.
- General mechanisms contain no Tokyo, NRT, Chinese-guide keyword or single-demo
  special case. Policies are expressed through shared interfaces and data.
- Route generation can start only from a persisted explicit authorization from
  the Generate Route action or an unambiguous user instruction.
- Tests cover alternative valid tool orders, re-planning after failure,
  premature finish, partial completion, version conflict, cancellation,
  cross-owner access, canonical city identity and unknown-airport rejection.
- Documentation and implementation are updated in the same change; static
  checks, tests and live provider/device verification remain explicitly
  distinguished.
