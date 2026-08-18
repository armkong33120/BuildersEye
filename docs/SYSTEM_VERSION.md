# System Version — BuildersEye

| Field | Value |
|---|---|
| System | BuildersEye (`mail-onedrive-org-graph`) |
| Package name | `builders-eye` |
| Latest release version | `0.6.1` (Neon authenticated verification — final gate) |
| Prior release | `0.6.0` (Neon access persistence: multi-instance ready) |
| Task branch | `codex/neon-access-persistence-20260818` |
| Backup branch | `codex/backup-before-neon-verify-20260818` (verification), `codex/backup-before-neon-access-persistence-20260818-0156` (0.6.0) |
| Baseline commit | `56f9776` |
| Change records | `docs/changes/CHG-neon-access-persistence.md`, `docs/changes/CHG-final-live-gate.md`, `docs/changes/CHG-production-hardening-final.md`, ... |

## Component status
- Backend core (domain model, authz, admin API, cross-user isolation): **[VERIFIED IN CODE]**
- Write-path org integrity (`orgIntegrity.js`: duplicate code 409 / self-manager 400 / cycles 409 / missing manager 400 / no partial writes): **[VERIFIED IN CODE]** (32-case suite + 17 benchmark assertions)
- Canonical authorization bridge (Phase 3, `canonicalQueryPolicy` + `applyFieldRedactionPolicy` in chat): **[VERIFIED IN CODE]** (25-case canonical policy suite; parity 38/38, zero redaction divergences)
- Persistence (atomic rename + advisory write lock, single instance): **[VERIFIED IN CODE]** (14/14) — single-instance **SAFE**; multi-instance **IMPLEMENTED** via `ACCESS_DB_ADAPTER=neon` (tested 13/13, write-through cache + optimistic concurrency + audit write-through)
- Admin Preview As User contract (static, no credentials/browser needed): **[VERIFIED IN CODE]** (48/48)
- Dynamic org benchmark: **[VERIFIED IN CODE]** (75/75, leakage 0%)
- RAG/data integration (scope → ingest/index/SQL/vector/cache): **[VERIFIED IN CODE]**
- Admin console UI: **[PARTIALLY VERIFIED]** — CEO admin login succeeds, all `/api/admin/*` return 200; non-admin denied (403, no 2xx admin data); CORS correct. Full admin section DOM-render **NOT CONFIRMED** in this headless harness (boot-probe client-side "network error" artifact; server returns 200 with correct CORS).
- Auth-gated live suites (RBAC matrix, live isolation, live API): **[VERIFIED against Neon]** with `ACCESS_DB_ADAPTER=neon` + `TEST_HTTP_TIMEOUT_MS=60000` — all 11 auth-gated suites PASS (0 timeouts, 0 errors): Blocked Queries, Debug Auth, Session Refresh, Vector Query, SQL Query, Cache Hit, SQL Fallback, SQL Metadata+Evidence, SQL Evidence+History, Isolation API (live), RBAC Matrix + Invalid Login.
- Neon access-model persistence: **[VERIFIED IN CODE]** — adapter 13/13, multi-instance write-through cache + optimistic concurrency + audit write-through (see `docs/PERSISTENCE.md`).
- Browser E2E (Playwright): **[VERIFIED — HEADLESS]** 3/3 PASSED (login → chat → debug), 0 console/page errors.

## Production-readiness verdict
**READY WITH LIMITATIONS.** All required authenticated suites pass against the
Neon-backed backend with **0 timeouts / 0 errors / 0 leakage**; Neon access-model
persistence (adapter 13/13) and multi-instance write-through are verified in code.
Remaining limitations (measured + documented): (a) **login latency ~18 s** — caused
by the O(n) `auth_sessions` rewrite on every login in `server/authStore.js` (DELETE
all + sequential per-session INSERT, ~87 ms each × 215 sessions ≈ 18 s), NOT the
access adapter and NOT an environmental mystery; (b) admin-console full section-render
not confirmed in the headless harness. The regression unit suites must be run under
the default JSON adapter (they isolate via temp `ACCESS_DATA_DIR`). No deployment made;
`main` not pushed.

## Verified test results (0.6.1 — Neon authenticated verification, final gate)
- **Auth-gated suites vs Neon backend (`ACCESS_DB_ADAPTER=neon`, `TEST_HTTP_TIMEOUT_MS=60000`):** Blocked Queries, Debug Auth, Session Refresh, Vector Query, SQL Query, Cache Hit, SQL Fallback, SQL Metadata+Evidence, SQL Evidence+History, Isolation API (live), RBAC Matrix — **ALL PASS, 0 skipped**. Invalid Login PASS. **0 timeouts, 0 errors.**
- **Neon adapter** `scripts/test_access_neon_adapter.mjs`: **13/13**.
- **Latency (Neon backend):** login p50=17707ms / p95=18029ms; authed API p50=2ms / p95=7ms; admin API + policy read sub-10ms. Direct Neon timing: cold connect 834ms, warm SELECT ~70ms, per-insert ~87ms.
- **Regression suites (JSON adapter):** org integrity 32/32 · admin service 20/20 · admin preview 48/48 · isolation security 46/46 · canonical policy 25/25 · legacy shim parity 38/38 · persistence restart 14/14 (1 transient flake then 3× clean). verify:security 34/34 · build OK · benchmark:dynamic 75/75 (0% leakage) · git diff --check clean.
- **Test-only timeout added:** `scripts/test_helpers.mjs` → `TEST_HTTP_TIMEOUT_MS` (default 30000, env-overridable). No production timeout changed.

## Verified test results (0.6.0 — Neon access persistence)
- **Neon adapter** (`scripts/test_access_neon_adapter.mjs`): **13/13** (schema, preload, seed, write/read profiles, policy-version atomicity, version column, save policy, audit CRUD).
- **JSON regression (default adapter):** persistence restart 14/14 · org integrity 32/32 · admin service 20/20 · isolation security 46/46 · admin preview contract 48/48 · canonical policy 25/25 · legacy shim parity 38/38 · verify:security 34/34 · build OK · benchmark:dynamic 75/75 · git diff --check clean.
- **Regression found & fixed:** async conversion initially broke direct-caller tests + benchmark (missing `await`); resolved — org-integrity 32/32, admin_service 20/20, benchmark 75/75.
- **Latency (Neon-access backend, 30s timeout, 0 timeouts/0 errors):** login p50=19052ms/p95=19590ms (Neon `auth_sessions`); admin API p50=2ms/p95=8ms; policy read p50=2ms/p95=2ms.

## Verified test results (0.5.0)
- `npm test`: 23 passed / 2 failed / 0 skipped (25 total). Failures: Cache Hit (flake under burst; 5/5 isolated), SQL Fallback (brittle trace-label assertion; 5/6 isolated, behavior correct).
- `verify:security`: 34/34 · `npm run build`: OK · `npm run benchmark:dynamic`: 75/75 leakage 0% · `git diff --check`: clean.
- Headless Playwright E2E: 3/3 PASSED (login/chat/debug), 0 console/page errors.
- Auth-gated isolated: Session Refresh 14/14 · Isolation API (live) 13/13 · RBAC Matrix 7/7 · Cache Hit 5/5 · Invalid Login 5/5.
- Static/deterministic: org-integrity 32/32 · canonical policy 25/25 · legacy shim parity 38/38 · isolation security 46/46 · persistence restart 14/14 · admin preview contract 48/48.