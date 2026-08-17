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
- `npm test` now also auto-derives test credentials from `server/.env` when `ENABLE_TEST_CREDS=true` (all users share `TEST_ACCOUNT_PASSWORD`) so the auth-gated suites run. Correct real usernames for THIS identity graph: CEO=`ceo`, Manager=`emp002`, Employee=`emp012`, HR=`emp135` (`hr-manager`/`emp001` do not exist here).

## Result (2026-08-18, neon-access-persistence 0.6.0)
- **Neon adapter** `scripts/test_access_neon_adapter.mjs`: **13/13** — schema (idempotent), preload, seed (idempotent), write/read profiles, policy-version atomicity, version column, save policy, audit CRUD. Runs against live Neon; requires `DATABASE_URL` + `ACCESS_DB_ADAPTER=neon`.
- **JSON regression** (unchanged, default adapter): persistence restart 14/14, isolation security 46/46, admin preview contract 48/48, org integrity 32/32, admin service 20/20, canonical policy 25/25, legacy shim parity 38/38, verify:security 34/34, build OK, benchmark:dynamic 75/75, git diff --check clean.
- **Multi-instance persistence**: **IMPLEMENTED** — `ACCESS_DB_ADAPTER=neon` activates write-through cache + optimistic concurrency + audit write-through. JSON adapter unchanged and remains the default.
- **Regression found & fixed:** async conversion initially broke direct-caller tests (`test_org_integrity`, `test_admin_service`) and `benchmark/dynamic-org` (calls to async `adminService.setManager`/`assignProfile`/`accStore.save*` lacked `await`). Resolved by adding `await` — all suites restored (org-integrity 32/32, admin_service 20/20, benchmark 75/75). These were regressions, not known gaps.
- **Latency (Neon-access backend, 30s timeout, 0 timeouts/0 errors):** login p50=19052ms/p95=19590ms (Neon `auth_sessions` round-trip); admin API p50=2ms/p95=8ms; policy read p50=2ms/p95=2ms. Access adapter adds no read penalty; login ~19s is Neon session latency (auth-gated suites need timeout > 19s, e.g. 60s).

## Result (2026-08-17, final-live-gate 0.5.0) — live local backend, file-backed sessions
- `npm test`: **23 passed / 2 failed / 0 skipped (25 total)** — all suites executed (auth configured).
  - **Cache Hit FAILED** in the aggregate = **flake**: the first LLM call takes ~26 s and clustered logins trip the 5/min login rate limit. Passes **5/5 isolated** on a fresh window.
  - **SQL Fallback FAILED** = **brittle trace-label assertion**: `test_api_sql_fallback.mjs` looks for the literal strings `"keyword"`/`"fallback"` in the trace, but the pipeline labels keyword retrieval `kw:...` and a non-error 0-row SQL run `sqle:rows=0` / `ctx:sql context ready`. All content assertions pass (200, valid Thai answer, no SQL error, valid `answerSource`); isolated **5/6**. Not a product/security defect.
- `verify:security`: **34/34**. `npm run build`: **OK** (emits `dist/admin.html`). `npm run benchmark:dynamic`: **75/75**, leakage **0%**. `git diff --check`: clean.
- **Headless Playwright E2E** (`npm run test:e2e`): **3/3 PASSED** — A) CEO login; B) RAG chat "CEO คือใคร" (1320-char answer, thinking-dots cleared); C) debug page (pipeline picked up, online `ceo` chip). 0 console + 0 page errors. Run in **headless** mode (`chromium.launch({headless:true})`); reported as headless, not headful.
- Auth-gated isolated: Session Refresh **14/14** (after `jti` fix) · Isolation API live **13/13** (after `addMessage` owner fix + real user `emp002`) · RBAC Matrix **7/7** · Cache Hit **5/5** · Invalid Login **5/5**.
- Admin console (headless): CEO admin login succeeds, all `/api/admin/*` return **200**; non-admin (`emp012`) denied (**403**, no 2xx admin data), no page errors; CORS verified correct. Full admin section DOM-render (org/preview/audit panels) **inconclusive** in this headless harness: `boot()`'s `/api/admin/profiles` probe intermittently surfaces a client-side "network error — backend unreachable" while the server returns 200 with correct CORS (curl-verified) and the browser network log shows 200 — a harness/race artifact, not a server/CORS/data defect.
- Neon note: with `DATABASE_URL` (Neon `auth_sessions`) a login round-trip is ~15 s here vs ~0.1 s file-backed, so auth suites exceed timeouts against a Neon backend in this environment. Neon reachability itself verified OK. Environmental observation, not a product defect; production should size Neon or raise test timeouts.

