# ADR 0011 — Verified delivery and workspace consistency

Status: accepted for implementation, 2026-09-08.

## Problem

The Agent already selects and composes domain tools autonomously, but a text
response could end a turn without verifying an active durable goal. The default
verifiers checked artifact existence and evidence status without checking the
accepted dates or itinerary coverage. A current run could also consume an old
route and label its output with the new Trip version. Separately, conversational
route creation did not attach the resulting background run to the client, and
authentication failures could discard the first message.

Inspecting a saved unfinished Goal also activated it and could restore an old
run. After a user revised the requested content, reading the old parameters
therefore bound that unrelated objective to the new turn's delivery.

## Decision

Keep the Agent as the sole orchestration layer. No fixed discovery, search,
research or guide sequence is introduced.

- Separate transport/turn termination from business delivery. Every Planner
  response carries a server-derived delivery status. A conversational answer
  without an accepted durable goal makes no verified-delivery claim.
- Separate Goal queries from acceptance. `get_active_goal` is read-only and
  returns saved parameters and existing runs without activating or creating a
  run. The Agent explicitly chooses `resume_goal` when those parameters match
  the current request, or `declare_goal` for changed intent. No keyword rule
  or automatic restoration chooses a previous Goal on the user's behalf.
- Verify the goals touched by the current turn at response finalization even
  when the model omits `finish_goal`. Explicit `finish_goal` and finalization
  share one completion service. Incomplete results remain incomplete; the
  server does not release a model's premature success claim as a successful
  delivery. The Agent may use verifier feedback to re-plan through its normal
  tool loop, without keyword repair or prescribed tool sequences.
- Domain verifiers validate artifact schemas, accepted Trip constraints, typed
  goal parameters, source lineage and coverage. Evidence verification and
  delivery completeness remain separate. Every requested day needs eligible
  content. Partially verified evidence is accepted only when the typed Goal
  explicitly permits it; this never waives day or destination coverage.
- Goal and Goal-run terminal statuses commit atomically with optimistic
  revisions and a locked current Trip version. A route worker's terminal job
  result is replayable: retries reconcile its Goal from persisted artifacts
  without repeating provider calls.
- The shared artifact workspace freezes a server-read Trip version, checks it
  after external calls and before writes, and validates source versions before
  composition. Cross-version reuse requires an explicit compatibility policy;
  absent such a policy, return a stable conflict instead of relabeling old
  evidence. Owner isolation and cancellation remain enforced.
- The client reconciles the authenticated workspace after conversation results
  and attaches any background route run to the existing polling/cancellation
  implementation. It never infers task state from conversation text.
- Credentials and refresh concurrency belong to one client session boundary.
  Authentication, session switches and failures must not lose a draft or let a
  late request restore an obsolete owner/session.

## Acceptance

- A pending declared goal cannot be reported as a completed delivery by ending
  with text or by omitting `finish_goal`.
- Querying an old Goal neither creates a run nor makes it part of this turn's
  delivery. Inspecting an old objective and declaring revised parameters
  verifies only the newly accepted objective. Explicit resume activates a
  current-context run while preserving historical runs.
- Wrong-date searches, missing itinerary days, mismatched destinations and
  stale source artifacts cannot satisfy the corresponding goal.
- A five-day old route cannot be relabeled as the current ten-day plan.
- Trip changes during a provider call and cancellation prevent stale writes.
- Both button and conversational route starts show progress and final results
  through the same client run handling.
- First-use login, login cancellation, bootstrap failure, token refresh,
  logout and session-switch races preserve input and owner isolation.
- Automated checks, local provider E2E and WeChat device acceptance are recorded
  separately; configured credentials are not provider availability evidence.

## Limits

The verifier checks typed dates, destinations, research categories, coverage
and persisted evidence. It does not prove that every arbitrary natural-language
question was semantically answered. Historical completed deliveries remain
historical snapshots; current artifact composition still requires compatible
Trip versions. Legacy artifacts without version lineage remain readable but
cannot be used as current verified completion evidence.
