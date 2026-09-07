# ADR 0008: Route detail, reviewed discovery, and cloud workspaces

- Status: Accepted for implementation
- Date: 2026-09-07
- Authority: `docs/FLIGHTOR_ARCHITECTURE.md`

## Problem and decision

The Phase 6 UI can load Artifacts, but route links still enter a legacy detail
page, Trips only shows the locally restored session, and Profile still treats
local preferences as authoritative. Discovery and its human review surface are
not implemented. Complete these remaining v1 slices without changing the
accepted single-destination route-generation boundary.

1. Route detail reads an owner-scoped immutable `route_set` Artifact, validates
   each path, and selects a representative by its stable path ID. The map,
   timeline, flight costs, warnings, and reasons derive from that same path.
   Research and guide details display only saved findings; they do not invent
   enrichment, coordinates, gates, terminals, or protected connections.
2. Trips lists server-owned records and resumes their server conversations.
   Saved route selections reference an Artifact and path within the same Trip.
   Archive and selection mutations are owner-scoped and version checked.
3. Profile edits the existing versioned cloud Markdown Memory, including its
   enabled setting and deletion. Legacy local preferences can be imported only
   through an explicit user action. Logout/session changes invalidate responses.
4. Discovery uses persistent candidates, runs, and immutable template versions.
   Bounded research and AI drafting may create review candidates, never published
   content. Publication is an explicit authenticated human reviewer action.
   Expired/unverified content cannot enter the public feed. Consumer and admin
   authentication remain separate; admin roles authorize each operation.
5. Explore displays only published, current templates and creates a Trip seed
   from canonical destinations and soft interests. Prices/flights are always
   recalculated by the existing search/generation services.
6. `apps/admin` is a small React SPA for queue, editor/preview, published content,
   and discovery monitoring. Secrets remain in the backend; admin sessions are
   never accepted as consumer identity.

## Development and validation

Use one primary coding Agent and complete vertical slices. Independent reads
and checks may run concurrently; delegation is opt-in. Preserve the existing
worktree. Run targeted behavioral tests during implementation and full root/
backend tests, typechecks, builds, and whitespace checks at the delivery gate.
Exercise rendered UI where the local environment supports it. Missing live
credentials or device acceptance must be reported separately from automated
acceptance. This decision does not authorize publishing production content.
