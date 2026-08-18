# Operations Runbook — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[MANUAL OP CHECK]** · **[PROPOSED FUTURE STATE]**

## Local dev
- Providers: `npm install`.
- Data prep: `npm run prepare:data`.
- Backend: `cd server && node index.js` (or `npm run dev:all` for frontend+backend).
- Frontend: `npm run dev` (Vite, port 5174).
- Re-index only via protected operation: `npm run index:hr` (server-side, admin authz). Do not re-index arbitrarily.
- Tests: `npm test`, `npm run verify:security`, `npm run benchmark`, `npm run benchmark:dynamic`, and the deterministic suites: `node scripts/test_org_integrity.mjs`, `node scripts/test_canonical_policy.mjs`, `node scripts/test_legacy_shim_parity.mjs`, `node scripts/test_isolation_security.mjs`, `node scripts/test_persistence_restart.mjs`, `node scripts/test_admin_preview_contract.mjs`.
- Backend refuses to boot without `JWT_SECRET` (and webhook validation requires `WEBHOOK_CLIENT_STATE`) — deny-by-default. **[VERIFIED IN CODE — observed in backend boot]**

## Neon access persistence (`ACCESS_DB_ADAPTER=neon`)
- **Verified (0.6.1):** all 11 auth-gated HTTP suites PASS against a Neon-backed backend with `TEST_HTTP_TIMEOUT_MS=60000` (0 timeouts/errors). Neon adapter test `scripts/test_access_neon_adapter.mjs` = 13/13.
- **How to run auth-gated suites against Neon:** `ACCESS_DB_ADAPTER=neon TEST_HTTP_TIMEOUT_MS=60000 node scripts/test_api_*.mjs` (or `npm test` with the env exported) against a running Neon-backed backend. **[VERIFIED]**
- **IMPORTANT — adapter isolation:** the deterministic unit/regression suites (`test_org_integrity`, `test_admin_service`, `test_admin_preview_contract`, `test_isolation_security`, `test_canonical_policy`, `test_persistence_restart`, `test_legacy_shim_parity`) isolate themselves via a temp `ACCESS_DATA_DIR` and must be run WITHOUT `ACCESS_DB_ADAPTER=neon` (i.e. default JSON). If forced onto the Neon adapter they fail with `Profile not found` / seed-mismatch because the Neon adapter ignores `ACCESS_DATA_DIR`. Run them with the default adapter to get the documented counts (org integrity 32/32, admin service 20/20, etc.). **[VERIFIED]**
- **Login latency ~18 s — root cause (NOT the access adapter):** every login rewrites ALL `auth_sessions` (`server/authStore.js` → `neonSaveSessions`): `DELETE` all + sequential per-session `INSERT`. Measured ~87 ms per INSERT on Neon; with 215 accumulated sessions that is ~18 s. Connection (834 ms cold), cold pool, startup, retry and test harness are ruled out by direct timing. **[VERIFIED BY DIRECT MEASUREMENT]**
- **Operational impact:** login latency grows linearly with the session count. On a Neon-backed deployment this is an accepted limitation for demo/staging. **Recommended future optimization (NOT applied — verification task):** replace the DELETE-all + per-session INSERT loop with a single multi-row upsert (`INSERT ... ON CONFLICT`) or `TRUNCATE` + batch insert, or persist only the added/revoked rows (delta) instead of the full set. See `server/authStore.js:neonSaveSessions`.
- Read paths (admin/policy) are sub-10 ms (Neon adapter in-memory cache). **[VERIFIED]**

## Health and readiness checks
- Boot log line `[access] Model seeded: 4 profiles, 2 policies, 150 employees` confirms the access store seeded. **[VERIFIED IN CODE — observed in backend boot]**
- `GET /api/registry/status` exposes `vectors.stale` (boolean). Use it to detect stale index. **[VERIFIED IN CODE]**
- Security: `npm run verify:security` → 34/34. **[VERIFIED]**
- Live scope check: `node scripts/verify_rag_scope.mjs` (requires running backend + `TEST_ACCOUNT_PASSWORD`). **[MANUAL OP CHECK — not run here, auth not configured]**
- Isolation regression: `node scripts/test_isolation_security.mjs` → 46/46 (incl. M1/L2/L4 hardening cases). **[VERIFIED]**
- Restart durability + persistence lock: `node scripts/test_persistence_restart.mjs` → 14/14 (atomic rename, advisory write lock serialization, no stale `.tmp`/`.lock`). **[VERIFIED]**
- Legacy shim parity: `node scripts/test_legacy_shim_parity.mjs` → 38/38 (query-policy parity, zero redaction divergences). **[VERIFIED]**
- Write-path org integrity: `node scripts/test_org_integrity.mjs` → 32/32 (duplicate employeeCode 409, self-manager 400, cycles 409, missing manager 400, no partial writes). **[VERIFIED]**
- Canonical policy: `node scripts/test_canonical_policy.mjs` → 25/25 (canonicalQueryPolicy + applyFieldRedactionPolicy in chat). **[VERIFIED]**
- Admin preview contract: `node scripts/test_admin_preview_contract.mjs` → 48/48 (static; no creds/browser needed). **[VERIFIED]**
- Persistence lock hygiene (manual): after any write, confirm no `.lock` dir remains and no `.tmp-*` files linger under `server/.data/access/`; stale ones are cleaned at startup. **[MANUAL OP CHECK]**
- Dynamic org benchmark: `npm run benchmark:dynamic` → 75/75, leakage 0% (58 read-path + 17 write-path org-integrity assertions). **[VERIFIED]**
- Backend auth smoke: with a generated `JWT_SECRET`, `/api/health` OK; `/api/admin/*`, `/api/conversations`, `/api/debug/pipeline` all 401 without a token. **[VERIFIED]**

