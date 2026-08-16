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

## Result (2026-08-16, final-hardening 0.4.0)
- `npm test`: **12 passed / 0 failed**, 11 skipped with a live local backend (all 11 skipped are auth-gated: Blocked Queries, Debug Auth, Session Refresh, Vector Query, SQL Query, Cache Hit, SQL Fallback, SQL Metadata+Evidence, SQL Evidence+History, Isolation API live, RBAC Matrix — require `TEST_USERNAME`/`TEST_PASSWORD`; Invalid Login ran live 5/5). *Without a live backend, Invalid Login is also skipped: 11 passed / 12 skipped. The previously published 10-passed figure predates the Admin Preview Contract suite joining `npm test` (commit `5a3601c`).*
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
