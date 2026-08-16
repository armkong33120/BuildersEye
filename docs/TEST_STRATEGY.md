# Test Strategy — BuildersEye org-access redesign

Status flags: **[VERIFIED IN CODE]** (actually run green) · **[NOT RUN]** (not executed in this environment)

## Commands
- `npm test` → `scripts/run_all_tests.mjs` (aggregates unit + API tests)
- `npm run test:api` → RBAC matrix (auth-gated)
- `npm run verify:security` → security/static checks
- `npm run test:e2e` → `scripts/test_ui_playwright_headful.mjs` (login→chat→debug, needs live backend + test password)
- `npm run benchmark` → `benchmark/runner.mjs`

## Result (2026-08-16)
- `npm test`: **8 passed / 0 failed**, 10 skipped (auth-gated: Blocked Queries, Debug Auth, Session Refresh, Vector Query, SQL Query, Cache Hit, SQL Fallback, SQL Metadata+Evidence, SQL Evidence+History, RBAC Matrix).
- `verify:security`: **34/34 passed**.
- `npm run build`: **OK** (emits `dist/admin.html`).

## New tests added this change
- `test_access_model.mjs` — 30/30 (role/profile mapping, org levels, subtree, direct reports, move, deactivate, cycle, missing manager, source ownership, field inheritance, deny-over-allow, redact, policy versioning, cache invalidation).
- `test_admin_service.mjs` — 20/20.
- `test_admin_api.mjs` — 9/9 (read/write separation, 403 non-admin, 401 unauthenticated, body-spoof ignored).
- `test_source_links.mjs`, `test_vector_staleness.mjs`, `test_scope_context.mjs`, `verify_rag_scope.mjs`.

## Security checks (verify:security)
Login rate limit, SQL injection block, `.env.example` placeholders, CORS non-wildcard, `.gitignore` excludes secrets, webhook state no fallback, JWT backend-enforced (no client-only gate), no hardcoded test passwords.

## Browser / Playwright
Playwright MCP is **not available** in this environment. **[NOT RUN]** The headful browser E2E (`test_ui_playwright_headful.mjs`) and admin-console browser flows require a running backend and `TEST_ACCOUNT_PASSWORD`; these are listed as **[NOT RUN]** — not claimed passed. API + static tests are the source of green status.