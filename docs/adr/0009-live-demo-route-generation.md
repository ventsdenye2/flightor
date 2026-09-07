# ADR 0009: Live fare-backed generation and local demo operation

- Status: Accepted for implementation
- Date: 2026-09-07
- Authority: FLIGHTOR_ARCHITECTURE.md; tonight's complete WeChat demo request

Live acceptance found that the generation composition can only enumerate a
pre-existing topology snapshot. A fresh installation therefore fails even when
the shared fare search returns real flights. Its segment enrichment also cannot
produce a defensible total without immutable fare Artifact references.

Add an owner-scoped live connection source to the production generation path.
It uses the existing flight-search domain to store exact-date fare Artifacts,
converts supported provider offers to route edges, and retains those Artifact
and offer IDs. Topology remains an additional source, not a required provider.
Never allocate a through fare across invented segment prices or infer protected
connections. Unsupported quoted connections remain explicitly excluded. Bound
date sampling and provider calls, preserve cancellation, and disclose coverage.

Generation stays an explicit user action. Conversation can create research,
trip outlines and guides, then suggest that action; this does not introduce an
autonomous route-generation tool or weaken user ownership.

For local development only, permit explicitly disabling Redis when its runtime
is unavailable. The real PostgreSQL queue and repositories remain authoritative;
rate limiting uses Fastify's local store and optional caches are disabled. Health
reports this state explicitly. Production still requires Redis. Do not substitute
mock data or an in-memory database to declare the demo successful.

Verify using the actual API, persistent Worker, live providers and a compiled
WeChat client where the available login/runtime permits. Record evidence and
remaining blockers continuously in DEMO_STATUS.md and commit milestones.

Live research follow-up: sample at most two distinct questions per destination,
within the existing eight-search cap, with two read-only searches in parallel.
Cover destinations before adding the second question and disclose truncation.
Keep exact travel dates in the synthesis brief; evergreen activity retrieval
must not require a page to contain those dates. Source verification remains
snippet-only and at most partial. GO TOKYO's exact domain is recognized from
the Tokyo Metropolitan Government's own portal announcement, not from a model
claim or a page title. Distribute eligible findings across the city's days;
do not fabricate activities to fill missing evidence.

Tokyo's canonical city/airport aliases use the existing curated GO TOKYO and
Japan National Tourism Organization source domains for activity research. This
server-owned query policy is disclosed on the research artifact and cannot be
set through user/model search operators. Other destinations retain open search.
Reference authority: https://www.english.metro.tokyo.lg.jp/w/029-101-004128 and
https://www.japan.travel/ . Source snippets still imply at most partial verification.

Research synthesis requests a strict JSON Schema through OpenRouter, with
provider parameter support required. Server validation still checks every
category, destination and source index and rejects truncated completions.
Unprocessed snippet fallback is always unverified and cannot populate a guide,
even on an official domain: relevance and travel dates have not been checked.
Guide matching canonicalizes registry city keys TYO/OSA to catalog NRT/KIX;
known airport aliases share that key. No name-based location guessing is used.
Protocol reference: https://openrouter.ai/docs/guides/features/structured-outputs .
