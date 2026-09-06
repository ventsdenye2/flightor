# Codex Kickoff Prompt — FlightOR Agent Architecture v1

You are the lead implementation engineer for the repository:

`ventsdenye2/flightor`

Your task is to migrate the current project toward the architecture defined in the root document:

`FLIGHTOR_ARCHITECTURE.md`

## Mandatory first steps

1. Read `FLIGHTOR_ARCHITECTURE.md` completely.
2. Read the current repository structure and identify the existing:
   - conversation agent;
   - OpenRouter adapter;
   - route planner;
   - SerpApi integration;
   - OAG integration;
   - frontend Plan/Search/Explore/Profile pages;
   - chatStore/userStore;
   - database migrations and tests.
3. Do **not** immediately rewrite or move the whole project.
4. Produce a short implementation plan grouped by architecture phase.
5. Start with **Phase 0 + Phase 1** only unless a dependency requires a small preparatory change.

## Architecture rules that must not be violated

- The LLM becomes the primary semantic interpreter.
- Do not use business regex parsing as the authoritative understanding layer.
- Deterministic validation remains mandatory at tool/provider boundaries.
- Agent tools return structured results/artifact references.
- `AeroDataBox` is the primary aviation-data provider.
- `SerpApi` is the primary fare provider.
- `OAG` is optional only; FlightOR must run without OAG credentials.
- Memory, Trip Context, Conversation and Artifacts are separate domains.
- User Memory is cloud-backed, user-editable Markdown.
- Current trip constraints override Memory.
- Route generation is explicitly triggered by the user.
- Preferred cities influence both destination and stopover selection, but remain soft preferences.
- FlightOR must support self-transfer, long stopovers and airport changes with explicit risk handling.
- Do not remove flight search. Reuse it through one shared `FlightSearchArtifact` path for both manual UI and Agent tool calls.
- Explore content must follow discovery → AI draft → human review → publish.
- AI must not auto-publish Explore content in v1.
- External factual data must retain internal provenance/verification metadata.
- Visa/entry eligibility must never be presented as guaranteed.
- Avoid destructive directory moves during early phases.
- Keep the repository buildable and tested after each milestone.

## First implementation milestone

Implement the architecture foundation:

### A. Root documentation

Create or update:

- `TOOLS.md`

Document each Agent-facing tool with:

- status;
- purpose;
- input;
- output;
- side effects;
- cost class;
- authority;
- provider dependencies;
- cache behavior;
- failure behavior.

Do not mark a tool implemented until code + tests exist.

### B. Tool-calling LLM adapter

Extend the OpenRouter client so it can support:

- tool schemas;
- tool calls;
- assistant tool-call messages;
- tool-result messages;
- bounded reasoning configuration;
- deterministic parsing of provider responses.

Maintain compatibility with current models when possible.

### C. Agent Runtime

Introduce a new Agent runtime, preferably under:

`backend/src/agent/runtime/`

Requirements:

- bounded step count;
- bounded provider/tool cost per turn;
- tool registry;
- schema validation;
- support independent parallel tool calls where safe;
- generation/request cancellation protection;
- structured tracing;
- deterministic fallback on failure.

Do not yet delete the old conversation-agent path. Build the replacement beside it first.

### D. Provider abstractions

Introduce:

```ts
interface AviationProvider {
  resolveLocation(...)
  getAirport(...)
  getAirportRoutes(...)
  getSchedules(...)
  getFlightStatus(...)
}
```

and:

```ts
interface FareProvider {
  searchFlights(...)
  searchFlexibleFlights(...)
  refreshFlight(...)
}
```

Implement:

- `MockAviationProvider`
- `MockFareProvider`

Create the real AeroDataBox adapter shell and configuration surface.

Keep OAG behind an optional implementation/fallback.

Normalize provider responses into FlightOR-owned domain types.

### E. Configuration

Add safe env/config entries for AeroDataBox, for example:

```text
AERODATABOX_API_KEY
AERODATABOX_BASE_URL
```

Never log or expose keys.

Keep OAG variables optional.

### F. First tools

