# Source claim and enrichment tests

Status: implemented and locally verified on 2026-09-21. The focused run passed 2 test files and 10 tests in 1.56s. This entry records deterministic unit-test coverage for the source-page and claim-evidence contracts; it is not evidence of live provider reachability or current source applicability.

`backend/src/research-agent/claim-evidence.test.ts` covers SHA-256 page hashes, quote and value containment, selected source indexes, source URL binding, timestamp/hash mismatches, snippet-only rejection, absence of inferred future validity, and conflict detection for equal subject/kind values while keeping differently named products separate.

`backend/src/research-agent/source-enrichment.test.ts` covers the injected reader's four-source/two-worker bound, synthesis ordering, cancellation, failed-read warnings with unknown sources retained, removal of provider-supplied page snapshots, trust in injected page snapshots, claim retention after artifact serialization, and conflict warnings. All fixtures are in-memory; no network or paid provider is used.

Validation command:

```powershell
cd backend
npx vitest run --config vitest.config.ts src/research-agent/claim-evidence.test.ts src/research-agent/source-enrichment.test.ts
```

The command passed after the source-reader integration present in this worktree. Passing these tests verifies the local contracts only; it does not verify public DNS/TLS, provider responses, or claim freshness beyond the captured page timestamp/hash.