## Important operational events and safe actions
| Detection | Safe immediate action | Escalate? |
|---|---|---|
| Auth denial spike | Check authStore + rate limit counters; do not raise credentials | Warning if sustained |
| Authorization denials / RBAC fail | Inspect auditStore + policy_version; re-check policy version | Yes (security) |
| Cross-user access attempt / conversation ownership violation | Expect 403 from `conversationStore`; log correlationId; do NOT return data | Yes (security) |
| Debug pipeline served with stale policy version | `/api/debug/pipeline` drops the entry (policy version guard); user re-runs chat | No |
| OneDrive/Excel sync failure | Keep last-known-good index; expose `syncStatus=failed`; retry via protected re-index | If repeated |
| Stale index (`vectors.stale=true`) | Run protected re-index | If persists |
| Duplicate employee / cyclic manager | Validate in admin console; do not auto-fix | Yes |
| Duplicate employeeCode write rejected (409) | Write-path `orgIntegrity.js` rejects + audits `action:'rejected'`; store unchanged — no manual action | If persistent |
| Hierarchy cycle / self-manager write rejected (400/409) | Write-path rejects + audits; org unchanged — validate manager choice in admin console | If persistent |
| `POST /api/admin/preview` 401/403 | Expect from `requireAdmin`; audit actor; no data returned | Yes (security) |
| Preview contract mismatch | Run `node scripts/test_admin_preview_contract.mjs` (48/48); fix contract or UI | Yes if mismatch |
| Canonical policy bridge failure | Run `node scripts/test_canonical_policy.mjs` (25/25); block release on failure | Yes (security) |
| Legacy shim divergence | Run `node scripts/test_legacy_shim_parity.mjs` (38/38); migrate off deprecated shim | Yes if divergence |
| Auth-gated suite failed/skipped | Auto-derived from `server/.env` when `ENABLE_TEST_CREDS=true`; if a suite fails while a live backend is up, diagnose individually (Cache Hit is a flake under burst — passes isolated; SQL Fallback fails a brittle trace-label assert). Do not report PASSED unless it is | If failed while backend present |
| Concurrent admin write conflict | Advisory lock serializes same-host writers; check audit/relationships for last-writer-wins | If cross-host: BLOCKED (see PERSISTENCE.md) |
| Persistence lock timeout / stale `.lock` | Retry; stale-lock auto-break via mtime at startup; no torn files (atomic rename) | If repeated |
| Benchmark regression (leakage > 0, accuracy < 100%, integrity assertion failed) | Block release; investigate scopeResolver / orgIntegrity.js | Yes (release gate) |
| SQL failure / fallback activation | Review sqlRouting; SQL blocks non-SELECT | Yes if data impact |
| Vector empty/spike | Check scoped retrieval; confirm scope is passed pre-query | Yes if empty |
| Cache mismatch | Bump policy_version (auditStore) to invalidate | If persists |
| Admin preview shows BLOCKED for a privileged profile | Run `test_legacy_shim_parity.mjs` + `test_isolation_security.mjs`; check profile permissions | Yes if mismatch |
| `/api/debug/online` or `/api/registry/status` exposing more than allowed | Verify admin-gating (non-admins see self / configured-flag only) | Yes (security) |
| Conversation append to another user's conversation not rejected (403) | Regression of the `conversationStore.addMessage` owner arg; run `test_api_session_refresh`/`test_isolation_api`; conversations must persist to disk | Yes (security) |
| JWT access tokens identical within the same second | `jti` claim missing; run `test_api_session_refresh.mjs` (14/14) | Yes if refresh rotation broken |
| Live auth suite flake under burst (429) | 5/min login rate limit + LLM latency; run the suite in isolation on a fresh window, space logins | If persistent |
| Neon-backed session latency (~15 s/round-trip here) | Auth suites exceed timeouts vs a Neon backend in this environment; Not a product defect — size Neon or raise timeouts | If persistent |
| Admin console headless shows "network error — backend unreachable" while server returns 200 | `boot()` `/api/admin/profiles` probe harness/race artifact in headless; verify via curl + browser network log; CORS is correct | No (doc, but confirm via curl) |

## Event → Incident → Problem mapping guidance
For each event consider: what happened, which service, users affected?, data security affected?, safe immediate action, open Incident?, open Problem?, which Change can permanently fix it. **[PROPOSED FUTURE STATE — manual process until tooling implemented]**