Implement a minimal vertical slice with tests:

1. `get_trip_context`
2. `update_trip_context`
3. `resolve_location`
4. `search_flights`

The purpose of this slice is to prove:

```text
User message
→ LLM
→ tool call
→ deterministic tool execution
→ structured result
→ final LLM response
```

without rule-first semantic extraction.

## Migration discipline

- Prefer small commits.
- Preserve current public API where practical.
- If the old frontend requires old response fields, temporarily adapt the new runtime output rather than rewriting frontend and backend simultaneously.
- Add tests before deleting old behavior.
- Keep current route planner and useful SerpApi code unless replacement is demonstrably better.
- Do not remove the existing SearchPage functionality; later it becomes Flight Explorer.

## Testing requirements for milestone 1

At minimum add tests covering:

1. tool-call parsing;
2. unknown tool rejection;
3. malformed tool args;
4. tool timeout/failure;
5. maximum tool-step cutoff;
6. `update_trip_context` mutation;
7. `resolve_location` through mock provider;
8. `search_flights` through mock fare provider;
9. no OAG configuration present;
10. one complete Agent conversation that successfully uses a tool.

Run:

- backend typecheck;
- backend test suite;
- backend build;
- existing root tests where still applicable.

Do not suppress existing failing tests without documenting why.

## Required final report after milestone 1

When finished, report:

1. files added/changed;
2. architecture decisions made;
3. tests added;
4. test/build results;
5. compatibility behavior retained;
6. known gaps;
7. which Phase 2 task should be done next.

Do not continue into a large frontend rewrite until the Agent runtime and provider abstractions are stable.



## Multi agent mode

You are the lead engineer and architecture owner.

Run as the primary GPT-5.6 Sol High orchestrator. Use Luna subagents aggressively for bounded auxiliary work to reduce cost and context usage, but do not delegate consequential architecture decisions.

### Sol owns

- architecture and domain boundaries;
- Agent Runtime design;
- Tool contracts;
- TripContext / Memory / Artifact semantics;
- provider abstraction design;
- Connection Engine architecture;
- Route Optimizer architecture;
- database identity/concurrency decisions;
- security-sensitive design;
- cross-domain debugging;
- integration;
- final code review and acceptance.

### Delegate to Luna when the task is

- clearly bounded;
- independently testable;
- limited to a known set of files;
- primarily implementation rather than architecture;
- repository reconnaissance;
- test creation;
- mock/fixture creation;
- provider adapter implementation against an already-defined interface;
- schema/Zod implementation against an approved contract;
- mechanical refactoring;
- documentation synchronization;
- isolated frontend component implementation.

Prefer cheaper Luna effort levels for scanning, documentation, tests, mocks and mechanical work. Use Luna Max only for bounded tasks whose implementation is genuinely non-trivial.

### Subagent context policy

Do not fork the complete orchestrator context unless absolutely necessary.

Each worker should receive only:

- its goal;
- relevant architecture constraints;
- relevant interfaces;
- required source files;
- acceptance criteria.

Avoid making Luna inherit irrelevant prior reasoning.

### Every delegated task must specify

GOAL
One measurable outcome.

CONTEXT
Only information needed to perform the task.

OWNERSHIP
Exact files/directories the worker may modify.

DO NOT
Architecture decisions or files outside its scope.

ACCEPTANCE
Required tests, typecheck or observable behavior.

RETURN

- summary;
- files changed;
- tests run and results;
- assumptions;
- unresolved risks.

### Parallelism

Parallelize only independent tasks with non-overlapping file ownership.

Do not allow multiple workers to modify the same integration file concurrently.

Use read-only Luna workers freely for repository reconnaissance before making architecture decisions.

### Integration rule

Luna workers provide candidate implementations, not final architectural authority.

After workers return:

1. inspect their diffs;
2. verify compliance with `FLIGHTOR_ARCHITECTURE.md` and `TOOLS.md`;
3. resolve inconsistencies yourself;
4. run integration tests;
5. only then accept the milestone.

Do not spawn a Sol-equivalent child for routine work. Use the cheapest capable worker.
