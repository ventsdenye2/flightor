# Codex continuation guide

Read `FLIGHTOR_ARCHITECTURE.md`, accepted ADRs, `TOOLS.md`, and `PROJECT_CONTEXT.md` before architecture changes. Phase 0/1 kickoff is historical; continue from the current implementation and acceptance status in `PHASE789_ACCEPTANCE.md`.

Use the model and effort chosen by the user (currently Astra Medium). Work with one primary agent by default. Delegate only when the user or applicable instructions explicitly request it. Parallel independent tool reads and checks are welcome. Preserve unrelated worktree changes and do not commit or publish without authorization.

Complete scoped vertical slices, validate failure and ownership boundaries, and report runtime limitations separately from automated checks. Update authoritative docs when behavior changes. Provider failures must remain explicit; never substitute fabricated fares, routes or published content. Keep cloud Memory, Trip Context, Conversation and immutable Artifacts separate.
