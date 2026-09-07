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
