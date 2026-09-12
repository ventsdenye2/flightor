# Current research component adapter

`runCurrentSystem({ baselineRoot, testCase, complete, model, signal, onSearch })`
loads the actual TypeScript implementation under `baselineRoot/backend/src`:
`ProductionResearchAgent`, `SerpApiResearchSearchProvider`,
`OpenRouterResearchSynthesisModel`, and `SerpApiClient`.
The installed baseline `tsx/esm/api` supplies a scoped import hook. No backend
source is copied or modified, and no separate build is needed.

`testCase.brief` must be a backend `ResearchBrief`; optional preferences are
`testCase.context.preferenceSummary`. The explicit `model` is passed into the
existing synthesis model. `complete({ messages, model, options })` must return
the backend `ChatCompletion` shape. The caller owns model usage/cost accounting,
including failures before the completion reaches the component.

Searches use `SERPAPI_API_KEY`, falling back to the current backend spelling
`SERPAPI_KEY`. `SERPAPI_BASE_URL` defaults to the existing SerpApi endpoint.
The adapter never reads an env file or writes/logs credentials. Every organic
search awaits `onSearch?.({ provider: 'serpapi' })` before dispatch. The callback
must reserve budgets atomically because the current component uses two workers.
A rejected reservation cancels the run and drains already-dispatched searches.

Returns `{ artifact, searchCalls, warnings, raw }`. `searchCalls` counts actual
client dispatch attempts, including provider failures and in-flight cancellations;
it is not confirmed SerpApi billing. `artifact.queryCount` comes from the current
component and can differ from dispatch count. `raw.searches` records sanitized
queries and request outcomes. `raw.synthesis` records completion count and
success/failure even when production code returns fallback findings. In
particular, a successful outer return does not imply successful synthesis.
Each search and synthesis records UTC `startedAt` and monotonic `elapsedMs`,
including failures and cancellations. Search timing includes budget reservation;
synthesis timing remains null if synthesis never starts. Concurrent search times
must not be added together to represent elapsed user waiting time.
Top-level errors expose the same result as `error.currentSystemResult` with a
nullable artifact. Error diagnostics contain names/codes only.

The assembly deliberately omits a query planner, matching the current
`routes/agent-cloud.ts` conversation path. This is a **research-component
baseline**, not a CloudPlanner, database persistence, Goal verification, travel
guide composition, or frontend end-to-end assessment.

Offline verification from this worktree:

```powershell
node --test experiments/travel-research/current-system.test.mjs
```

Tests use the parent repository as baseline by default. To target another
checkout, set `FLIGHTOR_BASELINE_ROOT`. Tests replace fetch with fixture responses
and use a dummy SerpApi key; they make no paid provider calls. They cover real
source assembly, production synthesis fallback, failures, cancellation, and
budget rejection while another search is in flight. Windows sandbox process
restrictions may block Node/tsx with `spawn EPERM`; this is an environment failure.
