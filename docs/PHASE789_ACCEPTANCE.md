# Phase 7–9 local operation and acceptance

## Implemented scope

- Route details parse immutable Artifacts into selectable paths, map edges, transfer timelines, costs, reasons and source details. Saved selections are version checked and become stale when Trip Context changes.
- Cloud Trips supports paging, save/archive/restore, conversation restoration and resuming generation. Profile edits versioned Markdown Memory with enable/disable, explicit local import and deletion.
- Discovery has persistent jobs, schedules, candidate deduplication and immutable template revisions. Authenticated reviewers edit, confirm evidence, publish and unpublish; the public Explore feed excludes expired or unverified versions. Template adoption creates an idempotent cloud Trip seed with canonical places and soft preferences.
- `apps/admin` contains dashboard, review queue, source inspector, published content and run/schedule monitoring. Admin and consumer tokens are separate; viewer/reviewer/admin roles gate writes.

## Start locally (PowerShell, repository root)

```powershell
npm ci
npm --prefix backend ci
npm --prefix apps/admin ci
# Configure backend/.env using backend/.env.example; start PostgreSQL and Redis.
npm run backend:migrate
$env:ADMIN_EMAIL = 'reviewer@example.com'
$env:ADMIN_PASSWORD = Read-Host 'Admin password (14+ characters)'
$env:ADMIN_ROLE = 'admin'
npm --prefix backend run admin:create
Remove-Item Env:ADMIN_PASSWORD
npm --prefix backend run dev
```

In separate terminals run `npm --prefix backend run dev:worker` and `npm run admin:dev`. Open http://127.0.0.1:4173. The development server proxies `/v1` to port 3000. Production builds use `npm run admin:build`; serve `apps/admin/dist` with an HTTPS reverse proxy routing `/v1` to the API. This change does not deploy a public site.

Check `GET /health`. Log in, queue research for a canonical airport, inspect the candidate sources, edit the draft, confirm evidence and validity dates, and publish. `GET /v1/explore` should contain the current published template; unpublish removes it. Failed research stays failed, never auto-published. Empty relevant synthesis stays empty; raw fallback snippets cannot become Discovery candidates.

## Validation and limits

Tonight's live-demo follow-up is tracked continuously in [DEMO_STATUS.md](./DEMO_STATUS.md). The real API/Worker now produces priced one-way routes using owner-scoped fare Artifacts even without a topology snapshot, restores the successful run from PostgreSQL, and answers saved-flight follow-up questions. The current gate is 68 backend suites / 336 tests, all database tests included, plus root tests and a real-mode WeChat build. Day-by-day guide and WeChat login/runtime acceptance remain separately tracked there. Older gates below are historical evidence.

Automated regression suites cover ownership, role isolation, optimistic conflicts, expiry, idempotency, saved-route provenance, cloud restoration and worker claims. Database suites use isolated schemas in a dedicated test database; set `TEST_DATABASE_URL` before `npm --prefix backend test`. Client checks run with `npm test`; build with `npm run build:weapp` and `npm run admin:build`.

Browser acceptance exercised login, edit/save, disabled publication before verification, publish/feed visibility, unpublish, repeated navigation and responsive layouts using a separate QA database. The design reference and fidelity notes are in `design/admin-design-system.md`. QA fixture publications were isolated from production.

A live OpenRouter Planner request persisted explicit PVG→NRT intent and kept Trip input above the default origin in Memory. A live SerpApi search returned 13 verified offers. Live research quality is checked separately from request success; one unrelated result exposed and led to fixing a too-small source pool and unsafe empty-synthesis fallback.

AeroDataBox is configured in the ignored backend/.env using the direct gateway. Live acceptance returned LHR airport data, 212 daily route destinations and 11 LHR→CDG schedules for 2026-09-08. The adapter now splits FIDS requests into at most twelve-hour windows and uses the endpoint airport as the implicit departure location. The full route-generation provider chain still needs online acceptance. WeChat credentials are absent: WeChat login and device/canvas interaction remain external acceptance items. The WeChat production build is not device acceptance. Current route generation supports one origin, one destination and one outbound journey; multi-visit, round-trip and ground transport composition remain explicit unsupported boundaries. Legacy local price alerts are not a cloud monitoring service. No production deployment or content publication has been performed.

Final automated gate: 67 backend suites / 314 tests passed including all PostgreSQL integration tests (no database skips), followed by 9/9 AeroDataBox regression tests after the live fix. Root npm test, backend TypeScript build, admin production build and WeChat production build passed.

AeroDataBox contract reference: https://doc.aerodatabox.com/docs/openapi-direct-v1.json . Endpoint range limits depend on the subscription; this key returned a 12-hour limit, now respected by the adapter.

Live Discovery follow-up succeeded with one sourced candidate, TOKYO ATLAS International Art Exhibition (https://tokyoatlas.jp/en), with an October–December 2026 window. It remains unpublished and requires human verification. The narrower cultural brief with no relevant evidence correctly failed with DISCOVERY_NO_FINDINGS.
