# Native Research backend notes — 2026-09-13

> Follow-up: native HTTP failure receipts are now persisted with bounded,
> redacted bodies and allowlisted headers; 25 focused unit tests and 5 native
> PostgreSQL tests passed. The full backend suite and date-correction acceptance
> are recorded in [the continuation handoff](HANDOFF_2026-09-13_CONTINUATION.md).
> Earlier gaps below are retained as historical evidence.

This note covers only the backend production integration. The default remains the existing SerpAPI research path; native research is selected only when `NATIVE_RESEARCH_PROVIDER=openrouter_native` is explicitly configured.

## Implemented boundary

- The cloud Planner ResearchAgent slot can use a thin OpenRouter native-research provider for Qwen or GLM. It receives a bounded `ResearchBrief` and preference summary only; it never receives the complete Conversation.
- The request has a dynamic, strict JSON schema for `disposition`, `uncertainties`, and findings (`category`, destination index, title, summary, and annotation-bound source URLs). Existing artifact v2 readers remain compatible because the added typed fields are optional.
- Each model invocation has a unique generation id, including repeated research for one request. The agent makes one bounded model request and does not repair or retry it. Missing search-use accounting fails closed.
- Migration 012 supplies a shared USD-micro budget and per-generation audit. Reserve and settle are atomic; a database budget must already exist. Unknown cost, timeout, and failed-to-account usage retain their reservation. Runtime `costUnits` is not used as a cash budget.
- The final research artifact is attached to its audit in the artifact write transaction. Owner, trip, conversation, Goal/run, and trip-context checks prevent an obsolete or cancelled generation from being marked delivered.
- Provider cost conversion rounds finite, non-negative fractional USD cost up to USD micros. A result above the reservation persists the raw receipt and failure, conservatively exhausts the budget, and prevents another paid call.

The native configuration fields are `NATIVE_RESEARCH_PROVIDER`, `NATIVE_RESEARCH_MODEL`, `NATIVE_RESEARCH_BUDGET_ID`, `NATIVE_RESEARCH_MAX_CALL_USD_MICROS`, and `NATIVE_RESEARCH_TIMEOUT_MS`. Native execution is fail-closed with the default zero per-call cap or an absent budget id.

## Evidence

Passed without Provider API calls:

```powershell
npm run check
npx vitest run src/research-agent/native.test.ts src/providers/openrouter/client.test.ts --pool=forks --maxWorkers=1
node --env-file=.env.demo node_modules\vitest\vitest.mjs run src/research-agent/native-postgres.integration.test.ts --pool=forks --maxWorkers=1
```

- TypeScript check passed.
- The focused native/provider unit command passed **15/15**.
- The isolated PostgreSQL command passed **4/4**. It created and dropped its own schema in the dedicated integration PostgreSQL instance; migration 012 was separately applied there.
- After the framing fix, `npx vitest run src/research-agent/native.test.ts --pool=forks --maxWorkers=1` passed **7/7**, and `npm run check` passed. This framing change has offline evidence only.

Full backend Vitest remains **unavailable**, not a passing or zero-failure result. One-worker `forks` waited about six minutes and one-worker `threads` about two minutes; both printed only `RUN` before cancellation, without collected test output. The record is in `backend/.demo/integration-backend-tests.log`. No backend process or PostgreSQL service was changed during those attempts.

## Limited live result and audit gap

An earlier Qwen native call reached OpenRouter and returned HTTP 429. Its metadata had no provider name, id, or usage, and no guide was generated. The shared external meter retained that reservation and prevented an additional call at that time.

The final authorized Qwen call subsequently completed: its research, route, and guide artifacts were produced; the current Goal/run and delivery are `satisfied`; the guide retains `evidence_partially_verified`; and its native audit is succeeded with `delivered_at` recorded. This is successful local Provider evidence with the stated verification warning. No further paid call was made to validate the framing change below.

The native audit currently stores the normalized error for a transport-level HTTP failure, but the thin transport does not return the raw HTTP response payload as a `NativeResearchReceipt`; the external meter retained that raw body. Before another paid attempt, preserve a safely capped raw status/body/headers receipt through the transport and ledger so the audit can independently explain a 4xx/5xx outcome.

The production adapter now accepts only two unambiguous response wrappers before the existing strict candidate validation: a single final JSON code fence, or prose followed by one JSON-object suffix. It records `normalization.framing` in the audit. It rejects multiple objects, an earlier JSON delimiter, trailing text, multiple fences, and unknown business fields; it does not repair or retry the model response. Empty `tool_calls: []` now means no pending tool work.

## Full-suite collection investigation (read-only)

There is no `vite` or `vitest` config in `backend`, and `package.json` runs bare `vitest run`. Installed Vitest 3.2.7 therefore uses its default root and the glob `**/*.{test,spec}.?(c|m)[jt]s?(x)`. There are 92 matching backend test files. Vitest excludes `node_modules`, `dist`, and several dot-directories by default, but it does **not** exclude `.demo`; `.demo` contains a PostgreSQL data directory and live receipt/log files. None of those files match the test glob, so this is a plausible Windows/Vite root-realpath or startup cost, not a confirmed cause of the collection stall.

Tests that use external-looking Provider clients stub `fetch`; `createProviders` constructs clients without making requests. `dotenv.config()` runs at module import in `src/config/env.ts`, so `--env-file=.env.demo` makes its values available, but the inspected import path does not itself issue a network request. Six PostgreSQL integration suites do activate when `TEST_DATABASE_URL` is present and each creates a schema; that is a likely source of long suite execution after collection, but it does not explain the observed absence of any collection line by itself.

Next diagnostic run, when the integration database is idle, should be a non-paid binary search with an explicit temporary Vitest configuration: set root to `backend`, include `src/**/*.test.ts`, exclude `.demo/**` and `pgdata/**`, then use `vitest list --pool=forks --maxWorkers=1 --no-file-parallelism` per top-level source directory. It will identify the first import that blocks before executing tests. Keep database integration suites as explicit commands with `TEST_DATABASE_URL`, separate from the default unit suite. Do not interpret that proposed diagnostic as evidence yet.

## Date-range follow-up (read-only)

Date-window `to` is inclusive throughout the backend (window validation permits it, flight verification uses `date <= to`, and research derives an exact departure plus `travelDays - 1` as its inclusive final visit day). It is not an exclusive endpoint. The authored guide contains ordinal days only. The current presentation reads exact Trip `departureWindow.from` and `returnWindow.to`; the visible `2026-10-12–14` therefore reflects the stored return endpoint despite the requested two-day 12–13 itinerary. First inspect the user input, context write, and completion consistency checks. Only after the domain explicitly distinguishes visit dates from transport dates would deriving a separate guide-card end from departure plus `travelDays - 1` be appropriate. Do not mask a context error with a UI-only date change or globally reinterpret inclusive windows.