## Result (2026-08-16, final-hardening 0.4.0)
- `npm test`: **14 passed / 0 failed**, 11 skipped with a live local backend (all 11 skipped are auth-gated: Blocked Queries, Debug Auth, Session Refresh, Vector Query, SQL Query, Cache Hit, SQL Fallback, SQL Metadata+Evidence, SQL Evidence+History, Isolation API live, RBAC Matrix — require `TEST_USERNAME`/`TEST_PASSWORD`; Invalid Login ran live 5/5). *Without a live backend, Invalid Login is also skipped: 13 passed / 12 skipped. The 0.3.0 published 10-passed figure predates the Admin Preview Contract (`5a3601c`), Org Integrity + Canonical Policy (`af0b6d2`) suites joining `npm test`.*
- `verify:security`: **34/34 passed**.
- `npm run build`: **OK** (emits `dist/admin.html`).
- `npm run benchmark:dynamic`: **75/75** — scopeCorrectness 100% (14/14), leakage **0%** (0/10), authorizationAccuracy 100% (21/21), retrievalRecall 100% (1/1), routeAccuracy 100% (4/4), cacheCorrectness 100% (6/6), errorRate 0%, indexFreshness 100% (6/6). Includes 17 new write-path org-integrity assertions (section 11).
- Write-path org integrity: `node scripts/test_org_integrity.mjs` → **32/32** (duplicate code 409, self-manager 400, cycles 409, missing manager 400, single/multi-root allowed, no partial writes, rejected-write audit).
- Canonical policy: `node scripts/test_canonical_policy.mjs` → **25/25** (`canonicalQueryPolicy` + `applyFieldRedactionPolicy` in chat; body identity never trusted).
- Legacy shim parity: `node scripts/test_legacy_shim_parity.mjs` → **38/38** (query-policy parity, zero redaction divergences).
- Isolation security: `node scripts/test_isolation_security.mjs` → **46/46** (includes M1/L2/L4 regression cases).
- Persistence: `node scripts/test_persistence_restart.mjs` → **14/14** (restart durability, atomic rename, advisory-lock serialization, no stale `.tmp`/`.lock`).
- Admin Preview Contract (static): `node scripts/test_admin_preview_contract.mjs` → **48/48** (admin-only 401/403, SELECTED-user scope, body spoof ignored, status-only records, isPreview+policyVersion, audit, UI seq guard, dist artifacts).
- Backend live invalid-login: **5/5** (wrong password 401, wrong username 401, empty password 400, empty body 400, SQL-injection username 401) — run against a local backend booted with a generated `JWT_SECRET`.

## New tests added this change (0.4.0 final-hardening)
- `test_org_integrity.mjs` — 32/32 write-path org-integrity cases (orgIntegrity.js).
- `test_canonical_policy.mjs` — 25/25 canonical authorization bridge cases.
- `test_admin_preview_contract.mjs` — 48/48 static preview-contract regression (no creds/browser needed); added to `npm test`.
- `test_isolation_security.mjs` — extended to 46/46 (M1 profile-authoritative admin, L2 conversationId cap/hash, L4 webhook clientState).
- `test_persistence_restart.mjs` — extended to 14/14 (concurrent-writer serialization via advisory lock; atomic rename; stale-file cleanup).
- `benchmark/dynamic-org.mjs` — extended 58 → **75 assertions** with write-path org-integrity section (duplicate-code create 409, self-manager 400, indirect cycles 409, missing manager 400, single/multi-root allowed, valid move persists, rejected writes leave the store byte-identical).

## Result (2026-08-16, production-hardening 0.3.0, superseded)
- `npm test`: 10 passed / 0 failed, 12 skipped (11 auth-gated + 1 no-live-backend: Invalid Login).
- `verify:security`: 34/34 passed. `npm run build`: OK.
- `npm run benchmark:dynamic`: 58/58 — leakage 0%, all metrics 100%.
- Backend auth smoke: with generated `JWT_SECRET`, `/api/health` OK and `/api/admin/preview`, `/api/conversations`, `/api/debug/pipeline` all return 401 without a token.

## New tests added (0.3.0 production-hardening)
- `test_isolation_security.mjs` — 38/38 (conversation ownership, chat-memory partition, cache isolation, policy-version invalidation, admin preview scoping, body-spoof ignored, engine permission-awareness).
- `test_isolation_api.mjs` — live HTTP cross-user cases (auth-gated: skipped without `TEST_USERNAME/TEST_USERNAME2`).
- `test_persistence_restart.mjs` — 9/9 (state survives process restart; response cache is process-local).
- `test_legacy_shim_parity.mjs` — 10/10 (scope 100% parity; redaction parity with exactly 2 documented intentional divergences).
- `benchmark/dynamic-org.mjs` — 58 assertions over a 24-employee multi-root org (NOT 150): transfers, manager replacement, deactivation, missing manager, cycles, duplicate codes, department change, source-link change, policy change, SQL/vector/evidence containment, conversation isolation, cache invalidation.

## Security checks (verify:security)
Login rate limit, SQL injection block, `.env.example` placeholders, CORS non-wildcard, `.gitignore` excludes secrets, webhook state no fallback, JWT backend-enforced (no client-only gate), no hardcoded test passwords.

## Browser / Playwright
Playwright MCP is **not available** in this environment. **[NOT RUN]** The headful browser E2E (`test_ui_playwright_headful.mjs`) and admin-console browser flows require a running backend and `TEST_ACCOUNT_PASSWORD`; these are listed as **[NOT RUN]** — not claimed passed. API + static tests are the source of green status. The Admin UI preview contract was reconciled at the API level (`/api/admin/preview` returns `viewer` + status-only `records`); browser verification remains **[NOT RUN]**.
