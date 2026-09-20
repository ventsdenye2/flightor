# Repository instructions

Read `docs/README.md`, `docs/PROJECT_CONTEXT.md` and `docs/DOCS_MAINTENANCE.md` before changes. Current planning work is tracked by `docs/design/budget-travel-agent/DPS.md` and its `progress.md`.

Every modification must include a corresponding update under `docs/` in the same change batch. Update the document that owns the behavior, contract or verification result; do not leave stale claims and merely add a generic progress note. Follow the validation and history rules in `docs/DOCS_MAINTENANCE.md`.

Proposed designs and historical handoffs are not implemented behavior or fresh authorization. Preserve unrelated changes. Use the user's current model settings; default to one agent unless delegation is explicitly requested. Multiple user test cases do not imply multiple agents.
