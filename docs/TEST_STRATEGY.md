# Test Strategy — BuildersEye org-access redesign + production hardening

Status flags: **[VERIFIED IN CODE]** (actually run green) · **[NOT RUN]** (not executed in this environment)

## Commands
- `npm test` → `scripts/run_all_tests.mjs` (aggregates unit + API tests)
- `npm run test:api` → RBAC matrix (auth-gated)
- `npm run verify:security` → security/static checks
- `npm run test:e2e` → `scripts/test_ui_playwright_headful.mjs` (login→chat→debug, needs live backend + test password)
- `npm run benchmark` → `benchmark/runner.mjs`
- `npm run benchmark:dynamic` → `benchmark/dynamic-org.mjs` (deterministic dynamic-org benchmark)
- `npm test` now probes backend health first: HTTP-only suites are SKIPPED (not failed) when no server is running.

## Result (2026-08-16, production-hardening)
- `npm test`: **10 passed / 0 failed**, 12 skipped (11 auth-gated: Blocked Queries, Debug Auth, Session Refresh, Vector Query, SQL Query, Cache Hit, SQL Fallback, SQL Metadata+Evidence, SQL Evidence+History, Isolation API live, RBAC Matrix; 1 no-live-backend: Invalid Login).
- `verify:security`: **34/34 passed**.
- `npm run build`: **OK** (emits `dist/admin.html`).
- `npm run benchmark:dynamic`: **58/58** — scopeCorrectness 100%, leakage 0%, authorizationAccuracy 100%, retrievalRecall 100%, routeAccuracy 100%, cacheCorrectness 100%, errorRate 0%, indexFreshness 100%.
- Backend auth smoke: with generated `JWT_SECRET`, `/api/health` OK and `/api/admin/preview`, `/api/conversations`, `/api/debug/pipeline` all return 401 without a token.

## New tests added this change
- `test_isolation_security.mjs` — 38/38 (conversation ownership, chat-memory partition, cache isolation, policy-version invalidation, admin preview scoping, body-spoof ignored, engine permission-awareness).
- `test_isolation_api.mjs` — live HTTP cross-user cases (auth-gated: skipped without `TEST_USERNAME/TEST_USERNAME2`).
- `test_persistence_restart.mjs` — 9/9 (state survives process restart; response cache is process-local).
- `test_legacy_shim_parity.mjs` — 10/10 (scope 100% parity; redaction parity with exactly 2 documented intentional divergences).
- `benchmark/dynamic-org.mjs` — 58 assertions over a 24-employee multi-root org (NOT 150): transfers, manager replacement, deactivation, missing manager, cycles, duplicate codes, department change, source-link change, policy change, SQL/vector/evidence containment, conversation isolation, cache invalidation.

## Security checks (verify:security)
Login rate limit, SQL injection block, `.env.example` placeholders, CORS non-wildcard, `.gitignore` excludes secrets, webhook state no fallback, JWT backend-enforced (no client-only gate), no hardcoded test passwords.

## Browser / Playwright
Playwright MCP is **not available** in this environment. **[NOT RUN]** The headful browser E2E (`test_ui_playwright_headful.mjs`) and admin-console browser flows require a running backend and `TEST_ACCOUNT_PASSWORD`; these are listed as **[NOT RUN]** — not claimed passed. API + static tests are the source of green status. The Admin UI preview contract was reconciled at the API level (`/api/admin/preview` returns `viewer` + status-only `records`); browser verification remains **[NOT RUN]**.
